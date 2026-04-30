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
export interface Promotion {
  id: string
  label: string
  basisType: 'enrollment_date' | 'start_date'
  startDate: string
  endDate: string
  discountType: 'percent' | 'amount'
  discountValue: number
  currency?: Currency
  condition?: string
  surchargeCompatible: boolean  // 서차지 기간에도 (학비+기숙사에) 할인 적용 가능
  note?: string
}

// ─── 등록비 ───────────────────────────────────────────────────────────────────
export interface RegistrationFee {
  amount: number
  currency: Currency
  note?: string
}

// ─── 현지납부비 ───────────────────────────────────────────────────────────────
export type LocalFeeCondition = 'one_time' | 'per_week' | 'min_weeks' | 'optional'

export interface LocalFee {
  id: string
  name: string
  amount: number
  condition: LocalFeeCondition
  minWeeks?: number
  note?: string
}

// ─── 패키지 ───────────────────────────────────────────────────────────────────
export interface Package {
  id: string
  label: string
  condition: string
  weeks?: number
  minWeeks?: number
  maxWeeks?: number
  totalPrice: number
  currency: Currency
  includes: string
  startDate?: string
  endDate?: string
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
  region: Region
  schoolType: SchoolType
  programTags: ProgramTag[]
  minWeeks: number
  allowShortTerm: boolean
  courseShortTermRates?: ShortTermRates
  dormShortTermRates?: ShortTermRates
  registrationFee?: RegistrationFee
  priceIncrease?: PriceIncrease         // 예정 비용 인상
  courses: Course[]
  dormitories: Dormitory[]
  surcharges: Surcharge[]
  promotions: Promotion[]
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
