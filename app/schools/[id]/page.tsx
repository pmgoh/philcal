'use client'
import { useState } from 'react'
import AdminLayout from '@/components/AdminLayout'
import SchoolForm from '@/components/SchoolForm'
import EditDataChat from '@/components/EditDataChat'

export default function EditSchoolPage({ params }: { params: { id: string } }) {
  const [tab, setTab] = useState<'info' | 'edit'>('info')

  return (
    <AdminLayout>
      <div className="flex border-b border-gray-200 bg-white sticky top-0 z-10">
        {(['info', 'edit'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'info' ? '학원 정보' : '💬 데이터 수정'}
          </button>
        ))}
      </div>
      {tab === 'info'
        ? <SchoolForm schoolId={params.id} />
        : <EditDataChat schoolId={params.id} />
      }
    </AdminLayout>
  )
}
