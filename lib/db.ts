import {
  collection, doc, getDocs, getDoc,
  setDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from './firebase'
import type { School, ExchangeRate } from '@/types'

// ─── 학원 ─────────────────────────────────────────────────────────────────────
export async function getSchools(): Promise<School[]> {
  const q = query(collection(db, 'schools'), orderBy('name'))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as School))
}

export async function getSchool(id: string): Promise<School | null> {
  const snap = await getDoc(doc(db, 'schools', id))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as School
}

// undefined 제거 (Firestore는 undefined 필드 저장 불가)
function cleanForFirestore(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(cleanForFirestore)
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([k, v]) => v !== undefined && !k.startsWith('_'))  // _nameMatched 등 임시 필드 제거
        .map(([k, v]) => [k, cleanForFirestore(v)])
    )
  }
  return obj
}

export async function saveSchool(school: Partial<School> & { id?: string }): Promise<string> {
  const now = new Date().toISOString()
  const cleaned = cleanForFirestore(school) as Record<string, unknown>

  if (school.id) {
    await setDoc(doc(db, 'schools', school.id), { ...cleaned, updatedAt: now })
    return school.id
  } else {
    const ref = doc(collection(db, 'schools'))
    await setDoc(ref, { ...cleaned, id: ref.id, createdAt: now, updatedAt: now })
    return ref.id
  }
}

// 여러 학원을 writeBatch로 원자적 저장 (순차 setDoc은 리스너 충돌 위험)
export async function saveBatchSchools(schools: Array<Partial<School> & { id?: string }>): Promise<void> {
  const { writeBatch } = await import('firebase/firestore')
  const now = new Date().toISOString()

  // Firestore writeBatch는 500개 제한 — 학원 수는 충분히 적으므로 단일 배치로 처리
  const batch = writeBatch(db)
  for (const school of schools) {
    const cleaned = cleanForFirestore(school) as Record<string, unknown>
    if (school.id) {
      batch.set(doc(db, 'schools', school.id), { ...cleaned, updatedAt: now })
    } else {
      const ref = doc(collection(db, 'schools'))
      batch.set(ref, { ...cleaned, id: ref.id, createdAt: now, updatedAt: now })
    }
  }
  await batch.commit()
}

export async function deleteSchool(id: string): Promise<void> {
  await deleteDoc(doc(db, 'schools', id))
}

export async function deleteBatchSchools(ids: string[]): Promise<void> {
  const { writeBatch } = await import('firebase/firestore')
  const CHUNK = 400
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const batch = writeBatch(db)
    for (const id of slice) batch.delete(doc(db, 'schools', id))
    await batch.commit()
  }
}

// ─── 환율 설정 ────────────────────────────────────────────────────────────────
export async function getExchangeRate(): Promise<ExchangeRate> {
  const snap = await getDoc(doc(db, 'settings', 'exchangeRate'))
  if (!snap.exists()) {
    return { phpToKrw: 25, usdToKrw: 1380, updatedAt: new Date().toISOString() }
  }
  return snap.data() as ExchangeRate
}

export async function saveExchangeRate(rate: Omit<ExchangeRate, 'updatedAt'>): Promise<void> {
  await setDoc(doc(db, 'settings', 'exchangeRate'), {
    ...rate,
    updatedAt: new Date().toISOString()
  })
}

// ─── 프로모션 컬렉션 ──────────────────────────────────────────────────────────
// 어학원 측 할인 status (v3 구조)
// - 'enabled': 자료에 구체값 명시 → 정상 계산
// - 'disabled': 자료에 "X"/"없음" 명시 → 0원 + "유학원 자체 할인 불가능" 견적
// - 'unconfirmed': 자료에 빈 칸 → 0원 + "본사 확인 필요" 안내
export type AgencyDiscountStatus = 'enabled' | 'disabled' | 'unconfirmed'

// AgencyDiscount 세부 타입 (v3)
export type AgencyDiscountKind =
  | 'percent'             // (학비+기숙사비)의 N%
  | 'amount_per_4weeks'   // 4주당 N원
  | 'amount_per_week'     // 1주당 N원 (legacy 호환)
  | 'amount_flat'         // 1회성 정액
  | 'reg_fee_only'        // 등록비만 할인
  | 'week_tiers'          // 주수 구간별 차등 정액

export interface AgencyWeekTier {
  minWeeks: number
  maxWeeks?: number       // 미설정 = 상한 없음
  amount: number
  scope?: 'per_person' | 'per_family'
}

