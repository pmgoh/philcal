/**
 * v3 → Firestore PromoEntry 변환 + 일괄 교체 스크립트
 *
 * 사용법:
 *   npx tsx scripts/migrate-promos-v3.ts            # dry-run (변환만, 리포트만)
 *   npx tsx scripts/migrate-promos-v3.ts --apply    # 실제 Firestore 교체
 *
 * 동작:
 *   1. data/promotions_v3.json 읽음
 *   2. data/schools_master.json에서 schoolCode → schoolName/region 매핑
 *   3. 날짜 텍스트 파싱 (정교한 다국어 처리)
 *   4. v3 구조 → Firestore PromoEntry flat 구조 변환
 *   5. 변환 실패 케이스 리포트
 *   6. --apply 옵션 있을 때만:
 *      a. 기존 promotions 컬렉션 백업 (data/backup-{timestamp}.json)
 *      b. 기존 promotions 전체 삭제
 *      c. v3 데이터 일괄 등록
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── 타입 (lib/db.ts와 일치) ───────────────────────────────────────────────
interface AgencyWeekTier {
  minWeeks: number
  maxWeeks?: number
  amount: number
  scope?: 'per_person' | 'per_family'
}

interface V3PromoEntry {
  id: string
  schoolCode: string
  promoName: string
  target: string
  season: string
  registrationDeadline: string | null
  attendancePeriod: string | null
  applyPeriodNote: string
  promoContent: string
  agencyDiscount: {
    status: 'enabled' | 'disabled' | 'unconfirmed'
    type?: string
    value?: number
    applyTo?: string
    scope?: string
    minWeeks?: number
    regFeeDiscount?: number
    weekTiers?: AgencyWeekTier[]
    rawText?: string
    note?: string
  }
  noteRaw: string
  schoolDiscountDisabled?: boolean
  stackable?: boolean
  conditions?: Record<string, unknown>
  noticeDate?: string | null
}

interface FirestorePromoEntry {
  id: string
  schoolName: string
  schoolCode: string
  promoName: string
  region: string
  target?: string
  season?: string
  registrationDeadline?: string | null
  attendancePeriod?: string | null
  applyPeriodNote?: string
  promoContent?: string
  noteRaw?: string
  basisType: string
  alwaysApply?: boolean
  stackable?: boolean
  startDate: string
  endDate: string
  discountType: string
  discountValue?: number
  applyToCourses?: boolean
  applyToDorms?: boolean
  applyToSurcharge?: boolean
  condition?: string
  applicableItems?: string[]
  schoolDiscountDisabled?: boolean
  details: string
  isUrgent?: boolean
  urgentDays?: number | null
  note: string
  active: boolean
  createdAt: string
  updatedAt?: string
  noticeDate?: string
  agencyDiscountStatus?: 'enabled' | 'disabled' | 'unconfirmed'
  agencyDiscountType?: string
  agencyDiscountValue?: number
  agencyDiscountApplyTo?: string
  agencyDiscountScope?: string
  agencyDiscountMinWeeks?: number
  agencyDiscountRegFee?: number
  agencyDiscountWeekTiers?: AgencyWeekTier[]
  agencyDiscountRawText?: string
  agencyDiscountNote?: string
  conditions?: Record<string, unknown>
}

// ─── 날짜 파서 ───────────────────────────────────────────────────────────
// 자료에 나오는 다양한 날짜 표기를 ISO 형식(YYYY-MM-DD)으로 변환
interface ParsedRange { startDate: string; endDate: string }

function pad2(n: number): string { return n.toString().padStart(2, '0') }

function normalizeYear(y: number): number {
  // 2자리 연도 → 2000+y (예: 26 → 2026)
  // 100 이상이면 이미 4자리
  if (y < 100) return 2000 + y
  return y
}

/**
 * 날짜 한 개를 ISO로 변환
 * 처리 형식:
 *   - "26.02.22" / "26/02/22" / "26-02-22"
 *   - "2026.02.22" / "2026/02/22"
 *   - "26년 2월 22일"
 *   - "26년 2월22일" (공백 없음)
 *   - "2/22" (연도 누락 - 현재 연도 기준)
 */
