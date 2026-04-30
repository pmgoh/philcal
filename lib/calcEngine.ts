import type { School, Course, Dormitory, QuoteItem, ExchangeRate, LocalFee, RegistrationFee } from '@/types'
import { calcShortTermPrice } from '@/types'
import { toKrw } from './utils'

export interface CourseItem { courseId: string; weeks: number }
export interface DormItem   { dormitoryId: string; weeks: number }

export interface QuoteInput {
  school: School
  startDate: string
  enrollmentDate: string
  courses: CourseItem[]       // 코스 목록 (독립)
  dormitories: DormItem[]     // 기숙사 목록 (독립)
}

export interface CalcResult {
  courseItems: QuoteItem[]    // 코스별 계산 결과
  dormItems:   QuoteItem[]    // 기숙사별 계산 결과
  surchargeItems: QuoteItem[]
  promotionLabel?: string
  promotionDiscount: number
  surchargeDiscount: number
  baseKrw: number
  surchargeKrw: number
  subtotal: number
  registrationFee?: RegistrationFee
  registrationFeeKrw: number
  totalKrw: number
  totalWeeks: number          // max(코스주수합, 기숙사주수합)
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
  const surchargeItems: QuoteItem[] = []

  const courses = school.courses ?? []
  const dorms   = school.dormitories ?? []

  // 총 주수 계산
  const courseTotalWeeks = input.courses.reduce((s, c) => s + Math.max(1, Math.round(Number(c.weeks)||1)), 0)
  const dormTotalWeeks   = input.dormitories.reduce((s, d) => s + Math.max(1, Math.round(Number(d.weeks)||1)), 0)
  const totalWeeks = Math.max(courseTotalWeeks, dormTotalWeeks)

  // 최소 주수 체크 (총 주수 기준)
  const effectiveMin = school.allowShortTerm ? 1 : school.minWeeks
  if (totalWeeks < effectiveMin) {
    warnings.push(`⚠️ ${school.name}의 최소 수강 기간은 ${school.minWeeks}주입니다. (요청 총 ${totalWeeks}주)`)
  }

  // 단기가 적용 여부 — 총 주수가 4 미만일 때만
  const isShortTerm = school.allowShortTerm && totalWeeks < 4

  // 비용 인상 체크
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

  const baseKrw = [...courseItems, ...dormItems].reduce((s,i) => s + i.krwAmount, 0)

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

  // ── 프로모션 ──────────────────────────────────────────────────────────────
  let promotionLabel: string | undefined
  let promotionDiscount = 0
  let surchargeDiscount = 0

  for (const promo of (school.promotions ?? [])) {
    if (!promo.startDate || !promo.endDate) continue
    const checkDate = promo.basisType === 'start_date' ? startDate : enrollmentDate
    if (!isInRange(checkDate, promo.startDate, promo.endDate)) continue
    if (promo.condition) notes.push(`ℹ️ 프로모션 조건: ${promo.condition}`)

    // 적용 대상 (기본값: 전체 적용)
    const toCourses   = promo.applyToCourses   !== false
    const toDorms     = promo.applyToDorms     !== false
    const toSurcharge = promo.applyToSurcharge !== false

    const targetKrw = (toCourses ? courseItems.reduce((s,i)=>s+i.krwAmount,0) : 0)
                    + (toDorms   ? dormItems.reduce((s,i)=>s+i.krwAmount,0)   : 0)

    if (promo.discountType === 'percent') {
      const discRate = promo.discountValue / 100
      promotionDiscount = Math.round(targetKrw * discRate)
      for (const sd of surchargeDetails) {
        if (toSurcharge && sd.discountAllowed) {
          surchargeDiscount += Math.round(sd.krw * discRate)
        } else if (!sd.discountAllowed) {
          notes.push(`ℹ️ ${sd.label}: 서차지엔 유학원 할인 미적용`)
        }
      }
    } else {
      promotionDiscount = toKrw(promo.discountValue, promo.currency ?? 'KRW', rate)
    }
    promotionLabel = promo.label
    if (!toCourses && toDorms) notes.push(`ℹ️ ${promo.label}: 기숙사비에만 적용`)
    if (toCourses && !toDorms) notes.push(`ℹ️ ${promo.label}: 코스 학비에만 적용`)
    break
  }

  const subtotal = baseKrw + surchargeKrw - promotionDiscount - surchargeDiscount

  // 등록비 (1회)
  const regFee = school.registrationFee
  const registrationFeeKrw = regFee ? toKrw(regFee.amount, regFee.currency, rate) : 0

  // 현지납부비 (총 주수 기준)
  const localFees = school.localFees ?? []
  let localFeePhp = 0
  for (const lf of localFees) {
    const cond = lf.condition ?? 'one_time'
    if (cond === 'optional') continue
    if (cond === 'one_time')  { localFeePhp += lf.amount; continue }
    if (cond === 'per_week')  { localFeePhp += lf.amount * totalWeeks; continue }
    if (cond === 'min_weeks') {
      // minWeeks가 명시된 경우에만, 그리고 totalWeeks가 그 이상일 때만 포함
      if (lf.minWeeks && totalWeeks >= lf.minWeeks) { localFeePhp += lf.amount; continue }
    }
  }

  return {
    courseItems, dormItems, surchargeItems,
    promotionLabel, promotionDiscount, surchargeDiscount,
    baseKrw, surchargeKrw, subtotal,
    registrationFee: regFee, registrationFeeKrw,
    totalKrw: subtotal + registrationFeeKrw,
    totalWeeks, courseTotalWeeks, dormTotalWeeks,
    localFees, localFeePhp,
    localFeeKrwEstimate: toKrw(localFeePhp, 'PHP', rate),
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
