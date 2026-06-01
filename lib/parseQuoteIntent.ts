// ─────────────────────────────────────────────────────────────────────────────
// parseQuoteIntent — 코드 우선 매칭 파서
//
// 목적: 사용자의 자연어 입력에서 학원·코스·기숙사·주수·시작일을 "코드로" 추출한다.
// LLM은 코드가 못 찾거나 헷갈릴 때만 폴백으로 쓴다(이 파일은 LLM을 호출하지 않음).
//
// 기획(확정):
//  1) 코드가 비슷한 명칭(코스/기숙/학원)을 유사 매칭으로 찾는다.
//  2) 충분히 확실하면 자동 선택 (어차피 사람이 confirm에서 확인).
//  3) 비슷한 후보가 여럿이면 선택지로 띄운다(사람이 클릭).
//  4) 못 찾거나 다 애매하면 LLM 폴백(needLLM=true)으로 넘긴다.
//
// 이 파일은 계산(calcEngine)을 건드리지 않는다. 입력 해석만 담당한다.
// ─────────────────────────────────────────────────────────────────────────────

import type { School, Course, Dormitory } from '@/types'
import { SCHOOL_ALIASES } from './schoolAliases'

// ── 별칭 사전 (영한 / 줄임말 / 표기 흔들림) ──────────────────────────────────
// 정규화 시 좌변을 우변으로 치환한다. 자주 쓰는 것만; 부족하면 계속 추가.
const ALIASES: Array<[RegExp, string]> = [
  // 인실 숫자 표기
  [/사인실|사인|4인/g, '4인'],
  [/삼인실|삼인|3인/g, '3인'],
  [/이인실|이인|2인/g, '2인'],
  [/일인실|일인|1인/g, '1인'],
  [/오인실|오인|5인/g, '5인'],
  [/육인실|육인|6인/g, '6인'],
  // 영문 인실
  [/single|싱글/g, '1인'],
  [/twin|double|트윈|더블/g, '2인'],
  [/triple|트리플/g, '3인'],
  [/quad(ruple)?|쿼드/g, '4인'],
  // 방 수식어 한영 (데이터 명칭이 영문인 경우 매칭되도록 영문으로 통일)
  [/스위트/g, 'suite'],
  [/콘도(미니엄)?|condominium/g, 'condo'],
  [/디럭스/g, 'deluxe'],
  [/프리미엄/g, 'premium'],
  [/스탠다드|스탠더드/g, 'standard'],
  [/슈페리어|슈페리얼|superior/g, 'superior'],
  [/발코니/g, 'balcony'],
  [/오션\s*뷰|오션뷰/g, '오션뷰'],
  [/씨티\s*뷰|시티\s*뷰|씨티뷰|시티뷰/g, '씨티뷰'],
  [/건물\s*뷰|건물뷰/g, '건물뷰'],
  [/바깥\s*뷰|바깥뷰|아웃사이드/g, '바깥뷰'],
  [/외부/g, 'external'],
  [/내부/g, 'internal'],
  [/알리시아|알리샤|alicia/g, 'alicia'],
  // 코스 영한
  [/파워\s*스피킹|파워스피킹/g, 'powerspeaking'],
  [/비즈니스|비지니스/g, 'business'],
  [/아이엘츠/g, 'ielts'],
  [/토익/g, 'toeic'],
  [/토플/g, 'toefl'],
  [/오픽/g, 'opic'],
  [/스파르타/g, 'sparta'],
  [/세미\s*스파르타|세미스파르타/g, 'semisparta'],
  [/워킹\s*홀리데이|워홀/g, 'workingholiday'],
  [/주니어/g, 'junior'],
  [/가디언|보호자/g, 'guardian'],
  [/인텐시브|집중/g, 'intensive'],
  // 학원명에 흔한 꼬리말 제거 (매칭 노이즈)
  [/아카데미|어학원|academy|english|campus|캠퍼스/g, ''],
  // 자주 쓰는 학원 음역 (한글 발음 → 영문코드). 부족하면 계속 추가.
  [/이브이/g, 'ev'],
  [/씨아이에이|시아이에이/g, 'cia'],
  [/파인스|파인즈/g, 'pines'],
  [/베시|비씨아이/g, 'beci'],
  [/블루오션/g, 'blueocean'],
  [/필인터/g, 'philinter'],
  [/씨피아이/g, 'cpi'],
  [/씨피아이엘에스|시필스/g, 'cpils'],
  [/스맥|에스맥/g, 'smeag'],
  [/아이브리즈|아이.브리즈/g, 'ibreeze'],
  [/몬올|모놀/g, 'monol'],
  [/이지이|이쥐이/g, 'egi'],
  [/큐큐/g, 'qq'],
]

