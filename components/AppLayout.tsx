'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getOrCreateUser } from '@/lib/users'
import type { AppUser } from '@/types'
import PendingPage from '@/components/PendingPage'
import { Calculator, LayoutGrid, LogOut } from 'lucide-react'

// 계산기/챗봇 전용 "앱 모드" 레이아웃.
// 기존 어드민 웹(사이드바 포함 AdminLayout)은 그대로 두고,
// 이 레이아웃은 사이드바 없이 계산기만 깔끔하게 보여준다. 인증은 동일하게 유지.
export default function AppLayout({ children }: { children: React.ReactNode }) {
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

  // PWA: service worker 등록 (바탕화면 설치 가능하게)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  if (appUser && appUser.status !== 'approved') {
    return <PendingPage user={appUser} />
  }

  const isAdmin = appUser?.role === 'admin'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 상단 최소 바 */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator size={18} className="text-blue-600" />
            <span className="font-semibold text-gray-800 text-sm">엠버시 견적 계산기</span>
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && (
              <button
                onClick={() => router.push('/calculator')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
                title="어드민 화면으로"
              >
                <LayoutGrid size={15} /> 어드민
              </button>
            )}
            <button
              onClick={() => signOut(auth)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors"
              title="로그아웃"
            >
              <LogOut size={15} /> 로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="widget-mode overflow-auto">
        <div className="max-w-md mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
