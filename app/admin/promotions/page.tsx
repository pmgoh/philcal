'use client'
import { useState, useEffect, useRef } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { getPromotions, savePromotion, deletePromotion, deleteBatchPromotions, saveBatchPromotions, getSchools, PromoEntry } from '@/lib/db'
import { v4 as uuid } from 'uuid'
import { Plus, Trash2, Upload, Bell, BellOff, Search, RefreshCw, X, Link2, CheckSquare, Square } from 'lucide-react'
import { findSchoolForPromo, buildAliasIndex, type AliasMap } from '@/lib/schoolMatching'
import schoolAliases from '@/data/school-aliases.json'
import type { School } from '@/types'

const REGIONS = ['전체', '세부', '바기오', '마닐라', '기타']

// v3 호환 D-day 계산
function getDdays(endDate: string): number {
  if (!endDate) return NaN
  const today = new Date(); today.setHours(0,0,0,0)
  const end = new Date(endDate); end.setHours(0,0,0,0)
  if (isNaN(end.getTime())) return NaN
  return Math.ceil((end.getTime() - today.getTime()) / 86400000)
}

// 만료 여부 (v3 호환)
// - alwaysApply=true → 만료 안 됨
// - endDate 없음/잘못됨 → 만료 안 됨 (자료 원문에 기간 없는 경우 - 상시/성수기 등)
function isExpired(p: PromoEntry): boolean {
  if (p.alwaysApply) return false
  const d = getDdays(p.endDate)
  if (isNaN(d)) return false
  return d < 0
}

function isActiveValid(p: PromoEntry): boolean {
  if (!p.active) return false
  return !isExpired(p)
}

