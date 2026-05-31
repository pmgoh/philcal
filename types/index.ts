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
  | 'amount'
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
  applyTo: 'all' | 'all_with_surcharge' | 'course_only' | 'dorm_only' | 'package_only' | 'course_and_dorm'
  scope?: 'per_person' | 'per_family'
  // [할인 기준 시점] 유학원 10%를 학원 할인 차감 전/후 어느 금액에 매기는지.
  // - 'after_discount' (기본): 학원 할인(프로모션·장기할인)을 뺀 후 금액에 적용. (CG 등 자료 명시)
  // - 'before_discount': 할인 전 원금에 적용. (자료가 원금 기준일 때)
  // 자료 표현대로 학원별 지정. 미설정이면 after_discount(계산 다 하고 10%).
  base?: 'after_discount' | 'before_discount'
  minWeeks?: number                   // [허용조건] 유학원 할인 적용 최소 주수 (이 주수 이상부터 켜짐)
  // [계산방식] type='amount_per_4weeks'일 때 4주 미만 잔여 주수 처리:
  // - 'floor' (기본): 4주 블록 단위 내림 (6주 → 1블록). 보수적(적게 할인).
  // - 'proportional': 비례 (6주 → 1.5블록).
  blockMethod?: 'floor' | 'proportional'
  // [계산방식 확인 여부] 자료에 계산방식이 명시되지 않아 floor로 기본 처리한 경우 false.
  // false면 견적 시 "계산방식 미확인 - 적게 할인 적용됨" 경고 자동 표시. (정보없음≠불가 원칙)
  methodConfirmed?: boolean
  regFeeDiscount?: number              // 등록비 할인 금액 (원)
  weekTiers?: AgencyWeekTier[]         // type='week_tiers'일 때
  rawText?: string                     // 자료 원문 보존
  note: string
}

// ─── 프로모션 주수 구간별 할인 (학원 자체 장기등록 할인용) ────────────────────
export interface PromotionWeekTier {
  minWeeks: number       // 이 주수 이상부터 적용
  maxWeeks?: number      // 미설정 = 상한 없음
  amount: number         // 할인 금액 (KRW)
}

