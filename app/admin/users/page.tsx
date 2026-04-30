'use client'
import { useEffect, useState } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { useAuth } from '@/components/AuthContext'
import { getAllUsers, updateUserStatus, updateUserRole } from '@/lib/users'
import type { AppUser, UserRole, UserStatus } from '@/types'
import { Check, X, Shield, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'

const STATUS_LABEL: Record<UserStatus, { label: string; color: string }> = {
  pending:  { label: '대기 중', color: 'bg-amber-100 text-amber-700' },
  approved: { label: '승인됨',  color: 'bg-green-100 text-green-700' },
  rejected: { label: '거절됨',  color: 'bg-red-100 text-red-700' },
}

const ROLE_LABEL: Record<UserRole, string> = {
  master: '마스터',
  admin:  '관리자',
  staff:  '상담원',
}

export default function UsersPage() {
  const { isMaster, appUser, loading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<AppUser[]>([])
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    if (!loading && !isMaster) router.replace('/schools')
  }, [loading, isMaster, router])

  useEffect(() => {
    if (isMaster) getAllUsers().then(u => { setUsers(u); setFetching(false) })
  }, [isMaster])

  const approve = async (uid: string) => {
    await updateUserStatus(uid, 'approved', appUser!.uid)
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status: 'approved' as UserStatus } : u))
  }

  const reject = async (uid: string) => {
    await updateUserStatus(uid, 'rejected', appUser!.uid)
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status: 'rejected' as UserStatus } : u))
  }

  const changeRole = async (uid: string, role: UserRole) => {
    await updateUserRole(uid, role)
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role } : u))
  }

  const pending = users.filter(u => u.status === 'pending')
  const others  = users.filter(u => u.status !== 'pending')

  if (loading || fetching) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    </AdminLayout>
  )

  return (
    <AdminLayout>
      <div className="p-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <Users size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">사용자 관리</h1>
            <p className="text-sm text-gray-500">총 {users.length}명 · 대기 {pending.length}명</p>
          </div>
        </div>

        {/* 대기 중 */}
        {pending.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              승인 대기 ({pending.length})
            </h2>
            <div className="space-y-2">
              {pending.map(u => (
                <UserRow key={u.uid} user={u}
                  onApprove={() => approve(u.uid)}
                  onReject={() => reject(u.uid)}
                  onRoleChange={role => changeRole(u.uid, role)}
                  currentUserUid={appUser!.uid}
                />
              ))}
            </div>
          </div>
        )}

        {/* 전체 목록 */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-3">전체 사용자</h2>
          <div className="space-y-2">
            {others.map(u => (
              <UserRow key={u.uid} user={u}
                onApprove={() => approve(u.uid)}
                onReject={() => reject(u.uid)}
                onRoleChange={role => changeRole(u.uid, role)}
                currentUserUid={appUser!.uid}
              />
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}

function UserRow({ user, onApprove, onReject, onRoleChange, currentUserUid }: {
  user: AppUser
  onApprove: () => void
  onReject: () => void
  onRoleChange: (role: UserRole) => void
  currentUserUid: string
}) {
  const isSelf = user.uid === currentUserUid
  const st = STATUS_LABEL[user.status]

  return (
    <div className="card p-4 flex items-center gap-4">
      {user.photoURL ? (
        <img src={user.photoURL} alt="" className="w-9 h-9 rounded-full" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-medium">
          {user.displayName?.[0] ?? '?'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 text-sm">{user.displayName}</span>
          {isSelf && <span className="text-xs text-blue-500">(나)</span>}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
        </div>
        <p className="text-xs text-gray-400 truncate">{user.email}</p>
      </div>

      {/* 역할 선택 */}
      {!isSelf && user.status === 'approved' && (
        <select value={user.role} onChange={e => onRoleChange(e.target.value as UserRole)}
          className="input-field text-xs w-24 py-1.5">
          {(Object.entries(ROLE_LABEL) as [UserRole, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      )}
      {isSelf && (
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <Shield size={12} /> {ROLE_LABEL[user.role]}
        </span>
      )}

      {/* 승인/거절 버튼 */}
      {user.status === 'pending' && !isSelf && (
        <div className="flex gap-1">
          <button onClick={onApprove}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-xs font-medium transition-colors border border-green-200">
            <Check size={12} /> 승인
          </button>
          <button onClick={onReject}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-medium transition-colors border border-red-200">
            <X size={12} /> 거절
          </button>
        </div>
      )}
    </div>
  )
}
