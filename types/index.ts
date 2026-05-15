// ─── 공통 ───────────────────────────────────────────────────────────────────
export type Currency = 'KRW' | 'PHP' | 'USD'
export type Region = '세부' | '바기오' | '클락' | '일로일로' | '바콜로드' | '마닐라' | '기타'
export type SchoolType = 'sparta' | 'general' | 'both'
export type ProgramTag =
  | '성인일반' | '가족연수' | '주니어' | 'IELTS' | 'TOEIC' | 'TOEFL'
  | '비즈니스' | '시니어' | '골프' | '워킹홀리데이' | '공무원연수'

// ─── 단기가 (1~3주) ───────────────────────────────────────────────────────────
// mode: 'percent' → 4주 총액 대비 %, 'fixed' → 직접 금액
export interface ShortTermRates {
  mode: 'percent' | 'fixed'
  week1: number
  week2: number
  week3: number
  week4Included: boolean   // 4주도 별도 가격으로 덮어쓸지
  week4?: number
}

// price4Weeks: 4주 기준 총 금액 (주당이 아님)
// 예: 인텐시브 4주 = 1,800,000원 → price4Weeks=1800000
// N주 계산: price4Weeks / 4 * N

// ─── 코스 ────────────────────────────────────────────────────────────────────
export interface Course {
  id: string
  name: string
  target: string
  price4Weeks: number
  currency: Currency
  note?: string
}

// ─── 기숙사 ──────────────────────────────────────────────────────────────────
export interface Dormitory {
  id: string
  name: string
  target: string
  price4Weeks: number
  currency: Currency
  operationPeriod?: { startDate: string; endDate: string }
  note?: string
}

// ─── 서차지 ──────────────────────────────────────────────────────────────────
export interface Surcharge {
  id: string
  label: string
  startDate: string
  endDate: string
  pricePerWeek: number      // 서차지는 주당 금액 (별도)
  currency: Currency
  discountAllowed: boolean  // 서차지 금액에 유학원 할인 적용 가능 여부
  note?: string
}

// ─── 프로모션 ─────────────────────────────────────────────────────────────────
export type PromotionBasis = 'enrollment_date' | 'start_date' | 'contract_date' | 'departure_date'

// ─── 유학원 자체 할인 ─────────────────────────────────────────────────────────
// v3 status 모델:
// - 'enabled': 정상 계산
// - 'disabled': 자료에 "X"/"없음" 명시 → 0원 + "유학원 자체 할인 불가능 견적" 안내
// - 'unconfirmed': 자료 빈 칸 → 0원 + "본사 확인 필요" 안내
export type AgencyDiscountStatus = 'enabled' | 'disabled' | 'unconfirmed'

export type AgencyDiscountKind =
  | 'percent'
  | 'amount_per_week'
  | 'amount_per_4weeks'
  | 'amount_flat'
  | 'reg_fee_only'
  | 'week_tiers'

export interface AgencyWeekTier {
  minWeeks: number
  maxWeeks?: number
  amount: number
  scope?: 'per_person' | 'per_family'
}

export interface AgencyDiscount {
  status?: AgencyDiscountStatus       // 기본 'enabled' (구버전 호환)
  type: AgencyDiscountKind
  value: number
  maxAmount?: number
  applyTo: 'all' | 'course_only' | 'dorm_only' | 'package_only' | 'course_and_dorm'
  scope?: 'per_person' | 'per_family'
  minWeeks?: number                   // 유학원 할인 적용 최소 주수
  regFeeDiscount?: number              // 등록비 할인 금액 (원)
  weekTiers?: AgencyWeekTier[]         // type='week_tiers'일 때
  rawText?: string                     // 자료 원문 보존
  note: string
}

export interface Promotion {
  id: string
  label: string
  basisType: PromotionBasis
  alwaysApply: boolean
  startDate: string
  endDate: string
  discountType: 'percent' | 'amount' | 'amount_per_week' | 'amount_per_4weeks'
  discountValue: number
  currency?: Currency
  applyToCourses: boolean
  applyToDorms: boolean
  applyToSurcharge: boolean
  condition?: string
  note?: string
  // 특정 기숙사/코스에만 적용 (빈 배열 또는 미설정 = 전체 적용)
  applicableItems?: string[]
  // true = 다른 프로모션과 중복 적용 가능 / false(기본) = 단독 적용
  stackable?: boolean
  agencyDiscount?: AgencyDiscount | null
}

// ─── 등록비 ───────────────────────────────────────────────────────────────────
export interface RegistrationFee {
  amount: number
  currency: Currency
  note?: string
}

// ─── 현지납부비 ───────────────────────────────────────────────────────────────
// trigger: 언제 발생하는가
export type LocalFeeTrigger =
  | 'always'      // 입국 시 1회 (항상)
  | 'per_week'    // 주당
  | 'per_4weeks'  // 4주당
  | 'over_weeks'  // N주 초과 시 1회 (비자연장 등)
  | 'optional'    // 선택 (총액 미포함)

// chargeUnit: 어떤 단위로 청구되는가
export type LocalFeeChargeUnit =
  | 'flat'        // 고정 (팀/방 단위)
  | 'per_person'  // 인당
  | 'per_trip'    // 편도당 (픽업/샌딩)
  | 'per_night'   // 박당

