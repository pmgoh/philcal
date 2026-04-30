import { doc, getDoc, setDoc, collection, getDocs, updateDoc, query, orderBy } from 'firebase/firestore'
import { db } from './firebase'
import type { AppUser, UserRole, UserStatus } from '@/types'

const MASTER_EMAIL = process.env.NEXT_PUBLIC_MASTER_EMAIL ?? 'pmgoh.works@gmail.com'

export async function getOrCreateUser(uid: string, email: string, displayName: string, photoURL?: string): Promise<AppUser> {
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  const isMaster = email === MASTER_EMAIL

  if (snap.exists()) {
    const existing = snap.data() as AppUser
    // 마스터 계정인데 pending이면 자동 복구
    if (isMaster && existing.status !== 'approved') {
      await updateDoc(ref, { role: 'master', status: 'approved', approvedAt: new Date().toISOString() })
      return { ...existing, role: 'master', status: 'approved' }
    }
    return existing
  }

  const user: AppUser = {
    uid, email, displayName, photoURL: photoURL ?? '',
    role: isMaster ? 'master' : 'staff',
    status: isMaster ? 'approved' : 'pending',
    createdAt: new Date().toISOString(),
  }
  await setDoc(ref, user)
  return user
}

export async function getCurrentUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  return snap.data() as AppUser
}

export async function getAllUsers(): Promise<AppUser[]> {
  const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map(d => d.data() as AppUser)
}

export async function updateUserStatus(uid: string, status: UserStatus, approvedBy: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    status,
    approvedAt: new Date().toISOString(),
    approvedBy,
  })
}

export async function updateUserRole(uid: string, role: UserRole): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { role })
}
