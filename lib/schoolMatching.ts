import type { School } from '@/types'
import type { PromoEntry } from './db'

/**
 * 학원 매칭 유틸
 *
 * - 자료의 학원명 표기는 일관되지 않을 수 있음 (예: "BAGUIO JIC" / "BAGUIO_JIC GVP" 등)
 * - schoolCode (영문 대문자_숫자_언더스코어) 기준으로 정규화
 * - region+name 함께 매칭하여 동일 학원명이 여러 지역에 있는 경우 (예: WALES)도 정확히 연결
 *
 * 매칭 우선순위:
 *   1. schoolCode 정확 일치
 *   2. (name 일치 AND region 일치) — 강한 일치
 *   3. name 정확 일치
 *   4. 정규화 일치 / 별칭 사전 / 학원 aliases 필드
 */

// 자료 학원명(짧은 표기) → schoolCode 매핑 별칭 사전
// 자료에 종종 등장하는 한글/약어 표기를 정규 code로 변환
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

/**
 * 임의 학원명 문자열을 정규 schoolCode로 변환
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
 * 학원 코드 정규화: 대문자 + 공백/하이픈/점을 언더스코어로
 */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s\-.]+/g, '_').replace(/[^A-Z0-9_]/g, '')
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
 * PromoEntry → 매칭되는 School 찾기 (region 강화 매칭 포함)
 */
export function findSchoolForPromo(
  promos: PromoEntry | { schoolCode?: string; schoolName?: string; region?: string },
  schools: School[]
): School | null {
  const targetCode = promos.schoolCode
    ?? (promos.schoolName ? resolveSchoolCode(promos.schoolName) : null)
  const targetRegion = promos.region

  // 1순위: code 정확 일치
  if (targetCode) {
    const byCode = schools.find(s => getSchoolCode(s) === targetCode)
    if (byCode) return byCode
  }

  if (!promos.schoolName) return null
  const nameLower = promos.schoolName.toLowerCase().trim()

  // 2순위: name + region 동시 일치
  if (targetRegion) {
    const both = schools.find(s =>
      s.name.toLowerCase().trim() === nameLower && s.region === targetRegion
    )
    if (both) return both
  }

  // 3순위: name 정확 일치
  const byName = schools.find(s => s.name.toLowerCase().trim() === nameLower)
  if (byName) return byName

  // 4순위: 정규화 후 일치
  const normName = normalizeCode(promos.schoolName)
  const byNorm = schools.find(s => normalizeCode(s.name) === normName)
  if (byNorm) return byNorm

  // 5순위: 부분 포함 (region 일치하면 우선)
  const includes = schools.filter(s =>
    s.name.toLowerCase().includes(nameLower) || nameLower.includes(s.name.toLowerCase())
  )
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
      s.name.toLowerCase().trim() === newSchool.name.toLowerCase().trim() &&
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