// 정규화: 소문자화, 공백·괄호·특수문자 제거, 별칭 치환
export function normalize(s: string): string {
  let t = (s ?? '').toLowerCase()
  for (const [re, to] of ALIASES) t = t.replace(re, to)
  // 괄호와 그 안 내용 제거 → 부가설명(Quadruple) 무시
  t = t.replace(/\([^)]*\)/g, '')
  // 공백·특수문자 제거 (한글/영문/숫자만 남김)
  t = t.replace(/[^0-9a-z가-힣]/g, '')
  return t
}

// ── 유사도 점수 (0~100) ──────────────────────────────────────────────────────
// query: 사용자 입력 조각 / target: 데이터의 명칭
export function matchScore(query: string, target: string): number {
  const q = normalize(query)
  const t = normalize(target)
  if (!q || !t) return 0
  if (q === t) return 100                       // 완전일치
  if (t.includes(q) || q.includes(t)) {         // 포함관계
    // 짧은 쪽이 긴 쪽에 얼마나 차지하는지로 가중
    const ratio = Math.min(q.length, t.length) / Math.max(q.length, t.length)
    // target이 query로 시작하면 우대 — 단 영문 약어(ev→evacademy)에 한정.
    // 한글 방/코스명은 접두사("2인실")가 여러 항목에 겹쳐 변별을 죽이므로 보너스 제외.
    const isAsciiAbbr = /^[a-z0-9]+$/.test(q)
    const startsBonus = isAsciiAbbr && t.startsWith(q) && q.length >= 2 ? 20 : 0
    return Math.min(100, Math.round(60 + 40 * ratio) + startsBonus)  // 60~100
  }
  // 핵심 토큰(인실 숫자) 일치
  const qRoom = q.match(/(\d+)인/)
  const tRoom = t.match(/(\d+)인/)
  if (qRoom && tRoom && qRoom[1] === tRoom[1]) return 70
  // 글자 단위 겹침 (Dice 계수 비슷하게)
  const overlap = charOverlap(q, t)
  return Math.round(overlap * 55)               // 0~55
}

function charOverlap(a: string, b: string): number {
  const setA = new Set(a.split(''))
  const setB = new Set(b.split(''))
  let common = 0
  for (const c of setA) if (setB.has(c)) common++
  return (2 * common) / (setA.size + setB.size)
}

// ── 후보 추출 (점수 매겨 정렬) ───────────────────────────────────────────────
export interface Candidate {
  id: string
  name: string
  score: number
  campus?: string
}