export interface LocalFee {
  id: string
  name: string
  amount: number          // 금액
  amountMax?: number      // 범위 있을 때 최대값 (1,000~2,000)
  currency: Currency      // PHP | KRW
  trigger: LocalFeeTrigger
  chargeUnit: LocalFeeChargeUnit
  triggerWeeks?: number   // over_weeks일 때 기준 주수 (예: 4주 초과 = 4)
  note?: string
}

// ─── 패키지 ───────────────────────────────────────────────────────────────────
export interface PackagePriceCell {
  label: string       // "2인가족", "성인1인", "1인실" 등 열 헤더
  amount: number
}

export interface PackagePriceRow {
  weeks: number
  prices: PackagePriceCell[]
}

export interface PackageAdditionalRule {
  id: string
  condition: string   // "성인 2인 시", "비성수기 추가" 등
  addAmount: number
  currency: Currency
}

export interface PackageSchedule {
  startDate: string       // YYYY-MM-DD
  endDate: string         // YYYY-MM-DD
  season?: string         // "비수기" | "성수기" | 그 외 자유 입력 (이 일정의 시즌)
  weeks?: number          // 일정 주수 (기본 패키지 주수와 다를 때)
  note?: string
}

export interface Package {
  id: string
  label: string                       // 패키지명
  season: string                      // "비수기" | "성수기" | "연중" | 자유 입력 (전체 기본 시즌, 일정별로 다를 수 있음)
  currency: Currency

  // 가격 행렬: 행=주수, 열=인원/구성
  columns: string[]                   // ["2인가족", "3인가족", "4인가족"]
  priceMatrix: PackagePriceRow[]

  // 추가 규정 (성인 2인 +150만원 등)
  additionalRules: PackageAdditionalRule[]

  // 포함/불포함 항목 (줄바꿈 구분)
  includes: string
  excludes: string

  startDate?: string
  endDate?: string
  schedules?: PackageSchedule[]       // 기간이 정해진 패키지의 일정 목록 (시즌별 가격이 다르거나 4주 단위 고정 일정인 경우)
  includesLocalFees?: boolean         // true = 패키지에 현지납부비 포함 → 별도 청구 안 함
  note?: string
}

// ─── 비용 인상 ───────────────────────────────────────────────────────────────
export interface PriceIncreaseItem {
  id: string       // courseId 또는 dormitoryId
  name: string     // 표시용
  add: number      // 추가 금액 (주당)
}

export interface PriceIncrease {
  fromDate: string
  label?: string
  currency: Currency
  courses: PriceIncreaseItem[]
  dormitories: PriceIncreaseItem[]
}

// ─── 학원 ────────────────────────────────────────────────────────────────────
export interface School {
  id: string
  name: string
  schoolCode?: string                 // v3: 영문 대문자_언더스코어 (예: BANANA_KIDS). promotions 매칭 키.
  campus?: string                     // v3: 캠퍼스명 (예: "본원", "프리미엄 캠퍼스")
  region: Region
  schoolType: SchoolType
  programTags: ProgramTag[]
  minWeeks: number
  allowShortTerm: boolean
  courseShortTermRates?: ShortTermRates
  dormShortTermRates?: ShortTermRates
  registrationFee?: RegistrationFee
  priceIncrease?: PriceIncrease
  courses: Course[]
  dormitories: Dormitory[]
  surcharges: Surcharge[]
  promotions: Promotion[] | null   // null = 프로모션 미확인 상태 (data-health 페이지가 표시)
  localFees: LocalFee[]
  packages: Package[]
  refundPolicy: string
  dormitoryRules: string
  generalNotes: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ─── 환율 ─────────────────────────────────────────────────────────────────────
export interface ExchangeRate {
  phpToKrw: number
  usdToKrw: number
  updatedAt: string
}

// ─── 견적 ─────────────────────────────────────────────────────────────────────
export interface QuoteItem {
  label: string
  weeks: number
  unitPrice: number
  currency: Currency
  krwAmount: number
}

export interface QuoteResult {
  id: string
  schoolId: string
  schoolName: string
  inputSummary: string
  items: QuoteItem[]
  surchargeItems: QuoteItem[]
  promotionApplied?: string
  localFees: LocalFee[]
  totalKrw: number
  totalPhp: number
  notes: string[]
  createdAt: string
  createdBy: string
  exchangeRate: ExchangeRate
}

// ─── 단기가 계산 헬퍼 ──────────────────────────────────────────────────────────
// price4Weeks: 4주 총액
export function calcShortTermPrice(
  price4Weeks: number,
  weeks: 1 | 2 | 3 | 4,
  rates?: ShortTermRates
): number {
  if (weeks === 4) {
    if (rates?.week4Included && rates.week4) return rates.week4
    return price4Weeks
  }
  if (!rates) return Math.round(price4Weeks / 4 * weeks)  // fallback: 4주가격 / 4 * 주수
  const raw = rates[`week${weeks}` as 'week1' | 'week2' | 'week3']
  if (rates.mode === 'percent') return Math.round(price4Weeks * raw / 100)
  return raw  // fixed
}

// ─── 사용자 권한 ──────────────────────────────────────────────────────────────
export type UserRole = 'master' | 'admin' | 'staff'
export type UserStatus = 'pending' | 'approved' | 'rejected'

export interface AppUser {
  uid: string
  email: string
  displayName: string
  photoURL?: string
  role: UserRole
  status: UserStatus
  createdAt: string
  approvedAt?: string
  approvedBy?: string
  memo?: string
}
