// ─────────────────────────────────────────────────────────────────────────────
// 슬롯 상태 머신 (입력 수집)
//
// 설계 원칙 (확정 스펙):
//  - 슬롯: schoolId(필수) / totalWeeks(필수) / courses[](필수) / dormitories[](필수, 통학 면제)
//          / startDate(선택, 없어도 계산 진행 — 서차지는 "확인필요" 표시)
//  - 수집 순서: 학원 → 총주수 → 코스 → 기숙  (시작일은 막지 않음)
//  - 매 턴: 대화 전체에서 슬롯을 추출·누적(덮어쓰기 아님). 여러 슬롯 동시 갱신 가능.
//  - 학원 미확정이면 멈춤: 하위 슬롯 진행/LLM 호출/계산 안 함.
//  - 모호/복합(코스 종류 여러개, 방이동)이면 그 슬롯만 선택지로 되묻기 or LLM 폴백.
//  - 충돌(코스/기숙 주수 합 ≠ 총주수): 계산 진행 말고 "무엇을 고칠지" 선택지로 되물음.
//  - 추측 금지. 확정 전 확인.
//  - 지역(세부/바기오) 판단은 견적에 불필요 → 입력 수집에서 사용하지 않음.
// ─────────────────────────────────────────────────────────────────────────────

import type { School, Course, Dormitory } from '@/types'
import { parseQuoteIntent, parseStartDate, parseWeeks, matchCourses, matchDorms, parseRows } from './parseQuoteIntent'

export interface Slots {
  schoolId: string | null
  totalWeeks: number | null
  courses: Array<{ courseId: string; weeks: number }>
  dormitories: Array<{ dormitoryId: string; weeks: number }>
  startDate: string          // '' = 미정(명시) 또는 아직 안 받음. dateProvided로 구분.
  startDateProvided: boolean // 사용자가 시작일/미정을 명시적으로 답했는가
  noDorm: boolean            // 통학(기숙사 없음) 명시
}

export type StepResult =
  | { kind: 'need_school'; options: Array<{ id: string; name: string }> | null }   // 학원 미확정 (멈춤)
  | { kind: 'need_weeks' }                                                          // 총주수 필요
  | { kind: 'need_course'; schoolId: string }                                       // 코스 선택 필요
  | { kind: 'need_course_disambiguation'; schoolId: string; hint: string }          // 코스 모호 → 그 코스만 되묻기
  | { kind: 'need_dorm'; schoolId: string }                                         // 기숙 선택 필요
  | { kind: 'conflict_weeks'; which: 'course' | 'dorm'; sum: number; total: number } // 주수 합 ≠ 총주수
  | { kind: 'need_start_date'; slots: Slots }                                       // 시작일 묻기 (미정 선택 가능)
  | { kind: 'needs_llm'; reason: string }                                           // 복합 입력 → LLM 폴백
  | { kind: 'ready'; slots: Slots }                                                 // 모든 필수 충족 → 확인/계산

const EMPTY_SLOTS: Slots = {
  schoolId: null, totalWeeks: null, courses: [], dormitories: [],
  startDate: '', startDateProvided: false, noDorm: false,
}

// 통학/기숙사 없음 명시 감지
function saysNoDorm(text: string): boolean {
  return /통학|기숙사\s*없|기숙\s*안|noroom|외부\s*거주|숙소\s*없/i.test(text)
}

// 기숙/방을 언급했는지 (언급했는데 못 잡으면 확정 보류)
function mentionsDorm(text: string): boolean {
  return /인실|기숙|룸|room|single|twin|double|triple|quad|스위트|suite|콘도|condo|디럭스|deluxe|발코니|balcony|오션|씨티|시티|건물|바깥|알리시아|alicia/i.test(text)
}

// 버튼/드롭다운 선택 텍스트에서 항목명이 데이터와 정확히 일치하는지 찾는다.
// 선택지는 "코스명 (1,420,000원/4주)" 형태이므로 가격 꼬리표를 떼고 비교.
// 정확 일치가 있으면 접두사([Sparta] 등)로 인한 오모호 없이 그 항목을 바로 반환.
function matchExactName(text: string, items: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const cleaned = text.replace(/\s*\([^)]*원[^)]*\)\s*$/g, '').trim()
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const target = norm(cleaned)
  if (!target) return null
  for (const it of items) {
    if (norm(it.name) === target) return { id: it.id, name: it.name }
  }
  return null
}

// 코스를 언급했는지
function mentionsCourse(text: string): boolean {
  return /esl|ielts|toeic|toefl|business|비즈니스|pic|sparta|스파르타|semi|세미|speaking|회화|스피킹|intensive|power|파워|tep|guarantee|보장|classic|클래식|specific|코스|과정/i.test(text)
}

