// ─────────────────────────────────────────────────────────────────────────────
// QuoteState — 단일 견적 상태 객체
//
// 구조의 핵심: 학원·총주수·코스·기숙·날짜 상태를 한 곳에서만 관리한다.
// 파서가 채우고, 카드(수동·자동)가 편집하고, 계산이 이걸 스냅샷(commit)한다.
// 이전엔 파서/카드/calcEngine 3곳에 흩어져 변환마다 버그가 났다 → 단일화로 제거.
//
// 정보 위계: 학원 → 총주수 → 코스 → 기숙 → (검증) → 날짜 → 할인 → 계산
// "계산" = 현재 temp의 스냅샷을 confirm. 검증을 통과해야만 계산(commit) 가능.
// ─────────────────────────────────────────────────────────────────────────────

import type { School } from '@/types'

// 코스/기숙 한 줄 (방이동·코스변경이면 여러 줄)
export interface CourseRow { courseId: string; weeks: number }
export interface DormRow { dormitoryId: string; weeks: number }
export interface PackageRow { packageId: string; weeks: number; columnLabel: string }

// 편집 중 상태(temp). 사용자가 자유롭게 덮어쓰거나 줄을 쌓는다.
// 슬롯별 누적/덮어쓰기 규칙:
//   - schoolId, totalWeeks, startDate: 단일값 → 새 입력이 덮어쓰기
//   - courseRows, dormRows: 배열 → 줄 추가/삭제로 누적(방이동·코스변경)
export interface QuoteState {
  schoolId: string | null
  totalWeeks: number | null        // 기준값. 학원 다음으로 확정. 현지비도 이 값 기준.
  courseRows: CourseRow[]
  dormRows: DormRow[]
  packageRows: PackageRow[]         // 패키지형 학원
  startDate: string                 // '' = 미정
  // 사용자가 손으로 직접 고친 슬롯은 잠금 — 자동(LLM/파서)이 덮어쓰지 않는다.
  locked: { school?: boolean; weeks?: boolean; course?: boolean; dorm?: boolean; date?: boolean }
}

export function emptyQuoteState(): QuoteState {
  return {
    schoolId: null, totalWeeks: null,
    courseRows: [], dormRows: [], packageRows: [],
    startDate: '', locked: {},
  }
}

// ── 검증 ─────────────────────────────────────────────────────────────────────
// 계산(commit) 가능 여부와 사람이 읽을 사유를 함께 낸다.
// "쌓임 ≠ 유효" — 줄이 채워져도 합이 총주수와 안 맞으면 계산 불가.
export interface ValidationResult {
  ok: boolean
  canCalculate: boolean
  issues: string[]          // 막는 문제 (계산 차단)
  warnings: string[]        // 안내 (계산은 가능)
  courseWeeksSum: number
  dormWeeksSum: number
  nextNeeded: string | null // 다음에 채워야 할 것 (UI 길잡이)
}

