// ─── 공통 ───────────────────────────────────────────────────────────────────
export type Currency = 'KRW' | 'PHP' | 'USD'
export type Region = '세부' | '바기오' | '클락' | '일로일로' | '바콜로드' | '마닐라' | '기타'
export type SchoolType = 'sparta' | 'general' | 'both'
export type ProgramTag =
  | '성인일반' | '가족연수' | '주니어' | 'IELTS' | 'TOEIC' | 'TOEFL'
  | '비즈니스' | '시니어' | '골프' | '워킹홀리데이' | '공무원연수'

// ─── 단기가 설정 ─────────────────────────────────────────────────────────────
// mode: 'percent' → 4주가격 대비 %, 'fixed' → 직접 금액 입력
// 4주 가격 = pricePerWeek × 4 (별도 입력 없음)
export interface ShortTermRates {
  mode: 'percent' | 'fixed'
  week1: number   // percent 모드: 예) 40 → 4주가격의 40% / fixed 모드: 직접 금액
  week2: number
  week3: number
  week4Included: boolean  // 4주도 별도 가격으로 덮어쓸지 여부 (false면 pricePerWeek×4)
  week4?: number          // week4Included=true일 때만 사용
}

// ─── 코스 ────────────────────────────────────────────────────────────────────
export interface Course {
  id: string
  name: string
  target: string
  pricePerWeek: number
  currency: Currency
  shortTermRates?: ShortTermRates
  note?: string
}

// ─── 기숙사 ──────────────────────────────────────────────────────────────────
export interface Dormitory {
  id: string
  name: string
  target: string
  pricePerWeek: number
  currency: Currency
  shortTermRates?: ShortTermRates
  operationPeriod?: {
    startDate: string   // "MM-DD"
    endDate: string
  }
  note?: string
}

// ─── 서차지 ──────────────────────────────────────────────────────────────────
export interface Surcharge {
  id: string
  label: string
  startDate: string
  endDate: string
  pricePerWeek: number
  currency: Currency
  discountAllowed: boolean
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
  surchargeCompatible: boolean
  note?: string
}

// ─── 현지납부비 ───────────────────────────────────────────────────────────────
export type LocalFeeCondition =
  | 'one_time'    // 1회성 (무조건 1번 납부)
  | 'per_week'    // 주당 (amount × weeks)
  | 'min_weeks'   // 특정 주수 이상일 때만
  | 'optional'    // 옵션 (선택 납부, 총액 미포함)

export interface LocalFee {
  id: string
  name: string
  amount: number            // PHP 금액
  condition: LocalFeeCondition
  minWeeks?: number         // condition='min_weeks'일 때 최소 주수
  note?: string
}

// ─── 등록비 (현지납부비와 별도, 보통 KRW) ───────────────────────────────────
export interface RegistrationFee {
  amount: number
  currency: Currency
  note?: string
}

// ─── 패키지 ───────────────────────────────────────────────────────────────────
export interface Package {
  id: string
  label: string
  condition: string
  weeks?: number          // 해당 패키지 적용 주수 (예: 4, 8, 12)
  minWeeks?: number       // 최소 주수 조건
  maxWeeks?: number       // 최대 주수 조건
  totalPrice: number
  currency: Currency
  includes: string
  startDate?: string
  endDate?: string
  note?: string
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
  registrationFee?: RegistrationFee   // 등록비 (현지납부비 별도)
  courses: Course[]
  dormitories: Dormitory[]
  surcharges: Surcharge[]
  promotions: Promotion[]
  localFees: LocalFee[]               // 현지납부비 (PHP)
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
export function calcShortTermPrice(
  pricePerWeek: number,
  weeks: 1 | 2 | 3 | 4,
  rates?: ShortTermRates
): number {
  const base4w = pricePerWeek * 4

  if (weeks === 4) {
    if (rates?.week4Included && rates.week4) return rates.week4
    return base4w
  }

  if (!rates) return pricePerWeek * weeks  // fallback: 주당가 × 주수

  const raw = rates[`week${weeks}` as 'week1' | 'week2' | 'week3']
  if (rates.mode === 'percent') return Math.round(base4w * raw / 100)
  return raw  // fixed
}
