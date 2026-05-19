import type { School, Course, Dormitory, QuoteItem, ExchangeRate, LocalFee, RegistrationFee, Package } from '@/types'
import { calcShortTermPrice } from '@/types'
import { toKrw } from './utils'

export interface CourseItem   { courseId: string; weeks: number }
export interface DormItem     { dormitoryId: string; weeks: number }
export interface PackageInput {
  packageId: string
  weeks: number
  columnLabel: string          // "2인가족", "3인가족" 등
  additionalRuleIds?: string[] // 적용할 추가규정 id
}

export interface QuoteInput {
  school: School
  startDate: string
  enrollmentDate: string
  courses: CourseItem[]
  dormitories: DormItem[]
  packages?: PackageInput[]    // 패키지 목록 (코스/기숙사와 독립)
}

export interface PackageResultItem {
  pkg: Package
  weeks: number
  columnLabel: string
  baseAmount: number           // 행렬 조회 금액 (원화)
  additionalAmount: number     // 추가규정 합계
  totalKrw: number
  appliedRules: string[]
}

export interface CalcResult {
  courseItems: QuoteItem[]
  dormItems:   QuoteItem[]
  packageItems: PackageResultItem[]
  surchargeItems: QuoteItem[]
  promotionLabel?: string
  promotionDiscount: number
  surchargeDiscount: number
  baseKrw: number
  surchargeKrw: number
  subtotal: number
  registrationFee?: RegistrationFee
  registrationFeeKrw: number
  agencyDiscountKrw: number        // 엠버시 자체 할인 (자동 계산)
  agencyDiscountNote: string
  totalKrw: number                 // 등록비+학비+기숙사+서차지-프로모션할인-엠버시할인
  totalWeeks: number
  courseTotalWeeks: number
  dormTotalWeeks: number
  localFees: LocalFee[]
  localFeePhp: number
  localFeeKrwEstimate: number
  warnings: string[]
  notes: string[]
}

function findCourse(courses: Course[], key: string): Course | undefined {
  if (!key) return undefined
  const lower = key.toLowerCase().trim()
  // 1순위: ID 정확 일치
  const byId = courses.find(c => c.id === key)
  if (byId) return byId
  // 2순위: 이름 정확 일치
  const byExact = courses.find(c => c.name.toLowerCase() === lower)
  if (byExact) return byExact
  // 3순위: 단어 단위 포함 (단어 경계 기준)
  const byWord = courses.find(c => {
    const cWords = c.name.toLowerCase().split(/[\s\-_]+/)
    const kWords = lower.split(/[\s\-_]+/)
    // 검색어의 모든 단어가 코스명에 포함되어야 함
    return kWords.every(kw => cWords.some(cw => cw === kw))
  })
  if (byWord) return byWord
  // 4순위: 부분 포함 (마지막 수단)
  return courses.find(c => c.name.toLowerCase().includes(lower))
}

function findDorm(dorms: Dormitory[], key: string): Dormitory | undefined {
  if (!key) return undefined
  const lower = key.toLowerCase()
  return dorms.find(d => d.id === key)
    ?? dorms.find(d => d.name.toLowerCase() === lower)
    ?? dorms.find(d => d.name.toLowerCase().includes(lower) || lower.includes(d.name.toLowerCase()))
}

function getPrice4w(item: Course | Dormitory): number {
  return (item as unknown as Record<string,number>).price4Weeks
    ?? (item as unknown as Record<string,number>).pricePerWeek
    ?? 0
}

