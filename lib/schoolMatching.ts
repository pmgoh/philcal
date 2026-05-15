import type { School } from '@/types'
import type { PromoEntry } from './db'

/**
 * 학원 매칭 유틸
 *
 * - 자료의 학원명 표기는 일관되지 않을 수 있음 (예: "BAGUIO JIC" / "BAGUIO_JIC GVP" 등)
 * - schoolCode (영문 대문자_숫자_언더스코어) 기준으로 정규화
 * - region+name 함께 매칭하여 동일 학원명이 여러 지역에 있는 경우 (예: WALES)도 정확히 연결
 */

// ─── 별칭 사전 타입 ──────────────────────────────────────────────────────
// data/school-aliases.json 의 구조와 일치
export interface AliasMap {
  [canonicalName: string]: string[]   // 정규명 → 별칭 배열
}

// 인덱스화된 별칭 사전 (검색 빠르게)
// 정규화된 별칭 → 정규명 Map
export type AliasIndex = Map<string, string>

// 자료 학원명(짧은 표기) → schoolCode 매핑 별칭 사전 (v3 신구조용)
const ALIAS_TO_CODE: Record<string, string> = {
  // 세부
  'banana kids': 'BANANA_KIDS',
  '바나나키즈': 'BANANA_KIDS',
  'bcebu': 'BCEBU',
  'besta': 'BESTA',
  'blue ocean': 'BLUE_OCEAN',
  '블루오션': 'BLUE_OCEAN',
  'cella premium': 'CELLA_PREMIUM',
  '셀라프리미엄': 'CELLA_PREMIUM',
  'cella uni': 'CELLA_UNI',
  '셀라유니': 'CELLA_UNI',
  'cg banilad': 'CG_BANILAD',
  'cg_banilad': 'CG_BANILAD',
  'cg sparta': 'CG_SPARTA',
  'cg_sparta': 'CG_SPARTA',
  'cia': 'CIA',
  'cia camp': 'CIA_CAMP',
  'cia_camp': 'CIA_CAMP',
  'ciec': 'CIEC',
  'cij': 'CIJ',
  'cij junior': 'CIJ_JUNIOR',
  'cij_junior': 'CIJ_JUNIOR',
  'cpi': 'CPI',
  'cpils': 'CPILS',
  'edu talk': 'EDU_TALK',
  'edutalk': 'EDU_TALK',
  'elsa': 'ELSA',
  'english fella 1': 'ENGLISH_FELLA_1',
  'english fella 2': 'ENGLISH_FELLA_2',
  'english_fella_1': 'ENGLISH_FELLA_1',
  'english_fella_2': 'ENGLISH_FELLA_2',
  'fella1': 'ENGLISH_FELLA_1',
  'fella2': 'ENGLISH_FELLA_2',
  'ev': 'EV',
  'ev_lamer': 'EV_LAMER',
  'ev lamer': 'EV_LAMER',
  'glant': 'GLANT',
  'glc': 'GLC',
  'i breeze': 'I_BREEZE',
  'i_breeze': 'I_BREEZE',
  'ibreeze': 'I_BREEZE',
  'i.breeze': 'I_BREEZE',
  'ims': 'IMS_BANILAD',
  'ims_banilad': 'IMS_BANILAD',
  'izam city': 'IZAM_CITY',
  'izam_city': 'IZAM_CITY',
  'izam mactan': 'IZAM_MACTAN',
  'izam_mactan': 'IZAM_MACTAN',
  'jjes': 'JJES',
  'joyful': 'JOYFUL',
  'jungle': 'JUNGLE',
  'lcic': 'LCIC',
  'philinter': 'PHILINTER',
  'pilaedu': 'PILAEDU',
  'pj academy': 'PJ_ACADEMY',
  'pj_academy': 'PJ_ACADEMY',
  'qqenglish bfc': 'QQENGLISH_BFC',
  'qqenglish_bfc': 'QQENGLISH_BFC',
  'qqenglish itp': 'QQENGLISH_ITP',
  'qqenglish_itp': 'QQENGLISH_ITP',
  'sk119': 'SK119',
  'smeag capital': 'SMEAG_CAPITAL',
  'smeag_capital': 'SMEAG_CAPITAL',
  'smeag encanto': 'SMEAG_ENCANTO',
  'smeag_encanto': 'SMEAG_ENCANTO',

  // 바기오
  'pines main': 'PINES_MAIN',
  'pines_main': 'PINES_MAIN',
  'pines chapis': 'PINES_CHAPIS',
  'pines_chapis': 'PINES_CHAPIS',
  'baguio jic': 'BAGUIO_JIC',
  'baguio_jic': 'BAGUIO_JIC',
  'baguio jic gvp': 'BAGUIO_JIC_GVP',
  'baguio_jic_gvp': 'BAGUIO_JIC_GVP',
  'cns': 'CNS',
  'beci sparta': 'BECI_SPARTA',
  'beci_sparta': 'BECI_SPARTA',
  'beci city': 'BECI_CITY',
  'beci_city': 'BECI_CITY',
  'beci the cafe': 'BECI_THE_CAFE',
  'beci_the_cafe': 'BECI_THE_CAFE',
  'monol': 'MONOL',
  'wales': 'WALES',
  'e-edu_eco': 'E_EDU_ECO',
  'e_edu_eco': 'E_EDU_ECO',
  'e-edu eco': 'E_EDU_ECO',

  // 일로일로
  'gitc_cnc': 'GITC_CNC',
  'gitc(cnc)': 'GITC_CNC',
  'gitc': 'GITC_CNC',
  'mk iloilo': 'MK_ILOILO',
  'mk_iloilo': 'MK_ILOILO',
  'mk(iloilo)': 'MK_ILOILO',
  'we woori': 'WE_WOORI',
  'we_woori': 'WE_WOORI',

  // 클락
  'baekakgwan': 'BAEKAKGWAN',
  'bela': 'BELA',
  'eg': 'EG',
  'gs': 'GS',
  'hana': 'HANA',
  'help clark': 'HELP_CLARK',
  'help(clark)': 'HELP_CLARK',
  'help_clark': 'HELP_CLARK',
  'talk': 'TALK',
  'we academy': 'WE_ACADEMY',
  'we_academy': 'WE_ACADEMY',
  'eroom': 'EROOM',

  // 기타
  'smeag_tarlac': 'SMEAG_TARLAC',
  'smeag tarlac': 'SMEAG_TARLAC',
  'boracay coco': 'BORACAY_COCO',
  'boracay_coco': 'BORACAY_COCO',
  'boracaycoco': 'BORACAY_COCO',
}