export function validateQuote(state: QuoteState, school: School | null): ValidationResult {
  const issues: string[] = []
  const warnings: string[] = []
  const hasPackages = (school?.packages?.length ?? 0) > 0 && (school?.courses?.length ?? 0) === 0

  const validCourses = state.courseRows.filter(r => r.courseId && r.weeks > 0)
  const validDorms = state.dormRows.filter(r => r.dormitoryId && r.weeks > 0)
  const courseWeeksSum = validCourses.reduce((s, r) => s + r.weeks, 0)
  const dormWeeksSum = validDorms.reduce((s, r) => s + r.weeks, 0)

  // 정보 위계 순서대로 다음에 필요한 것을 판정 (UI가 강조할 슬롯)
  let nextNeeded: string | null = null
  if (!state.schoolId) nextNeeded = 'school'
  else if (!state.totalWeeks) nextNeeded = 'weeks'
  else if (!hasPackages && validCourses.length === 0) nextNeeded = 'course'

  // 막는 문제
  if (!state.schoolId) issues.push('학원을 선택하세요.')
  if (state.schoolId && !state.totalWeeks) issues.push('총 주수를 정하세요.')
  if (state.schoolId && state.totalWeeks && !hasPackages && validCourses.length === 0)
    issues.push('코스를 선택하세요.')

  // 합 = 총주수 검증 (총주수가 기준값)
  if (state.totalWeeks && !hasPackages) {
    if (courseWeeksSum > 0 && courseWeeksSum !== state.totalWeeks) {
      const diff = state.totalWeeks - courseWeeksSum
      issues.push(diff > 0 ? `코스 기간이 ${diff}주 부족합니다 (총 ${state.totalWeeks}주).`
                           : `코스 기간이 ${-diff}주 초과합니다 (총 ${state.totalWeeks}주).`)
    }
    if (dormWeeksSum > 0 && dormWeeksSum !== state.totalWeeks) {
      const diff = state.totalWeeks - dormWeeksSum
      warnings.push(diff > 0 ? `기숙사 기간이 ${diff}주 부족합니다 — 통학 기간이 있나요?`
                             : `기숙사 기간이 ${-diff}주 초과합니다.`)
    }
  }

  const canCalculate = issues.length === 0
  return { ok: issues.length === 0 && warnings.length === 0, canCalculate, issues, warnings, courseWeeksSum, dormWeeksSum, nextNeeded }
}

// ── commit: temp 상태 → calcEngine 입력으로 스냅샷 ─────────────────────────────
// "계산"을 누르는 순간의 상태가 1스택(하나의 견적). 정정·누적은 commit 전 temp에서 끝남.
export interface CommittedQuote {
  schoolId: string
  startDate: string
  enrollmentDate: string
  courses?: CourseRow[]
  dormitories?: DormRow[]
  packages?: PackageRow[]
}

export function commitQuote(state: QuoteState, school: School | null): CommittedQuote | null {
  const v = validateQuote(state, school)
  if (!v.canCalculate || !state.schoolId) return null
  const hasPackages = (school?.packages?.length ?? 0) > 0 && (school?.courses?.length ?? 0) === 0
  return {
    schoolId: state.schoolId,
    startDate: state.startDate,
    enrollmentDate: state.startDate,
    courses: hasPackages ? undefined : state.courseRows.filter(r => r.courseId && r.weeks > 0),
    dormitories: hasPackages ? undefined : state.dormRows.filter(r => r.dormitoryId && r.weeks > 0),
    packages: hasPackages ? state.packageRows.map(p => ({ ...p, weeks: state.totalWeeks ?? p.weeks })) : undefined,
  }
}

// ── 자동(파서/LLM) 결과를 temp에 병합 ────────────────────────────────────────
// 사용자가 잠근(locked) 슬롯은 건드리지 않는다 — 수동 편집이 자동 추측보다 우선.
// 단일값은 덮어쓰기, 코스/기숙 배열은 자동이 여러 줄을 줬을 때만 교체(부분 누적은 UI에서).
export function mergeAuto(state: QuoteState, auto: Partial<{
  schoolId: string
  totalWeeks: number
  courseRows: CourseRow[]
  dormRows: DormRow[]
  startDate: string
}>): QuoteState {
  const next = { ...state }
  if (auto.schoolId != null && !state.locked.school) {
    // 학원이 바뀌면 코스/기숙은 무효(다른 학원 id) → 비움
    if (auto.schoolId !== state.schoolId) {
      next.courseRows = []; next.dormRows = []; next.packageRows = []
    }
    next.schoolId = auto.schoolId
  }
  if (auto.totalWeeks != null && !state.locked.weeks) next.totalWeeks = auto.totalWeeks
  if (auto.courseRows && auto.courseRows.length > 0 && !state.locked.course) next.courseRows = auto.courseRows
  if (auto.dormRows && auto.dormRows.length > 0 && !state.locked.dorm) next.dormRows = auto.dormRows
  if (auto.startDate != null && auto.startDate !== '' && !state.locked.date) next.startDate = auto.startDate
  return next
}
