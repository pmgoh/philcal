'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useState } from 'react'
import { getOrCreateUser } from '@/lib/users'
import type { AppUser } from '@/types'
import Sidebar from '@/components/Sidebar'
import PendingPage from '@/components/PendingPage'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [appUser, setAppUser] = useState<AppUser | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.replace('/login'); return }
      try {
        const au = await getOrCreateUser(user.uid, user.email ?? '', user.displayName ?? '', user.photoURL ?? '')
        setAppUser(au)
      } catch {
        setAppUser(null)
      }
      setReady(true)
    })
    return unsub
  }, [router])

  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  // 미승인 사용자
  if (appUser && appUser.status !== 'approved') {
    return <PendingPage user={appUser} />
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar appUser={appUser} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
