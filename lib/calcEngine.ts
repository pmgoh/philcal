import type { School, Course, Dormitory, QuoteItem, ExchangeRate, Currency, LocalFee, RegistrationFee } from '@/types'
import { calcShortTermPrice } from '@/types'
import { toKrw } from './utils'

export interface QuoteInput {
  school: School
  weeks: number
  startDate: string
  enrollmentDate: string
  courseId: string
  dormitoryId: string
}

export interface CalcResult {
  items: QuoteItem[]
  surchargeItems: QuoteItem[]
  promotionLabel?: string
  promotionDiscount: number       // 학비+기숙사에 적용된 할인
  surchargeDiscount: number       // 서차지에 적용된 할인 (discountAllowed=true일 때)
  baseKrw: number                 // 학비+기숙사 합계
  surchargeKrw: number
  subtotal: number                // baseKrw + surchargeKrw - promotionDiscount - surchargeDiscount
  registrationFee?: RegistrationFee
  registrationFeeKrw: number
  totalKrw: number                // subtotal + 등록비 (현지납부비 제외)
  localFees: LocalFee[]
  localFeePhp: number
  localFeeKrwEstimate: number
  courseUsed?: Course
  dormUsed?: Dormitory
  warnings: string[]
  notes: string[]
}

function findCourse(courses: Course[], key: string): Course | undefined {
  if (!key) return undefined
  const lower = key.toLowerCase()
  return (
    courses.find(c => c.id === key) ??
    courses.find(c => c.name.toLowerCase() === lower) ??
    courses.find(c => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()))
  )
}

function findDorm(dorms: Dormitory[], key: string): Dormitory | undefined {
  if (!key) return undefined
  const lower = key.toLowerCase()
  return (
    dorms.find(d => d.id === key) ??
    dorms.find(d => d.name.toLowerCase() === lower) ??
    dorms.find(d => d.name.toLowerCase().includes(lower) || lower.includes(d.name.toLowerCase()))
  )
}