function DdayBadge({ promo }: { promo: PromoEntry }) {
  if (!promo.active) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">비활성</span>
  if (promo.alwaysApply) return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">상시</span>
  const d = getDdays(promo.endDate)
  if (isNaN(d)) return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">기간없음</span>
  if (d < 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">만료</span>
  if (d === 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-600 text-white font-bold animate-pulse">D-day</span>
  if (d <= 7)  return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">D-{d}</span>
  if (d <= 14) return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-bold">D-{d}</span>
  if (d <= 30) return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">D-{d}</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">D-{d}</span>
}

function urgencyLevel(p: PromoEntry): number {
  if (!p.active) return 9999
  if (p.alwaysApply) return 500
  const d = getDdays(p.endDate)
  if (isNaN(d)) return 600
  if (d < 0) return 9998
  return d
}

// ===== 학원별 표(검증용) 헬퍼 =====

// 유학원 할인 표시: "10% (학비+기숙)" / "등록금 10만원" / "없음"
function agencyDiscountLabel(p: PromoEntry): { value: string; type: string } {
  const t = p.agencyDiscountType
  const v = p.agencyDiscountValue
  if (!t || t === 'none') return { value: '없음', type: '' }
  if (t === 'percent') return { value: `${v}%`, type: (p.agencyDiscountRawText ?? '학비＋기숙 기준').slice(0, 30) }
  if (t === 'reg_fee_only') return { value: '등록비 할인', type: (p.agencyDiscountRawText ?? '').slice(0, 30) }
  if (t === 'amount') return { value: `${(v ?? 0).toLocaleString()}원`, type: (p.agencyDiscountRawText ?? '정액 할인').slice(0, 30) }
  return { value: String(t), type: '' }
}

// 학원 할인 표시
function schoolDiscountLabel(p: PromoEntry): { main: string; sub: string } {
  const dt = p.discountType
  const dv = p.discountValue
  if (dt === 'amount_per_week' && dv) return { main: `4주당 ${(dv * 4).toLocaleString()}원`, sub: `주당 ${dv.toLocaleString()}원` }
  if (dt === 'percent' && dv) return { main: `${dv}%`, sub: '' }
  if (dt === 'amount' && dv) return { main: `${dv.toLocaleString()}원`, sub: '' }
  if (dt === 'week_tiers') return { main: '주수별 정액', sub: '' }
  return { main: '없음', sub: '' }
}

// 장기 할인(week_tiers) 표시 — 같은 학원의 장기등록 프로모션을 가져와 표시
function longTermLabel(tiers?: Array<{ minWeeks: number; maxWeeks?: number; amount: number }>): string[] {
  if (!tiers || tiers.length === 0) return []
  return tiers.map(t => `${t.minWeeks}주 ${(t.amount / 10000)}만`)
}

// 계산 순서 토큰 생성
function calcOrderTokens(p: PromoEntry, hasLongTerm: boolean): Array<{ label: string; kind: 'base' | 'minus' }> {
  const toks: Array<{ label: string; kind: 'base' | 'minus' }> = [
    { label: '등록비＋학비＋기숙＋서차지', kind: 'base' },
  ]
  const isSchoolPromo = p.discountType && p.discountType !== 'none' && (p.discountValue || (p.weekTiers && p.weekTiers.length))
  if (isSchoolPromo && p.discountType !== 'week_tiers') toks.push({ label: '프로모션', kind: 'minus' })
  if (hasLongTerm) toks.push({ label: '장기', kind: 'minus' })
  const at = p.agencyDiscountType
  if (at && at !== 'none') {
    if (at === 'percent') toks.push({ label: `유학원 ${p.agencyDiscountValue}%`, kind: 'minus' })
    else toks.push({ label: '유학원할인', kind: 'minus' })
  }
  toks.push({ label: '입학금할인', kind: 'minus' })
  return toks
}

// D-day 배지 정보
function ddayInfo(p: PromoEntry): { text: string; cls: string } {
  if (p.alwaysApply) return { text: '상시', cls: 'always' }
  const d = getDdays(p.endDate)
  if (isNaN(d)) return { text: '기간없음', cls: 'always' }
  if (d < 0) return { text: '만료', cls: 'expired' }
  if (d <= 14) return { text: `D-${d}`, cls: 'soon' }
  return { text: `D-${d}`, cls: 'ok' }
}

export default function PromotionsPage() {
  const [promos, setPromos] = useState<PromoEntry[]>([])
  const [schools, setSchools] = useState<School[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('전체')
  const [showExpired, setShowExpired] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<PromoEntry>>({})
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // 일괄 선택 상태
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)

  // 뷰 모드: 'list'(편집 리스트) | 'table'(학원별 표 검증용)
  const [viewMode, setViewMode] = useState<'list' | 'table'>('list')

  const aliasIdx = buildAliasIndex(schoolAliases as unknown as AliasMap)

  const load = async () => {
    setLoading(true)
    const [data, schs] = await Promise.all([getPromotions(), getSchools()])
    setPromos(data.sort((a, b) => urgencyLevel(a) - urgencyLevel(b)))
    setSchools(schs)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = promos.filter(p => {
    if (!showExpired && isExpired(p)) return false
    if (regionFilter !== '전체' && p.region !== regionFilter) return false
    if (search && !p.schoolName.toLowerCase().includes(search.toLowerCase()) &&
        !p.promoName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const activeCount = promos.filter(p => isActiveValid(p)).length
  const urgentCount = promos.filter(p => {
    if (!isActiveValid(p) || p.alwaysApply) return false
    const d = getDdays(p.endDate)
    return !isNaN(d) && d >= 0 && d <= 7
  }).length
  const soonCount = promos.filter(p => {
    if (!isActiveValid(p) || p.alwaysApply) return false
    const d = getDdays(p.endDate)
    return !isNaN(d) && d > 7 && d <= 30
  }).length

  const handleSave = async (p: PromoEntry) => {
    let toSave = p
    if (!p.schoolId) {
      const matched = findSchoolForPromo(
        { schoolCode: p.schoolCode, schoolName: p.schoolName, region: p.region },
        schools,
        aliasIdx,
      )
      if (matched) toSave = { ...p, schoolId: matched.id }
    }
    await savePromotion(toSave)
    setEditId(null); setEditData({})
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return
    await deletePromotion(id); load()
  }

  // 일괄삭제 핸들러
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
  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map(p => p.id)))
  }
  const clearSelection = () => setSelectedIds(new Set())
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`선택된 ${selectedIds.size}개 프로모션을 모두 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) return
    if (selectedIds.size >= 50 && !confirm(`정말 ${selectedIds.size}개를 한 번에 삭제하시겠습니까?\n다시 한 번 확인합니다.`)) return
    try {
      await deleteBatchPromotions(Array.from(selectedIds))
      setSelectedIds(new Set())
      setSelectMode(false)
      load()
    } catch (e) {
      console.error(e)
      alert('일괄삭제 중 오류가 발생했습니다.')
    }
  }

  const handleToggleActive = async (p: PromoEntry) => {
    await savePromotion({ ...p, active: !p.active }); load()
  }

  const [importDiff, setImportDiff] = useState<{
    added: PromoEntry[]
    updated: Array<{ before: PromoEntry; after: PromoEntry; changedFields: string[] }>
    unchanged: PromoEntry[]
    blocked: string | null
    incoming: PromoEntry[]
  } | null>(null)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    if (fileRef.current) fileRef.current.value = ''
    try {
      const text = await file.text()
      const data = JSON.parse(text)

      // 다양한 형식 지원:
      //   - 배열: [{ ... }, { ... }]
      //   - 단일 객체: { promoName: ..., ... }
      //   - 래퍼 객체: { promotions: [...] } (학원별 JSON 파일에서 자주 쓰임)
      //   - 래퍼 객체: { _meta: {...}, promotions: [...] }
      let arr: Record<string, unknown>[]
      if (Array.isArray(data)) {
        arr = data as Record<string, unknown>[]
      } else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).promotions)) {
        arr = (data as { promotions: Record<string, unknown>[] }).promotions
      } else {
        arr = [data as Record<string, unknown>]
      }

      const sample = arr[0]
      if (!sample) return
      if ('courses' in sample || 'dormitories' in sample) {
        setImportDiff({ added: [], updated: [], unchanged: [], incoming: [], blocked: '❌ 학원 JSON이 감지됐습니다. 학원 관리 탭에서 가져오기 하세요.' })
        return
      }
      if (!('promoName' in sample) && !('schoolName' in sample)) {
        setImportDiff({ added: [], updated: [], unchanged: [], incoming: [], blocked: '❌ 프로모션 JSON 형식이 아닙니다. promoName, schoolName 필드를 확인하세요.\n\n지원 형식:\n  - 배열: [{...}, {...}]\n  - 래퍼 객체: { "promotions": [...] }' })
        return
      }

      const incoming = arr as unknown as PromoEntry[]
      const added: PromoEntry[] = []
      const updated: Array<{ before: PromoEntry; after: PromoEntry; changedFields: string[] }> = []
      const unchanged: PromoEntry[] = []

      for (const next of incoming) {
        const existing = promos.find(p => p.id === next.id)
        if (!existing) { added.push(next); continue }
        const COMPARE_FIELDS: (keyof PromoEntry)[] = [
          'schoolId','schoolCode','region',
          'promoName','schoolName','startDate','endDate','discountType','discountValue',
          'alwaysApply','stackable','applyToCourses','applyToDorms','applyToSurcharge','condition',
          'details','active','note','agencyDiscountNote','agencyDiscountType',
          'agencyDiscountValue','agencyDiscountApplyTo','isUrgent','urgentDays',
          'minWeeks','blockMethod','methodConfirmed',
          'stackWith','exclusiveWith','relationConfirmed','agencyDiscountBase',
          'agencyDiscountStatus','agencyDiscountScope','agencyDiscountPerPerson',
          'agencyDiscountMaxAmount','agencyDiscountMinWeeks','agencyDiscountRegFee',
          'agencyDiscountRawText','target','familyEligible',
        ] as (keyof PromoEntry)[]
        const normalize = (v: unknown) => {
          if (v === null || v === undefined || v === '') return ''
          return JSON.stringify(v)
        }
        const changedFields = COMPARE_FIELDS.filter(f =>
          normalize(existing[f]) !== normalize(next[f])
        )
        if (changedFields.length > 0) updated.push({ before: existing, after: next, changedFields })
        else unchanged.push(next)
      }

      setImportDiff({ added, updated, unchanged, incoming, blocked: null })
    } catch { alert('JSON 파일 형식 오류') }
  }

  const handleConfirmImport = async () => {
    if (!importDiff) return
    setImporting(true)
    try {
      const enriched = importDiff.incoming.map(p => {
        if (p.schoolId) return p
        const matched = findSchoolForPromo(
          { schoolCode: p.schoolCode, schoolName: p.schoolName, region: p.region },
          schools,
          aliasIdx,
        )
        return matched ? { ...p, schoolId: matched.id } : p
      })
      await saveBatchPromotions(enriched)
      setImportDiff(null)
      load()
    } catch { alert('저장 중 오류') }
    finally { setImporting(false) }
  }

  const addNew = () => {
    const id = uuid()
    const newPromo: PromoEntry = {
      id, schoolName: '', promoName: '', region: '세부',
      basisType: 'enrollment_date', startDate: '2026-01-01', endDate: '2026-12-31',
      discountType: 'amount', details: '', note: '',
      active: true, createdAt: new Date().toISOString(),
    }
    setPromos(prev => [newPromo, ...prev])
    setEditId(id); setEditData(newPromo)
  }

  return (
    <AdminLayout>
      <div className={`p-4 md:p-6 mx-auto ${viewMode === 'table' ? 'max-w-[1600px]' : 'max-w-5xl'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900">프로모션 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              전체 {activeCount}개 활성
              {urgentCount > 0 && <span className="ml-2 text-red-600 font-semibold">🔴 D-7 이내 {urgentCount}개</span>}
              {soonCount > 0 && <span className="ml-2 text-yellow-600 font-semibold">🟡 D-30 이내 {soonCount}개</span>}
            </p>
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
            <button onClick={() => {
              const blob = new Blob([JSON.stringify(promos, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `promotions_${new Date().toISOString().split('T')[0]}.json`
              a.click()
              URL.revokeObjectURL(url)
            }} className="btn-secondary flex items-center gap-1.5 text-sm">
              <Upload size={14} className="rotate-180" /> JSON 내보내기
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={importing}
              className="btn-secondary flex items-center gap-1.5 text-sm">
              <Upload size={14} /> JSON 가져오기
            </button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button onClick={addNew} className="btn-primary flex items-center gap-1.5 text-sm">
              <Plus size={14} /> 프로모션 추가
            </button>
          </div>
        </div>

        <div className="inline-flex bg-gray-100 rounded-lg p-1 mb-4">
          <button onClick={() => setViewMode('list')}
            className={`text-sm px-4 py-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-blue-900 text-white font-semibold' : 'text-gray-500 hover:text-gray-700'}`}>
            편집 리스트
          </button>
          <button onClick={() => setViewMode('table')}
            className={`text-sm px-4 py-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-blue-900 text-white font-semibold' : 'text-gray-500 hover:text-gray-700'}`}>
            학원별 표 (검증용)
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="input-field pl-8 text-sm" placeholder="학원명, 프로모션명 검색" />
          </div>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
            className="input-field text-sm w-28">
            {REGIONS.map(r => <option key={r}>{r}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
            <input type="checkbox" checked={showExpired} onChange={e => setShowExpired(e.target.checked)} className="w-4 h-4" />
            만료 포함
          </label>
          <button onClick={load} className="btn-secondary p-2"><RefreshCw size={14} /></button>
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

        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : viewMode === 'table' ? (
          <PromoTableView promos={filtered} schools={schools} onEdit={(id) => { setViewMode('list'); setEditId(id) }} onDelete={async (id) => { if (confirm('이 프로모션을 삭제할까요?')) { await deletePromotion(id); load() } }} />
        ) : (
          <div className="space-y-2">
            {filtered.length === 0 && <div className="text-center py-12 text-gray-400">프로모션이 없습니다.</div>}
            {filtered.map(p => {
              const isEditing = editId === p.id
              const d = getDdays(p.endDate)
              const expired = isExpired(p)
              const hasNoDates = !p.alwaysApply && isNaN(d)

              return (
                <div key={p.id} className={`card rounded-xl border overflow-hidden transition-colors ${
                  expired || !p.active ? 'opacity-50' :
                  hasNoDates ? 'border-purple-200 bg-purple-50/20' :
                  p.alwaysApply ? 'border-blue-200 bg-blue-50/20' :
                  d <= 7 ? 'border-red-200 bg-red-50/30' :
                  d <= 14 ? 'border-orange-200 bg-orange-50/20' :
                  d <= 30 ? 'border-yellow-200 bg-yellow-50/20' : 'border-gray-200'
                }`}>
                  {isEditing ? (
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">학원명</label>
                          <input value={editData.schoolName ?? ''} onChange={e => setEditData(d => ({...d, schoolName: e.target.value}))}
                            className="input-field text-sm" placeholder="학원명" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">프로모션명</label>
                          <input value={editData.promoName ?? ''} onChange={e => setEditData(d => ({...d, promoName: e.target.value}))}
                            className="input-field text-sm" placeholder="프로모션명" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">지역</label>
                          <select value={editData.region ?? '세부'} onChange={e => setEditData(d => ({...d, region: e.target.value}))}
                            className="input-field text-sm">
                            {['세부','바기오','마닐라','기타'].map(r => <option key={r}>{r}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">기준일 유형</label>
                          <select value={editData.basisType ?? 'enrollment_date'} onChange={e => setEditData(d => ({...d, basisType: e.target.value}))}
                            className="input-field text-sm">
                            <option value="enrollment_date">등록일</option>
                            <option value="start_date">연수 시작일</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">시작일</label>
                          <input type="date" value={editData.startDate ?? ''} onChange={e => setEditData(d => ({...d, startDate: e.target.value}))}
                            className="input-field text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">종료일 (마감일)</label>
                          <input type="date" value={editData.endDate ?? ''} onChange={e => setEditData(d => ({...d, endDate: e.target.value}))}
                            className="input-field text-sm" />
                        </div>
                      </div>

                      <div className="border border-blue-200 rounded-xl p-3 bg-blue-50/30 space-y-3">
                        <p className="text-xs font-semibold text-blue-700">🧮 견적 계산 설정</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">할인 유형</label>
                            <select value={editData.discountType ?? 'amount'} onChange={e => setEditData(d => ({...d, discountType: e.target.value}))}
                              className="input-field text-xs py-1.5">
                              <option value="amount">금액 (원)</option>
                              <option value="percent">% 할인</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
                              {editData.discountType === 'percent' ? '할인율 (%)' : '할인금액 (원)'}
                            </label>
                            <input type="number" value={editData.discountValue ?? ''} onChange={e => setEditData(d => ({...d, discountValue: Number(e.target.value)}))}
                              className="input-field text-xs py-1.5" placeholder="예: 50000" />
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={editData.alwaysApply ?? false} onChange={e => setEditData(d => ({...d, alwaysApply: e.target.checked}))} className="rounded" />
                              <span className="text-xs text-gray-600">기간 무관 항상 적용</span>
                            </label>
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={(editData as Record<string,unknown>).stackable as boolean ?? false}
                                onChange={e => setEditData(d => ({...d, stackable: e.target.checked}))} className="rounded" />
                              <span className="text-xs text-blue-700 font-medium">타 프로모션 중복 적용 가능</span>
                            </label>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={editData.applyToCourses ?? true} onChange={e => setEditData(d => ({...d, applyToCourses: e.target.checked}))} className="rounded" />
                            <span className="text-xs text-gray-600">학비 적용</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={editData.applyToDorms ?? true} onChange={e => setEditData(d => ({...d, applyToDorms: e.target.checked}))} className="rounded" />
                            <span className="text-xs text-gray-600">기숙사 적용</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={editData.applyToSurcharge ?? false} onChange={e => setEditData(d => ({...d, applyToSurcharge: e.target.checked}))} className="rounded" />
                            <span className="text-xs text-gray-600">서차지 적용</span>
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">조건 (주수 등)</label>
                          <input value={editData.condition ?? ''} onChange={e => setEditData(d => ({...d, condition: e.target.value}))}
                            className="input-field text-xs py-1.5" placeholder="예: 8주 등록 시 적용 (코스 학비만)" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 p-2 bg-amber-50 border border-amber-200 rounded">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">최소 주수 (숫자)</label>
                          <input type="number" value={editData.minWeeks ?? ''}
                            onChange={e => setEditData(d => ({...d, minWeeks: e.target.value === '' ? undefined : Number(e.target.value)}))}
                            className="input-field text-xs py-1.5" placeholder="예: 4" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">4주당 잔여 처리</label>
                          <select value={editData.blockMethod ?? ''}
                            onChange={e => setEditData(d => ({...d, blockMethod: (e.target.value || undefined) as 'floor'|'proportional'|undefined}))}
                            className="input-field text-xs py-1.5">
                            <option value="">(미설정)</option>
                            <option value="floor">4주 단위 내림</option>
                            <option value="proportional">비례 (1/N)</option>
                          </select>
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" checked={editData.methodConfirmed ?? false}
                              onChange={e => setEditData(d => ({...d, methodConfirmed: e.target.checked}))} className="rounded" />
                            <span>계산방식 확인됨</span>
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">할인 상세</label>
                        <textarea value={editData.details ?? ''} onChange={e => setEditData(d => ({...d, details: e.target.value}))}
                          className="input-field text-sm h-20 resize-none" placeholder="할인 내용 상세" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">메모</label>
                        <input value={editData.note ?? ''} onChange={e => setEditData(d => ({...d, note: e.target.value}))}
                          className="input-field text-sm" placeholder="메모" />
                      </div>

                      <div className="border border-red-200 rounded-xl p-3 bg-red-50/30 space-y-2">
                        <p className="text-xs font-semibold text-red-700">✂️ 이 프로모션 활성 시 유학원 할인</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">할인 유형</label>
                            <select value={editData.agencyDiscountType ?? ''}
                              onChange={e => setEditData(d => ({...d, agencyDiscountType: e.target.value as PromoEntry['agencyDiscountType']}))}
                              className="input-field text-xs py-1.5">
                              <option value="">학원 기본값 사용</option>
                              <option value="none">유학원 할인 없음</option>
                              <option value="percent">% 할인</option>
                              <option value="amount_per_week">주당 금액</option>
                              <option value="amount_per_4weeks">4주당 금액</option>
                              <option value="amount_flat">고정 금액</option>
                              <option value="reg_fee_only">등록비만 할인</option>
                            </select>
                          </div>
                          {editData.agencyDiscountType && editData.agencyDiscountType !== 'none' && editData.agencyDiscountType !== 'reg_fee_only' && (
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">
                                {editData.agencyDiscountType === 'percent' ? '할인율 (%)' : '금액 (원)'}
                              </label>
                              <input type="number" value={editData.agencyDiscountValue ?? ''}
                                onChange={e => setEditData(d => ({...d, agencyDiscountValue: Number(e.target.value)}))}
                                className="input-field text-xs py-1.5" placeholder="예: 10 또는 100000" />
                            </div>
                          )}
                          {editData.agencyDiscountType && editData.agencyDiscountType !== 'none' && (
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">등록비 할인 (원)</label>
                              <input type="number" value={editData.agencyDiscountRegFee ?? ''}
                                onChange={e => setEditData(d => ({...d, agencyDiscountRegFee: e.target.value ? Number(e.target.value) : undefined}))}
                                className="input-field text-xs py-1.5" placeholder="예: 100000" />
                            </div>
                          )}
                          {editData.agencyDiscountType && editData.agencyDiscountType !== 'none' && editData.agencyDiscountType !== 'reg_fee_only' && (
                            <div>
                              <label className="block text-xs text-gray-500 mb-1">적용 범위</label>
                              <select value={editData.agencyDiscountApplyTo ?? 'all'}
                                onChange={e => setEditData(d => ({...d, agencyDiscountApplyTo: e.target.value as PromoEntry['agencyDiscountApplyTo']}))}
                                className="input-field text-xs py-1.5">
                                <option value="all">전체</option>
                                <option value="all_with_surcharge">전체+서차지 (서차지 포함 할인)</option>
                                <option value="course_only">학비만</option>
                                <option value="dorm_only">기숙사만</option>
                                <option value="course_and_dorm">학비+기숙사</option>
                              </select>
                            </div>
                          )}
                          <div className="sm:col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">기준 시점 (차감 전/후)</label>
                            <select value={editData.agencyDiscountBase ?? 'after_discount'}
                              onChange={e => setEditData(d => ({...d, agencyDiscountBase: e.target.value as 'after_discount'|'before_discount'}))}
                              className="input-field text-xs py-1.5">
                              <option value="after_discount">학원 할인 차감 후 (기본)</option>
                              <option value="before_discount">학원 할인 차감 전 (원금)</option>
                            </select>
                            <p className="text-xs text-gray-400 mt-1">자료에 &quot;(학비+기숙사-장기할인-...)의 N%&quot; 같은 표현이 있으면 차감 후</p>
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">표시 메모</label>
                            <input value={editData.agencyDiscountNote ?? ''}
                              onChange={e => setEditData(d => ({...d, agencyDiscountNote: e.target.value}))}
                              className="input-field text-xs py-1.5" placeholder="예: CALA 10%, 등록비 10만원" />
                          </div>
                        </div>
                      </div>

                      <div className="border border-purple-200 rounded-xl p-3 bg-purple-50/30 space-y-2">
                        <p className="text-xs font-semibold text-purple-700">🔗 다른 프로모션과의 호환 관계</p>
                        <p className="text-xs text-gray-500">대부분 프로모션은 시기·대상으로 안 겹쳐 비워둠. 동시 적용될 수 있는 것만 명시. 프로모션 ID 쉼표 구분.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">중복 가능 (stackWith)</label>
                            <input
                              value={(editData.stackWith ?? []).join(', ')}
                              onChange={e => setEditData(d => ({
                                ...d,
                                stackWith: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                              }))}
                              className="input-field text-xs py-1.5" placeholder="예: cg_banilad_school_long_term" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">택일 (exclusiveWith)</label>
                            <input
                              value={(editData.exclusiveWith ?? []).join(', ')}
                              onChange={e => setEditData(d => ({
                                ...d,
                                exclusiveWith: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                              }))}
                              className="input-field text-xs py-1.5" placeholder="예: cij_low_h1_1plus1" />
                          </div>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={editData.relationConfirmed ?? false}
                            onChange={e => setEditData(d => ({...d, relationConfirmed: e.target.checked}))} className="rounded" />
                          <span>관계 확인됨 (체크 안 하면 동시 적용 시 미확인 경고)</span>
                        </label>
                      </div>

                      <div className="border border-orange-200 rounded-xl p-3 bg-orange-50/30 space-y-2">
                        <p className="text-xs font-semibold text-orange-700">🎯 적용 기숙사/코스 제한 (비워두면 전체 적용)</p>
                        <p className="text-xs text-gray-500">쉼표로 구분. 선택된 기숙사/코스 이름에 이 중 하나라도 포함되면 적용.</p>
                        <p className="text-xs text-gray-400">예: <code>IB1 2인실, IB2 2인실</code> 또는 <code>3인실</code></p>
                        <input
                          value={(editData.applicableItems ?? []).join(', ')}
                          onChange={e => setEditData(d => ({
                            ...d,
                            applicableItems: e.target.value ? e.target.value.split(',').map(s => s.trim()).filter(Boolean) : []
                          }))}
                          className="input-field text-xs py-1.5 w-full"
                          placeholder="비워두면 전체 적용" />
                      </div>

                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setEditId(null); setEditData({}); load() }}
                          className="btn-secondary text-sm px-4">취소</button>
                        <button onClick={() => handleSave({ ...p, ...editData } as PromoEntry)}
                          className="btn-primary text-sm px-4">저장</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 p-3 sm:p-4">
                      {/* 선택 모드 체크박스 */}
                      {selectMode && (
                        <button onClick={() => toggleOne(p.id)}
                          className="flex-shrink-0 mt-1 p-1 hover:bg-gray-100 rounded">
                          {selectedIds.has(p.id)
                            ? <CheckSquare size={18} className="text-red-600" />
                            : <Square size={18} className="text-gray-400" />}
                        </button>
                      )}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
                        <DdayBadge promo={p} />
                        <span className="text-xs text-gray-400">{p.region}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-gray-900 text-sm">{p.schoolName}</span>
                          {(() => {
                            const matched = findSchoolForPromo(
                              { schoolId: p.schoolId, schoolCode: p.schoolCode, schoolName: p.schoolName, region: p.region },
                              schools,
                              aliasIdx
                            )
                            if (matched) return null
                            return (
                              <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded flex items-center gap-1" title="이 프로모션은 schools 컬렉션의 어떤 학원과도 연결되어 있지 않습니다. 견적 봇에 노출되지 않습니다.">
                                <Link2 size={10} /> 미연결
                              </span>
                            )
                          })()}
                          <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{p.promoName}</span>
                          {p.note && <span className="text-xs text-orange-600">{p.note}</span>}
                          {p.agencyDiscountStatus === 'disabled'
                            ? <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded">유학원할인X</span>
                            : p.agencyDiscountStatus === 'unconfirmed'
                            ? <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded">유학원 확인 필요</span>
                            : p.agencyDiscountType === 'none'
                            ? <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded">유학원할인X</span>
                            : p.agencyDiscountType
                              ? <span className="text-xs px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded">
                                  ✂️ {p.agencyDiscountType === 'reg_fee_only' ? `등록비 ${p.agencyDiscountRegFee?.toLocaleString()}원` :
                                       p.agencyDiscountType === 'percent' ? `${p.agencyDiscountValue}%` :
                                       p.agencyDiscountType === 'amount_per_week' ? `${p.agencyDiscountValue?.toLocaleString()}원/주` :
                                       p.agencyDiscountType === 'amount_per_4weeks' ? `${p.agencyDiscountValue?.toLocaleString()}원/4주` :
                                       `${p.agencyDiscountValue?.toLocaleString()}원`}
                                  {p.agencyDiscountRegFee && p.agencyDiscountType !== 'reg_fee_only' ? ` + 등록비 ${p.agencyDiscountRegFee.toLocaleString()}원` : ''}
                                </span>
                              : <span className="text-xs text-gray-300">할인미설정</span>
                          }
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">{p.details || p.promoContent}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {p.alwaysApply
                            ? '상시 적용'
                            : hasNoDates
                            ? '기간 정보 없음'
                            : <>{p.basisType === 'enrollment_date' ? '등록일' : '연수시작일'} 기준 · {p.startDate} ~ {p.endDate}</>
                          }
                        </p>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => handleToggleActive(p)} title={p.active ? '비활성화' : '활성화'}
                          className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                          {p.active ? <Bell size={14} /> : <BellOff size={14} />}
                        </button>
                        <button onClick={() => { setEditId(p.id); setEditData({...p}) }}
                          className="p-2 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 text-xs">
                          수정
                        </button>
                        <button onClick={() => handleDelete(p.id)}
                          className="p-2 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {importDiff && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-2xl max-h-[90dvh] flex flex-col shadow-xl">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-900">가져오기 검토</h2>
              <button onClick={() => setImportDiff(null)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {importDiff.blocked ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{importDiff.blocked}</div>
              ) : (
                <>
                  <div className="flex gap-3 flex-wrap">
                    {importDiff.added.length > 0 && <span className="px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 text-sm rounded-full font-medium">✚ 신규 {importDiff.added.length}개</span>}
                    {importDiff.updated.length > 0 && <span className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-full font-medium">✎ 변경 {importDiff.updated.length}개</span>}
                    {importDiff.unchanged.length > 0 && <span className="px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-500 text-sm rounded-full">변경없음 {importDiff.unchanged.length}개</span>}
                  </div>

                  {importDiff.added.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-700 mb-2">✚ 새로 추가됨</p>
                      <div className="space-y-1.5">
                        {importDiff.added.map(p => (
                          <div key={p.id} className="px-3 py-2 bg-green-50 border border-green-200 rounded-xl text-sm">
                            <span className="font-medium">{p.schoolName}</span> · {p.promoName}
                            <span className="ml-2 text-xs text-green-600">{p.startDate}~{p.endDate}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {importDiff.updated.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-700 mb-2">✎ 변경됨</p>
                      <div className="space-y-2">
                        {importDiff.updated.map(({ before, after, changedFields }) => (
                          <div key={after.id} className="border border-amber-200 rounded-xl overflow-hidden">
                            <div className="px-3 py-2 bg-amber-50 text-sm font-medium text-amber-900">
                              {after.schoolName} · {after.promoName}
                            </div>
                            <div className="divide-y divide-gray-100">
                              {changedFields.map(f => (
                                <div key={f} className="px-3 py-2 flex gap-2 text-xs flex-wrap">
                                  <span className="text-gray-500 w-20 flex-shrink-0">{f}</span>
                                  <span className="text-red-500 line-through">{String((before as unknown as Record<string,unknown>)[f] ?? '')}</span>
                                  <span className="text-gray-400">→</span>
                                  <span className="text-green-700 font-medium">{String((after as unknown as Record<string,unknown>)[f] ?? '')}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {importDiff.added.length === 0 && importDiff.updated.length === 0 && (
                    <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">변경사항이 없습니다.</div>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
              <button onClick={() => setImportDiff(null)} className="flex-1 btn-secondary text-sm">취소</button>
              {!importDiff.blocked && (importDiff.added.length > 0 || importDiff.updated.length > 0) && (
                <button onClick={handleConfirmImport} disabled={importing}
                  className="flex-1 btn-primary text-sm disabled:opacity-40">
                  {importing ? '저장 중...' : `저장 (신규 ${importDiff.added.length} + 변경 ${importDiff.updated.length}개)`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

// ===== 학원별 표 (검증용) 뷰 =====
function PromoTableView({ promos, schools, onEdit, onDelete }: {
  promos: PromoEntry[]
  schools: School[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  // 학원코드(없으면 학원명) 기준으로 그룹핑
  const groups = new Map<string, PromoEntry[]>()
  for (const p of promos) {
    const key = p.schoolCode || p.schoolName || '미지정'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }

  const saveImage = async (groupKey: string) => {
    const el = document.getElementById(`promo-card-${groupKey}`)
    if (!el) return
    const h2c = (await import('html2canvas')).default
    const canvas = await h2c(el, { scale: 2, backgroundColor: '#ffffff' })
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `프로모션_${groupKey}_${new Date().toISOString().split('T')[0]}.png`
    a.click()
  }

  if (groups.size === 0) {
    return <div className="text-center py-12 text-gray-400">표시할 프로모션이 없습니다.</div>
  }

  // 각 그룹의 장기등록 할인(week_tiers) 프로모션을 찾아 장기할인 열에 공통 표시
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([groupKey, list]) => {
        const longTermPromo = list.find(p => p.discountType === 'week_tiers')
        const longTiers = longTermLabel(longTermPromo?.weekTiers)
        // 장기등록 전용 프로모션은 별도 행에서 제외(장기할인 열로 흡수), 단 그 외 행에 표시
        const rows = list.filter(p => p.discountType !== 'week_tiers')
        const liveCount = rows.filter(p => !isExpired(p)).length
        const expCount = rows.filter(p => isExpired(p)).length
        // 정렬: 현행 먼저, 만료 나중
        const sorted = [...rows].sort((a, b) => (isExpired(a) ? 1 : 0) - (isExpired(b) ? 1 : 0))

        return (
          <div key={groupKey} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center gap-2 bg-blue-900 text-white text-sm font-semibold px-4 py-1.5 rounded">
                {groupKey}
                <span className="bg-white/25 px-2 py-0.5 rounded-full text-xs">현행 {liveCount}{expCount > 0 ? ` · 만료 ${expCount}` : ''}</span>
              </span>
              <button onClick={() => saveImage(groupKey)}
                className="text-xs px-3 py-1.5 border border-blue-900 text-blue-900 rounded-md font-medium hover:bg-blue-50">
                📷 이 학원 이미지 저장
              </button>
            </div>

            <div className="overflow-x-auto">
            <div id={`promo-card-${groupKey}`} className="bg-white" style={{ minWidth: '1100px' }}>
              <table className="w-full text-xs border border-gray-200 rounded-lg overflow-hidden" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr className="bg-blue-50 text-blue-900">
                    <th className="px-2 py-2 border-b border-gray-200 text-center">프로모션</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">대상</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">프로모션 기간</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">조건</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">학원 할인</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">유학원 할인</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">장기 할인</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">계산 순서</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">업데이트</th>
                    <th className="px-2 py-2 border-b border-gray-200 text-center">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    return (
                      <tr className="bg-amber-50/30">
                        <td className="px-2 py-2.5 border-t border-gray-100 text-left align-middle">
                          <span className="font-bold text-gray-500">기본</span>
                          <span className="block text-[10px] text-gray-400 mt-0.5">할인 없음</span>
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle">전체</td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle">
                          <div className="text-gray-600">상시 적용</div>
                          <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">상시</span>
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-left align-middle text-gray-600">별도 조건 없음</td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle"><span className="text-gray-300">없음</span></td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle text-gray-400">프로모션별</td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-left align-middle">
                          {longTiers.length > 0 ? <span className="text-gray-700">{longTiers.join(' · ')}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 align-middle">
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-900">등록비＋학비＋기숙＋서차지</span>
                            {longTiers.length > 0 && <><span className="text-gray-300 text-[10px] font-bold">−</span><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700">장기</span></>}
                            <span className="text-gray-300 text-[10px] font-bold">−</span><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700">유학원할인</span>
                            <span className="text-gray-300 text-[10px] font-bold">−</span><span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700">입학금할인</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle text-gray-300">—</td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle text-gray-300">—</td>
                      </tr>
                    )
                  })()}
                  {sorted.map((p, i) => {
                    const expired = isExpired(p)
                    const dd = ddayInfo(p)
                    const ag = agencyDiscountLabel(p)
                    const sd = schoolDiscountLabel(p)
                    const toks = calcOrderTokens(p, longTiers.length > 0)
                    const ddColor = dd.cls === 'soon' ? 'bg-red-50 text-red-700' : dd.cls === 'ok' ? 'bg-green-50 text-green-700' : dd.cls === 'expired' ? 'bg-gray-200 text-gray-500' : 'bg-blue-50 text-blue-700'
                    return (
                      <tr key={p.id} className={expired ? 'opacity-50 bg-gray-50' : (i % 2 ? 'bg-slate-50/40' : '')}>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-left align-middle">
                          <span className="font-semibold text-blue-900">{p.promoName}</span>
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle">{p.target ?? '전체'}</td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle">
                          <div className="text-gray-600">{p.alwaysApply ? '상시 적용' : `${p.startDate ?? ''}${p.endDate ? ' ~ ' + p.endDate : ''}`}</div>
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${ddColor}`}>{dd.text}</span>
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-left align-middle text-gray-600 whitespace-pre-line">{p.condition || p.noteRaw || '별도 조건 없음'}</td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle">
                          {sd.main === '없음' ? <span className="text-gray-300">없음</span> : <><span className="text-red-700 font-bold">{sd.main}</span>{sd.sub && <span className="block text-[10px] text-gray-400 mt-0.5">{sd.sub}</span>}</>}
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle">
                          {ag.value === '없음' ? <span className="text-gray-300">없음</span> : <><span className="text-indigo-800 font-bold">{ag.value}</span>{ag.type && <span className="block text-[10px] text-gray-400 mt-0.5">{ag.type}</span>}</>}
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-left align-middle">
                          {longTiers.length > 0 ? <span className="text-gray-700">{longTiers.join(' · ')}</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 align-middle">
                          <div className="flex flex-wrap gap-1 items-center">
                            {toks.map((t, j) => (
                              <span key={j} className="inline-flex items-center gap-1">
                                {j > 0 && <span className="text-gray-300 text-[10px] font-bold">−</span>}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${t.kind === 'base' ? 'bg-blue-50 text-blue-900' : 'bg-red-50 text-red-700'}`}>{t.label}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle">
                          <span className="text-green-700 font-semibold text-[11px]">{p.updatedAt ? p.updatedAt.split('T')[0].slice(5) : '—'}</span>
                        </td>
                        <td className="px-2 py-2.5 border-t border-gray-100 text-center align-middle">
                          <div className="flex flex-col gap-1 items-center">
                            <button onClick={() => onEdit(p.id)} className="text-[10px] text-blue-900 border border-blue-200 px-2 py-0.5 rounded">수정</button>
                            <button onClick={() => onDelete(p.id)} className="text-[10px] text-red-600 border border-red-200 px-2 py-0.5 rounded">삭제</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">· 이 표를 학원에 전달해 확인받습니다 · 만료 프로모션은 흐리게 표시(보관) · 수정은 '수정' 버튼(편집 리스트로 이동)</p>
          </div>
        )
      })}
    </div>
  )
}
