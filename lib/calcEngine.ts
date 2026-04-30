import type { School, Course, Dormitory, QuoteItem, ExchangeRate, Currency, LocalFee, RegistrationFee } from '@/types'
import { calcShortTermPrice } from '@/types'
import { toKrw } from './utils'

export interface QuoteInput {
  school: School
  weeks: number         // 반드시 Number (string 혼입 방지용 강제 변환)
  startDate: string
  enrollmentDate: string
  courseId: string      // UUID 또는 코스명 (fallback 매칭)
  dormitoryId: string
}

export interface CalcResult {
  items: QuoteItem[]
  surchargeItems: QuoteItem[]
  promotionLabel?: string
  promotionDiscount: number
  subtotal: number              // 코스+기숙사+서차지-프로모션
  registrationFee?: RegistrationFee
  registrationFeeKrw: number    // 등록비 원화 환산
  totalKrw: number              // subtotal + 등록비 (현지납부비 제외)
  localFees: LocalFee[]
  localFeePhp: number
  localFeeKrwEstimate: number
  courseUsed?: Course
  dormUsed?: Dormitory
  warnings: string[]
  notes: string[]
}

// ID 또는 이름으로 코스 매칭 (대소문자 무시, 부분 일치 포함)
function findCourse(courses: Course[], key: string): Course | undefined {
  if (!key) return courses[0]
  const lower = key.toLowerCase()
  return (
    courses.find(c => c.id === key) ??
    courses.find(c => c.id.toLowerCase() === lower) ??
    courses.find(c => c.name.toLowerCase() === lower) ??
    courses.find(c => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()))
  )
}

function findDorm(dorms: Dormitory[], key: string): Dormitory | undefined {
  if (!key) return dorms[0]
  const lower = key.toLowerCase()
  return (
    dorms.find(d => d.id === key) ??
    dorms.find(d => d.id.toLowerCase() === lower) ??
    dorms.find(d => d.name.toLowerCase() === lower) ??
    dorms.find(d => d.name.toLowerCase().includes(lower) || lower.includes(d.name.toLowerCase()))
  )
}

