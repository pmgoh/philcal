// 학원 모드 자동 추론.
// 모드는 "일반 연수"(성인 ESL/IELTS 등 코스 중심)와 "캠프·가족·주니어"(정액 패키지 중심) 둘.
// 규칙:
//   - courses가 1개 이상 있으면 'regular' (코스 학원). 일반 학원이 가족 패키지 1개 들고 있어도 regular로 분류 — 패키지 모드에 안 섞이게.
//   - courses 0개이고 packages가 1개 이상 있으면 'camp_family' (패키지 학원).
//   - 둘 다 0개이면 'unknown' — 본사 확인 대기 상태. 어느 모드에도 안 보임(데이터 점검 필요 학원).
//
// 추후 모호한 학원이 나오면 학원 JSON에 명시 필드(programType)를 옵션으로 추가해 우선시키도록 확장 가능.

import type { School } from '@/types'

export type SchoolMode = 'regular' | 'camp_family' | 'unknown'

export function inferSchoolMode(school: Pick<School, 'courses' | 'packages'>): SchoolMode {
  const hasCourses = (school.courses?.length ?? 0) > 0
  const hasPackages = (school.packages?.length ?? 0) > 0
  if (hasCourses) return 'regular'
  if (hasPackages) return 'camp_family'
  return 'unknown'
}

// 모드별 라벨 (UI 표시용)
export const MODE_LABELS: Record<SchoolMode, string> = {
  regular: '일반 연수',
  camp_family: '캠프·가족·주니어',
  unknown: '데이터 점검 필요',
}

// 학원 목록을 모드로 필터링
export function filterSchoolsByMode(schools: School[], mode: SchoolMode): School[] {
  return schools.filter(s => inferSchoolMode(s) === mode)
}
