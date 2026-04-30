'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Building2, MessageSquare, Settings, LogOut, ChevronRight } from 'lucide-react'

const navItems = [
  { href: '/schools', icon: Building2, label: '학원 관리' },
  { href: '/quote', icon: MessageSquare, label: '견적 상담' },
  { href: '/settings', icon: Settings, label: '설정' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await signOut(auth)
    router.replace('/login')
  }

  return (
    <aside className="w-56 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      {/* 로고 */}
      <div className="px-4 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">E</span>
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900">엠버시</div>
            <div className="text-xs text-gray-400">견적 시스템</div>
          </div>
        </div>
      </div>

      {/* 메뉴 */}
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon size={16} />
              {label}
              {active && <ChevronRight size={14} className="ml-auto text-blue-400" />}
            </Link>
          )
        })}
      </nav>

      {/* 로그아웃 */}
      <div className="p-3 border-t border-gray-100">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut size={16} />
          로그아웃
        </button>
      </div>
    </aside>
  )
}