// ─── 정규화 ──────────────────────────────────────────────────────────────

/**
 * 학원명을 비교용으로 정규화
 * - 소문자 변환
 * - 양쪽 공백 제거
 * - 연속 공백/언더스코어/하이픈을 하나로
 * - 특수문자 일부 제거 (괄호 등)
 *
 * 비교 시 양쪽을 모두 이 함수로 정규화한 뒤 비교
 */
export function normalizeSchoolName(name: string): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .trim()
    .replace(/[()[\]【】「」『』〈〉<>·•]/g, ' ')   // 괄호류 → 공백
    .replace(/[\s_\-./]+/g, ' ')                      // 공백/언더/하이픈/점/슬래시 → 공백
    .trim()
}

/**
 * 학원 코드 정규화: 대문자 + 공백/하이픈/점을 언더스코어로
 */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s\-.]+/g, '_').replace(/[^A-Z0-9_]/g, '')
}

// ─── 별칭 사전 인덱싱 ────────────────────────────────────────────────────

/**
 * AliasMap을 검색 가능한 인덱스(Map)로 변환
 *
 * data/school-aliases.json 예시:
 * {
 *   "CIJ Premium": ["CIJ", "씨아이제이"],
 *   "Pines Main": ["파인스", "Pines"]
 * }
 *
 * @returns 정규화된 별칭 → 정규명 Map (정규명 자체도 키로 포함)
 */
export function buildAliasIndex(aliases: AliasMap): AliasIndex {
  const idx: AliasIndex = new Map<string, string>()

  for (const [canonical, aliasList] of Object.entries(aliases ?? {})) {
    if (!canonical) continue
    const list = Array.isArray(aliasList) ? aliasList : []
    // 정규명 자체도 키로 등록 (정규명으로 검색해도 매칭됨)
    idx.set(normalizeSchoolName(canonical), canonical)
    for (const alias of list) {
      if (!alias) continue
      idx.set(normalizeSchoolName(alias), canonical)
    }
  }

  return idx
}