export interface Promotion {
  id: string
  label: string
  basisType: PromotionBasis
  alwaysApply: boolean
  startDate: string
  endDate: string
  discountType: 'percent' | 'amount' | 'amount_per_week' | 'amount_per_4weeks' | 'week_tiers'
  discountValue: number
  currency?: Currency
  applyToCourses: boolean
  applyToDorms: boolean
  applyToSurcharge: boolean
  weekTiers?: PromotionWeekTier[]   // discountType='week_tiers'일 때
  // [허용조건] 이 주수 이상일 때만 할인 적용 (예: "4주 이상 등록 시" → 4).
  // condition 자유문자열 대신 명시적 숫자로. 미설정이면 제한 없음.
  minWeeks?: number
  // [계산방식] discountType='amount_per_4weeks'일 때 4주 미만 잔여 주수 처리:
  // - 'floor' (기본): 4주 블록 단위 내림 (6주 → 1블록). 보수적(적게 할인).
  // - 'proportional': 비례 (6주 → 1.5블록).
  blockMethod?: 'floor' | 'proportional'
  // [계산방식 확인 여부] 자료에 계산방식 명시 없어 floor로 기본 처리한 경우 false.
  // false면 견적 시 "계산방식 미확인" 경고 자동 표시.
  methodConfirmed?: boolean
  // [최대 주수] 이 주수 이하일 때만 적용 (예: "8주 이하" → 8). 미설정이면 상한 없음.
  maxWeeks?: number
  // [제외 기간] 연수 시작일이 이 기간들에 들면 적용 안 함 (예: 성수기 6~8월 제외).
  excludePeriods?: Array<{ start: string; end: string }>
  // [체류기간 조건] 연수 체류기간에 특정 구간이 N주 이상 포함돼야 적용 (예: 겨울 12/21~1/1 2주 포함자만).
  requireStayIncludes?: { start: string; end: string; minWeeks?: number }
  condition?: string                // 자료 원문 보존용 (계산엔 minWeeks 사용)
  note?: string
  // 특정 기숙사/코스에만 적용 (빈 배열 또는 미설정 = 전체 적용)
  applicableItems?: string[]
  // [중복 적용 관계] 다른 프로모션과 동시 적용 가능한지를 ID 기반으로 표현.
  // 대부분 프로모션은 시기·대상으로 이미 안 겹치므로 미설정(빈 값). 동시 적용 상황이
  // 생길 수 있는 것들만 관계를 명시한다. 학원마다 표현이 달라도 관계는 ID 쌍으로 통일 저장.
  // - stackWith: 이 ID들과는 함께 적용 가능 (예: 장기할인 + 비수기할인)
  // - exclusiveWith: 이 ID들과는 택일 (둘 중 하나만. 예: 1+1특파원 vs 20%할인)
  // 관계는 대칭으로 해석(a가 b와 stack이면 b도 a와 stack). 한쪽만 적어도 됨.
  stackWith?: string[]
  exclusiveWith?: string[]
  // [관계 확인 여부] 동시 적용될 수 있는 다른 프로모션이 있는데 관계가 자료에 명시 안 된 경우 false.
  // false면 함께 적용 시 "중복 가능 여부 미확인 — 본사 확인 필요" 경고. (정보없음≠임의처리 원칙)
  relationConfirmed?: boolean
  // (구버전 호환) stackable: 기본 true. 명시적 false면 단독. 위 관계 필드가 우선.
  stackable?: boolean
  // 학원 프로모션과 별개로 적용되는 추가 항목 (예: 학원 자체 장기할인 + 본 프로모션)
  excludeCourses?: string[]    // 이 코스 IDs는 본 프로모션 적용 제외 (예: GEC, JEC)
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
  | 'per_room'    // 방당 (호텔보증금, 가족당 픽업 등)

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
  // [택일 그룹] 같은 group 값을 가진 항목들은 상호 배타 — 하나만 선택해 합산.
  // 예: 공항픽업 주말/평일, 픽업 성인/가족. 견적 화면에서 < >로 선택.
  // 미설정이면 단독 항목(기존대로 trigger에 따라 합산).
  exclusiveGroup?: string
  // 그룹 내 기본 선택 항목 여부 (미지정 시 그룹의 첫 항목이 기본)
  groupDefault?: boolean
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

// ─── 추가 옵션 비용 ──────────────────────────────────────────────────────────
// 자동 계산 대상은 아님 (코스/기숙사/패키지 외 별도 옵션)
// 견적 봇이 학원 컨텍스트로 인지하여 안내 시 활용
// 예: CELLA 익스프레서 (1주/2주 + 기숙사별 가격), CIA 추가숙박 (1박당), CIDEC 한 학년 학비, Booster ESL 단기 코스
export interface AdditionalCharge {
  id?: string             // 선택. 미설정 시 시스템이 label 기준으로 식별
  label: string           // 옵션 항목명
  amount: number          // 금액
  unit: string            // "1주" | "2주" | "1박" | "4주당" | "1회" 등 자유 입력
  currency: Currency
  category?: string       // 분류 (예: "단기옵션" | "추가숙박" | "옵션수업" | "1회성")
  note?: string
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
  // 4주 미만 단기 가격 데이터 상태:
  // - 'confirmed' (기본): 자료에 단기 비율 명시됨 (예: CG 40/60/85%)
  // - 'unconfirmed': 자료에 단기 비율 명시 없음. 시스템 fallback(정비례) 사용하되,
  //   견적 결과에 강한 경고 자동 추가. 정보 없음 ≠ 불가 원칙에 따라 계산은 진행.
  shortTermDataStatus?: 'confirmed' | 'unconfirmed'
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
  additionalCharges?: AdditionalCharge[]   // 옵션 비용 (자동 계산 X, 견적 봇 안내용)
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
