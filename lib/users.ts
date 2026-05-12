import { doc, getDoc, setDoc, collection, getDocs, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { AppUser, UserRole, UserStatus } from '@/types'

const MASTER_EMAIL = process.env.NEXT_PUBLIC_MASTER_EMAIL ?? 'pmgoh.works@gmail.com'

export async function getOrCreateUser(uid: string, email: string, displayName: string, photoURL?: string): Promise<AppUser> {
  const ref = doc(db, 'users', uid)
  const isMaster = email === MASTER_EMAIL

  try {
    const snap = await getDoc(ref)

    if (snap.exists()) {
      const existing = snap.data() as AppUser
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
    console.log('[getOrCreateUser] created:', email, user.status)
    return user
  } catch (e) {
    console.error('[getOrCreateUser] failed for', email, e)
    // 실패해도 pending 상태 객체 반환 (UI는 보여주되 DB 저장 실패)
    return {
      uid, email, displayName, photoURL: photoURL ?? '',
      role: isMaster ? 'master' : 'staff',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
  }
}

export async function getCurrentUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  return snap.data() as AppUser
}

export async function getAllUsers(): Promise<AppUser[]> {
  try {
    const snap = await getDocs(collection(db, 'users'))
    const users = snap.docs.map(d => d.data() as AppUser)
    return users.sort((a, b) => {
      const ta = typeof a.createdAt === 'string' ? a.createdAt : ''
      const tb = typeof b.createdAt === 'string' ? b.createdAt : ''
      return tb.localeCompare(ta)
    })
  } catch (e) {
    console.error('[getAllUsers] error:', e)
    return []
  }
}

export async function updateUserStatus(uid: string, status: UserStatus, approvedBy: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    status,
    approvedAt: new Date().toISOString(),
    approvedBy: approvedBy || 'unknown',
  })
}

export async function deactivateUser(uid: string): Promise<void> {
  await setDoc(doc(db, 'users', uid), { status: 'rejected' }, { merge: true })
}

export async function updateUserRole(uid: string, role: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { role })
}

export async function deleteUser(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid))
}
