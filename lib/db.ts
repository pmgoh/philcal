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
export interface PromoEntry {
  id: string
  schoolName: string
  promoName: string
  region: string
  basisType: string
  startDate: string
  endDate: string
  discountType: string
  details: string
  isUrgent: boolean
  urgentDays?: number | null
  note: string
  active: boolean
  createdAt: string
  updatedAt?: string
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

export async function saveBatchPromotions(promos: PromoEntry[]): Promise<void> {
  const { writeBatch } = await import('firebase/firestore')
  const now = new Date().toISOString()
  const batch = writeBatch(db)
  for (const p of promos) {
    batch.set(doc(db, 'promotions', p.id), { ...p, updatedAt: now })
  }
  await batch.commit()
}
