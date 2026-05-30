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
    // target이 query로 시작하면(예: "ev"→"evacademy") 학원코드 약어로 보고 우대
    const startsBonus = t.startsWith(q) && q.length >= 2 ? 20 : 0
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
  // 단일 토큰 + 인접 2-그램까지 시도 (예: "ESL Classic" 같은 2단어 코스명)
  const grams: string[] = [...tokens, text]
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
  const viable = cands.filter(c => c.score >= CHOICE_MIN).slice(0, MAX_CHOICES)
  if (viable.length > 0) return { kind: 'choices', options: viable }
  return { kind: 'none' }
}

// ── 주수 / 날짜 추출 (정규식) ────────────────────────────────────────────────
export function parseWeeks(text: string): number | null {
  // "4주", "8 weeks", "12w"
  const m = text.match(/(\d+)\s*(?:주|weeks?|w)\b/i) || text.match(/(\d+)\s*주/)
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
  // 5월 1일 (연도 생략 → 빈값, 미정 아님: 호출측에서 연도 보완/되물음)
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
  const cands = schools
    .map(s => {
      const byName = bestTokenScore(text, s.name)
      const byCode = s.schoolCode ? bestTokenScore(text, s.schoolCode.replace(/_/g, ' ')) : 0
      const byCampus = s.campus ? Math.min(bestTokenScore(text, s.campus), 60) : 0
      let score = Math.max(byName, byCode, byCampus)
      // 별칭 적중 시 그 점수로 덮어씀(별칭 우선)
      if (s.schoolCode && aliasHit[s.schoolCode] != null) score = aliasHit[s.schoolCode]
      return { id: s.id, name: s.name, score, campus: s.campus }
    })
    .filter(c => c.score >= 50)
    .sort((a, b) => b.score - a.score)
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
}

// 메인 파서: 학원을 먼저 잡고, 학원이 확정되면 그 학원 안에서 코스/기숙을 잡는다.
export function parseQuoteIntent(text: string, schools: School[], extraAliases?: AliasOverride): ParseResult {
  const school = matchSchools(text, schools, extraAliases)
  const weeks = parseWeeks(text)
  const { date, unset } = parseStartDate(text)
  const result: ParseResult = { school, weeks, startDate: date, dateUnset: unset }

  if (school.kind === 'auto') {
    const target = schools.find(s => s.id === school.pick.id)
    if (target) {
      result.course = matchCourses(text, target)
      result.dorm = matchDorms(text, target)
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