// 문장을 토큰으로 쪼개 각 토큰과 후보를 비교, 토큰별 최고점을 후보 점수로 사용.
// (전체 문장으로 비교하면 다른 단어들이 노이즈가 되어 점수가 희석됨)
function bestTokenScore(text: string, target: string): number {
  const tokens = text.split(/\s+/).filter(Boolean)
  // 영문↔숫자 경계가 붙은 토큰은 분리해서도 시도한다 (예: "EV0802" → "EV","0802").
  // 날짜/숫자가 학원 약어에 붙어버리면 매칭이 약해지는 것을 방지.
  const splitTokens: string[] = []
  for (const t of tokens) {
    if (/[a-zA-Z]/.test(t) && /[0-9]/.test(t)) {
      for (const part of t.split(/(?<=[a-zA-Z])(?=[0-9])|(?<=[0-9])(?=[a-zA-Z])/)) {
        // 순수 숫자(날짜 등)는 학원/코스명과 무관한 노이즈이므로 제외, 영문 부분만 사용
        if (part && /[a-zA-Z]/.test(part)) splitTokens.push(part)
      }
    }
  }
  // 단일 토큰 + 인접 2-그램까지 시도 (예: "ESL Classic" 같은 2단어 코스명)
  const grams: string[] = [...tokens, ...splitTokens, text]
  for (let i = 0; i < tokens.length - 1; i++) grams.push(tokens[i] + ' ' + tokens[i + 1])
  for (let i = 0; i < tokens.length - 2; i++) grams.push(tokens[i] + ' ' + tokens[i + 1] + ' ' + tokens[i + 2])
  let best = 0
  for (const g of grams) { const s = matchScore(g, target); if (s > best) best = s }
  return best
}

function rankCandidates<T extends { id: string; name: string }>(
  query: string,
  items: T[],
): Candidate[] {
  return items
    .map(it => ({
      id: it.id,
      name: it.name,
      score: bestTokenScore(query, it.name),
      campus: (it as unknown as { campus?: string }).campus,
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
}

// ── 분기 판정 ────────────────────────────────────────────────────────────────
// 기획대로: 최고점 높고 2등과 차이 크면 자동 / 비슷하면 선택지 / 다 낮으면 LLM
export type Resolution =
  | { kind: 'auto'; pick: Candidate }                  // 자동 확정
  | { kind: 'choices'; options: Candidate[] }          // 선택지 띄움
  | { kind: 'none' }                                   // 후보 없음 → LLM

const AUTO_MIN = 85       // 자동 확정 최소 점수
const AUTO_GAP = 20       // 1등-2등 최소 차이
const CHOICE_MIN = 50     // 선택지로 띄울 최소 점수
const MAX_CHOICES = 5     // 선택지 최대 개수

function resolve(cands: Candidate[]): Resolution {
  if (cands.length === 0) return { kind: 'none' }
  const top = cands[0]
  const second = cands[1]
  if (top.score >= AUTO_MIN && (!second || top.score - second.score >= AUTO_GAP)) {
    return { kind: 'auto', pick: top }
  }
  // 1등과 점수 격차가 큰(30 초과) 하위 후보는 노이즈로 본다.
  // 진짜 같은 학원의 다른 캠퍼스(예: EV / EV La Mer)는 점수가 근접하므로 살아남고,
  // 입력 속 단어가 우연히 겹친 무관한 학원(낮은 점수)은 제거되어 LLM에 안 넘어간다.
  const viable = cands
    .filter(c => c.score >= CHOICE_MIN && top.score - c.score <= 30)
    .slice(0, MAX_CHOICES)
  if (viable.length > 0) return { kind: 'choices', options: viable }
  return { kind: 'none' }
}

// ── 주수 / 날짜 추출 (정규식) ────────────────────────────────────────────────
export function parseWeeks(text: string): number | null {
  // "4주", "8 weeks", "12w"
  const m = text.match(/(\d+)\s*(?:주|weeks?|w)(?![가-힣a-z])/i) || text.match(/(\d+)\s*주/)
  if (m) return parseInt(m[1], 10)
  return null
}

export function parseStartDate(text: string): { date: string; unset: boolean } {
  // 미정 키워드
  if (/미정|무관|상관\s*없|아무\s*때|언제든|나중에/i.test(text)) return { date: '', unset: true }
  // 2026-05-01 / 2026.05.01 / 2026/5/1
  let m = text.match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/)
  if (m) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, unset: false }
  // 2026년 5월 1일
  m = text.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (m) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, unset: false }
  // 연도 생략: "6/8", "6.8", "6월 8일" → 가까운 미래 연도로 보완
  //  (M/D가 오늘 이전이면 내년으로). "주" 앞 숫자(기간)와 혼동 방지: 슬래시/점/월일 형태만.
  m = text.match(/(?<!\d)(\d{1,2})\s*[./월]\s*(\d{1,2})\s*일?(?!\s*(?:주|개월|주일|week))/)
  if (m) {
    const mo = parseInt(m[1], 10), da = parseInt(m[2], 10)
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      const now = new Date()
      let yr = now.getFullYear()
      const cand = new Date(yr, mo - 1, da)
      if (cand.getTime() < now.getTime() - 86400000) yr += 1  // 이미 지난 날짜면 내년
      return { date: `${yr}-${pad(String(mo))}-${pad(String(da))}`, unset: false }
    }
  }
  // 연도/월일 못 잡음 → 빈값(미정 아님: 호출측에서 되물음 가능)
  return { date: '', unset: false }
}
function pad(s: string): string { return s.padStart(2, '0') }