// ─── 유사도 검색 (Levenshtein 기반) ──────────────────────────────────────

/**
 * 두 문자열의 Levenshtein 거리 계산
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

/**
 * 유사도 점수 (0~100, 높을수록 유사)
 */
function similarityScore(a: string, b: string): number {
  if (!a || !b) return 0
  const aN = normalizeSchoolName(a)
  const bN = normalizeSchoolName(b)
  if (aN === bN) return 100

  const dist = levenshtein(aN, bN)
  const maxLen = Math.max(aN.length, bN.length)
  if (maxLen === 0) return 0

  let score = Math.round((1 - dist / maxLen) * 100)

  // 부분 포함 시 가산점
  if (aN.includes(bN) || bN.includes(aN)) score = Math.max(score, 70)

  return Math.max(0, Math.min(100, score))
}

/**
 * 학원명 후보에서 유사한 이름 검색
 *
 * @param query 검색할 학원명
 * @param candidates 비교 대상 학원명 배열
 * @param limit 반환할 최대 개수 (기본 5)
 * @returns 점수 내림차순, score >= 1만 반환
 */
export function findSimilarSchoolNames(
  query: string,
  candidates: string[],
  limit: number = 5,
): Array<{ name: string; score: number }> {
  if (!query) return []
  const scored = candidates
    .filter(c => c && c !== query)
    .map(c => ({ name: c, score: similarityScore(query, c) }))
    .filter(r => r.score >= 1)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

// ─── 별칭 사전 기반 학원 찾기 ────────────────────────────────────────────

/**
 * AliasIndex에서 query에 해당하는 정규 학원명 찾기
 */
function lookupAlias(query: string, aliasIdx?: AliasIndex): string | null {
  if (!aliasIdx) return null
  const normalized = normalizeSchoolName(query)
  return aliasIdx.get(normalized) ?? null
}

// ─── 메인 매칭 함수 ──────────────────────────────────────────────────────

/**
 * 임의 학원명 문자열을 정규 schoolCode로 변환 (v3 신구조용)
 * 매칭 실패 시 null
 */
export function resolveSchoolCode(name: string): string | null {
  if (!name) return null
  const key = name.toLowerCase().trim()

  // 1. 별칭 사전 정확 일치
  if (ALIAS_TO_CODE[key]) return ALIAS_TO_CODE[key]

  // 2. 공백/언더스코어/하이픈 정규화 후 재시도
  const normalized = key.replace(/[\s\-]+/g, '_')
  if (ALIAS_TO_CODE[normalized]) return ALIAS_TO_CODE[normalized]
  const denorm = key.replace(/[_\-]+/g, ' ')
  if (ALIAS_TO_CODE[denorm]) return ALIAS_TO_CODE[denorm]

  // 3. 부분 포함 (마지막 수단)
  const found = Object.entries(ALIAS_TO_CODE).find(([alias]) =>
    key.includes(alias) || alias.includes(key)
  )
  return found ? found[1] : null
}

/**
 * School 객체에서 effective code 추출 (있으면 schoolCode, 없으면 정규화된 name)
 */
export function getSchoolCode(school: School): string {
  const raw = (school as unknown as { code?: string; schoolCode?: string }).code
    ?? (school as unknown as { code?: string; schoolCode?: string }).schoolCode
  return raw ? normalizeCode(raw) : normalizeCode(school.name)
}

/**
 * PromoEntry → 매칭되는 모든 School 찾기 (같은 schoolCode 공유 학원 여러 개 가능)
 *
 * 사용 케이스: 사용자가 한 학원의 시즌별 row를 따로 등록한 경우
 * (예: SMEAG_ENCANTO 비수기 / 성수기로 학원 2개 등록 → 둘 다 반환)
 */
export function findSchoolsForPromo(
  promo: PromoEntry | { schoolId?: string; schoolCode?: string; schoolName?: string; region?: string },
  schools: School[],
  aliasIdx?: AliasIndex,
): School[] {
  const targetCode = (promo as { schoolCode?: string }).schoolCode
    ?? (promo.schoolName ? resolveSchoolCode(promo.schoolName) : null)

  // schoolCode 일치하는 학원 모두 (region 필터 추가 가능)
  if (targetCode) {
    const byCode = schools.filter(s => getSchoolCode(s) === targetCode)
    if (byCode.length > 0) {
      const targetRegion = (promo as { region?: string }).region
      if (targetRegion) {
        const inRegion = byCode.filter(s => s.region === targetRegion)
        if (inRegion.length > 0) return inRegion
      }
      return byCode
    }
  }

  // code 매칭 실패 시 단일 매칭으로 fallback
  const single = findSchoolForPromo(promo, schools, aliasIdx)
  return single ? [single] : []
}

/**
 * PromoEntry → 매칭되는 School 찾기
 *
 * 매칭 우선순위:
 *   1. schoolId 정확 일치 (있을 때)
 *   2. schoolCode 정확 일치 (v3)
 *   3. AliasIndex 조회
 *   4. (name 일치 AND region 일치) — 강한 일치
 *   5. 정규화된 name 일치
 *   6. 부분 포함
 *
 * @param promo PromoEntry 또는 부분 정보
 * @param schools 검색 대상 학원 배열
 * @param aliasIdx 선택: 별칭 인덱스
 */
export function findSchoolForPromo(
  promo: PromoEntry | { schoolId?: string; schoolCode?: string; schoolName?: string; region?: string },
  schools: School[],
  aliasIdx?: AliasIndex,
): School | null {
  // 1순위: schoolId 정확 일치
  const targetId = (promo as { schoolId?: string }).schoolId
  if (targetId) {
    const byId = schools.find(s => s.id === targetId)
    if (byId) return byId
  }

  // 2순위: schoolCode 정확 일치 (v3)
  const targetCode = (promo as { schoolCode?: string }).schoolCode
    ?? (promo.schoolName ? resolveSchoolCode(promo.schoolName) : null)
  if (targetCode) {
    const byCode = schools.find(s => getSchoolCode(s) === targetCode)
    if (byCode) return byCode
  }

  if (!promo.schoolName) return null
  const nameNorm = normalizeSchoolName(promo.schoolName)
  const targetRegion = (promo as { region?: string }).region

  // 3순위: 별칭 사전 조회
  if (aliasIdx) {
    const canonical = lookupAlias(promo.schoolName, aliasIdx)
    if (canonical) {
      const canonicalNorm = normalizeSchoolName(canonical)
      const byAlias = schools.find(s => normalizeSchoolName(s.name) === canonicalNorm)
      if (byAlias) return byAlias
    }
  }

  // 4순위: name + region 동시 일치
  if (targetRegion) {
    const both = schools.find(s =>
      normalizeSchoolName(s.name) === nameNorm && s.region === targetRegion
    )
    if (both) return both
  }

  // 5순위: 정규화된 name 일치
  const byName = schools.find(s => normalizeSchoolName(s.name) === nameNorm)
  if (byName) return byName

  // 6순위: 부분 포함 (region 일치하면 우선)
  const includes = schools.filter(s => {
    const sNorm = normalizeSchoolName(s.name)
    return sNorm.includes(nameNorm) || nameNorm.includes(sNorm)
  })
  if (includes.length === 1) return includes[0]
  if (includes.length > 1 && targetRegion) {
    const byRegion = includes.find(s => s.region === targetRegion)
    if (byRegion) return byRegion
  }
  return includes[0] ?? null
}

/**
 * 학원 신규 등록 시 중복 체크
 * - 동일 code 중복 금지
 * - 동일 (name + region) 중복 경고
 */
export function checkSchoolDuplicate(
  newSchool: { name: string; region?: string; code?: string },
  existing: School[]
): { ok: boolean; reason?: string; duplicateOf?: School } {
  const newCode = newSchool.code
    ? normalizeCode(newSchool.code)
    : normalizeCode(newSchool.name)

  // code 중복
  const codeDup = existing.find(s => getSchoolCode(s) === newCode)
  if (codeDup) {
    return { ok: false, reason: `동일 코드 학원이 이미 존재 (${codeDup.name})`, duplicateOf: codeDup }
  }

  // (name + region) 중복
  if (newSchool.region) {
    const nameRegionDup = existing.find(s =>
      normalizeSchoolName(s.name) === normalizeSchoolName(newSchool.name) &&
      s.region === newSchool.region
    )
    if (nameRegionDup) {
      return {
        ok: false,
        reason: `동일한 이름의 학원이 ${newSchool.region}에 이미 존재`,
        duplicateOf: nameRegionDup,
      }
    }
  }

  return { ok: true }
}
