// 학원 이름 매칭 유틸리티
//
// 문제: schools 컬렉션의 학원명은 한글 풀네임("CELLA PREMIUM (프리미엄 캠퍼스)")인데
//       promotions의 schoolName은 영문 슬러그("CELLA PREMIUM")라 매칭이 안 됐다.
//
// 해결: 두 단계 매칭
//   1) schoolId가 있으면 그걸로 매칭 (구조적 정답)
//   2) 없으면 정규화된 이름 + 별칭 사전으로 매칭
//
// 별칭 사전은 외부 데이터 파일(/data/school-aliases.json)에서 로드한다.
// 신규 학원/프로모션 입력 시 자동 매칭 후보 제시도 같은 로직 사용.

import type { School } from '@/types'

/**
 * 이름 정규화 — 비교용 키 생성
 * - 소문자
 * - 공백/하이픈/언더스코어/괄호 내용 제거
 * - 특수문자 제거
 */
export function normalizeSchoolName(s: string): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')          // 괄호 내용 제거: "CELLA PREMIUM (프리미엄)" → "cella premium "
    .replace(/[·•・\-_/\\]/g, '')         // 구분자 제거
    .replace(/\s+/g, '')                 // 모든 공백 제거
    .replace(/[^\w가-힣]/g, '')           // 영숫자/한글만 남김
    .trim()
}

/**
 * 별칭 사전 타입 — 한 학원에 대해 동일하게 취급할 이름들
 * 형식: { canonical: ["alias1", "alias2", ...] }
 *   canonical = 정식 표시명 (보통 schools.name)
 *   aliases   = 같은 학원을 가리키는 다른 표기들 (보통 promotions의 schoolName)
 */
export type AliasMap = Record<string, string[]>

/**
 * 별칭 사전을 정규화 기반 역인덱스로 변환
 * → 어떤 이름이 들어와도 canonical name을 빠르게 찾을 수 있게
 */
export function buildAliasIndex(aliases: AliasMap): Map<string, string> {
  const idx = new Map<string, string>()
  for (const [canonical, alts] of Object.entries(aliases)) {
    const cKey = normalizeSchoolName(canonical)
    if (cKey) idx.set(cKey, canonical)
    for (const a of alts) {
      const aKey = normalizeSchoolName(a)
      if (aKey) idx.set(aKey, canonical)
    }
  }
  return idx
}

/**
 * 이름 → canonical 학원명 변환
 * @returns canonical name 또는 null
 */
export function resolveSchoolName(name: string, idx: Map<string, string>): string | null {
  const key = normalizeSchoolName(name)
  if (!key) return null
  return idx.get(key) ?? null
}

/**
 * 학원 매칭 — schoolId 우선, 이름 fallback
 * promo가 schoolId를 가지고 있으면 그걸로 직매칭,
 * 없으면 schoolName → canonical 변환 → schools.name과 비교
 */
export function findSchoolForPromo(
  promo: { schoolId?: string; schoolName?: string },
  schools: School[],
  aliasIdx: Map<string, string>
): School | null {
  if (promo.schoolId) {
    const byId = schools.find(s => s.id === promo.schoolId)
    if (byId) return byId
  }
  if (promo.schoolName) {
    // 1) 정확 일치
    const exact = schools.find(s => s.name === promo.schoolName)
    if (exact) return exact

    // 2) 정규화 일치
    const promoKey = normalizeSchoolName(promo.schoolName)
    const byNorm = schools.find(s => normalizeSchoolName(s.name) === promoKey)
    if (byNorm) return byNorm

    // 3) 별칭 사전 — promo의 schoolName이 가리키는 canonical 찾기
    const canonical = resolveSchoolName(promo.schoolName, aliasIdx)
    if (canonical) {
      const byAlias = schools.find(s => s.name === canonical)
      if (byAlias) return byAlias
    }

    // 4) school의 aliases 필드 검사
    const byAliases = schools.find(s =>
      (s.aliases ?? []).some(a => normalizeSchoolName(a) === promoKey)
    )
    if (byAliases) return byAliases
  }
  return null
}

/**
 * 신규 학원 입력 시 유사 학원명 후보 제시
 * (매칭 검증 UI에서 사용)
 */
export function findSimilarSchoolNames(
  inputName: string,
  candidates: string[],
  limit = 5
): Array<{ name: string; score: number }> {
  const inputKey = normalizeSchoolName(inputName)
  if (!inputKey) return []

  const scored = candidates.map(c => {
    const cKey = normalizeSchoolName(c)
    if (!cKey) return { name: c, score: 0 }
    let score = 0
    // 완전 일치
    if (cKey === inputKey) score = 100
    // 한쪽이 다른 쪽을 포함
    else if (cKey.includes(inputKey)) score = 80
    else if (inputKey.includes(cKey)) score = 75
    // 공통 토큰
    else {
      const inTokens: string[] = inputKey.match(/[a-z]+|[가-힣]+/g) ?? []
      const cTokens: string[] = cKey.match(/[a-z]+|[가-힣]+/g) ?? []
      const common = inTokens.filter(t => cTokens.includes(t))
      if (common.length > 0) {
        score = Math.round((common.length / Math.max(inTokens.length, cTokens.length)) * 60)
      }
    }
    return { name: c, score }
  })

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * 미연결 프로모션 = schoolId도 없고 이름으로도 학원을 못 찾는 promo
 */
export function findOrphanPromos<T extends { schoolId?: string; schoolName?: string }>(
  promos: T[],
  schools: School[],
  aliasIdx: Map<string, string>
): T[] {
  return promos.filter(p => findSchoolForPromo(p, schools, aliasIdx) === null)
}

/**
 * 프로모션 미확인 학원 = School.promotions === null
 */
export function findUnknownPromoSchools(schools: School[]): School[] {
  return schools.filter(s => s.promotions === null)
}
