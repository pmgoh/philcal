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

  // 24주 이상 → 반드시 학원 문의 안내
  if (totalWeeks >= 24) {
    warnings.push(`⚠️ 24주 이상 장기 연수입니다. 정확한 학비 및 조건은 반드시 학원에 직접 문의하세요.`)
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
  const registrationFeeKrw = regFee ? toKrw(regFee.amount, regFee.currency, rate) : 0

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

  // ── 프로모션 (좁은 기간 우선, alwaysApply 최하위) ─────────────────────────
  let promotionLabel: string | undefined
  let promotionDiscount = 0
  let surchargeDiscount = 0

  // 날짜 범위 너비 계산 (좁을수록 우선순위 높음)
  const promoWidth = (p: typeof school.promotions[0]) => {
    if (p.alwaysApply) return Infinity
    if (!p.startDate || !p.endDate) return Infinity
    return new Date(p.endDate).getTime() - new Date(p.startDate).getTime()
  }

  // 좁은 기간 순 정렬
  const sortedPromos = [...(school.promotions ?? [])].sort((a, b) => promoWidth(a) - promoWidth(b))

  for (const promo of sortedPromos) {
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
        const betterExists = sortedPromos.some(other => {
          const m2 = other.condition?.match(/(\d+)주/)
          return m2 && Number(m2[1]) > required && Number(m2[1]) <= totalWeeks
        })
        if (betterExists) continue
      }
      notes.push(`ℹ️ 프로모션 조건: ${promo.condition}`)
    }

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

    // 프로모션에 agencyDiscount가 정의된 경우 → 학원 기본값 override
    // null = 이 프로모션 활성 시 유학원 할인 없음
    // undefined = 학원 기본 agencyDiscount 그대로 사용
    if ('agencyDiscount' in promo) {
      if (promo.agencyDiscount === null) {
        // 유학원 할인 없음 (명시적으로 null)
        agencyDiscountKrw = 0
        agencyDiscountNote = ''
      } else if (promo.agencyDiscount) {
        // 이 프로모션 전용 할인 규칙으로 재계산
        const pad = promo.agencyDiscount
        const applyTo = pad.applyTo ?? 'all'
        let base = 0
        if (applyTo === 'all')          base = baseKrw
        if (applyTo === 'course_only')  base = courseItems.reduce((s,i) => s + i.krwAmount, 0)
        if (applyTo === 'dorm_only')    base = dormItems.reduce((s,i) => s + i.krwAmount, 0)
        if (applyTo === 'package_only') base = pkgBaseKrw

        if (pad.type === 'percent') {
          agencyDiscountKrw = Math.round(base * pad.value / 100)
          if (pad.maxAmount) agencyDiscountKrw = Math.min(agencyDiscountKrw, pad.maxAmount)
        } else if (pad.type === 'amount_per_week') {
          agencyDiscountKrw = pad.value * totalWeeks
          if (pad.maxAmount) agencyDiscountKrw = Math.min(agencyDiscountKrw, pad.maxAmount)
        } else if (pad.type === 'amount_flat') {
          agencyDiscountKrw = pad.value
        } else if (pad.type === 'reg_fee_only') {
          agencyDiscountKrw = 0  // 등록비 할인은 별도 처리
        }
        // 등록비 할인이 있으면 registrationFeeKrw에서 차감
        if (pad.regFeeDiscount) {
          agencyDiscountKrw += pad.regFeeDiscount
        }
        agencyDiscountNote = pad.note ?? ''
      }
    }
    break
  }

  const subtotal = baseKrw + surchargeKrw - promotionDiscount - surchargeDiscount
  const totalKrw = subtotal + registrationFeeKrw - agencyDiscountKrw

  // 현지납부비 (총 주수 기준)
  const localFees = school.localFees ?? []
  let localFeePhp = 0
  let localFeeKrw = 0

  for (const lf of localFees) {
    const raw = lf as unknown as Record<string, unknown>
    const trigger = lf.trigger ?? (raw.condition === 'one_time' ? 'always'
      : raw.condition === 'min_weeks' ? 'over_weeks'
      : raw.condition as string ?? 'always')
    if (trigger === 'optional') continue

    const isKrw = lf.currency === 'KRW'
    const amt = lf.amount ?? 0

    const add = (v: number) => isKrw ? (localFeeKrw += v) : (localFeePhp += v)

    if (trigger === 'always')     { add(amt) }
    else if (trigger === 'per_week')   { add(amt * totalWeeks) }
    else if (trigger === 'per_4weeks') { add(amt * Math.ceil(totalWeeks / 4)) }
    else if (trigger === 'over_weeks') {
      const threshold = lf.triggerWeeks ?? (raw.minWeeks as number) ?? 4
      if (totalWeeks > threshold) add(amt)
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