// ── 학원 매칭 (이름 + 캠퍼스) ────────────────────────────────────────────────
// 외부(Firestore) 별칭을 코드 기본 별칭과 병합. route에서 주입.
export type AliasOverride = Record<string, string[]>
function mergedAliases(extra?: AliasOverride): Record<string, string[]> {
  if (!extra) return SCHOOL_ALIASES
  const out: Record<string, string[]> = {}
  const codes = new Set([...Object.keys(SCHOOL_ALIASES), ...Object.keys(extra)])
  for (const code of codes) {
    out[code] = Array.from(new Set([...(SCHOOL_ALIASES[code] ?? []), ...(extra[code] ?? [])]))
  }
  return out
}

// 입력 텍스트에 '학원 별칭/이름'이 실제로 거론된 학원 id 목록.
// 전환 판정 전용 — 방("2인실")·주수("8주")·코스("IELTS")는 학원 별칭이 아니므로 안 걸린다.
// "베씨"는 BECI 별칭 적중 → 거론됨. "2인실로 바꿔줘"는 어떤 학원 별칭도 적중 안 함 → 빈 목록.
export function schoolsMentioned(text: string, schools: School[], extraAliases?: AliasOverride): string[] {
  const nText = normalize(text)
  const ALIASES = mergedAliases(extraAliases)
  const tokens = nText.length > 0 ? text.toLowerCase().split(/\s+/).map(normalize).filter(Boolean) : []
  const hitCodes = new Set<string>()
  for (const [code, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const na = normalize(a)
      if (!na) continue
      const hit = na.length <= 2 ? tokens.includes(na) : nText.includes(na)
      if (hit) { hitCodes.add(code); break }
    }
  }
  // 별칭 코드 → 학원 id. 풀네임 토큰 매칭(60점 이상)도 학원 거론으로 인정.
  const ids = new Set<string>()
  for (const s of schools) {
    if (s.schoolCode && hitCodes.has(s.schoolCode)) ids.add(s.id)
    else if (bestTokenScore(text, s.name) >= 70) ids.add(s.id)
  }
  return [...ids]
}