export function calculateQuote(input: QuoteInput, rate: ExchangeRate): CalcResult {
  // weeks를 반드시 정수로 강제 변환 (AI가 string으로 줄 수 있음)
  const weeks = Math.max(1, Math.round(Number(input.weeks) || 1))
  const { school, startDate, enrollmentDate, courseId, dormitoryId } = input

  const warnings: string[] = []
  const notes: string[] = []
  const items: QuoteItem[] = []
  const surchargeItems: QuoteItem[] = []

  if (weeks < school.minWeeks) {
    warnings.push(`⚠️ ${school.name}의 최소 수강 기간은 ${school.minWeeks}주입니다.`)
  }

  const courses = school.courses ?? []
  const dorms   = school.dormitories ?? []

  const course = findCourse(courses, courseId)
  const dorm   = findDorm(dorms, dormitoryId)

  if (!course && courses.length > 0) warnings.push(`코스 "${courseId}"를 찾을 수 없어 첫 번째 코스로 대체했습니다.`)
  if (!dorm   && dorms.length > 0)   warnings.push(`기숙사 "${dormitoryId}"를 찾을 수 없어 첫 번째 기숙사로 대체했습니다.`)

  const effectiveCourse = course ?? courses[0]
  const effectiveDorm   = dorm   ?? dorms[0]

  // ── 코스 가격 ─────────────────────────────────────────────────────────────
  if (effectiveCourse) {
    const useShort = school.allowShortTerm && weeks <= 3
    const use4wOverride = school.allowShortTerm && weeks === 4 && effectiveCourse.shortTermRates?.week4Included

    if (useShort) {
      const price = calcShortTermPrice(effectiveCourse.pricePerWeek, weeks as 1|2|3, effectiveCourse.shortTermRates)
      items.push({
        label: `코스: ${effectiveCourse.name} (${weeks}주 단기가)`,
        weeks, unitPrice: price,
        currency: effectiveCourse.currency,
        krwAmount: toKrw(price, effectiveCourse.currency, rate),
      })
    } else if (use4wOverride) {
      const price = effectiveCourse.shortTermRates!.week4 ?? effectiveCourse.pricePerWeek * 4
      items.push({
        label: `코스: ${effectiveCourse.name} (4주 특별가)`,
        weeks, unitPrice: price,
        currency: effectiveCourse.currency,
        krwAmount: toKrw(price, effectiveCourse.currency, rate),
      })
    } else {
      // 일반: 주당가 × 주수
      const totalPrice = effectiveCourse.pricePerWeek * weeks
      items.push({
        label: `코스: ${effectiveCourse.name}`,
        weeks,
        unitPrice: effectiveCourse.pricePerWeek,
        currency: effectiveCourse.currency,
        krwAmount: toKrw(totalPrice, effectiveCourse.currency, rate),
      })
    }
  }

  // ── 기숙사 가격 ───────────────────────────────────────────────────────────
  if (effectiveDorm) {
    const useShort = school.allowShortTerm && weeks <= 3
    const use4wOverride = school.allowShortTerm && weeks === 4 && effectiveDorm.shortTermRates?.week4Included

    if (useShort) {
      const price = calcShortTermPrice(effectiveDorm.pricePerWeek, weeks as 1|2|3, effectiveDorm.shortTermRates)
      items.push({
        label: `기숙사: ${effectiveDorm.name} (${weeks}주 단기가)`,
        weeks, unitPrice: price,
        currency: effectiveDorm.currency,
        krwAmount: toKrw(price, effectiveDorm.currency, rate),
      })
    } else if (use4wOverride) {
      const price = effectiveDorm.shortTermRates!.week4 ?? effectiveDorm.pricePerWeek * 4
      items.push({
        label: `기숙사: ${effectiveDorm.name} (4주 특별가)`,
        weeks, unitPrice: price,
        currency: effectiveDorm.currency,
        krwAmount: toKrw(price, effectiveDorm.currency, rate),
      })
    } else {
      const totalPrice = effectiveDorm.pricePerWeek * weeks
      items.push({
        label: `기숙사: ${effectiveDorm.name}`,
        weeks,
        unitPrice: effectiveDorm.pricePerWeek,
        currency: effectiveDorm.currency,
        krwAmount: toKrw(totalPrice, effectiveDorm.currency, rate),
      })
    }
  }

  const baseKrw = items.reduce((s, i) => s + i.krwAmount, 0)

  // ── 서차지 ────────────────────────────────────────────────────────────────
  let surchargeKrw = 0
  let surchargeDiscountAllowed = true
  const endDate = addWeeks(startDate, weeks)

  for (const sc of (school.surcharges ?? [])) {
    if (!sc.startDate || !sc.endDate) continue
    const overlap = getOverlapWeeks(startDate, endDate, sc.startDate, sc.endDate)
    if (overlap > 0) {
      const krw = toKrw(sc.pricePerWeek * overlap, sc.currency, rate)
      surchargeItems.push({
        label: `서차지: ${sc.label} (${overlap}주)`,
        weeks: overlap, unitPrice: sc.pricePerWeek,
        currency: sc.currency, krwAmount: krw,
      })
      surchargeKrw += krw
      if (!sc.discountAllowed) {
        surchargeDiscountAllowed = false
        notes.push(`ℹ️ ${sc.label}: 서차지 기간에는 유학원 할인이 적용되지 않습니다.`)
      }
    }
  }

  const subtotalBeforePromo = baseKrw + surchargeKrw

  // ── 프로모션 ──────────────────────────────────────────────────────────────
  let promotionLabel: string | undefined
  let promotionDiscount = 0

  for (const promo of (school.promotions ?? [])) {
    if (!promo.startDate || !promo.endDate) continue
    const checkDate = promo.basisType === 'start_date' ? startDate : enrollmentDate
    if (!isInRange(checkDate, promo.startDate, promo.endDate)) continue
    if (promo.condition) notes.push(`ℹ️ 프로모션 조건: ${promo.condition}`)
    if (surchargeItems.length > 0 && !promo.surchargeCompatible) {
      notes.push(`ℹ️ ${promo.label}: 성수기 서차지 기간에는 적용 불가합니다.`)
      continue
    }
    const base = surchargeDiscountAllowed ? subtotalBeforePromo : baseKrw
    promotionDiscount = promo.discountType === 'percent'
      ? Math.round(base * promo.discountValue / 100)
      : toKrw(promo.discountValue, promo.currency ?? 'KRW', rate)
    promotionLabel = promo.label
    break
  }

  const subtotal = subtotalBeforePromo - promotionDiscount

  // 등록비 (현지납부비와 별도)
  const regFee = school.registrationFee
  const registrationFeeKrw = regFee ? toKrw(regFee.amount, regFee.currency, rate) : 0

  // 현지납부비: 조건별 계산, totalKrw에서 제외, 별도 반환
  const localFees = school.localFees ?? []
  let localFeePhp = 0
  const localFeePhpOptional: number[] = []

  for (const lf of localFees) {
    const cond = lf.condition ?? 'one_time'
    if (cond === 'optional') {
      localFeePhpOptional.push(lf.amount)
      continue
    }
    if (cond === 'one_time') { localFeePhp += lf.amount; continue }
    if (cond === 'per_week') { localFeePhp += lf.amount * weeks; continue }
    if (cond === 'min_weeks' && weeks >= (lf.minWeeks ?? 1)) { localFeePhp += lf.amount; continue }
  }

  const localFeeKrwEstimate = toKrw(localFeePhp, 'PHP', rate)

  return {
    items, surchargeItems,
    promotionLabel, promotionDiscount,
    subtotal,
    registrationFee: regFee,
    registrationFeeKrw,
    totalKrw: subtotal + registrationFeeKrw,  // 등록비 포함, 현지납부비 제외
    localFees, localFeePhp, localFeeKrwEstimate,
    courseUsed: effectiveCourse,
    dormUsed: effectiveDorm,
    warnings, notes,
  }
}

function addWeeks(d: string, w: number): string {
  const dt = new Date(d)
  dt.setDate(dt.getDate() + Math.round(w) * 7)
  return dt.toISOString().split('T')[0]
}

function getOverlapWeeks(s1: string, e1: string, s2: string, e2: string): number {
  const s = Math.max(new Date(s1).getTime(), new Date(s2).getTime())
  const e = Math.min(new Date(e1).getTime(), new Date(e2).getTime())
  return e <= s ? 0 : Math.ceil((e - s) / 604800000)
}

function isInRange(d: string, s: string, e: string): boolean {
  return d >= s && d <= e
}