// 텍스트에 서로 다른 코스 종류가 몇 개 언급됐는지 (복합 조합 판단용).
// 예: "파워6 4주 아이엘츠 8주" → 2 (파워 + 아이엘츠).  "IELTS 12주" → 1.
function countCourseKinds(text: string): number {
  const t = text.toLowerCase()
  const groups = [
    /ielts|아이엘츠/,
    /toeic|토익/,
    /toefl|토플/,
    /power|파워|스피킹|speaking/,
    /esl|이에스엘/,
    /business|비즈니스/,
    /tep/,
    /classic|클래식/,
    /specific|스페시픽/,
  ]
  return groups.filter(re => re.test(t)).length
}

/**
 * 대화 전체(userMsgs, 오래된→최신 순)에서 슬롯을 누적 추출한다.
 * 학원은 최근 메시지부터 거슬러 올라가며 식별되는 첫 학원을 사용(후속 턴에서 학원 유지).
 * 학원이 확정(auto)돼야 그 학원 데이터로 코스/기숙을 매칭한다.
 */
export function extractSlots(
  userMsgs: string[],
  schools: School[],
  aliasData?: Record<string, string[]>,
): { slots: Slots; schoolChoices: Array<{ id: string; name: string }> | null; ambiguous: { course?: string; dorm?: boolean }; needsLlm: string | null } {
  const slots: Slots = { ...EMPTY_SLOTS, courses: [], dormitories: [] }
  let schoolChoices: Array<{ id: string; name: string }> | null = null
  const ambiguous: { course?: string; dorm?: boolean } = {}
  let needsLlm: string | null = null

  // ── 1) 학원 확정 (최우선) ──────────────────────────────────────────────
  // 최근 메시지부터 거슬러 학원을 본다. auto(확정)가 가장 강하므로 전체에서 auto를 먼저 찾는다.
  // auto가 하나도 없을 때만 choices(애매)를 후보로 쓴다.
  // (후속 턴의 "IELTS Guarantee" 같은 코스 단어가 엉뚱한 학원을 choices로 잡아도,
  //  앞선 메시지의 학원 auto가 우선되어 학원이 유지된다.)
  let firstChoices: Array<{ id: string; name: string }> | null = null
  for (let i = userMsgs.length - 1; i >= 0; i--) {
    const txt = (userMsgs[i] ?? '').trim()
    if (!txt) continue
    const pf = parseQuoteIntent(txt, schools, aliasData)
    if (pf.school.kind === 'auto') {
      slots.schoolId = pf.school.pick.id
      schoolChoices = null
      break
    }
    if (pf.school.kind === 'choices' && !firstChoices) {
      // 가장 최근의 choices를 기억해두되, 계속 거슬러 올라가 auto를 찾는다.
      firstChoices = pf.school.options.map(o => ({ id: o.id, name: o.name }))
    }
  }
  if (!slots.schoolId && firstChoices) {
    schoolChoices = firstChoices
  }

  // 학원 미확정이면 여기서 종료 (하위 슬롯 진행 안 함)
  if (!slots.schoolId) {
    return { slots, schoolChoices, ambiguous, needsLlm }
  }

  const school = schools.find(s => s.id === slots.schoolId)
  if (!school) return { slots, schoolChoices: null, ambiguous, needsLlm }

  // ── 2) 총주수 / 시작일 / 코스 / 기숙 누적 추출 ─────────────────────────
  // 학원 확정 후, 전체 대화에서 나머지 슬롯을 누적한다.
  // 코스/기숙은 parseQuoteIntent의 학원매칭에 의존하지 않고, 확정 학원으로 직접 매칭한다.
  const courseList = (school.courses ?? []).map(c => ({ id: c.id, name: c.name }))
  const dormList = (school.dormitories ?? []).map(d => ({ id: d.id, name: d.name }))

  for (const raw of userMsgs) {
    const txt = (raw ?? '').trim()
    if (!txt) continue
    // 버튼/드롭다운 선택 텍스트의 가격 꼬리표("(1,420,000원/4주)")는 주수 파싱을 오염시키므로 제거한 사본으로 주수를 본다.
    const txtNoPrice = txt.replace(/\([^)]*원[^)]*\)/g, ' ')

    // 총주수: 부분 주수(방이동 "3인실 4주 8주", 코스 분할)가 총주수를 덮어쓰지 않게 한다.
    //  - 한 메시지에 주수가 2개 이상이면 그건 분할(방이동/복합)이므로 총주수로 잡지 않는다.
    //  - "총 N주" 또는 "N주 동안" 같은 명시는 항상 총주수.
    //  - 그 외 주수 1개는, 아직 총주수가 없을 때만 채운다(이미 있으면 부분 주수일 수 있어 덮어쓰지 않음).
    const weekMatches = (txtNoPrice.match(/(\d+)\s*(?:주|weeks?|w)(?![가-힣a-z])/gi) ?? [])
    const explicitTotal = /총\s*\d+\s*주|\d+\s*주\s*(?:동안|짜리|과정|코스로|로\s*변경|으로\s*변경)/.test(txtNoPrice)
    if (explicitTotal) {
      const wk = parseWeeks(txtNoPrice)
      if (wk != null) slots.totalWeeks = wk
    } else if (weekMatches.length === 1) {
      const wk = parseWeeks(txtNoPrice)
      // 방/코스 키워드가 같이 있으면 그 주수는 부분 주수일 수 있다 → 총주수 미설정일 때만 채움
      const hasItemKeyword = mentionsCourse(txtNoPrice) || mentionsDorm(txtNoPrice)
      if (wk != null && (!hasItemKeyword || slots.totalWeeks == null)) {
        slots.totalWeeks = wk
      }
    }
    // weekMatches.length >= 2 → 분할 입력. 총주수는 건드리지 않는다.

    // 시작일
    if (/미정|무관|상관\s*없|아무\s*때|언제든|나중에/i.test(txt)) {
      slots.startDate = ''
      slots.startDateProvided = true
    } else {
      const sd = parseStartDate(txt)
      if (sd.date) { slots.startDate = sd.date; slots.startDateProvided = true }
    }

    // 통학 명시
    if (saysNoDorm(txt)) { slots.noDorm = true; slots.dormitories = [] }

    // 코스: 복합 판단은 "서로 다른 코스 종류를 몇 개 말했나"로 한다.
    // (주수 개수로 판단하면 "12주 IELTS 12주"처럼 총주수+코스주수가 겹칠 때 복합으로 오인됨)
    if (mentionsCourse(txt)) {
      // "나머지/잔여" 자연어 분할은 파서가 못 나눔 → LLM
      const hasRemainderC = /나머지|잔여|남은/.test(txt)
      // 버튼/드롭다운 선택은 "코스명 (가격원/4주)" 형태로 들어온다.
      // 가격 꼬리표를 떼고 코스명이 데이터와 정확히 일치하면 그대로 채택(접두사 [Sparta] 등으로 인한 오모호 방지).
      const exactCourse = matchExactName(txt, courseList)
      if (exactCourse) {
        // 버튼 선택은 단일 코스. 가격 꼬리표("...4주")의 숫자를 주수로 오인하지 않도록
        // 총주수를 우선 적용한다(없으면 0 → 나중에 총주수 자동).
        slots.courses = [{ courseId: exactCourse.id, weeks: slots.totalWeeks ?? 0 }]
        delete ambiguous.course
      } else if (hasRemainderC) {
        needsLlm = needsLlm ?? 'course_natural'
      } else {
      const courseKeywords = countCourseKinds(txt)
      const cRows = parseRows(txt, courseList)
      if (cRows.length > 1) {
        slots.courses = cRows.map(r => ({ courseId: r.id, weeks: r.weeks }))
        delete ambiguous.course
      } else if (courseKeywords >= 2) {
        // 코스 종류를 2개 이상 말했는데 parseRows가 못 나눔(한글약어 등) → 추측 금지, LLM.
        needsLlm = 'course_complex'
      } else {
        const cm = matchCourses(txt, school)
        if (cm.kind === 'auto') {
          const w = parseWeeks(txt) ?? slots.totalWeeks ?? 0
          slots.courses = [{ courseId: cm.pick.id, weeks: w }]
          delete ambiguous.course
        } else if (cm.kind === 'choices' && cm.options.length === 1) {
          // 후보가 1개뿐이면 모호하지 않다 → 채택
          const w = parseWeeks(txt) ?? slots.totalWeeks ?? 0
          slots.courses = [{ courseId: cm.options[0].id, weeks: w }]
          delete ambiguous.course
        } else if (cm.kind === 'choices') {
          ambiguous.course = txt   // 코스 말했는데 종류 여러개 → 되묻기
        }
      }
      }
    }

    // 기숙: 복합(방이동, 주수 2개+)이면 parseRows, 단일이면 matchDorms
    if (!slots.noDorm && mentionsDorm(txt)) {
      // "나머지/잔여" 같은 자연어 방이동은 파서가 완벽히 못 나눈다 → LLM에 맡긴다.
      const hasRemainder = /나머지|잔여|남은|이후|그\s*다음/.test(txt)
      const exactDorm = matchExactName(txt, dormList)
      if (exactDorm) {
        slots.dormitories = [{ dormitoryId: exactDorm.id, weeks: slots.totalWeeks ?? 0 }]
        delete ambiguous.dorm
      } else if (hasRemainder) {
        needsLlm = needsLlm ?? 'dorm_natural'
      } else {
      const dRows = parseRows(txt, dormList)
      if (dRows.length > 1) {
        slots.dormitories = dRows.map(r => ({ dormitoryId: r.id, weeks: r.weeks }))
        delete ambiguous.dorm
      } else {
        const dm = matchDorms(txt, school)
        if (dm.kind === 'auto') {
          const w = parseWeeks(txt) ?? slots.totalWeeks ?? 0
          slots.dormitories = [{ dormitoryId: dm.pick.id, weeks: w }]
          delete ambiguous.dorm
        } else if (dm.kind === 'choices' && dm.options.length === 1) {
          const w = parseWeeks(txt) ?? slots.totalWeeks ?? 0
          slots.dormitories = [{ dormitoryId: dm.options[0].id, weeks: w }]
          delete ambiguous.dorm
        } else if (dm.kind === 'choices') {
          ambiguous.dorm = true
        } else if ((txtNoPrice.match(/(\d+)\s*(?:주|weeks?|w)(?![가-힣a-z])/gi) ?? []).length >= 2) {
          // 방이동(주수 2개+)인데 못 나눔 → LLM
          needsLlm = needsLlm ?? 'dorm_complex'
        }
      }
      }
    }
  }

  return { slots, schoolChoices, ambiguous, needsLlm }
}