export function matchSchools(text: string, schools: School[], extraAliases?: AliasOverride): Resolution {
  const nText = normalize(text)
  const ALIASES = mergedAliases(extraAliases)
  // 1) 별칭 우선: 정규화된 입력에 학원 별칭이 포함되면 그 학원을 강하게 가산.
  //    (점수제에 매몰되지 않게 — 별칭이 맞으면 사실상 확정)
  const aliasHit: Record<string, number> = {}
  const tokens = nText.length > 0 ? text.toLowerCase().split(/\s+/).map(normalize).filter(Boolean) : []
  for (const [code, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const na = normalize(a)
      if (!na) continue
      let hit = false
      if (na.length <= 2) {
        // 짧은 별칭(ev, we, gs 등)은 토큰과 정확히 일치할 때만 — 긴 한글 안 우연 매칭 방지
        hit = tokens.includes(na)
      } else {
        hit = nText.includes(na)
      }
      if (hit) aliasHit[code] = Math.max(aliasHit[code] ?? 0, 100 + na.length)
    }
  }
  // 2) 이름/코드/캠퍼스 토큰 유사 매칭
  const hasAliasHit = Object.keys(aliasHit).length > 0
  const cands = schools
    .map(s => {
      const byName = bestTokenScore(text, s.name)
      const byCode = s.schoolCode ? bestTokenScore(text, s.schoolCode.replace(/_/g, ' ')) : 0
      const byCampus = s.campus ? Math.min(bestTokenScore(text, s.campus), 60) : 0
      let score = Math.max(byName, byCode, byCampus)
      // 별칭 적중 시 그 점수로 덮어씀(별칭 우선)
      const aliasMatched = !!(s.schoolCode && aliasHit[s.schoolCode] != null)
      if (aliasMatched) score = aliasHit[s.schoolCode!]
      return { id: s.id, name: s.name, score, campus: s.campus, aliasMatched }
    })
    // 별칭이 하나라도 적중했으면 별칭 적중 학원만 남긴다.
    // (학원명 매칭은 입력 속 코스/방 단어가 무관한 학원명과 우연히 겹쳐 노이즈 후보를 만든다.
    //  예: "ev 세미esl..." 입력에서 'esl' 토큰이 English Fella 학원명에 끼는 것 방지 + LLM 토큰 절약)
    .filter(c => hasAliasHit ? c.aliasMatched : c.score >= 50)
    .sort((a, b) => b.score - a.score)
    .map(({ aliasMatched: _drop, ...c }) => c)
  return resolve(cands)
}

// ── 코스 / 기숙 매칭 (특정 학원 안에서) ──────────────────────────────────────
export function matchCourses(text: string, school: School): Resolution {
  return resolve(rankCandidates(text, (school.courses ?? []) as Course[]))
}
export function matchDorms(text: string, school: School): Resolution {
  return resolve(rankCandidates(text, (school.dormitories ?? []) as Dormitory[]))
}

// ── 통합 파서 결과 ───────────────────────────────────────────────────────────
export interface ParseResult {
  school: Resolution
  weeks: number | null
  startDate: string
  dateUnset: boolean
  // 코스/기숙은 학원이 auto로 정해졌을 때만 채운다 (학원 모르면 코스 후보도 무의미)
  course?: Resolution
  dorm?: Resolution
  // 방이동·코스변경: "3인실 4주 + 2인실 2주" 처럼 항목별 주수가 여러 개면 행 배열로 분해.
  courseRows?: Array<{ id: string; name: string; weeks: number }>
  dormRows?: Array<{ id: string; name: string; weeks: number }>
}

// 자연어를 "N주" 경계로 토막 내어, 각 토막의 (항목, 주수)를 뽑는다.
// 예) "PIC-4 3인실 4주 + 2인실 2주 + 1B 1주" → 토막별로 직전 명사구 + 주수.
// items는 학원의 courses 또는 dormitories. 매칭된 행 배열을 반환.
function parseRows(text: string, items: Array<{ id: string; name: string }>): Array<{ id: string; name: string; weeks: number }> {
  if (items.length === 0) return []
  // "N주"의 위치를 모두 찾는다.
  const weekRe = /(\d+)\s*(?:주|weeks?|w)(?![가-힣a-z])/gi
  const matches: Array<{ weeks: number; index: number }> = []
  let m: RegExpExecArray | null
  while ((m = weekRe.exec(text)) !== null) {
    matches.push({ weeks: parseInt(m[1], 10), index: m.index })
  }
  if (matches.length <= 1) return []  // 주수가 1개 이하면 단일 처리(기존 경로)로

  // 각 "N주" 앞의 텍스트 토막에서 항목을 매칭. 토막 = 직전 주수 끝 ~ 이번 주수 시작.
  const rows: Array<{ id: string; name: string; weeks: number }> = []
  let segStart = 0
  let lastId: string | null = null
  let explicitCount = 0  // 토막에서 항목명이 실제로 매칭된 횟수
  for (const mt of matches) {
    const segment = text.slice(segStart, mt.index)
    const r = resolve(rankCandidates(segment, items as Array<Course | Dormitory>))
    let picked = r.kind === 'auto' ? r.pick : r.kind === 'choices' ? r.options[0] : null
    const explicit = !!picked
    if (explicit) explicitCount++
    // 이 토막에 항목명이 없으면(예: "2주"만) 직전 항목을 이어쓴다.
    if (!picked && lastId) {
      const prev = items.find(it => it.id === lastId)
      if (prev) picked = { id: prev.id, name: prev.name, score: 100 }
    }
    if (picked) {
      rows.push({ id: picked.id, name: picked.name, weeks: mt.weeks })
      lastId = picked.id
    }
    segStart = mt.index + String(mt.weeks).length
  }
  // 항목명이 1번만 명시됐으면(예: 코스 "PIC-4"만, 나머지는 기숙 주수) 분해하지 않는다.
  // → 같은 항목이 여러 주수에 잘못 복제되는 것 방지. 2개 이상 명시될 때만 진짜 변경으로 본다.
  if (explicitCount < 2) return []
  return rows
}

