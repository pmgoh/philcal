import {
  collection, doc, getDocs, getDoc,
  setDoc, updateDoc, deleteDoc,
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

export async function saveSchool(school: Partial<School> & { id?: string }): Promise<string> {
  const now = new Date().toISOString()
  if (school.id) {
    await updateDoc(doc(db, 'schools', school.id), { ...school, updatedAt: now })
    return school.id
  } else {
    const ref = doc(collection(db, 'schools'))
    await setDoc(ref, { ...school, id: ref.id, createdAt: now, updatedAt: now })
    return ref.id
  }
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