export function calculateQuote(input: QuoteInput, rate: ExchangeRate): CalcResult {
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

  // 비용 인상 적용 여부 체크
  const today = new Date().toISOString().split('T')[0]
  const pi = school.priceIncrease
  const increaseActive = pi && pi.fromDate <= today
  const courseAddKrw = increaseActive ? toKrw(pi!.courseAdd, pi!.currency, rate) : 0
  const dormAddKrw   = increaseActive ? toKrw(pi!.dormAdd,   pi!.currency, rate) : 0

  if (increaseActive && pi!.courseAdd > 0) {
    notes.push(`ℹ️ ${pi!.label ?? '비용 인상'} 적용 중 (${pi!.fromDate}~): 코스 +${pi!.courseAdd.toLocaleString()}${pi!.currency}, 기숙사 +${pi!.dormAdd.toLocaleString()}${pi!.currency}`)
  }

  const course = findCourse(courses, courseId)
  const dorm   = findDorm(dorms, dormitoryId)

  // ── 코스 가격 계산 (price4Weeks 기준, 구 데이터 pricePerWeek 호환) ──────────
  if (course) {
    const rawPrice = (course as unknown as Record<string,number>).price4Weeks
      ?? (course as unknown as Record<string,number>).pricePerWeek
      ?? 0
    const p4w = rawPrice
    const useShort = school.allowShortTerm && weeks <= 3
    const use4wOverride = school.allowShortTerm && weeks === 4 && school.courseShortTermRates?.week4Included

    let price: number
    let label: string

    if (useShort) {
      price = calcShortTermPrice(p4w, weeks as 1|2|3, school.courseShortTermRates)
      label = `코스: ${course.name} (${weeks}주 단기가)`
    } else if (use4wOverride) {
      price = school.courseShortTermRates?.week4 ?? p4w
      label = `코스: ${course.name} (4주 특별가)`
    } else {
      // 일반: 4주 가격 ÷ 4 × 주수
      price = Math.round(p4w / 4 * weeks)
      label = `코스: ${course.name} (${p4w.toLocaleString()}${course.currency}/4주 × ${weeks}주)`
    }
    items.push({ label, weeks, unitPrice: Math.round(price / weeks), currency: course.currency, krwAmount: toKrw(price, course.currency, rate) + courseAddKrw * weeks })
  }

  // ── 기숙사 가격 계산 (price4Weeks 기준, 구 데이터 pricePerWeek 호환) ─────────
  if (dorm) {
    const rawPrice = (dorm as unknown as Record<string,number>).price4Weeks
      ?? (dorm as unknown as Record<string,number>).pricePerWeek
      ?? 0
    const p4w = rawPrice
    const useShort = school.allowShortTerm && weeks <= 3
    const use4wOverride = school.allowShortTerm && weeks === 4 && school.dormShortTermRates?.week4Included

    let price: number
    let label: string

    if (useShort) {
      price = calcShortTermPrice(p4w, weeks as 1|2|3, school.dormShortTermRates)
      label = `기숙사: ${dorm.name} (${weeks}주 단기가)`
    } else if (use4wOverride) {
      price = school.dormShortTermRates?.week4 ?? p4w
      label = `기숙사: ${dorm.name} (4주 특별가)`
    } else {
      price = Math.round(p4w / 4 * weeks)
      label = `기숙사: ${dorm.name} (${p4w.toLocaleString()}${dorm.currency}/4주 × ${weeks}주)`
    }
    items.push({ label, weeks, unitPrice: Math.round(price / weeks), currency: dorm.currency, krwAmount: toKrw(price, dorm.currency, rate) + dormAddKrw * weeks })
  }

  const baseKrw = items.reduce((s, i) => s + i.krwAmount, 0)

  // ── 서차지 ────────────────────────────────────────────────────────────────
  let surchargeKrw = 0
  const endDate = addWeeks(startDate, weeks)
  const surchargeDetails: Array<{ krw: number; discountAllowed: boolean; label: string }> = []

  for (const sc of (school.surcharges ?? [])) {
    if (!sc.startDate || !sc.endDate) continue
    const overlap = getOverlapWeeks(startDate, endDate, sc.startDate, sc.endDate)
    if (overlap > 0) {
      const krw = toKrw(sc.pricePerWeek * overlap, sc.currency, rate)
      surchargeItems.push({
        label: `서차지: ${sc.label} (${overlap}주 × ${sc.pricePerWeek.toLocaleString()}${sc.currency}/주)`,
        weeks: overlap, unitPrice: sc.pricePerWeek,
        currency: sc.currency, krwAmount: krw,
      })
      surchargeKrw += krw
      surchargeDetails.push({ krw, discountAllowed: sc.discountAllowed, label: sc.label })
    }
  }

  // ── 프로모션: 학비+기숙사에 항상 적용, 서차지엔 discountAllowed 따라 적용 ──
  let promotionLabel: string | undefined
  let promotionDiscount = 0
  let surchargeDiscount = 0

  for (const promo of (school.promotions ?? [])) {
    if (!promo.startDate || !promo.endDate) continue
    const checkDate = promo.basisType === 'start_date' ? startDate : enrollmentDate
    if (!isInRange(checkDate, promo.startDate, promo.endDate)) continue
    if (promo.condition) notes.push(`ℹ️ 프로모션 조건: ${promo.condition}`)

    // 학비+기숙사 할인 (항상 적용)
    const discountRate = promo.discountType === 'percent' ? promo.discountValue / 100 : 0
    if (promo.discountType === 'percent') {
      promotionDiscount = Math.round(baseKrw * discountRate)
      // 서차지 중 할인 가능한 것에도 적용
      for (const sd of surchargeDetails) {
        if (sd.discountAllowed) {
          surchargeDiscount += Math.round(sd.krw * discountRate)
        } else {
          notes.push(`ℹ️ ${sd.label}: 서차지 금액에는 유학원 할인이 적용되지 않습니다.`)
        }
      }
    } else {
      promotionDiscount = toKrw(promo.discountValue, promo.currency ?? 'KRW', rate)
    }
    promotionLabel = promo.label
    break
  }

  const subtotal = baseKrw + surchargeKrw - promotionDiscount - surchargeDiscount

  // 등록비
  const regFee = school.registrationFee
  const registrationFeeKrw = regFee ? toKrw(regFee.amount, regFee.currency, rate) : 0

  // 현지납부비 (조건별)
  const localFees = school.localFees ?? []
  let localFeePhp = 0
  for (const lf of localFees) {
    const cond = lf.condition ?? 'one_time'
    if (cond === 'optional') continue
    if (cond === 'one_time') { localFeePhp += lf.amount; continue }
    if (cond === 'per_week') { localFeePhp += lf.amount * weeks; continue }
    if (cond === 'min_weeks' && weeks >= (lf.minWeeks ?? 1)) { localFeePhp += lf.amount; continue }
  }
  const localFeeKrwEstimate = toKrw(localFeePhp, 'PHP', rate)

  return {
    items, surchargeItems,
    promotionLabel, promotionDiscount, surchargeDiscount,
    baseKrw, surchargeKrw,
    subtotal,
    registrationFee: regFee,
    registrationFeeKrw,
    totalKrw: subtotal + registrationFeeKrw,
    localFees, localFeePhp, localFeeKrwEstimate,
    courseUsed: course, dormUsed: dorm,
    warnings, notes,
  }
}

function addWeeks(d: string, w: number): string {
  const dt = new Date(d); dt.setDate(dt.getDate() + Math.round(w) * 7); return dt.toISOString().split('T')[0]
}
function getOverlapWeeks(s1: string, e1: string, s2: string, e2: string): number {
  const s = Math.max(new Date(s1).getTime(), new Date(s2).getTime())
  const e = Math.min(new Date(e1).getTime(), new Date(e2).getTime())
  return e <= s ? 0 : Math.ceil((e - s) / 604800000)
}
function isInRange(d: string, s: string, e: string): boolean { return d >= s && d <= e }
