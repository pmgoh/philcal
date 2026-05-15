'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { Building2, MessageSquare, Settings, LogOut, ChevronRight, Users, Menu, X, Tag, Pencil, FileJson, AlertTriangle } from 'lucide-react'
import type { AppUser } from '@/types'
import { useState } from 'react'

interface Props { appUser?: AppUser | null }

export default function Sidebar({ appUser }: Props) {
  const pathname  = usePathname()
  const router    = useRouter()
  const [open, setOpen] = useState(false)
  const isMaster  = appUser?.role === 'master'
  const isAdmin   = appUser?.role === 'master' || appUser?.role === 'admin'

  const navItems = [
    { href: '/quote',             icon: MessageSquare,   label: '견적 챗봇',       show: true },
    { href: '/schools',           icon: Building2,       label: '학원 관리',       show: isAdmin },
    { href: '/admin/promotions',  icon: Tag,             label: '프로모션',        show: isAdmin },
    { href: '/admin/data-health', icon: AlertTriangle,   label: '데이터 확인 필요', show: isAdmin },
    { href: '/admin/edit-data',   icon: Pencil,          label: '데이터 수정',     show: isAdmin },
    { href: '/admin/json-tool',   icon: FileJson,        label: 'JSON 파서',       show: isAdmin },
    { href: '/settings',          icon: Settings,        label: '설정',            show: isAdmin },
    { href: '/admin/users',       icon: Users,           label: '사용자',          show: isMaster },
  ].filter(i => i.show)

  const handleLogout = async () => { await signOut(auth); router.replace('/login') }

  return (
    <>
      {/* ── 데스크탑 사이드바 ── */}
      <aside className="hidden md:flex w-56 min-h-screen bg-white border-r border-gray-200 flex-col flex-shrink-0">
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
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname.startsWith(href)
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
                <Icon size={16} />
                {label}
                {active && <ChevronRight size={14} className="ml-auto text-blue-400" />}
              </Link>
            )
          })}
        </nav>
        <div className="px-3 py-3 border-t border-gray-100">
          {appUser && (
            <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
              {appUser.photoURL
                ? <img src={appUser.photoURL} alt="" className="w-7 h-7 rounded-full" />
                : <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">{appUser.displayName?.[0]}</div>
              }
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-800 truncate">{appUser.displayName}</div>
                <div className="text-xs text-gray-400">{appUser.role === 'master' ? '마스터' : appUser.role === 'admin' ? '관리자' : '상담원'}</div>
              </div>
            </div>
          )}
          <button onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors">
            <LogOut size={16} /> 로그아웃
          </button>
        </div>
      </aside>

      {/* ── 모바일 상단 헤더 ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">E</span>
          </div>
          <span className="text-sm font-bold text-gray-900">엠버시 견적</span>
        </div>
        <button onClick={() => setOpen(true)} className="p-2 rounded-lg hover:bg-gray-100">
          <Menu size={20} className="text-gray-600" />
        </button>
      </div>

      {/* ── 모바일 드로어 ── */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-72 bg-white flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-sm font-bold">E</span>
                </div>
                <div>
                  <div className="text-sm font-bold text-gray-900">엠버시</div>
                  <div className="text-xs text-gray-400">{appUser?.displayName}</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map(({ href, icon: Icon, label }) => {
                const active = pathname.startsWith(href)
                return (
                  <Link key={href} href={href} onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}>
                    <Icon size={18} />
                    {label}
                  </Link>
                )
              })}
            </nav>
            <div className="px-3 py-4 border-t border-gray-100">
              <button onClick={handleLogout}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
                <LogOut size={18} /> 로그아웃
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 모바일 하단 탭바 ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href)
          return (
            <Link key={href} href={href}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${active ? 'text-blue-600' : 'text-gray-400'}`}>
              <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </>
  )
}
