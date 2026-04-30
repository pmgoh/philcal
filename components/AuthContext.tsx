'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { onAuthStateChanged, signOut, User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getOrCreateUser, getCurrentUser } from '@/lib/users'
import type { AppUser } from '@/types'

interface AuthContextType {
  firebaseUser: User | null
  appUser: AppUser | null
  loading: boolean
  logout: () => Promise<void>
  isApproved: boolean
  isMaster: boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null, appUser: null, loading: true,
  logout: async () => {},
  isApproved: false, isMaster: false, isAdmin: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setFirebaseUser(u)
      if (u) {
        try {
          const au = await getOrCreateUser(u.uid, u.email ?? '', u.displayName ?? '', u.photoURL ?? '')
          setAppUser(au)
        } catch {
          setAppUser(null)
        }
      } else {
        setAppUser(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  const logout = async () => { await signOut(auth) }

  const isApproved = appUser?.status === 'approved'
  const isMaster   = appUser?.role === 'master'
  const isAdmin    = appUser?.role === 'master' || appUser?.role === 'admin'

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading, logout, isApproved, isMaster, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
