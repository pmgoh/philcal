import type { School, Course, Dormitory, QuoteItem, ExchangeRate, LocalFee, RegistrationFee, Package, ShortTermRates, Promotion } from '@/types'
import { toKrw } from './utils'
import { normalizeSchool } from './normalizeSchool'

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

// 프로모션 1건의 적용 상태 + 근거 (화면 표시용)
// - status: 'applied' 자동 적용됨 / 'unmet' 조건 미충족(미적용, 회색 표시) / 'manual' 수동 적용
//           / 'pending' 시작일 미정이라 시기 판정 보류 (날짜 정하면 확정 가능 — 화면에서 데이트피커 제공)
// - 자동 적용은 그대로 두되, 어떤 프로모션이 어떤 근거로 얼마 할인됐는지 노출하여
//   상담사가 보고 수동으로 켜고 끌 수 있게 한다 (수동 수정은 화면단에서 처리).
export interface PromotionLineItem {
  id: string
  label: string
  status: 'applied' | 'unmet' | 'manual' | 'pending'
  kind: 'school' | 'agency'    // 학원 자체 할인 / 유학원(필자닷컴) 할인
  discountKrw: number          // 이 프로모션의 할인액 (원화, 양수). pending이면 0
  basis: string                // 적용/미적용 근거 (예: "비수기 4주 이상, 4주당 25만원")
  unmetReason?: string         // status='unmet'일 때 사유 (예: "최소 4주 미달")
  periodNote?: string          // status='pending'일 때 적용 기간 안내 (예: "비수기 3-6월")
  stackable: boolean
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
  // 프로모션 상태별 근거 목록 (화면이 단계별로 표시) — 자동 적용 + 근거 노출
  promotionLines: PromotionLineItem[]
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
  const { school: rawSchool, startDate, enrollmentDate } = input
  const school = normalizeSchool(rawSchool)
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
    if (pkgStart && pkgEnd && startDate && startDate.trim() !== '') {
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

  // [단기 비율] 총 주수가 4주 미만이면 "정비례 대비 목표 비율"을 분자/분모로 들고 곱셈 먼저 적용.
  // 대전제: 총 주수 하나로 결정, 코스 조합 무관. 학원은 %로 주므로 데이터는 %.
  // 핵심: 배율(80/75)을 미리 나눠 무한소수로 만들지 말 것. price = round(주당 × 주수 × pct / propPct)로
  //       곱셈을 먼저 하고 나눗셈(반올림)을 마지막에 한 번만 → %로 계산할 때처럼 오차 0.
  // rates 미확인이면 pct=propPct(배율 1, 정비례 그대로).
  function shortTermPct(rates?: ShortTermRates): { pct: number; propPct: number } {
    const propPct = totalWeeks * 100 / 4   // 정비례 시 % (3주 → 75)
    if (!isShortTerm || !rates) return { pct: propPct, propPct }
    const raw = rates[`week${totalWeeks}` as 'week1'|'week2'|'week3']
    if (rates.mode === 'percent' && raw != null) return { pct: raw, propPct }
    return { pct: propPct, propPct }   // fixed 등은 정비례 fallback
  }
  const courseSt = shortTermPct(school.courseShortTermRates)
  const dormSt   = shortTermPct(school.dormShortTermRates)

  // ── 코스 계산 ─────────────────────────────────────────────────────────────
  for (const ci of input.courses) {
    const w = Math.max(1, Math.round(Number(ci.weeks)||1))
    const course = findCourse(courses, ci.courseId)
    if (!course) { warnings.push(`코스 "${ci.courseId}"를 찾을 수 없습니다.`); continue }

    const p4w = getPrice4w(course)
    const addKrw = increaseActive ? toKrw(pi!.courses.find(c=>c.id===course.id)?.add??0, pi!.currency, rate) : 0

    let price: number, label: string
    if (isShortTerm) {
      // [단기] 주당단가 × 주수 × 목표% ÷ 정비례%. 곱셈을 먼저 하고 나눗셈을 마지막에 한 번(round).
      // %로 계산할 때와 동일하게 오차 없음. 코스 여러 개여도 같은 비율이 적용됨.
      const weekly = p4w / 4
      price = Math.round(weekly * w * courseSt.pct / courseSt.propPct)
      label = `코스: ${course.name} × ${w}주 (총 ${totalWeeks}주 단기가)`
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
    if (isShortTerm) {
      // [단기] 코스와 동일: 주당단가 × 주수 × 목표% ÷ 정비례% (곱셈 먼저, 반올림 마지막).
      const weekly = p4w / 4
      price = Math.round(weekly * w * dormSt.pct / dormSt.propPct)
      label = `기숙사: ${dorm.name} × ${w}주 (총 ${totalWeeks}주 단기가)`
    } else {
      price = Math.round(p4w / 4 * w)
      label = `기숙사: ${dorm.name} × ${w}주`
    }
    dormItems.push({ label, weeks: w, unitPrice: Math.round(price/w), currency: dorm.currency, krwAmount: toKrw(price, dorm.currency, rate) + addKrw * w })
  }

  // [캠퍼스 검증] 한 학원에 여러 캠퍼스(예: BECI = EOP/스파르타/시티)가 있을 때,
  // 코스와 기숙사가 서로 다른 캠퍼스면 실제로 불가능한 조합 → 견적이 틀린다. 경고로 막는다.
  {
    const pickedCampuses = new Set<string>()
    for (const ci of input.courses ?? []) {
      const c = (school.courses ?? []).find(x => x.id === ci.courseId) as { campus?: string } | undefined
      if (c?.campus) pickedCampuses.add(c.campus)
    }
    for (const di of input.dormitories ?? []) {
      const d = (school.dormitories ?? []).find(x => x.id === di.dormitoryId) as { campus?: string } | undefined
      if (d?.campus) pickedCampuses.add(d.campus)
    }
    if (pickedCampuses.size > 1) {
      warnings.push(
        `⚠️ [캠퍼스 불일치] 선택한 코스·기숙사가 서로 다른 캠퍼스입니다 (${[...pickedCampuses].join(', ')}). ` +
        `같은 캠퍼스끼리만 등록 가능하니 확인하세요.`
      )
    }
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
  // [날짜 미정 모드] startDate가 비어있으면 시기 의존 항목(서차지·기간한정 프로모션)을 보류 처리.
  // 학비·기숙사·등록비·현지납부비는 날짜와 무관하게 정상 계산 → "덜 확정적인 견적" 제공.
  const dateUnset = !startDate || startDate.trim() === ''
  let surchargeKrw = 0
  const endDate = dateUnset ? '' : addWeeksHelper(startDate, totalWeeks)
  const surchargeDetails: Array<{krw:number; discountAllowed:boolean; label:string}> = []
  const pendingSeasonalLines: PromotionLineItem[] = []   // 날짜 미정 보류 항목

  for (const sc of (school.surcharges ?? [])) {
    if (!sc.startDate || !sc.endDate) continue
    if (dateUnset) {
      // 날짜 미정 → 서차지 존재만 보류로 알림 (날짜 정하면 확정)
      pendingSeasonalLines.push({
        id: `surcharge__${sc.label}`, label: `성수기 추가비: ${sc.label}`,
        status: 'pending', kind: 'school', discountKrw: 0,
        basis: `주당 ${sc.pricePerWeek.toLocaleString()}${sc.currency}`,
        periodNote: `${sc.startDate} ~ ${sc.endDate} 기간 입국 시 부과`,
        stackable: true,
      })
      continue
    }
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
  const promotionLines: PromotionLineItem[] = []   // 상태별 근거 기록 (화면 표시용)
  // [단계 분리] 유학원 할인은 학원 할인이 전부 합산된 뒤 계산해야 차감 후 base가 정확하다.
  // 1차 루프에서는 학원 할인만 계산하고, 유학원 할인은 이 배열에 모아 2차에서 처리.
  const agencyPending: Array<{ label: string; id: string; pad: NonNullable<Promotion['agencyDiscount']> }> = []

  const schoolPromotions = school.promotions ?? []
  const promoWidth = (p: typeof schoolPromotions[0]) => {
    if (p.alwaysApply) return Infinity
    if (!p.startDate || !p.endDate) return Infinity
    return new Date(p.endDate).getTime() - new Date(p.startDate).getTime()
  }
  const sortedPromos = [...schoolPromotions].sort((a, b) => promoWidth(a) - promoWidth(b))

  // [호환 관계] stackable boolean 대신 ID 기반 관계(stackWith/exclusiveWith)로 조합 검사.
  // 대부분 프로모션은 시기·대상으로 안 겹쳐 관계 미설정. 동시 적용될 수 있는 것만 명시.
  const promoId = (p: typeof schoolPromotions[0]) => (p as { id?: string }).id ?? p.label
  const isStackable = (p: typeof schoolPromotions[0]) => p.stackable !== false   // legacy 호환
  const appliedPromoIds: string[] = []   // 적용 확정된 프로모션 ID 추적

  // 현재 프로모션을 이미 적용된 것들과 함께 적용 가능한지 판정.
  // 반환: { ok: 적용가능 여부, reason: 불가 사유, needConfirm: 관계 미확인 경고 }
  function checkCompat(p: typeof schoolPromotions[0]): { ok: boolean; reason?: string; needConfirm?: boolean } {
    if (appliedPromoIds.length === 0) return { ok: true }
    const pid = promoId(p)
    const stackWith = (p as { stackWith?: string[] }).stackWith ?? []
    const exclWith  = (p as { exclusiveWith?: string[] }).exclusiveWith ?? []
    const relConfirmed = (p as { relationConfirmed?: boolean }).relationConfirmed
    for (const aid of appliedPromoIds) {
      const applied = sortedPromos.find(x => promoId(x) === aid)
      if (!applied) continue
      const aStackWith = (applied as { stackWith?: string[] }).stackWith ?? []
      const aExclWith  = (applied as { exclusiveWith?: string[] }).exclusiveWith ?? []
      // 배타 관계 (양방향): 둘 중 하나라도 상대를 exclusiveWith에 두면 택일 → 스킵
      if (exclWith.includes(aid) || aExclWith.includes(pid)) {
        return { ok: false, reason: `${applied.label}와(과) 택일 (둘 중 하나만 적용 가능)` }
      }
      // 호환 관계 (양방향): 명시돼 있으면 OK
      if (stackWith.includes(aid) || aStackWith.includes(pid)) continue
      // 관계 미설정 → legacy stackable 폴백, 그래도 불명확하면 미확인 경고
      if (!isStackable(p) || !isStackable(applied)) {
        return { ok: false, reason: `${applied.label}와(과) 중복 불가 (단독 적용)` }
      }
      if (relConfirmed === false) return { ok: true, needConfirm: true }
    }
    return { ok: true }
  }

  // [캠퍼스 필터용] 이번 견적에서 선택된 코스/기숙사의 campus 집합을 미리 구한다.
  // 학원 안에 여러 캠퍼스(BECI=EOP/스파르타/시티 등)가 있을 때, 프로모션이 특정 캠퍼스
  // 전용이면 그 캠퍼스를 고른 경우에만 적용해야 한다.
  const selectedCampuses = new Set<string>()
  for (const ci of input.courses ?? []) {
    const c = (school.courses ?? []).find(x => x.id === ci.courseId) as { campus?: string } | undefined
    if (c?.campus) selectedCampuses.add(c.campus)
  }
  for (const di of input.dormitories ?? []) {
    const d = (school.dormitories ?? []).find(x => x.id === di.dormitoryId) as { campus?: string } | undefined
    if (d?.campus) selectedCampuses.add(d.campus)
  }

  for (const promo of sortedPromos) {
    // [target 필터] 일반 연수 견적(코스/기숙사로 들어온 경우)에는 캠프·주니어·가족 전용
    // 프로모션이 붙으면 안 된다(예: CPI "주니어캠프 형제자매"가 성인 코스에 오매칭).
    // 견적에 packages가 없고 courses가 있으면 일반 연수로 보고 캠프성 프로모션 제외.
    const isGeneralCourse = (input.courses?.length ?? 0) > 0 && (input.packages?.length ?? 0) === 0
    const promoTarget = (promo as { target?: string }).target
    if (isGeneralCourse && promoTarget && ['camp','junior','family'].includes(promoTarget)) {
      notes.push(`ℹ️ ${promo.label}: ${promoTarget} 전용 — 일반 연수 견적이라 미적용`)
      continue
    }

    // [캠퍼스 매칭] 프로모션이 campus를 명시했는데, 이번에 선택한 코스/기숙사 캠퍼스와
    // 겹치지 않으면 이 프로모션은 해당 캠퍼스 전용이므로 적용하지 않는다.
    const promoCampus = (promo as { campus?: string }).campus
    if (promoCampus && selectedCampuses.size > 0 && !selectedCampuses.has(promoCampus)) {
      notes.push(`ℹ️ ${promo.label}: ${promoCampus} 캠퍼스 전용 — 선택한 캠퍼스(${[...selectedCampuses].join(', ')})와 달라 미적용`)
      continue
    }
    // 프로모션은 campus를 명시했는데 코스/기숙사엔 campus 정보가 없으면, 캠퍼스 판단 불가 → 경고만
    if (promoCampus && selectedCampuses.size === 0) {
      warnings.push(`⚠️ ${promo.label}: ${promoCampus} 캠퍼스 전용이나 선택 항목에 캠퍼스 정보가 없어 적용 여부 확인 필요`)
    }

    // 이미 적용된 프로모션들과의 호환 관계 검사
    const compat = checkCompat(promo)
    if (!compat.ok) {
      notes.push(`ℹ️ ${promo.label}: ${compat.reason} → 미적용`)
      continue
    }
    if (compat.needConfirm) {
      warnings.push(`⚠️ ${promo.label}: 다른 프로모션과 중복 적용 가능 여부 미확인 — 본사 확인 필요`)
    }

    // 기간 체크
    if (!promo.startDate && !promo.alwaysApply) continue
    if (!promo.alwaysApply) {
      if (!promo.endDate) continue
      // [날짜 미정 모드] 기간 한정 프로모션은 시작일이 있어야 판정 가능 → 보류(pending)로 기록
      if (dateUnset) {
        pendingSeasonalLines.push({
          id: ((promo as { id?: string }).id ?? promo.label) + '__pending',
          label: promo.label, status: 'pending', kind: 'school', discountKrw: 0,
          basis: promo.condition ?? '기간 한정 프로모션',
          periodNote: `${promo.startDate} ~ ${promo.endDate} 입국 시 적용 가능`,
          stackable: isStackable(promo),
        })
        continue
      }
      const checkDate = promo.basisType === 'start_date' ? startDate : enrollmentDate
      if (!isInRange(checkDate, promo.startDate, promo.endDate)) continue
    }

    // [체류기간 포함 조건] 일부 프로모션은 "체류기간에 특정 날짜 구간(예: 연말 12/21~1/1)이
    // N주 이상 포함된 학생"만 대상. 등록일/입국일 범위가 아니라 체류기간 자체를 검사해야 한다.
    // 데이터의 requireStayIncludes = { start, end, minWeeks } 가 있으면 검사.
    const stayReq = (promo as { requireStayIncludes?: { start?: string; end?: string; minWeeks?: number } }).requireStayIncludes
    if (stayReq && stayReq.start && stayReq.end) {
      // 날짜 미정이면 판정 불가 → 적용 보류(미적용)
      if (dateUnset) continue
      const stayStart = startDate
      const stayEnd = endDate   // 위에서 addWeeksHelper(startDate, totalWeeks)로 계산됨
      // 체류기간[stayStart, stayEnd]과 요구구간[reqStart, reqEnd]의 겹치는 주수
      const overlapWeeks = getOverlapWeeks(stayStart, stayEnd, stayReq.start, stayReq.end)
      const need = stayReq.minWeeks ?? 1
      if (overlapWeeks < need) continue   // 조건 미충족 → 이 프로모션 적용 안 함
    }

    // [허용조건] minWeeks 명시 필드 우선. 없으면 condition 문자열 정규식(구버전 폴백).
    const promoMinWeeks = (promo as { minWeeks?: number }).minWeeks
      ?? (promo.condition?.match(/(\d+)주/) ? Number(promo.condition.match(/(\d+)주/)![1]) : undefined)
    if (promoMinWeeks != null && totalWeeks < promoMinWeeks) {
      // 조건 미충족 — 버리지 않고 unmet으로 기록 (화면에 회색 표시, 상담사가 수동 적용 가능)
      promotionLines.push({
        id: (promo as { id?: string }).id ?? promo.label,
        label: promo.label, status: 'unmet', kind: 'school', discountKrw: 0,
        basis: promo.condition ?? `${promoMinWeeks}주 이상 조건`,
        unmetReason: `최소 ${promoMinWeeks}주 미달 (요청 ${totalWeeks}주)`,
        stackable: isStackable(promo),
      })
      continue
    }
    if (promo.condition) notes.push(`ℹ️ 프로모션 조건: ${promo.condition}`)

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
      // [계산방식] floor(기본): 4주 블록 내림 / proportional: 비례
      const method = (promo as { blockMethod?: 'floor'|'proportional' }).blockMethod ?? 'floor'
      const blocks = method === 'proportional' ? (totalWeeks / 4) : Math.floor(totalWeeks / 4)
      thisDiscount = Math.round(toKrw(promo.discountValue, promo.currency ?? 'KRW', rate) * blocks)
      // 계산방식 미확인이면 경고 (자료에 명시 없어 floor 기본 적용된 경우)
      if ((promo as { methodConfirmed?: boolean }).methodConfirmed === false) {
        warnings.push(`⚠️ ${promo.label}: 할인 계산방식 미확인 — 4주 단위 내림(적게 할인)으로 처리됨. 정확한 방식은 본사 확인 필요.`)
      }
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
        // [수정] 적용 tier 없음(예: 8주인데 학원 장기할인은 12주~) → 학원 할인은 0이지만
        // 프로모션을 통째로 스킵하면 안 된다. 이 프로모션에 딸린 상시 유학원 할인(agency,
        // 예: 수업료+기숙사비 10%)은 주수 무관하게 적용돼야 하므로, continue 대신 학원 할인만 0.
        thisDiscount = 0
      }
    } else {
      thisDiscount = toKrw(promo.discountValue, promo.currency ?? 'KRW', rate)
    }
    promotionDiscount += thisDiscount
    // 할인액이 0이 아닌 프로모션만 적용된 것으로 기록
    if (thisDiscount > 0) {
      appliedPromoLabels.push(promo.label)
      appliedPromoIds.push(promoId(promo))
      appliedPromoDetails.push({ label: promo.label, discount: thisDiscount })
      // 근거 문자열 구성
      const basisParts: string[] = []
      if (promo.discountType === 'percent') basisParts.push(`${promo.discountValue}% 할인`)
      else if (promo.discountType === 'amount_per_week') basisParts.push(`주당 ${promo.discountValue.toLocaleString()} × ${totalWeeks}주`)
      else if (promo.discountType === 'amount_per_4weeks') basisParts.push(`4주당 ${promo.discountValue.toLocaleString()}`)
      else basisParts.push(promo.condition ?? '할인')
      promotionLines.push({
        id: (promo as { id?: string }).id ?? promo.label,
        label: promo.label, status: 'applied', kind: 'school', discountKrw: thisDiscount,
        basis: basisParts.join(', '),
        stackable: isStackable(promo),
      })
      // 단독 적용 프로모션 표시 (legacy 호환)
      if (!isStackable(promo)) promotionLabel = promo.label
    }

    if (!toCourses && toDorms) notes.push(`ℹ️ ${promo.label}: 기숙사비에만 적용`)
    if (toCourses && !toDorms) notes.push(`ℹ️ ${promo.label}: 코스 학비에만 적용`)
    if (excludeIds.length > 0) notes.push(`ℹ️ ${promo.label}: 일부 코스 제외 (${excludeIds.join(', ')})`)

    // agencyDiscount 처리 (v3 status 모델) — [단계분리] 여기선 status 판정 + 수집만.
    // 실제 금액 계산은 학원 할인 전체 합산 후 2차에서 (차감 후 base 정확성 위해).
    if ('agencyDiscount' in promo) {
      if (promo.agencyDiscount === null) {
        // null = 이 프로모션엔 유학원 할인 슬롯 없음.
      } else if (promo.agencyDiscount) {
        const pad = promo.agencyDiscount
        const status = pad.status ?? 'enabled'
        if (status === 'disabled') {
          notes.push(`ℹ️ ${promo.label}: 유학원 자체 할인 불가 (학원 측 명시)`)
        } else if (status === 'unconfirmed') {
          warnings.push(`⚠️ ${promo.label}: 유학원 할인 정보 미확정 — 본사 확인 필요`)
          if (!agencyDiscountNote) agencyDiscountNote = pad.note || '본사 확인 필요'
        } else {
          // enabled → 2차 처리용으로 수집
          agencyPending.push({ label: promo.label, id: (promo as { id?: string }).id ?? promo.label, pad })
        }
      }
    }
  }

  // ── 2차: 유학원 할인 계산 (학원 할인 전부 합산된 뒤) ──────────────────────────
  // base 기준: 'after_discount'(기본) = 학원 할인 차감 후 / 'before_discount' = 차감 전 원금.
  // 자료 표현대로 학원별 지정. 차감 후가 정확하려면 promotionDiscount가 확정된 이 시점이어야 함.
  let regFeeAgencyApplied = false  // 등록비성 유학원할인이 이미 한 번 적용됐는지 (중복 방지)
  for (const { label, id, pad } of agencyPending) {
    if (pad.minWeeks && totalWeeks < pad.minWeeks) {
      notes.push(`ℹ️ ${label}: ${pad.minWeeks}주 미만은 유학원 할인 불가 (요청 ${totalWeeks}주)`)
      continue
    }
    const applyTo = pad.applyTo ?? 'all'
    const courseSum = courseItems.reduce((s,i) => s + i.krwAmount, 0)
    const dormSum   = dormItems.reduce((s,i) => s + i.krwAmount, 0)
    let base = 0
    if (applyTo === 'all')                   base = baseKrw
    else if (applyTo === 'course_only')      base = courseSum
    else if (applyTo === 'dorm_only')        base = dormSum
    else if (applyTo === 'package_only')     base = pkgBaseKrw
    else if (applyTo === 'course_and_dorm')  base = courseSum + dormSum

    // [차감 전/후] 기본 after_discount: 학원 할인(promotionDiscount)을 비례 차감한 금액에 적용.
    const baseMode = (pad as { base?: 'after_discount'|'before_discount' }).base ?? 'after_discount'
    if (baseMode === 'after_discount' && promotionDiscount > 0 && baseKrw > 0) {
      // base가 전체(baseKrw)면 학원할인 전액 차감, 부분이면 그 비중만큼 차감
      const ratio = base / baseKrw
      base = Math.max(0, base - Math.round(promotionDiscount * ratio))
    }

    let thisAgencyDiscount = 0
    if (pad.type === 'percent') {
      thisAgencyDiscount = Math.round(base * pad.value / 100)
      if (pad.maxAmount) thisAgencyDiscount = Math.min(thisAgencyDiscount, pad.maxAmount)
    } else if (pad.type === 'amount_per_week') {
      thisAgencyDiscount = pad.value * totalWeeks
      if (pad.maxAmount) thisAgencyDiscount = Math.min(thisAgencyDiscount, pad.maxAmount)
    } else if (pad.type === 'amount_per_4weeks') {
      const method = (pad as { blockMethod?: 'floor'|'proportional' }).blockMethod ?? 'floor'
      const blocks = method === 'proportional' ? (totalWeeks / 4) : Math.floor(totalWeeks / 4)
      thisAgencyDiscount = Math.round(pad.value * blocks)
      if (pad.maxAmount) thisAgencyDiscount = Math.min(thisAgencyDiscount, pad.maxAmount)
      if ((pad as { methodConfirmed?: boolean }).methodConfirmed === false) {
        warnings.push(`⚠️ ${label}(유학원할인): 계산방식 미확인 — 4주 단위 내림(적게 할인)으로 처리됨. 본사 확인 필요.`)
      }
    } else if (pad.type === 'amount_flat' || pad.type === 'amount') {
      // 정액 유학원 할인 (예: PILAedu 등록비 13만 할인, BCEBU 등록금 10만 할인)
      thisAgencyDiscount = pad.value
      if (pad.maxAmount) thisAgencyDiscount = Math.min(thisAgencyDiscount, pad.maxAmount)
    } else if (pad.type === 'reg_fee_only') {
      // 등록비 전액 유학원 할인 (예: 블루오션 "등록비 할인 가능") → 등록비만큼 차감
      thisAgencyDiscount = registrationFeeKrw
    } else if (pad.type === 'week_tiers') {
      const tier = (pad.weekTiers ?? []).find(t => {
        if (totalWeeks < t.minWeeks) return false
        if (t.maxWeeks !== undefined && totalWeeks > t.maxWeeks) return false
        return true
      })
      if (tier) {
        thisAgencyDiscount = tier.amount
        if (tier.scope === 'per_person') notes.push(`ℹ️ ${label}: 인당 ${tier.amount.toLocaleString()}원 (인원수만큼 곱하기는 운영자 입력)`)
      } else {
        notes.push(`ℹ️ ${label}: 주수 구간 매칭 없음 (총 ${totalWeeks}주)`)
      }
    }

    if (pad.regFeeDiscount && pad.regFeeDiscount > 0) {
      const regDiscount = Math.min(pad.regFeeDiscount, registrationFeeKrw)
      registrationFeeKrw = Math.max(0, registrationFeeKrw - regDiscount)
      thisAgencyDiscount += regDiscount
    }

    // [등록비성 정액할인 중복 방지] PILAedu·BCEBU처럼 여러 프로모션에 같은 "등록비 N만원 할인"이
    // 중복 기재된 경우, 등록비는 한 번만 내므로 할인도 한 번만. 또한 등록비를 초과해 깎을 수 없다.
    const isRegFeeDiscount = (pad.type === 'amount' || pad.type === 'amount_flat' || pad.type === 'reg_fee_only')
      && /등록비|등록금|입학금/.test(pad.rawText ?? pad.note ?? '')
    if (isRegFeeDiscount) {
      if (regFeeAgencyApplied) {
        // 이미 등록비성 유학원할인을 적용함 → 이번 건은 중복이므로 적용하지 않음
        thisAgencyDiscount = 0
      } else {
        // 등록비를 초과하지 않도록 상한
        thisAgencyDiscount = Math.min(thisAgencyDiscount, registrationFeeKrw)
        if (thisAgencyDiscount > 0) regFeeAgencyApplied = true
      }
    }

    agencyDiscountKrw += thisAgencyDiscount
    if (thisAgencyDiscount > 0) {
      if (!agencyDiscountNote || agencyDiscountNote === '본사 확인 필요') agencyDiscountNote = pad.note ?? ''
      promotionLines.push({
        id: id + '__agency',
        label: `${label} (유학원 할인)`, status: 'applied', kind: 'agency',
        discountKrw: thisAgencyDiscount,
        basis: pad.rawText ?? pad.note ?? `${pad.type}`,
        stackable: true,
      })
    }
  }

  // 날짜 미정 보류 항목(서차지·기간한정 프로모션)을 promotionLines에 합침
  for (const pl of pendingSeasonalLines) promotionLines.push(pl)
  if (dateUnset && pendingSeasonalLines.length > 0) {
    notes.push(`ℹ️ 시작일 미정 — 성수기 추가비/기간 한정 프로모션은 날짜 확정 후 반영됩니다. (현재 기본 견적)`)
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
  let localFeeEstimateNote = false   // 4주 미만 per_4weeks 추정 부과 시 경고용
  // [택일 그룹] 같은 exclusiveGroup 항목은 자동 합산하지 않고 그룹 기본값만 합산.
  // 그룹 목록은 결과에 담아 UI가 < >로 선택하게 한다.
  const exclusiveGroups = new Map<string, LocalFee[]>()
  for (const lf of localFees) {
    const g = (lf as { exclusiveGroup?: string }).exclusiveGroup
    if (g) {
      if (!exclusiveGroups.has(g)) exclusiveGroups.set(g, [])
      exclusiveGroups.get(g)!.push(lf)
    }
  }

  if (pkgIncludesLocal) {
    notes.push('ℹ️ 패키지 가격에 현지납부비 포함')
  } else {
    for (const lf of localFees) {
      const raw = lf as unknown as Record<string, unknown>
      const trigger = lf.trigger ?? (raw.condition === 'one_time' ? 'always'
        : raw.condition === 'min_weeks' ? 'over_weeks'
        : raw.condition as string ?? 'always')
      if (trigger === 'optional') continue

      // [택일 그룹] 그룹에 속하면, 기본값(groupDefault 또는 그룹 첫 항목)만 합산
      const grp = (lf as { exclusiveGroup?: string }).exclusiveGroup
      if (grp) {
        const members = exclusiveGroups.get(grp) ?? []
        const defaultMember = members.find(m => (m as { groupDefault?: boolean }).groupDefault) ?? members[0]
        if (lf.id !== defaultMember?.id) continue   // 기본값 아니면 합산 안 함 (UI에서 선택)
      }

      const isKrw = lf.currency === 'KRW'
      const amt = lf.amount ?? 0
      const add = (v: number) => isKrw ? (localFeeKrw += v) : (localFeePhp += v)

      if (trigger === 'always')          { add(amt) }
      else if (trigger === 'per_week')   { add(amt * totalWeeks) }
      else if (trigger === 'per_4weeks') {
        // 4주 미만이면 4주치(올림)로 부과 — 자료 미명시, 추정치. 현지 관리비 특성상 보통 1주라도 한 달치.
        const blocks = Math.ceil(totalWeeks / 4)
        add(amt * blocks)
        if (totalWeeks < 4 && amt > 0) {
          localFeeEstimateNote = true   // 아래에서 경고 한 번만
        }
      }
      else if (trigger === 'over_weeks') {
        const threshold = lf.triggerWeeks ?? (raw.minWeeks as number) ?? 4
        if (totalWeeks > threshold) add(amt)
      }
    }
  }

  const localFeeKrwEstimate = toKrw(localFeePhp, 'PHP', rate) + localFeeKrw
  if (localFeeEstimateNote) {
    notes.push('ℹ️ 현지납부비 중 4주 단위 항목(관리비·전기·수도·교재 등)은 4주 미만이어도 4주치로 추정 부과했습니다. 학원 확인 필요.')
  }

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
    promotionLines,
    warnings, notes,
  }
}

function addWeeksHelper(d: string, w: number): string {
  const dt = new Date(d); dt.setDate(dt.getDate() + w * 7); return dt.toISOString().split('T')[0]
}

// [토일월 그룹 정규화] 학원마다 입국 요일이 토/일/월로 달라도 같은 입국 묶음으로 본다.
// 어떤 날짜든 "그 날짜가 속한 토/일/월 그룹의 대표일(직전 또는 당일 토요일)"로 정렬한다.
// 토(6)=당일, 일(0)=전날 토, 월(1)=이틀전 토. 화~금은 그 주 토요일로 (입국일은 보통 토일월).
function toSatMonGroup(d: string): string {
  const dt = new Date(d)
  const day = dt.getUTCDay()  // 일0 월1 ... 토6
  // 토일월을 직전 토요일로 묶음: 토→0, 일→-1, 월→-2, 그 외(화~금)→해당 주 토요일(-day-1)
  const back = day === 6 ? 0 : day === 0 ? 1 : day === 1 ? 2 : (day + 1)
  dt.setUTCDate(dt.getUTCDate() - back)
  return dt.toISOString().split('T')[0]
}

function getOverlapWeeks(s1:string,e1:string,s2:string,e2:string): number {
  // 토일월 그룹으로 정렬 후 겹침 계산 (요일 1~2일 차이로 인한 경계 오차 제거)
  const g1s = toSatMonGroup(s1), g1e = toSatMonGroup(e1)
  const g2s = toSatMonGroup(s2), g2e = toSatMonGroup(e2)
  const s = Math.max(new Date(g1s).getTime(), new Date(g2s).getTime())
  const e = Math.min(new Date(g1e).getTime(), new Date(g2e).getTime())
  return e <= s ? 0 : Math.floor((e-s)/604800000)
}
function isInRange(d:string,s:string,e:string): boolean {
  // 토일월 그룹 정렬 후 비교: 입국일과 기간 경계를 같은 그룹 기준으로
  const gd = toSatMonGroup(d), gs = toSatMonGroup(s), ge = toSatMonGroup(e)
  return gd >= gs && gd <= ge
}
