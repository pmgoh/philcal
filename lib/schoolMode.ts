// 학원 모드 판정.
// 모드(탭)는 사용자가 직접 선택해 확정한다: 'regular'(일반 연수) | 'camp_family'(캠프·가족·주니어).
//
// [중요] 모드는 추론하지 않는다. 사용자가 탭으로 확정한 모드에 맞춰,
// "이 학원이 그 모드에 해당하는 데이터(코스/패키지)를 가졌는가"만 판정한다.
// 한 학원이 일반연수 코스와 가족/주니어 데이터를 모두 가지면, 양쪽 모드에 모두 노출된다.
//
// 모드 소속은 데이터로 표현한다:
//   - 코스: target 필드 ('성인일반' | '가족연수' | '주니어' | '시니어' | 없음)
//           target이 없으면 일반연수(regular)로 본다 (기본값).
//   - 패키지: programType 필드 (junior | family | camp | camp_family | senior | ...)
//           패키지는 기본적으로 캠프·가족·주니어(camp_family) 모드 데이터로 본다.

import type { School, Course } from '@/types'

export type SchoolMode = 'regular' | 'camp_family' | 'unknown'

// 코스가 일반연수(성인) 대상인가. target이 없으면 일반연수로 간주(기본값).
function isRegularCourse(c: Pick<Course, 'target'>): boolean {
  const t = (c as { target?: string }).target
  if (!t) return true                 // target 미입력 → 일반연수 기본
  return t === '성인일반'
}

// 코스가 캠프·가족·주니어 대상인가.
function isCampFamilyCourse(c: Pick<Course, 'target'>): boolean {
  const t = (c as { target?: string }).target
  if (!t) return false
  return t === '가족연수' || t === '주니어' || t === '시니어'
}

// 학원이 특정 모드의 데이터를 하나라도 가졌는가 (탭 노출 판정).
export function schoolHasMode(school: Pick<School, 'courses' | 'packages'>, mode: SchoolMode): boolean {
  const courses = school.courses ?? []
  const packages = school.packages ?? []
  if (mode === 'regular') {
    // 일반연수 코스가 하나라도 있으면 노출
    return courses.some(isRegularCourse)
  }
  if (mode === 'camp_family') {
    // 가족/주니어/시니어 코스가 있거나, 패키지가 하나라도 있으면 노출
    return courses.some(isCampFamilyCourse) || packages.length > 0
  }
  return false
}

// 한 학원의 "주된" 단일 모드 추론 (목록 정렬·표시 등 보조 용도. 필터엔 schoolHasMode 사용).
export function inferSchoolMode(school: Pick<School, 'courses' | 'packages'>): SchoolMode {
  const hasRegular = (school.courses ?? []).some(isRegularCourse)
  const hasCampFamily = (school.courses ?? []).some(isCampFamilyCourse) || (school.packages?.length ?? 0) > 0
  if (hasRegular) return 'regular'
  if (hasCampFamily) return 'camp_family'
  return 'unknown'
}

// 모드별 라벨 (UI 표시용)
export const MODE_LABELS: Record<SchoolMode, string> = {
  regular: '일반 연수',
  camp_family: '캠프·가족·주니어',
  unknown: '데이터 점검 필요',
}

// 학원 목록을 모드로 필터링 (해당 모드 데이터를 가진 학원).
export function filterSchoolsByMode(schools: School[], mode: SchoolMode): School[] {
  return schools.filter(s => schoolHasMode(s, mode))
}
