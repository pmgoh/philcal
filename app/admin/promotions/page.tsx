'use client'
import { useState, useEffect, useRef } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { getPromotions, savePromotion, deletePromotion, saveBatchPromotions, PromoEntry } from '@/lib/db'
import { v4 as uuid } from 'uuid'
import { Plus, Trash2, Upload, Bell, BellOff, Search, Filter, RefreshCw } from 'lucide-react'

const REGIONS = ['전체', '세부', '바기오', '마닐라', '기타']

function getDdays(endDate: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const end = new Date(endDate); end.setHours(0,0,0,0)
  return Math.ceil((end.getTime() - today.getTime()) / 86400000)
}

function DdayBadge({ endDate, active }: { endDate: string; active: boolean }) {
  if (!active) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">비활성</span>
  const d = getDdays(endDate)
  if (d < 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">만료</span>
  if (d === 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-600 text-white font-bold animate-pulse">D-day</span>
  if (d <= 7)  return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">D-{d}</span>
  if (d <= 14) return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-bold">D-{d}</span>
  if (d <= 30) return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">D-{d}</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">D-{d}</span>
}

function urgencyLevel(endDate: string, active: boolean): number {
  if (!active) return 999
  const d = getDdays(endDate)
  if (d < 0) return 998
  return d
}

export default function PromotionsPage() {
  const [promos, setPromos] = useState<PromoEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('전체')
  const [showExpired, setShowExpired] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<PromoEntry>>({})
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    const data = await getPromotions()
    setPromos(data.sort((a, b) => urgencyLevel(a.endDate, a.active) - urgencyLevel(b.endDate, b.active)))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = promos.filter(p => {
    const expired = getDdays(p.endDate) < 0
    if (!showExpired && expired) return false
    if (regionFilter !== '전체' && p.region !== regionFilter) return false
    if (search && !p.schoolName.toLowerCase().includes(search.toLowerCase()) &&
        !p.promoName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const urgentCount = promos.filter(p => p.active && getDdays(p.endDate) >= 0 && getDdays(p.endDate) <= 7).length
  const soonCount = promos.filter(p => p.active && getDdays(p.endDate) > 7 && getDdays(p.endDate) <= 30).length

  const handleSave = async (p: PromoEntry) => {
    await savePromotion(p)
    setEditId(null); setEditData({})
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return
    await deletePromotion(id); load()
  }

  const handleToggleActive = async (p: PromoEntry) => {
    await savePromotion({ ...p, active: !p.active }); load()
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const arr = (Array.isArray(data) ? data : [data]) as PromoEntry[]
      await saveBatchPromotions(arr)
      load()
      alert(`${arr.length}개 프로모션을 가져왔습니다.`)
    } catch { alert('JSON 파일 형식 오류') }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const addNew = () => {
    const id = uuid()
    const newPromo: PromoEntry = {
      id, schoolName: '', promoName: '', region: '세부',
      basisType: 'enrollment_date', startDate: '2026-01-01', endDate: '2026-12-31',
      discountType: 'amount', details: '', isUrgent: false, urgentDays: null, note: '',
      active: true, createdAt: new Date().toISOString(),
    }
    setPromos(prev => [newPromo, ...prev])
    setEditId(id); setEditData(newPromo)
  }

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900">프로모션 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              전체 {promos.filter(p => p.active && getDdays(p.endDate) >= 0).length}개 활성
              {urgentCount > 0 && <span className="ml-2 text-red-600 font-semibold">🔴 D-7 이내 {urgentCount}개</span>}
              {soonCount > 0 && <span className="ml-2 text-yellow-600 font-semibold">🟡 D-30 이내 {soonCount}개</span>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
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

        {/* 필터 */}
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

        {/* 테이블 */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : (
          <div className="space-y-2">
            {filtered.length === 0 && <div className="text-center py-12 text-gray-400">프로모션이 없습니다.</div>}
            {filtered.map(p => {
              const isEditing = editId === p.id
              const d = getDdays(p.endDate)
              const expired = d < 0

              return (
                <div key={p.id} className={`card rounded-xl border overflow-hidden transition-colors ${
                  expired || !p.active ? 'opacity-50' :
                  d <= 7 ? 'border-red-200 bg-red-50/30' :
                  d <= 14 ? 'border-orange-200 bg-orange-50/20' :
                  d <= 30 ? 'border-yellow-200 bg-yellow-50/20' : 'border-gray-200'
                }`}>
                  {isEditing ? (
                    // 편집 모드
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

                      {/* 유학원 할인 섹션 */}
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
                                <option value="course_only">학비만</option>
                                <option value="dorm_only">기숙사만</option>
                              </select>
                            </div>
                          )}
                          <div className="sm:col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">표시 메모</label>
                            <input value={editData.agencyDiscountNote ?? ''}
                              onChange={e => setEditData(d => ({...d, agencyDiscountNote: e.target.value}))}
                              className="input-field text-xs py-1.5" placeholder="예: CALA 10%, 등록비 10만원" />
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2 justify-end">
                        <button onClick={() => { setEditId(null); setEditData({}); load() }}
                          className="btn-secondary text-sm px-4">취소</button>
                        <button onClick={() => handleSave({ ...p, ...editData } as PromoEntry)}
                          className="btn-primary text-sm px-4">저장</button>
                      </div>
                    </div>
                  ) : (
                    // 보기 모드
                    <div className="flex items-start gap-3 p-3 sm:p-4">
                      {/* D-day 배지 */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0 w-16">
                        <DdayBadge endDate={p.endDate} active={p.active} />
                        <span className="text-xs text-gray-400">{p.region}</span>
                      </div>

                      {/* 내용 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-gray-900 text-sm">{p.schoolName}</span>
                          <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{p.promoName}</span>
                          {p.note && <span className="text-xs text-orange-600">{p.note}</span>}
                          {/* 유학원 할인 배지 */}
                          {p.agencyDiscountType === 'none'
                            ? <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded">유학원할인X</span>
                            : p.agencyDiscountType
                              ? <span className="text-xs px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded">
                                  ✂️ {p.agencyDiscountType === 'reg_fee_only' ? `등록비 ${p.agencyDiscountRegFee?.toLocaleString()}원` :
                                       p.agencyDiscountType === 'percent' ? `${p.agencyDiscountValue}%` :
                                       p.agencyDiscountType === 'amount_per_week' ? `${p.agencyDiscountValue?.toLocaleString()}원/주` :
                                       `${p.agencyDiscountValue?.toLocaleString()}원`}
                                  {p.agencyDiscountRegFee && p.agencyDiscountType !== 'reg_fee_only' ? ` + 등록비 ${p.agencyDiscountRegFee.toLocaleString()}원` : ''}
                                </span>
                              : <span className="text-xs text-gray-300">할인미설정</span>
                          }
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed line-clamp-2">{p.details}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {p.basisType === 'enrollment_date' ? '등록일' : '연수시작일'} 기준
                          {' '}· {p.startDate} ~ {p.endDate}
                        </p>
                      </div>

                      {/* 액션 */}
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
    </AdminLayout>
  )
}