export function calculateQuote(input: QuoteInput, rate: ExchangeRate): CalcResult {
  const { school, startDate, enrollmentDate } = input
  const warnings: string[] = []
  const notes: string[] = []
  const courseItems: QuoteItem[] = []
  const dormItems:   QuoteItem[] = []
  const packageItems: PackageResultItem[] = []
  const surchargeItems: QuoteItem[] = []

  const courses = school.courses ?? []
  const dorms   = school.dormitories ?? []
  const pkgs    = school.packages ?? []

  // ── 패키지 계산 ───────────────────────────────────────────────────────────
  for (const pi of (input.packages ?? [])) {
    const pkg = pkgs.find(p => p.id === pi.packageId)
      ?? pkgs.find(p => p.label === pi.packageId)
      ?? pkgs.find(p => p.label.includes(pi.packageId))
    if (!pkg) { warnings.push(`패키지 "${pi.packageId}"를 찾을 수 없습니다.`); continue }

    // ── 패키지 유효기간 체크 ────────────────────────────────────────────────
    const pkgStart = pkg.startDate
    const pkgEnd   = pkg.endDate
    if (pkgStart && pkgEnd) {
      if (startDate < pkgStart || startDate > pkgEnd) {
        warnings.push(
          `⚠️ [혼합기간 주의] "${pkg.label}" 유효기간 ${pkgStart}~${pkgEnd} / 입국일 ${startDate} 는 범위 밖입니다. ` +
          `패키지 기간과 일반 기간이 혼합된 케이스일 수 있으니 학원 담당자 확인 필수. 아래 금액은 추산값입니다.`
        )
      }
    }

    const w = Math.max(1, Math.round(Number(pi.weeks) || 1))
    const row = pkg.priceMatrix.find(r => r.weeks === w)
    if (!row) {
      // 가장 가까운 주수 찾기
      const sorted = [...pkg.priceMatrix].sort((a, b) => Math.abs(a.weeks - w) - Math.abs(b.weeks - w))
      warnings.push(`⚠️ "${pkg.label}"에 ${w}주 가격이 없습니다. 가장 가까운 ${sorted[0]?.weeks}주를 참고하세요.`)
      continue
    }

    // 열 매칭 (정확 → 부분)
    const col = row.prices.find(p => p.label === pi.columnLabel)
      ?? row.prices.find(p => p.label.includes(pi.columnLabel) || pi.columnLabel.includes(p.label))
    if (!col) {
      warnings.push(`⚠️ "${pkg.label}"에서 "${pi.columnLabel}" 열을 찾을 수 없습니다. 가능한 열: ${row.prices.map(p => p.label).join(', ')}`)
      continue
    }

    const baseAmount = toKrw(col.amount, pkg.currency, rate)

    // 추가규정 적용
    let additionalAmount = 0
    const appliedRules: string[] = []
    for (const rule of (pkg.additionalRules ?? [])) {
      if (!pi.additionalRuleIds || pi.additionalRuleIds.includes(rule.id)) continue
      // 명시적으로 요청된 추가규정만 적용
    }
    if (pi.additionalRuleIds) {
      for (const ruleId of pi.additionalRuleIds) {
        const rule = (pkg.additionalRules ?? []).find(r => r.id === ruleId || r.condition.includes(ruleId))
        if (rule) {
          additionalAmount += toKrw(rule.addAmount, rule.currency, rate)
          appliedRules.push(`${rule.condition}: +${rule.addAmount.toLocaleString()}${rule.currency}`)
        }
      }
    }

    packageItems.push({
      pkg, weeks: w, columnLabel: col.label,
      baseAmount, additionalAmount,
      totalKrw: baseAmount + additionalAmount,
      appliedRules,
    })
  }

  // 총 주수 계산 (패키지 포함)
  const courseTotalWeeks = input.courses.reduce((s, c) => s + Math.max(1, Math.round(Number(c.weeks)||1)), 0)
  const dormTotalWeeks   = input.dormitories.reduce((s, d) => s + Math.max(1, Math.round(Number(d.weeks)||1)), 0)
  const pkgTotalWeeks    = packageItems.length > 0 ? Math.max(...packageItems.map(p => p.weeks)) : 0
  const totalWeeks = Math.max(courseTotalWeeks, dormTotalWeeks, pkgTotalWeeks)

  // 최소 주수 체크 (총 주수 기준)
  const effectiveMin = school.allowShortTerm ? 1 : school.minWeeks
  if (totalWeeks < effectiveMin) {
    warnings.push(`⚠️ ${school.name}의 최소 수강 기간은 ${school.minWeeks}주입니다. (요청 총 ${totalWeeks}주)`)
  }

  // 단기가 적용 여부 — 총 주수가 4 미만일 때만
  const isShortTerm = school.allowShortTerm && totalWeeks < 4

  // 단기 가격 정보 미확인 학원에 4주 미만 견적 요청 시 — 강한 경고 자동 추가
  // (정보 없음 ≠ 불가 원칙: 계산은 정비례 fallback으로 진행하되 견적이 추정값임을 명시)
  if (totalWeeks < 4 && school.shortTermDataStatus === 'unconfirmed') {
    warnings.push(
      `🔴 [단기-미확인] ${school.name}은(는) 4주 미만 단기 가격이 자료에 명시되어 있지 않습니다. ` +
      `시스템은 정비례(4주 단가 ÷ 4 × 주수)로 자동 계산했으나, 학원 실제 단기가와 다를 수 있습니다. ` +
      `정확한 단기 견적은 본사 또는 학원에 직접 문의 필요합니다.`
    )
  }

  // 24주 이상 → 반드시 학원 문의 안내
  if (totalWeeks >= 24) {
    warnings.push(`⚠️ 24주 이상 장기 연수입니다. 정확한 학비 및 조건은 반드시 학원에 직접 문의하세요.`)
  }

  // 기숙사 미운영 학원 (영어유치원 등 외부 거주 전제) 안내
  // 학원 데이터에 dormitories가 비어있으면 시스템 안내. 사용자가 dormItems를 넣어도 빈 학원이라 무시됨.
  if ((dorms?.length ?? 0) === 0) {
    if (input.dormitories.length > 0) {
      warnings.push(
        `ℹ️ ${school.name}은(는) 기숙사를 운영하지 않습니다 (외부 거주 전제). ` +
        `요청하신 기숙사 항목은 견적에서 제외됩니다.`
      )
    } else {
      notes.push(`ℹ️ ${school.name}은(는) 기숙사를 직접 운영하지 않습니다. 견적에 기숙사비는 미포함.`)
    }
  }

  const today = new Date().toISOString().split('T')[0]
  const pi = school.priceIncrease
  const increaseActive = pi && pi.fromDate <= today
  if (increaseActive) notes.push(`ℹ️ ${pi!.label ?? '비용 인상'} 적용 중 (${pi!.fromDate}~)`)

  // ── 코스 계산 ─────────────────────────────────────────────────────────────
  for (const ci of input.courses) {
    const w = Math.max(1, Math.round(Number(ci.weeks)||1))
    const course = findCourse(courses, ci.courseId)
    if (!course) { warnings.push(`코스 "${ci.courseId}"를 찾을 수 없습니다.`); continue }

    const p4w = getPrice4w(course)
    const addKrw = increaseActive ? toKrw(pi!.courses.find(c=>c.id===course.id)?.add??0, pi!.currency, rate) : 0

    let price: number, label: string
    if (isShortTerm && w <= 3) {
      price = calcShortTermPrice(p4w, w as 1|2|3, school.courseShortTermRates)
      label = `코스: ${course.name} (${w}주 단기가)`
    } else if (isShortTerm && w === 4 && school.courseShortTermRates?.week4Included) {
      price = school.courseShortTermRates.week4 ?? p4w
      label = `코스: ${course.name} (4주 특별가)`
    } else {
      price = Math.round(p4w / 4 * w)
      label = `코스: ${course.name} × ${w}주`
    }
    courseItems.push({ label, weeks: w, unitPrice: Math.round(price/w), currency: course.currency, krwAmount: toKrw(price, course.currency, rate) + addKrw * w })
  }

  // ── 기숙사 계산 ───────────────────────────────────────────────────────────
  for (const di of input.dormitories) {
    const w = Math.max(1, Math.round(Number(di.weeks)||1))
    const dorm = findDorm(dorms, di.dormitoryId)
    if (!dorm) { warnings.push(`기숙사 "${di.dormitoryId}"를 찾을 수 없습니다.`); continue }

    const p4w = getPrice4w(dorm)
    const addKrw = increaseActive ? toKrw(pi!.dormitories.find(d=>d.id===dorm.id)?.add??0, pi!.currency, rate) : 0

    let price: number, label: string
    if (isShortTerm && w <= 3) {
      price = calcShortTermPrice(p4w, w as 1|2|3, school.dormShortTermRates)
      label = `기숙사: ${dorm.name} (${w}주 단기가)`
    } else if (isShortTerm && w === 4 && school.dormShortTermRates?.week4Included) {
      price = school.dormShortTermRates.week4 ?? p4w
      label = `기숙사: ${dorm.name} (4주 특별가)`
    } else {
      price = Math.round(p4w / 4 * w)
      label = `기숙사: ${dorm.name} × ${w}주`
    }
    dormItems.push({ label, weeks: w, unitPrice: Math.round(price/w), currency: dorm.currency, krwAmount: toKrw(price, dorm.currency, rate) + addKrw * w })
  }

  // 등록비 (1회)
  const regFee = school.registrationFee
  let registrationFeeKrw = regFee ? toKrw(regFee.amount, regFee.currency, rate) : 0

  const pkgBaseKrw = packageItems.reduce((s, p) => s + p.totalKrw, 0)
  const baseKrw = [...courseItems, ...dormItems].reduce((s,i) => s + i.krwAmount, 0) + pkgBaseKrw

  // agencyDiscount는 프로모션에서만 계산 (초기값 0)
  let agencyDiscountKrw = 0
  let agencyDiscountNote = ''

  // ── 서차지 ────────────────────────────────────────────────────────────────
  let surchargeKrw = 0
  const endDate = addWeeksHelper(startDate, totalWeeks)
  const surchargeDetails: Array<{krw:number; discountAllowed:boolean; label:string}> = []

  for (const sc of (school.surcharges ?? [])) {
    if (!sc.startDate || !sc.endDate) continue
    const overlap = getOverlapWeeks(startDate, endDate, sc.startDate, sc.endDate)
    if (overlap > 0) {
      const krw = toKrw(sc.pricePerWeek * overlap, sc.currency, rate)
      surchargeItems.push({ label: `서차지: ${sc.label} (${overlap}주 × ${sc.pricePerWeek.toLocaleString()}${sc.currency}/주)`, weeks: overlap, unitPrice: sc.pricePerWeek, currency: sc.currency, krwAmount: krw })
      surchargeKrw += krw
      surchargeDetails.push({ krw, discountAllowed: sc.discountAllowed, label: sc.label })
    }
  }

  // ── 프로모션 ─────────────────────────────────────────────────────────────
  let promotionLabel: string | undefined
  let promotionDiscount = 0
  let surchargeDiscount = 0
  const appliedPromoLabels: string[] = []
  const appliedPromoDetails: Array<{ label: string; discount: number }> = []

  const schoolPromotions = school.promotions ?? []
  const promoWidth = (p: typeof schoolPromotions[0]) => {
    if (p.alwaysApply) return Infinity
    if (!p.startDate || !p.endDate) return Infinity
    return new Date(p.endDate).getTime() - new Date(p.startDate).getTime()
  }
  const sortedPromos = [...schoolPromotions].sort((a, b) => promoWidth(a) - promoWidth(b))

  // stackable 기본값: true (명시적 false 시에만 단독)
  const isStackable = (p: typeof schoolPromotions[0]) => p.stackable !== false

  for (const promo of sortedPromos) {
    // 이미 non-stackable 프로모션이 적용됐으면 다른 프로모션은 스킵
    const hasNonStackableApplied = appliedPromoLabels.length > 0 &&
      sortedPromos.some(p => appliedPromoLabels.includes(p.label) && !isStackable(p))
    if (hasNonStackableApplied) continue
    // 본 프로모션이 non-stackable인데 이미 다른 프로모션이 적용됐으면 스킵
    if (!isStackable(promo) && appliedPromoLabels.length > 0) continue

    // 기간 체크
    if (!promo.startDate && !promo.alwaysApply) continue
    if (!promo.alwaysApply) {
      if (!promo.endDate) continue
      const checkDate = promo.basisType === 'start_date' ? startDate : enrollmentDate
      if (!isInRange(checkDate, promo.startDate, promo.endDate)) continue
    }

    // condition 주수 체크
    if (promo.condition) {
      const weekMatch = promo.condition.match(/(\d+)주/)
      if (weekMatch) {
        const required = Number(weekMatch[1])
        if (totalWeeks < required) continue
        // 같은 stackable 그룹 내에서 더 나은 조건 있으면 스킵
        const betterExists = sortedPromos.some(other => {
          if (other.label === promo.label) return false
          const m2 = other.condition?.match(/(\d+)주/)
          return m2 && Number(m2[1]) > required && Number(m2[1]) <= totalWeeks &&
            isStackable(other) === isStackable(promo)
        })
        if (betterExists) continue
      }
      notes.push(`ℹ️ 프로모션 조건: ${promo.condition}`)
    }

    // applicableItems 체크
    if (promo.applicableItems && promo.applicableItems.length > 0) {
      const selectedNames = [
        ...courseItems.map(i => i.label),
        ...dormItems.map(i => i.label),
        ...packageItems.map(i => i.pkg.label),
      ].join(' ')
      const hasMatch = promo.applicableItems.some(item => selectedNames.includes(item))
      if (!hasMatch) continue
    }

    // 할인 계산
    const toCourses   = promo.applyToCourses   !== false
    const toDorms     = promo.applyToDorms     !== false
    const toSurcharge = promo.applyToSurcharge !== false

    // excludeCourses: 본 프로모션 적용 제외 코스
    const excludeIds = ('excludeCourses' in promo ? (promo as { excludeCourses?: string[] }).excludeCourses : undefined) ?? []
    const courseTargetKrw = toCourses
      ? courseItems.filter(i => !excludeIds.includes((i as unknown as { courseId?: string }).courseId ?? ''))
                   .reduce((s,i)=>s+i.krwAmount,0)
      : 0
    const targetKrw = courseTargetKrw + (toDorms ? dormItems.reduce((s,i)=>s+i.krwAmount,0) : 0)

    let thisDiscount = 0
    if (promo.discountType === 'percent') {
      const discRate = promo.discountValue / 100
      thisDiscount = Math.round(targetKrw * discRate)
      for (const sd of surchargeDetails) {
        if (toSurcharge && sd.discountAllowed) {
          surchargeDiscount += Math.round(sd.krw * discRate)
        } else if (!sd.discountAllowed) {
          notes.push(`ℹ️ ${sd.label}: 서차지엔 할인 미적용`)
        }
      }
    } else if (promo.discountType === 'amount_per_4weeks') {
      thisDiscount = toKrw(promo.discountValue, promo.currency ?? 'KRW', rate) * Math.floor(totalWeeks / 4)
    } else if (promo.discountType === 'amount_per_week') {
      thisDiscount = toKrw(promo.discountValue, promo.currency ?? 'KRW', rate) * totalWeeks
    } else if (promo.discountType === 'week_tiers') {
      // 주수 구간별 차등 정액 할인 (학원 자체 장기등록 할인 등)
      const tiers = ('weekTiers' in promo ? (promo as { weekTiers?: Array<{ minWeeks: number; maxWeeks?: number; amount: number }> }).weekTiers : undefined) ?? []
      // totalWeeks가 minWeeks 이상이면서 가장 큰 amount의 tier를 선택
      const matched = tiers
        .filter(t => totalWeeks >= t.minWeeks && (t.maxWeeks == null || totalWeeks <= t.maxWeeks))
        .sort((a, b) => b.amount - a.amount)[0]
      if (matched) {
        thisDiscount = toKrw(matched.amount, promo.currency ?? 'KRW', rate)
        notes.push(`ℹ️ ${promo.label}: ${matched.minWeeks}주 이상 적용 = ${matched.amount.toLocaleString()}${promo.currency === 'PHP' ? '페소' : '원'}`)
      } else {
        continue  // 적용 tier 없음
      }
    } else {
      thisDiscount = toKrw(promo.discountValue, promo.currency ?? 'KRW', rate)
    }
    promotionDiscount += thisDiscount
    // 할인액이 0이 아닌 프로모션만 적용된 것으로 기록
    if (thisDiscount > 0) {
      appliedPromoLabels.push(promo.label)
      appliedPromoDetails.push({ label: promo.label, discount: thisDiscount })
    }

    if (!toCourses && toDorms) notes.push(`ℹ️ ${promo.label}: 기숙사비에만 적용`)
    if (toCourses && !toDorms) notes.push(`ℹ️ ${promo.label}: 코스 학비에만 적용`)
    if (excludeIds.length > 0) notes.push(`ℹ️ ${promo.label}: 일부 코스 제외 (${excludeIds.join(', ')})`)

    // agencyDiscount 처리 (v3 status 모델)
    // 여러 프로모션의 agencyDiscount는 각각 독립 슬롯이므로 합산. disabled/null은 추가 안 하고 skip.
    if ('agencyDiscount' in promo) {
      if (promo.agencyDiscount === null) {
        // null = 이 프로모션엔 유학원 할인 슬롯 없음. 다른 프로모션이 채운 값 유지.
      } else if (promo.agencyDiscount) {
        const pad = promo.agencyDiscount
        const status = pad.status ?? 'enabled'   // 기본 enabled (구버전 호환)

        if (status === 'disabled') {
          // 자료에 명시적으로 "X"/"없음" → 이 프로모션의 유학원 할인 슬롯은 비활성. 다른 프로모션 값 유지.
          notes.push(`ℹ️ ${promo.label}: 유학원 자체 할인 불가 (학원 측 명시)`)
        } else if (status === 'unconfirmed') {
          // 자료 빈 칸 → 본사 확인 필요. 이 프로모션의 슬롯만 비활성.
          warnings.push(`⚠️ ${promo.label}: 유학원 할인 정보 미확정 — 본사 확인 필요`)
          if (!agencyDiscountNote) agencyDiscountNote = pad.note || '본사 확인 필요'
        } else {
          // status === 'enabled' → 정상 계산
          // minWeeks 게이트
          if (pad.minWeeks && totalWeeks < pad.minWeeks) {
            notes.push(`ℹ️ ${promo.label}: ${pad.minWeeks}주 미만은 유학원 할인 불가 (요청 ${totalWeeks}주)`)
          } else {
            const applyTo = pad.applyTo ?? 'all'
            let base = 0
            if (applyTo === 'all')             base = baseKrw
            else if (applyTo === 'course_only') base = courseItems.reduce((s,i) => s + i.krwAmount, 0)
            else if (applyTo === 'dorm_only')   base = dormItems.reduce((s,i) => s + i.krwAmount, 0)
            else if (applyTo === 'package_only') base = pkgBaseKrw
            else if (applyTo === 'course_and_dorm') {
              base = courseItems.reduce((s,i) => s + i.krwAmount, 0)
                   + dormItems.reduce((s,i) => s + i.krwAmount, 0)
            }

            // 유학원 할인은 학원 할인 차감 전 base에 적용 (자료의 "학교할인 차감 후" 표현은
            // 운영 관행상 적용 안 함 - 견적서 검증 결과로 확인됨)
            let thisAgencyDiscount = 0
            if (pad.type === 'percent') {
              thisAgencyDiscount = Math.round(base * pad.value / 100)
              if (pad.maxAmount) thisAgencyDiscount = Math.min(thisAgencyDiscount, pad.maxAmount)
            } else if (pad.type === 'amount_per_week') {
              thisAgencyDiscount = pad.value * totalWeeks
              if (pad.maxAmount) thisAgencyDiscount = Math.min(thisAgencyDiscount, pad.maxAmount)
            } else if (pad.type === 'amount_per_4weeks') {
              // 4주 단위로 적용 (3주는 0, 4-7주는 1배, 8-11주는 2배...)
              const blocks = Math.floor(totalWeeks / 4)
              thisAgencyDiscount = pad.value * blocks
              if (pad.maxAmount) thisAgencyDiscount = Math.min(thisAgencyDiscount, pad.maxAmount)
            } else if (pad.type === 'amount_flat') {
              thisAgencyDiscount = pad.value
            } else if (pad.type === 'reg_fee_only') {
              thisAgencyDiscount = 0  // 학비/기숙사 할인 없음 (등록비는 아래에서 별도 처리)
            } else if (pad.type === 'week_tiers') {
              // 주수 구간별 차등 정액
              const tier = (pad.weekTiers ?? []).find(t => {
                if (totalWeeks < t.minWeeks) return false
                if (t.maxWeeks !== undefined && totalWeeks > t.maxWeeks) return false
                return true
              })
              if (tier) {
                thisAgencyDiscount = tier.amount
                if (tier.scope === 'per_person') {
                  notes.push(`ℹ️ ${promo.label}: 인당 ${tier.amount.toLocaleString()}원 (인원수만큼 곱하기는 운영자 입력)`)
                }
              } else {
                notes.push(`ℹ️ ${promo.label}: 주수 구간 매칭 없음 (총 ${totalWeeks}주)`)
              }
            }

            // 등록비 할인: registrationFeeKrw에서 직접 차감
            if (pad.regFeeDiscount && pad.regFeeDiscount > 0) {
              const regDiscount = Math.min(pad.regFeeDiscount, registrationFeeKrw)
              registrationFeeKrw = Math.max(0, registrationFeeKrw - regDiscount)
              thisAgencyDiscount += regDiscount
            }

            // 합산 (여러 프로모션의 agencyDiscount는 누적)
            agencyDiscountKrw += thisAgencyDiscount
            if (thisAgencyDiscount > 0) {
              // 노트는 첫 번째 enabled 프로모션 것을 유지 (또는 가장 큰 것)
              if (!agencyDiscountNote || agencyDiscountNote === '본사 확인 필요') {
                agencyDiscountNote = pad.note ?? ''
              }
            }
          }
        }
      }
    }

    // 단독 적용 프로모션 표시 (legacy 호환)
    if (!isStackable(promo)) promotionLabel = promo.label
  }

  // 여러 프로모션 적용 시 - 사용자에게 명시
  if (appliedPromoLabels.length > 1) {
    promotionLabel = appliedPromoLabels.join(' + ')
    notes.push(`ℹ️ 어학원 프로모션 ${appliedPromoLabels.length}개가 중복 적용되었습니다:`)
    for (const detail of appliedPromoDetails) {
      notes.push(`  • ${detail.label}: -${detail.discount.toLocaleString()}원`)
    }
  } else if (appliedPromoLabels.length === 1) {
    promotionLabel = appliedPromoLabels[0]
  }

  const subtotal = baseKrw + surchargeKrw - promotionDiscount - surchargeDiscount
  const totalKrw = subtotal + registrationFeeKrw - agencyDiscountKrw

  // 현지납부비 (총 주수 기준)
  // 패키지에 현지납부비 포함된 경우 스킵
  const pkgIncludesLocal = packageItems.length > 0 &&
    packageItems.every(p => p.pkg.includesLocalFees === true)

  const localFees = school.localFees ?? []
  let localFeePhp = 0
  let localFeeKrw = 0

  if (pkgIncludesLocal) {
    notes.push('ℹ️ 패키지 가격에 현지납부비 포함')
  } else {
    for (const lf of localFees) {
      const raw = lf as unknown as Record<string, unknown>
      const trigger = lf.trigger ?? (raw.condition === 'one_time' ? 'always'
        : raw.condition === 'min_weeks' ? 'over_weeks'
        : raw.condition as string ?? 'always')
      if (trigger === 'optional') continue

      const isKrw = lf.currency === 'KRW'
      const amt = lf.amount ?? 0
      const add = (v: number) => isKrw ? (localFeeKrw += v) : (localFeePhp += v)

      if (trigger === 'always')          { add(amt) }
      else if (trigger === 'per_week')   { add(amt * totalWeeks) }
      else if (trigger === 'per_4weeks') { add(amt * Math.ceil(totalWeeks / 4)) }
      else if (trigger === 'over_weeks') {
        const threshold = lf.triggerWeeks ?? (raw.minWeeks as number) ?? 4
        if (totalWeeks > threshold) add(amt)
      }
    }
  }

  const localFeeKrwEstimate = toKrw(localFeePhp, 'PHP', rate) + localFeeKrw

  return {
    courseItems, dormItems, packageItems, surchargeItems,
    promotionLabel, promotionDiscount, surchargeDiscount,
    baseKrw, surchargeKrw, subtotal,
    registrationFee: regFee, registrationFeeKrw,
    agencyDiscountKrw, agencyDiscountNote,
    totalKrw,
    totalWeeks, courseTotalWeeks, dormTotalWeeks,
    localFees, localFeePhp,
    localFeeKrwEstimate,
    warnings, notes,
  }
}

function addWeeksHelper(d: string, w: number): string {
  const dt = new Date(d); dt.setDate(dt.getDate() + w * 7); return dt.toISOString().split('T')[0]
}
function getOverlapWeeks(s1:string,e1:string,s2:string,e2:string): number {
  const s = Math.max(new Date(s1).getTime(), new Date(s2).getTime())
  const e = Math.min(new Date(e1).getTime(), new Date(e2).getTime())
  return e <= s ? 0 : Math.ceil((e-s)/604800000)
}
function isInRange(d:string,s:string,e:string): boolean { return d>=s && d<=e }
