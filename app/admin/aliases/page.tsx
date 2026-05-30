'use client'
import { useState, useEffect } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { getSchools, getSchoolAliases, saveSchoolAliases } from '@/lib/db'
import { SCHOOL_ALIASES } from '@/lib/schoolAliases'
import { Plus, X, Search, Save } from 'lucide-react'
import type { School } from '@/types'

// 학원 별칭 관리: 코드 파서가 자연어에서 학원을 찾을 때 쓰는 별칭(음역·약칭·오타).
// 비속어 필터처럼 학원별로 별칭을 추가/삭제한다. 저장 시 Firestore('schoolAliases')에 반영,
// 챗봇 파서는 코드 기본 별칭 + 이 Firestore 별칭을 병합해 사용한다.
export default function AliasAdminPage() {
  const [schools, setSchools] = useState<School[]>([])
  const [aliases, setAliases] = useState<Record<string, string[]>>({})   // Firestore 별칭
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const [input, setInput] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    getSchools().then(setSchools)
    getSchoolAliases().then(docs => {
      const m: Record<string, string[]> = {}
      for (const d of docs) m[d.schoolCode] = d.aliases
      setAliases(m)
    }).catch(() => {})
  }, [])

  // 학원별 코드 기본 별칭 (참고 표시용 — 삭제 불가, Firestore 별칭만 편집)
  const codeAliasesOf = (code?: string) => (code && SCHOOL_ALIASES[code]) ? SCHOOL_ALIASES[code] : []

  const add = (code: string) => {
    const v = (input[code] ?? '').trim()
    if (!v) return
    const cur = aliases[code] ?? []
    if (cur.includes(v)) { setInput({ ...input, [code]: '' }); return }
    setAliases({ ...aliases, [code]: [...cur, v] })
    setInput({ ...input, [code]: '' })
    setDirty({ ...dirty, [code]: true })
  }
  const remove = (code: string, a: string) => {
    setAliases({ ...aliases, [code]: (aliases[code] ?? []).filter(x => x !== a) })
    setDirty({ ...dirty, [code]: true })
  }
  const save = async (code: string) => {
    setSaving(code)
    try {
      await saveSchoolAliases(code, aliases[code] ?? [])
      setDirty({ ...dirty, [code]: false })
    } finally { setSaving(null) }
  }

  const shown = schools.filter(s => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return s.name.toLowerCase().includes(f) || (s.schoolCode ?? '').toLowerCase().includes(f)
  })

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-800">학원 별칭 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            챗봇이 자연어에서 학원을 찾을 때 쓰는 별칭입니다. 상담사가 실제로 치는 음역·약칭·오타를 추가하세요.
            (예: 베시·베씨·비씨아이 → BECI). 회색 칩은 코드 기본값(삭제 불가), 파란 칩은 추가한 별칭입니다.
          </p>
        </div>

        <div className="flex items-center gap-2 mb-4 bg-white border border-gray-200 rounded-lg px-3 py-2">
          <Search size={16} className="text-gray-400" />
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="학원명 또는 코드 검색"
            className="flex-1 text-sm outline-none" />
        </div>

        <div className="space-y-3">
          {shown.map(s => {
            const code = s.schoolCode ?? s.id
            const fire = aliases[code] ?? []
            const base = codeAliasesOf(s.schoolCode)
            return (
              <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-gray-800">{s.name}</span>
                    <span className="ml-2 text-xs text-gray-400">{code}</span>
                  </div>
                  {dirty[code] && (
                    <button onClick={() => save(code)} disabled={saving === code}
                      className="flex items-center gap-1 text-xs bg-blue-600 text-white px-2.5 py-1 rounded-md hover:bg-blue-700 disabled:opacity-50">
                      <Save size={12} /> {saving === code ? '저장 중' : '저장'}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {base.map(a => (
                    <span key={'b' + a} className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-500">{a}</span>
                  ))}
                  {fire.map(a => (
                    <span key={'f' + a} className="text-xs px-2 py-1 rounded-md bg-blue-50 text-blue-700 flex items-center gap-1">
                      {a}
                      <button onClick={() => remove(code, a)} className="hover:text-blue-900"><X size={11} /></button>
                    </span>
                  ))}
                  {base.length === 0 && fire.length === 0 && (
                    <span className="text-xs text-gray-300">별칭 없음</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={input[code] ?? ''}
                    onChange={e => setInput({ ...input, [code]: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') add(code) }}
                    placeholder="별칭 추가 후 Enter (예: 베씨)"
                    className="flex-1 text-sm border border-gray-200 rounded-md px-2 py-1.5 outline-none focus:border-blue-400" />
                  <button onClick={() => add(code)}
                    className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-md text-gray-700">
                    <Plus size={12} /> 추가
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </AdminLayout>
  )
}
