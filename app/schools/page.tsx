'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AdminLayout from '@/components/AdminLayout'
import JsonImportModal from '@/components/JsonImportModal'
import { getSchools, deleteBatchSchools } from '@/lib/db'
import type { School, Region } from '@/types'
import { Plus, Search, MapPin, Tag, Pencil, FileJson, Building2, CheckSquare, Square, Trash2, X } from 'lucide-react'

const REGIONS: Region[] = ['세부', '바기오', '클락', '일로일로', '바콜로드', '마닐라', '기타']

const regionColor: Record<Region, string> = {
  '세부':   'bg-blue-50 text-blue-700 border-blue-200',
  '바기오': 'bg-green-50 text-green-700 border-green-200',
  '클락':   'bg-purple-50 text-purple-700 border-purple-200',
  '일로일로':'bg-orange-50 text-orange-700 border-orange-200',
  '바콜로드':'bg-pink-50 text-pink-700 border-pink-200',
  '마닐라': 'bg-slate-50 text-slate-700 border-slate-200',
  '기타':   'bg-gray-50 text-gray-700 border-gray-200',
}

export default function SchoolsPage() {
  const [schools, setSchools] = useState<School[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState<Region | 'all'>('all')
  const [showImport, setShowImport] = useState(false)

  // 일괄 선택 상태
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const load = () => {
    setLoading(true)
    getSchools().then(s => { setSchools(s); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const filtered = schools.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase())
    const matchRegion = regionFilter === 'all' || s.region === regionFilter
    return matchSearch && matchRegion
  })

  const byRegion = REGIONS.reduce((acc, r) => {
    acc[r] = schools.filter(s => s.region === r).length
    return acc
  }, {} as Record<Region, number>)

  // 일괄 선택/삭제 핸들러
  const toggleSelectMode = () => {
    setSelectMode(prev => !prev)
    setSelectedIds(new Set())
  }
  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAllFiltered = () => setSelectedIds(new Set(filtered.map(s => s.id)))
  const clearSelection = () => setSelectedIds(new Set())
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`선택된 ${selectedIds.size}개 학원을 모두 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return
    if (selectedIds.size >= 10 && !confirm(`정말 ${selectedIds.size}개를 한 번에 삭제하시겠습니까?\n다시 한 번 확인합니다.`)) return
    try {
      await deleteBatchSchools(Array.from(selectedIds))
      setSelectedIds(new Set())
      setSelectMode(false)
      load()
    } catch (e) {
      console.error(e)
      alert('일괄삭제 중 오류가 발생했습니다.')
    }
  }

  return (
    <AdminLayout>
      <div className="p-4 md:p-8">
        {showImport && (
          <JsonImportModal
            onClose={() => setShowImport(false)}
            onImported={() => {
              setShowImport(false)
              load()
            }}
          />
        )}
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">학원 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">총 {schools.length}개 캠퍼스 등록됨</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={toggleSelectMode}
              className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors ${
                selectMode
                  ? 'bg-red-50 border-red-300 text-red-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              {selectMode ? <X size={14} /> : <CheckSquare size={14} />}
              {selectMode ? '선택 취소' : '선택 모드'}
            </button>
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(schools, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `schools_${new Date().toISOString().split('T')[0]}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
              className="btn-secondary flex items-center gap-2"
            >
              <FileJson size={16} />
              <span>JSON 내보내기</span>
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <FileJson size={16} />
              <span>JSON 가져오기</span>
            </button>
            <Link href="/schools/new" className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              학원 추가
            </Link>
          </div>
        </div>

        {/* 일괄삭제 모드 액션 바 */}
        {selectMode && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-red-800">
                {selectedIds.size}개 선택됨 (현재 화면: {filtered.length}개)
              </span>
              <button onClick={selectAllFiltered}
                className="text-xs px-2 py-1 bg-white border border-red-300 text-red-700 rounded hover:bg-red-100">
                현재 화면 전체 선택
              </button>
              {selectedIds.size > 0 && (
                <button onClick={clearSelection}
                  className="text-xs px-2 py-1 bg-white border border-gray-200 text-gray-600 rounded hover:bg-gray-50">
                  선택 해제
                </button>
              )}
            </div>
            <button onClick={handleBatchDelete} disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <Trash2 size={14} /> 선택 일괄 삭제 ({selectedIds.size})
            </button>
          </div>
        )}

        {/* 지역 필터 칩 */}
        <div className="flex gap-2 flex-wrap mb-4">
          <button
            onClick={() => setRegionFilter('all')}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              regionFilter === 'all'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            전체 {schools.length}
          </button>
          {REGIONS.map(r => byRegion[r] > 0 && (
            <button
              key={r}
              onClick={() => setRegionFilter(regionFilter === r ? 'all' : r)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                regionFilter === r
                  ? 'bg-blue-600 text-white border-blue-600'
                  : `${regionColor[r]} border`
              }`}
            >
              {r} {byRegion[r]}
            </button>
          ))}
        </div>

        {/* 검색 */}
        <div className="relative mb-6">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="학원명 검색..."
            className="input-field pl-9 max-w-sm"
          />
        </div>

        {/* 목록 */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-3" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Building2 size={40} className="mx-auto mb-3 opacity-30" />
            <p>{search || regionFilter !== 'all' ? '검색 결과가 없습니다.' : '등록된 학원이 없습니다.'}</p>
            {!search && regionFilter === 'all' && (
              <Link href="/schools/new" className="btn-primary inline-flex items-center gap-2 mt-4">
                <Plus size={14} /> 첫 학원 추가하기
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(school => (
              <SchoolCard key={school.id} school={school}
                selectMode={selectMode}
                selected={selectedIds.has(school.id)}
                onToggle={() => toggleOne(school.id)} />
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}

function SchoolCard({ school, selectMode, selected, onToggle }: {
  school: School
  selectMode: boolean
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div className={`card p-5 hover:shadow-md transition-shadow ${selected ? 'ring-2 ring-red-400 bg-red-50/40' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {selectMode && (
            <button onClick={onToggle} className="flex-shrink-0 mt-0.5 p-0.5 hover:bg-gray-100 rounded">
              {selected
                ? <CheckSquare size={18} className="text-red-600" />
                : <Square size={18} className="text-gray-400" />}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{school.name}</h3>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <MapPin size={12} className="text-gray-400 flex-shrink-0" />
              <span className={`tag border text-xs ${regionColor[school.region]}`}>
                {school.region}
              </span>
              <span className="text-xs text-gray-400">
                {school.schoolType === 'sparta' ? '스파르타' : school.schoolType === 'general' ? '일반' : '스파르타/일반'}
              </span>
              {school.priceIncrease && (() => {
                const today = new Date().toISOString().split('T')[0]
                const active = school.priceIncrease.fromDate <= today
                return (
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${active ? 'bg-orange-100 text-orange-700' : 'bg-blue-50 text-blue-600'}`}>
                    {active ? '🔴 인상 적용 중' : `📢 ${school.priceIncrease.fromDate} 인상예정`}
                  </span>
                )
              })()}
            </div>
          </div>
        </div>
        {!selectMode && (
          <Link
            href={`/schools/${school.id}`}
            className="btn-secondary p-2 ml-2 flex-shrink-0"
            title="수정"
          >
            <Pencil size={14} />
          </Link>
        )}
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: '코스', count: school.courses?.length ?? 0 },
          { label: '기숙사', count: school.dormitories?.length ?? 0 },
          { label: '서차지', count: school.surcharges?.length ?? 0 },
        ].map(({ label, count }) => (
          <div key={label} className="bg-gray-50 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-gray-800">{count}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* 프로그램 태그 */}
      {school.programTags?.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Tag size={11} className="text-gray-300" />
          {(school.programTags ?? []).slice(0, 4).map(tag => (
            <span key={tag} className="tag bg-gray-100 text-gray-600 text-xs">{tag}</span>
          ))}
          {school.programTags.length > 4 && (
            <span className="text-xs text-gray-400">+{school.programTags.length - 4}</span>
          )}
        </div>
      )}
    </div>
  )
}
