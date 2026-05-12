'use client'
import { useEffect, useState } from 'react'
import AdminLayout from '@/components/AdminLayout'
import EditDataChat from '@/components/EditDataChat'
import { getSchools } from '@/lib/db'
import type { School } from '@/types'
import { ChevronRight } from 'lucide-react'

export default function EditDataPage() {
  const [schools, setSchools] = useState<School[]>([])
  const [selected, setSelected] = useState<School | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSchools().then(s => { setSchools(s); setLoading(false) })
  }, [])

  return (
    <AdminLayout>
      <div className="flex h-[calc(100dvh-56px)]">
        {/* 학원 목록 */}
        <div className="w-56 flex-shrink-0 border-r border-gray-200 overflow-y-auto bg-gray-50">
          <div className="px-3 py-3 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-500">학원 선택</p>
          </div>
          {loading
            ? <div className="p-4 text-xs text-gray-400">불러오는 중...</div>
            : schools.filter(s => s.isActive).map(s => (
              <button key={s.id} onClick={() => setSelected(s)}
                className={`w-full text-left px-3 py-2.5 flex items-center justify-between transition-colors text-sm ${
                  selected?.id === s.id
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}>
                <span className="truncate">{s.name}</span>
                {selected?.id === s.id && <ChevronRight size={14} className="flex-shrink-0" />}
              </button>
            ))
          }
        </div>

        {/* 채팅 영역 */}
        <div className="flex-1 overflow-hidden">
          {selected
            ? <EditDataChat schoolId={selected.id} key={selected.id} />
            : <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                왼쪽에서 학원을 선택하세요
              </div>
          }
        </div>
      </div>
    </AdminLayout>
  )
}