export interface PromoEntry {
  id: string
  schoolName: string       // 표시용 (구버전 호환)
  schoolId?: string        // 학원 문서 ID 참조 (구버전 호환)
  schoolCode?: string      // 신구조: 학원 매칭 키 (영문 대문자_숫자_언더스코어)
  promoName: string
  region: string
  target?: 'adult' | 'family' | 'junior' | 'camp' | 'all'   // 누구 대상
  season?: 'low' | 'high' | 'all'                            // 비수기/성수기/전체

  // ── 자료 원문 보존 (v3 신구조) ────────────────────────────────────────────
  registrationDeadline?: string | null   // 자료 [등록] 원문
  attendancePeriod?: string | null       // 자료 [적용기간]/[연수기간]/[출국일 기준] 원문
  applyPeriodNote?: string               // 자료 '적용기간' 컬럼 원문 전체
  promoContent?: string                  // 자료 '프로모션 내용' 컬럼 원문 그대로
  noteRaw?: string                       // 자료 '비고' 컬럼 원문 그대로

  // ── calcEngine 연동 필드 (legacy 호환) ────────────────────────────────────
  basisType: string                    // 'enrollment_date' | 'start_date'
  alwaysApply?: boolean
  stackable?: boolean                  // true = 타 프로모션 중복 적용 가능
  startDate: string
  endDate: string
  discountType: string                 // 'percent' | 'amount' | 'amount_per_4weeks' | 'amount_per_week'
  discountValue?: number               // 할인값 (% 또는 원)
  applyToCourses?: boolean
  applyToDorms?: boolean
  applyToSurcharge?: boolean
  condition?: string                   // 주수 조건 등 텍스트
  applicableItems?: string[]           // 특정 기숙사/코스 제한
  schoolDiscountDisabled?: boolean     // 어학원 자체 할인 없는 시즌 안내용

  // ── 표시용 필드 ───────────────────────────────────────────────────────────
  details: string                      // 상담원용 프로모션 상세 설명
  isUrgent?: boolean
  urgentDays?: number | null
  note: string                         // 메모 (운영자 입력)
  active: boolean
  createdAt: string
  updatedAt?: string
  noticeDate?: string                  // 자료 공지날짜 (YY-MM-DD)

  // ── 유학원 자체 할인 (v3 신구조) ──────────────────────────────────────────
  agencyDiscountStatus?: AgencyDiscountStatus    // 신구조 status (기본: enabled)
  agencyDiscountType?: AgencyDiscountKind | 'none'
  agencyDiscountValue?: number
  agencyDiscountMaxAmount?: number
  agencyDiscountApplyTo?: 'all' | 'course_only' | 'dorm_only' | 'package_only' | 'course_and_dorm'
  agencyDiscountScope?: 'per_person' | 'per_family'
  agencyDiscountMinWeeks?: number                // 유학원 할인 적용 최소 주수
  agencyDiscountRegFee?: number
  agencyDiscountWeekTiers?: AgencyWeekTier[]     // week_tiers 타입일 때
  agencyDiscountRawText?: string                 // 자료 '유학원프로모션' 컬럼 원문 그대로
  agencyDiscountNote?: string

  // ── 분기 조건 (성인/가족 외 추가 조건) ────────────────────────────────────
  conditions?: {
    dormType?: string                  // "독채" | "내부숙소"
    courseType?: string
    dormSubType?: string               // "독채형" | "대형사이즈" 등
    [key: string]: unknown
  }
}

export async function getPromotions(): Promise<PromoEntry[]> {
  const snap = await getDocs(collection(db, 'promotions'))
  return snap.docs.map(d => d.data() as PromoEntry)
}

export async function savePromotion(promo: PromoEntry): Promise<void> {
  const now = new Date().toISOString()
  await setDoc(doc(db, 'promotions', promo.id), { ...promo, updatedAt: now })
}

export async function deletePromotion(id: string): Promise<void> {
  await deleteDoc(doc(db, 'promotions', id))
}

export async function deleteBatchPromotions(ids: string[]): Promise<void> {
  const { writeBatch } = await import('firebase/firestore')
  // Firestore writeBatch는 한 번에 500개까지. 청크 분할
  const CHUNK = 400
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const batch = writeBatch(db)
    for (const id of slice) batch.delete(doc(db, 'promotions', id))
    await batch.commit()
  }
}

export async function saveBatchPromotions(promos: PromoEntry[]): Promise<void> {
  const { writeBatch } = await import('firebase/firestore')
  const now = new Date().toISOString()
  const batch = writeBatch(db)
  for (const p of promos) {
    batch.set(doc(db, 'promotions', p.id), { ...p, updatedAt: now })
  }
  await batch.commit()
}
