'use client'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { useRouter } from 'next/navigation'
import type { AppUser } from '@/types'
import { Clock, LogOut } from 'lucide-react'

export default function PendingPage({ user }: { user: AppUser }) {
  const router = useRouter()
  const handleLogout = async () => { await signOut(auth); router.replace('/login') }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100">
      <div className="w-full max-w-sm text-center">
        <div className="card p-8 space-y-4">
          <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto">
            <Clock size={28} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">승인 대기 중</h2>
            <p className="text-sm text-gray-500 mt-1">
              <strong>{user.displayName}</strong>님의 계정이<br />
              관리자 승인을 기다리고 있습니다.
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-500">
            {user.email}
          </div>
          <p className="text-xs text-gray-400">
            승인 후 자동으로 접속됩니다.<br />
            문의: pmgoh.works@gmail.com
          </p>
          <button onClick={handleLogout}
            className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
            <LogOut size={14} /> 로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}