// 메인 파서: 학원을 먼저 잡고, 학원이 확정되면 그 학원 안에서 코스/기숙을 잡는다.
export function parseQuoteIntent(text: string, schools: School[], extraAliases?: AliasOverride): ParseResult {
  const school = matchSchools(text, schools, extraAliases)
  const weeks = parseWeeks(text)
  const { date, unset } = parseStartDate(text)
  const result: ParseResult = { school, weeks, startDate: date, dateUnset: unset }

  // 학원이 auto면 그 학원, choices면 첫 후보(카드가 그 학원으로 시작) 기준으로 코스/기숙 파싱.
  // choices라고 코스/기숙을 건너뛰면, 완전한 입력도 카드에서 다시 골라야 하는 문제가 생김.
  const pickedSchool = school.kind === 'auto' ? school.pick
    : school.kind === 'choices' ? school.options[0] : null
  if (pickedSchool) {
    const target = schools.find(s => s.id === pickedSchool.id)
    if (target) {
      result.course = matchCourses(text, target)
      result.dorm = matchDorms(text, target)
      // 방이동·코스변경: 항목별 주수가 여러 개면 행 배열로 분해해 카드에 채운다.
      const cRows = parseRows(text, (target.courses ?? []).map(c => ({ id: c.id, name: c.name })))
      const dRows = parseRows(text, (target.dormitories ?? []).map(d => ({ id: d.id, name: d.name })))
      if (cRows.length > 1) result.courseRows = cRows
      if (dRows.length > 1) result.dormRows = dRows
      // 코스가 단일인데 기숙이 여러 줄이면, 코스 총 주수를 기숙 합과 맞춘다(보통 일치).
      if ((!result.courseRows || result.courseRows.length <= 1) && result.dormRows && result.dormRows.length > 1) {
        const dormSum = result.dormRows.reduce((s, r) => s + r.weeks, 0)
        if (dormSum > 0) result.weeks = dormSum
      }
    }
  }
  return result
}

// ── 미해결 입력 수집 ─────────────────────────────────────────────────────────
// 학원을 코드가 못 찾아(none) LLM 폴백으로 넘어간 경우, 그 입력을 기록해두면
// 나중에 "이게 무슨 학원이었나"를 보고 schoolAliases.ts에 별칭을 추가할 수 있다.
// 점수제에 매몰되지 않고, 실제 사용 로그로 사전을 키우는 구조.
export interface UnresolvedLog {
  text: string
  reason: 'school_not_found' | 'course_not_found' | 'dorm_not_found'
  at: string
}
export function logUnresolved(text: string, reason: UnresolvedLog['reason']): UnresolvedLog {
  // 실제 저장은 호출측(route)에서 Firestore/콘솔로. 여기선 구조만 만든다.
  const entry: UnresolvedLog = { text: text.slice(0, 200), reason, at: new Date().toISOString() }
  try { console.log('[unresolved]', JSON.stringify(entry)) } catch { /* noop */ }
  return entry
}
