'use client'
import { useEffect, useState } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { getSchools, saveSchool } from '@/lib/db'
import type { School, AgencyDiscount } from '@/types'
import { getDefaultDiscount } from './defaults'
import { Check, Save, ChevronDown, Info } from 'lucide-react'

type DiscountRow = {
  school: School
  draft: AgencyDiscount | undefined
  dirty: boolean
  saving: boolean
  saved: boolean
}

const PRESETS: { label: string; value: AgencyDiscount }[] = [
  { label: '학비+기숙사 10%', value: { type: 'percent', value: 10, applyTo: 'all', note: 'CALA 10%' } },
  { label: '학비+기숙사 15%', value: { type: 'percent', value: 15, applyTo: 'all', note: '비수기 최대 15%' } },
  { label: '4주당 10만원', value: { type: 'amount_per_week', value: 25000, maxAmount: 100000, applyTo: 'all', note: '4주당 10만원' } },
  { label: '없음', value: undefined as unknown as AgencyDiscount },
]

export default function DiscountsPage() {
  const [rows, setRows] = useState<DiscountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'set' | 'unset'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    getSchools().then(async schools => {
      // 미설정 학원에 기본값 즉시 저장
      const toUpdate: School[] = []
      const initialRows: DiscountRow[] = schools.map(s => {
        let discount = s.agencyDiscount
        if (!discount) {
          const def = getDefaultDiscount(s.name)
          if (def !== undefined) {
            discount = def ?? undefined
            if (discount !== undefined) {
              toUpdate.push({ ...s, agencyDiscount: discount })
            }
          }
        }
        return { school: { ...s, agencyDiscount: discount }, draft: discount, dirty: false, saving: false, saved: false }
      })
      setRows(initialRows)
      setLoading(false)

      // 백그라운드 저장
      if (toUpdate.length > 0) {
        await Promise.all(toUpdate.map(s => saveSchool(s)))
        // 저장 완료 후 rows 갱신
        setRows(prev => prev.map(r => ({ ...r, dirty: false })))
      }
    })
  }, [])

  const update = (idx: number, patch: Partial<DiscountRow>) =>
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))

  const updateDiscount = (idx: number, d: AgencyDiscount | undefined) =>
    update(idx, { draft: d, dirty: true, saved: false })

  const save = async (idx: number) => {
    const row = rows[idx]
    update(idx, { saving: true })
    const updated = { ...row.school, agencyDiscount: row.draft }
    await saveSchool(updated)
    update(idx, { school: updated, saving: false, saved: true, dirty: false })
    setTimeout(() => update(idx, { saved: false }), 2000)
  }

  const saveAll = async () => {
    const dirtyIdxs = rows.map((r, i) => r.dirty ? i : -1).filter(i => i >= 0)
    await Promise.all(dirtyIdxs.map(save))
  }

  const filtered = rows.filter(r => {
    if (filter === 'set'   && !r.draft) return false
    if (filter === 'unset' && r.draft)  return false
    if (search && !r.school.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const dirtyCount = rows.filter(r => r.dirty).length
  const setCount   = rows.filter(r => r.draft).length

  function DiscountEditor({ row, idx }: { row: DiscountRow; idx: number }) {
    const d = row.draft
    const set = (field: keyof AgencyDiscount, val: unknown) =>
      updateDiscount(idx, { ...(d ?? { type: 'percent', value: 0, applyTo: 'all', note: '' }), [field]: val } as AgencyDiscount)

    return (
      <div className="space-y-2">
        {/* 프리셋 */}
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p, pi) => (
            <button key={pi}
              onClick={() => updateDiscount(idx, p.value)}
              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                !d && !p.value ? 'bg-red-50 border-red-300 text-red-700' :
                d && p.value && d.type === p.value.type && d.value === p.value.value
                  ? 'bg-blue-100 border-blue-400 text-blue-800 font-semibold'
                  : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        {d && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-gray-50 rounded-lg p-2">
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">유형</label>
              <select value={d.type} onChange={e => set('type', e.target.value)}
                className="input-field text-xs py-1">
                <option value="percent">% 할인</option>
                <option value="amount_per_week">주당 금액</option>
                <option value="amount_flat">고정 금액</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">
                {d.type === 'percent' ? '할인율 (%)' : d.type === 'amount_per_week' ? '주당 금액 (원)' : '고정 금액 (원)'}
              </label>
              <input type="number" value={d.value} onChange={e => set('value', Number(e.target.value))}
                className="input-field text-xs py-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">적용범위</label>
              <select value={d.applyTo} onChange={e => set('applyTo', e.target.value)}
                className="input-field text-xs py-1">
                <option value="all">전체</option>
                <option value="course_only">학비만</option>
                <option value="dorm_only">기숙사만</option>
                <option value="package_only">패키지만</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-0.5">메모</label>
              <input value={d.note ?? ''} onChange={e => set('note', e.target.value)}
                className="input-field text-xs py-1" placeholder="예: CALA 10%" />
            </div>
            {d.type !== 'amount_flat' && (
              <div className="col-span-2">
                <label className="text-xs text-gray-500 block mb-0.5">최대 한도 (원, 선택)</label>
                <input type="number" value={d.maxAmount ?? ''} placeholder="없으면 비워두세요"
                  onChange={e => set('maxAmount', e.target.value ? Number(e.target.value) : undefined)}
                  className="input-field text-xs py-1" />
              </div>
            )}
          </div>
        )}

        {/* 미리보기 */}
        {d && (
          <div className="flex items-center gap-2">
            <span className="text-xs bg-red-50 border border-red-200 text-red-700 px-2 py-1 rounded-lg font-medium">
              ✂️ {d.type === 'percent' ? `${d.value}%` :
                  d.type === 'amount_per_week' ? `${d.value.toLocaleString()}원/주` :
                  `${d.value.toLocaleString()}원 고정`}
              {d.maxAmount ? ` (최대 ${d.maxAmount.toLocaleString()}원)` : ''}
              {' · '}{d.applyTo === 'all' ? '전체' : d.applyTo === 'course_only' ? '학비만' : d.applyTo === 'dorm_only' ? '기숙사만' : '패키지만'}
            </span>
            <button onClick={() => updateDiscount(idx, undefined)}
              className="text-xs text-red-400 hover:text-red-600">삭제</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">유학원 할인규정 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              설정: {setCount}개 · 미설정: {rows.length - setCount}개
              {dirtyCount > 0 && <span className="ml-2 text-orange-600 font-semibold">· 미저장 {dirtyCount}개</span>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {dirtyCount > 0 && (
              <button onClick={saveAll} className="btn-primary flex items-center gap-1.5 text-sm">
                <Save size={14} /> {dirtyCount}개 전체 저장
              </button>
            )}
          </div>
        </div>

        {/* 안내 */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex gap-2">
          <Info size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            여기서 설정한 할인은 <strong>견적 생성 시 자동 적용</strong>되어 빨간색으로 강조됩니다.
            학원이 허용하는 수수료 범위 내 최대 할인으로 설정하세요.
            <br/>
            <strong>유학원 할인X</strong>인 학원은 설정하지 않거나 "없음"으로 두세요.
          </p>
        </div>

        {/* 필터 */}
        <div className="flex gap-2 mb-4">
          <input value={search} onChange={e => setSearch(e.target.value)}
            className="input-field text-sm flex-1" placeholder="학원명 검색" />
          {(['all', 'set', 'unset'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-3 py-2 rounded-lg border transition-colors ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
              {f === 'all' ? '전체' : f === 'set' ? '✅ 설정됨' : '⬜ 미설정'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((row, fi) => {
              const idx = rows.indexOf(row)
              return (
                <div key={row.school.id}
                  className={`card rounded-xl border overflow-hidden ${row.dirty ? 'border-orange-300' : ''}`}>
                  <div className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 text-sm">{row.school.name}</span>
                          <span className="text-xs text-gray-400">{row.school.region}</span>
                          {row.draft
                            ? <span className="text-xs px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full">✂️ 할인 설정됨</span>
                            : <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded-full">미설정</span>
                          }
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        {row.dirty && (
                          <button onClick={() => save(idx)} disabled={row.saving}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors">
                            {row.saving ? '저장 중...' : <><Save size={11} /> 저장</>}
                          </button>
                        )}
                        {row.saved && (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <Check size={11} /> 저장됨
                          </span>
                        )}
                      </div>
                    </div>
                    <DiscountEditor row={row} idx={idx} />
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">검색 결과 없음</div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