/**
 * 슬롯 상태를 보고 "다음에 무엇을 해야 하는지" 결정한다.
 * 순서: 학원 → 총주수 → 코스 → 기숙 → (충돌검사) → ready
 */
export function nextStep(
  slots: Slots,
  schoolChoices: Array<{ id: string; name: string }> | null,
  ambiguous: { course?: string; dorm?: boolean },
  needsLlm?: string | null,
): StepResult {
  // 1) 학원
  if (!slots.schoolId) {
    return { kind: 'need_school', options: schoolChoices }
  }

  // 학원은 확정됐는데 복합 입력을 파서가 못 푼 경우 → LLM 폴백 (추측 금지)
  if (needsLlm) {
    return { kind: 'needs_llm', reason: needsLlm }
  }

  // 2) 총주수
  if (slots.totalWeeks == null || slots.totalWeeks <= 0) {
    return { kind: 'need_weeks' }
  }

  // 3) 코스
  if (ambiguous.course) {
    return { kind: 'need_course_disambiguation', schoolId: slots.schoolId, hint: ambiguous.course }
  }
  if (slots.courses.length === 0) {
    return { kind: 'need_course', schoolId: slots.schoolId }
  }
  // 단일 코스인데 주수가 비었으면(나중에 총주수만 받은 경우) 총주수 자동 적용
  if (slots.courses.length === 1 && (!slots.courses[0].weeks || slots.courses[0].weeks === 0)) {
    slots.courses[0].weeks = slots.totalWeeks
  }
  // 코스 주수 합 검증
  const courseSum = slots.courses.reduce((a, c) => a + (c.weeks || 0), 0)
  if (courseSum !== slots.totalWeeks) {
    return { kind: 'conflict_weeks', which: 'course', sum: courseSum, total: slots.totalWeeks }
  }

  // 4) 기숙 (통학 명시면 면제)
  if (!slots.noDorm) {
    if (ambiguous.dorm) {
      // 방을 말했는데 여러 개로 좁혀짐(예: "3인실"→Triple/Suite Triple) → 선택지로 되묻는다.
      // (LLM으로 보내지 않는다: 추측 금지 + 불필요한 LLM 호출 회피)
      return { kind: 'need_dorm', schoolId: slots.schoolId }
    }
    if (slots.dormitories.length === 0) {
      return { kind: 'need_dorm', schoolId: slots.schoolId }
    }
    // 단일 기숙사면 총주수 자동 적용 (extractSlots에서 weeks가 0이면 여기서 보정)
    if (slots.dormitories.length === 1 && (!slots.dormitories[0].weeks || slots.dormitories[0].weeks === 0)) {
      slots.dormitories[0].weeks = slots.totalWeeks
    }
    const dormSum = slots.dormitories.reduce((a, d) => a + (d.weeks || 0), 0)
    if (dormSum !== slots.totalWeeks) {
      return { kind: 'conflict_weeks', which: 'dorm', sum: dormSum, total: slots.totalWeeks }
    }
  }

  // 5) 필수(학원·주수·코스·기숙) 충족. 시작일을 아직 안 물었으면 묻는다(미정 선택 가능, 계산은 막지 않음).
  if (!slots.startDateProvided) {
    return { kind: 'need_start_date', slots }
  }

  // 6) 시작일까지 처리 완료 → 확인/계산 단계로.
  return { kind: 'ready', slots }
}