function parseDate(text: string): string | null {
  if (!text) return null
  const s = text.trim()

  // 26.02.22 / 26/02/22 / 26-02-22 / 2026.02.22
  let m = s.match(/(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/)
  if (m) {
    const y = normalizeYear(Number(m[1]))
    const mo = Number(m[2])
    const d = Number(m[3])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(mo)}-${pad2(d)}`
    }
  }

  // "26년 2월 22일" / "26년2월22일" / "2026년 2월 22일"
  m = s.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (m) {
    const y = normalizeYear(Number(m[1]))
    return `${y}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`
  }

  // "2월 22일" (연도 누락) - 현재 연도 기준
  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (m) {
    const now = new Date()
    return `${now.getFullYear()}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`
  }

  // "2/22" (연-월-일 슬래시, 연도 누락) - 매우 짧은 형식이라 보수적으로 무시
  return null
}

/**
 * 텍스트에서 기간(start~end) 추출
 *
 * 원칙:
 * - 시작일이 자료에 명시되지 않으면 null 반환 → 호출하는 쪽에서 alwaysApply=true로 처리
 * - 절대 오늘 날짜를 시작일로 임의 박지 않음
 * - 멀티 기간 (예: "26/2/8 ~ 6/14 / 26/9/6 ~ 12/27")은 첫 번째 기간만 사용
 */
function parseDateRange(text: string): ParsedRange | null {
  if (!text) return null
  const cleaned = text.replace(/\s+/g, ' ').trim()

  // ── 1. 명시적 시작~끝 패턴 (가장 우선) ────────────────────────────────
  // "26.02.22 ~ 26.06.27" / "26/2/8 ~ 6/14" / "26.02.22~26.06.27"
  // 시작쪽은 풀 날짜, 끝쪽은 풀 날짜 또는 월/일만
  let m

  // (a) 풀 날짜 ~ 풀 날짜
  m = cleaned.match(/(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})\s*[~\-–]\s*(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/)
  if (m) {
    const y1 = normalizeYear(Number(m[1]))
    const y2 = normalizeYear(Number(m[4]))
    return {
      startDate: `${y1}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`,
      endDate: `${y2}-${pad2(Number(m[5]))}-${pad2(Number(m[6]))}`,
    }
  }

  // (b) 풀 날짜 ~ 월/일 (같은 연도 가정): "26/2/8 ~ 6/14"
  m = cleaned.match(/(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})\s*[~\-–]\s*(\d{1,2})[.\/\-](\d{1,2})(?:\s|$|[^.\/\-\d])/)
  if (m) {
    const y = normalizeYear(Number(m[1]))
    return {
      startDate: `${y}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`,
      endDate: `${y}-${pad2(Number(m[4]))}-${pad2(Number(m[5]))}`,
    }
  }

  // (c) 한국어 풀형: "2026년 9월 1일 ~ 2026년 12월 30일" / "26년 2월 22일 ~ 5월 24일"
  m = cleaned.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:부터|이후)?\s*[~\-–]?\s*(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:까지|이전)?/)
  if (m) {
    const y1 = normalizeYear(Number(m[1]))
    const y2 = m[4] ? normalizeYear(Number(m[4])) : y1
    return {
      startDate: `${y1}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`,
      endDate: `${y2}-${pad2(Number(m[5]))}-${pad2(Number(m[6]))}`,
    }
  }

  // (d) 한국어 + "까지" 한쪽만: "26년 3월 ~ 26년 6월 30일까지" (시작은 월만)
  m = cleaned.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*[~\-–]\s*(?:(\d{2,4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (m) {
    const y1 = normalizeYear(Number(m[1]))
    const y2 = m[3] ? normalizeYear(Number(m[3])) : y1
    return {
      startDate: `${y1}-${pad2(Number(m[2]))}-01`,
      endDate: `${y2}-${pad2(Number(m[4]))}-${pad2(Number(m[5]))}`,
    }
  }

  // (e) 한국어 월-월 범위: "26년 2월~12월"
  m = cleaned.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*[~\-–]\s*(\d{1,2})\s*월/)
  if (m) {
    const y = normalizeYear(Number(m[1]))
    const m1 = Number(m[2])
    const m2 = Number(m[3])
    const lastDay = new Date(y, m2, 0).getDate()
    return {
      startDate: `${y}-${pad2(m1)}-01`,
      endDate: `${y}-${pad2(m2)}-${pad2(lastDay)}`,
    }
  }

  // (f) 단일 월: "26년 3월" → 그 달 1일~말일
  m = cleaned.match(/^(?:\[[^\]]*\]\s*)?(\d{2,4})\s*년\s*(\d{1,2})\s*월(?:\s|$|[^\d])/)
  if (m) {
    const y = normalizeYear(Number(m[1]))
    const mo = Number(m[2])
    const lastDay = new Date(y, mo, 0).getDate()
    return {
      startDate: `${y}-${pad2(mo)}-01`,
      endDate: `${y}-${pad2(mo)}-${pad2(lastDay)}`,
    }
  }

  // (g) 월/일 ~ 월/일 (같은 연도, 자료에 "26년" 등 연도 단서 있을 때만)
  const yearMatch = cleaned.match(/(?:^|\D)(?:20)?(\d{2})\s*년/)
  if (yearMatch) {
    m = cleaned.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*[~\-–]\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
    if (m) {
      const y = normalizeYear(Number(yearMatch[1]))
      return {
        startDate: `${y}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`,
        endDate: `${y}-${pad2(Number(m[3]))}-${pad2(Number(m[4]))}`,
      }
    }
  }

  // (h) "2026 1월 1일 부터" — 시작 단독, 종료는 연말
  m = cleaned.match(/(\d{4})\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:등록생)?\s*(?:부터|이후)/)
  if (m) {
    const y = Number(m[1])
    return {
      startDate: `${y}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`,
      endDate: `${y}-12-31`,
    }
  }
  m = cleaned.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:등록생)?\s*(?:부터|이후)/)
  if (m) {
    const y = normalizeYear(Number(m[1]))
    return {
      startDate: `${y}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`,
      endDate: `${y}-12-31`,
    }
  }

  // (i) "2026년 12월 일정 이내에 입학" — 단일 월
  m = cleaned.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*일정\s*이내/)
  if (m) {
    const y = normalizeYear(Number(m[1]))
    const mo = Number(m[2])
    const lastDay = new Date(y, mo, 0).getDate()
    return {
      startDate: `${y}-${pad2(mo)}-01`,
      endDate: `${y}-${pad2(mo)}-${pad2(lastDay)}`,
    }
  }

  // ── 매칭 실패 ─────────────────────────────────────────────────────────
  // 끝-단독 표기 ("5월 24일 등록자까지" 등)는 시작일을 임의로 박지 않고 null 반환
  // → 호출 측에서 alwaysApply=true로 처리하고 자료 원문은 applyPeriodNote에 보존
  return null
}

// ─── 변환 로직 ───────────────────────────────────────────────────────────
interface ConversionResult {
  entry: FirestorePromoEntry | null
  warnings: string[]
  errors: string[]
}

function convertV3ToFirestore(
  v3: V3PromoEntry,
  schoolLookup: Map<string, { name: string; campus: string; region: string }>,
  now: string,
): ConversionResult {
  const warnings: string[] = []
  const errors: string[] = []

  // 1. 학원 조회
  const school = schoolLookup.get(v3.schoolCode)
  if (!school) {
    errors.push(`알 수 없는 학원 코드: ${v3.schoolCode}`)
    return { entry: null, warnings, errors }
  }

  const schoolDisplayName = school.campus && school.campus !== '본원'
    ? `${school.name} ${school.campus}`
    : school.name

  // 2. 날짜 파싱
  let startDate = ''
  let endDate = ''
  let alwaysApply = false

  // 우선순위: attendancePeriod > registrationDeadline > applyPeriodNote
  const periodSources = [
    v3.attendancePeriod,
    v3.registrationDeadline,
    v3.applyPeriodNote,
  ].filter((s): s is string => !!s)

  let parsed: ParsedRange | null = null
  for (const source of periodSources) {
    parsed = parseDateRange(source)
    if (parsed) break
  }

  if (parsed) {
    // 시작 > 끝 역전 검증 → 이상하면 alwaysApply로 안전 처리
    const sDate = new Date(parsed.startDate)
    const eDate = new Date(parsed.endDate)
    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      warnings.push(`날짜 변환 실패: ${parsed.startDate} ~ ${parsed.endDate}`)
      alwaysApply = true
      startDate = ''
      endDate = ''
    } else if (sDate.getTime() > eDate.getTime()) {
      warnings.push(`시작일이 종료일보다 늦음 (${parsed.startDate} > ${parsed.endDate}) — alwaysApply로 처리`)
      alwaysApply = true
      startDate = ''
      endDate = ''
    } else {
      startDate = parsed.startDate
      endDate = parsed.endDate
    }
  } else if (periodSources.length === 0) {
    // 자료에 기간 정보 자체가 없음 → alwaysApply
    alwaysApply = true
    startDate = ''
    endDate = ''
  } else {
    // 기간 정보는 있는데 파싱 실패 → 리포트
    warnings.push(`날짜 파싱 실패: "${periodSources[0]?.substring(0, 60)}..."`)
    alwaysApply = true
    startDate = ''
    endDate = ''
  }

  // 3. 할인 타입 매핑 (어학원 측 학비할인 → calcEngine용 discountType)
  // promoContent에서 추출 - 정교한 파싱은 운영자가 수정하도록 기본값만 세팅
  let discountType = 'amount'
  let discountValue = 0
  // promoContent에 "%" 있으면 percent, "만원" 있으면 amount
  if (v3.promoContent && /\d+\s*%/.test(v3.promoContent)) {
    discountType = 'percent'
  } else if (v3.promoContent && /\d+\s*만\s*원/.test(v3.promoContent)) {
    discountType = 'amount'
  }

  // 4. agencyDiscount flat 변환
  const ad = v3.agencyDiscount
  const adFields: Partial<FirestorePromoEntry> = {
    agencyDiscountStatus: ad.status,
    agencyDiscountRawText: ad.rawText,
    agencyDiscountNote: ad.note,
  }
  if (ad.status === 'enabled') {
    adFields.agencyDiscountType = ad.type
    adFields.agencyDiscountValue = ad.value
    adFields.agencyDiscountApplyTo = ad.applyTo
    adFields.agencyDiscountScope = ad.scope
    adFields.agencyDiscountMinWeeks = ad.minWeeks
    adFields.agencyDiscountRegFee = ad.regFeeDiscount
    adFields.agencyDiscountWeekTiers = ad.weekTiers
  }

  // 5. region 매핑 (자료 region을 PromoEntry region으로)
  // schools_master.json의 region을 그대로 사용
  let region = school.region
  // PromoEntry region 형식 통일 (선택)
  if (region === '딸락') region = '기타'   // 일치된 enum 없으면 '기타'로

  // 6. 결과 조립 - undefined 필드는 제거
  const result: FirestorePromoEntry = {
    id: v3.id,
    schoolName: schoolDisplayName,
    schoolCode: v3.schoolCode,
    promoName: v3.promoName,
    region,
    target: v3.target,
    season: v3.season,
    registrationDeadline: v3.registrationDeadline ?? undefined,
    attendancePeriod: v3.attendancePeriod ?? undefined,
    applyPeriodNote: v3.applyPeriodNote,
    promoContent: v3.promoContent,
    noteRaw: v3.noteRaw,
    basisType: 'start_date',  // 자료에 "출국일 기준" 명시 다수 있어 기본값을 start_date
    alwaysApply,
    stackable: v3.stackable,
    startDate,
    endDate,
    discountType,
    discountValue,
    applyToCourses: true,
    applyToDorms: true,
    applyToSurcharge: false,
    schoolDiscountDisabled: v3.schoolDiscountDisabled,
    details: v3.promoContent || v3.applyPeriodNote || '',
    note: v3.noteRaw || '',
    active: true,
    createdAt: now,
    noticeDate: v3.noticeDate ?? undefined,
    conditions: v3.conditions,
    ...adFields,
  }

  // undefined 제거 (Firestore 호환)
  Object.keys(result).forEach((k) => {
    const v = (result as unknown as Record<string, unknown>)[k]
    if (v === undefined) delete (result as unknown as Record<string, unknown>)[k]
  })

  return { entry: result, warnings, errors }
}

// ─── 메인 ────────────────────────────────────────────────────────────────
async function main() {
  const apply = process.argv.includes('--apply')

  // 1. v3 JSON 읽기
  const v3Path = path.join(process.cwd(), 'data/promotions_v3.json')
  const v3Data = JSON.parse(fs.readFileSync(v3Path, 'utf-8'))
  const v3Promos: V3PromoEntry[] = v3Data.promotions
  console.log(`v3 프로모션 ${v3Promos.length}건 로드`)

  // 2. schools_master 읽기
  const smPath = path.join(process.cwd(), 'data/schools_master.json')
  const smRaw = JSON.parse(fs.readFileSync(smPath, 'utf-8'))
  // schools_master.json 구조: { schools: [...] } 또는 [...] 그대로
  const schools = (smRaw.schools ?? smRaw) as Array<{
    code: string; name: string; campus: string; region: string
  }>
  const schoolLookup = new Map<string, { name: string; campus: string; region: string }>()
  for (const s of schools) {
    schoolLookup.set(s.code, { name: s.name, campus: s.campus, region: s.region })
  }
  console.log(`학원 마스터 ${schoolLookup.size}건 로드\n`)

  // 3. 변환 + 리포트 수집
  const now = new Date().toISOString()
  const converted: FirestorePromoEntry[] = []
  const failedPromos: Array<{ promo: V3PromoEntry; errors: string[]; warnings: string[] }> = []
  const warnedPromos: Array<{ promo: V3PromoEntry; warnings: string[] }> = []

  for (const v3 of v3Promos) {
    const { entry, warnings, errors } = convertV3ToFirestore(v3, schoolLookup, now)
    if (errors.length > 0 || !entry) {
      failedPromos.push({ promo: v3, errors, warnings })
    } else {
      converted.push(entry)
      if (warnings.length > 0) {
        warnedPromos.push({ promo: v3, warnings })
      }
    }
  }

  // 4. 리포트 출력
  console.log('=== 변환 결과 ===')
  console.log(`성공: ${converted.length} / ${v3Promos.length}`)
  console.log(`실패: ${failedPromos.length}`)
  console.log(`경고 (성공이지만 날짜 파싱 등 일부 실패): ${warnedPromos.length}`)
  console.log()

  if (failedPromos.length > 0) {
    console.log('=== 실패 케이스 ===')
    failedPromos.forEach((f) => {
      console.log(`[${f.promo.id}] ${f.promo.schoolCode} - ${f.promo.promoName}`)
      f.errors.forEach((e) => console.log(`  ERROR: ${e}`))
    })
    console.log()
  }

  if (warnedPromos.length > 0) {
    console.log('=== 경고 케이스 (날짜 파싱 실패 → alwaysApply=true) ===')
    warnedPromos.slice(0, 30).forEach((w) => {
      console.log(`[${w.promo.id}] ${w.promo.schoolCode} - ${w.promo.promoName}`)
      w.warnings.forEach((wn) => console.log(`  WARN: ${wn}`))
    })
    if (warnedPromos.length > 30) {
      console.log(`... 외 ${warnedPromos.length - 30}건`)
    }
    console.log()
  }

  // 5. 리포트 파일로 저장
  const reportPath = path.join(process.cwd(), 'data/migration-report.json')
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: now,
    totalV3: v3Promos.length,
    successCount: converted.length,
    failureCount: failedPromos.length,
    warningCount: warnedPromos.length,
    failures: failedPromos.map((f) => ({
      id: f.promo.id,
      schoolCode: f.promo.schoolCode,
      promoName: f.promo.promoName,
      errors: f.errors,
      warnings: f.warnings,
    })),
    warnings: warnedPromos.map((w) => ({
      id: w.promo.id,
      schoolCode: w.promo.schoolCode,
      promoName: w.promo.promoName,
      warnings: w.warnings,
    })),
  }, null, 2), 'utf-8')
  console.log(`리포트 저장: ${reportPath}`)

  // 6. 변환된 데이터 저장
  const convertedPath = path.join(process.cwd(), 'data/promotions_v3_firestore.json')
  fs.writeFileSync(convertedPath, JSON.stringify({
    timestamp: now,
    promotions: converted,
  }, null, 2), 'utf-8')
  console.log(`Firestore용 변환본: ${convertedPath}`)

  // 7. --apply 시 실제 교체
  if (!apply) {
    console.log('\n💡 실제 Firestore 적용은: npx tsx scripts/migrate-promos-v3.ts --apply')
    return
  }

  // ── Firestore 적용 ────────────────────────────────────────────────────
  console.log('\n=== Firestore 적용 시작 ===')

  // 동적 import (Firebase는 .env.local 로딩 필요)
  // 환경변수 로드
  const dotenvPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(dotenvPath)) {
    const envContent = fs.readFileSync(dotenvPath, 'utf-8')
    envContent.split('\n').forEach((line) => {
      const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    })
  }

  const { initializeApp } = await import('firebase/app')
  const { getFirestore, collection, getDocs, writeBatch, doc } = await import('firebase/firestore')

  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }
  const app = initializeApp(firebaseConfig)
  const db = getFirestore(app)

  // 7-1. 기존 데이터 백업
  console.log('기존 promotions 컬렉션 백업 중...')
  const snap = await getDocs(collection(db, 'promotions'))
  const backupData = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const backupPath = path.join(process.cwd(), `data/backup-promotions-${Date.now()}.json`)
  fs.writeFileSync(backupPath, JSON.stringify({ timestamp: now, data: backupData }, null, 2), 'utf-8')
  console.log(`백업 저장: ${backupPath} (${backupData.length}건)`)

  // 7-2. 기존 데이터 삭제
  console.log('기존 promotions 삭제 중...')
  const deleteBatch = writeBatch(db)
  snap.docs.forEach((d) => deleteBatch.delete(d.ref))
  await deleteBatch.commit()
  console.log(`${backupData.length}건 삭제 완료`)

  // 7-3. v3 데이터 일괄 등록 (500개 단위 배치)
  console.log('v3 데이터 등록 중...')
  for (let i = 0; i < converted.length; i += 400) {
    const slice = converted.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const p of slice) {
      batch.set(doc(db, 'promotions', p.id), p)
    }
    await batch.commit()
    console.log(`  ${Math.min(i + 400, converted.length)}/${converted.length}`)
  }
  console.log(`\n✅ ${converted.length}건 Firestore 등록 완료`)
}

main().catch((err) => {
  console.error('스크립트 실행 실패:', err)
  process.exit(1)
})
