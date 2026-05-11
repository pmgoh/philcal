'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuid } from 'uuid'
import AdminLayout from '@/components/AdminLayout'
import { getSchool, saveSchool, deleteSchool } from '@/lib/db'
import type {
  School, Course, Dormitory, ShortTermRates,
  Surcharge, Promotion, PromotionBasis, LocalFee,
  Package, PackagePriceRow, PackageAdditionalRule,
  RegistrationFee, PriceIncrease,
  Region, SchoolType, ProgramTag, Currency
} from '@/types'
import { calcShortTermPrice } from '@/types'
import {
  Plus, Trash2, ChevronDown, ChevronUp, Save,
  ArrowLeft, AlertCircle, Check, Settings2, X
} from 'lucide-react'

const REGIONS: Region[] = ['세부', '바기오', '클락', '일로일로', '바콜로드', '마닐라', '기타']
const PROGRAM_TAGS: ProgramTag[] = [
  '성인일반', '가족연수', '주니어', 'IELTS', 'TOEIC', 'TOEFL',
  '비즈니스', '시니어', '골프', '워킹홀리데이', '공무원연수'
]
const CURRENCIES: Currency[] = ['KRW', 'PHP', 'USD']

const EMPTY_SCHOOL: Omit<School, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', region: '세부', schoolType: 'general', programTags: [],
  minWeeks: 4, allowShortTerm: false,
  courseShortTermRates: undefined,
  dormShortTermRates: undefined,
  registrationFee: undefined,
  priceIncrease: undefined,
  courses: [], dormitories: [],
  surcharges: [], promotions: [], localFees: [], packages: [],
  refundPolicy: '', dormitoryRules: '', generalNotes: '', isActive: true,
}

// undefined 등 Firestore 불가 값 제거
function cleanForFirestore(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(cleanForFirestore)
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, cleanForFirestore(v)])
    )
  }
  return obj
}

interface Props { schoolId?: string }

export default function SchoolForm({ schoolId }: Props) {
  const router = useRouter()
  const isNew = !schoolId

  const [school, setSchool] = useState<Omit<School, 'id' | 'createdAt' | 'updatedAt'>>(EMPTY_SCHOOL)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [openSection, setOpenSection] = useState<string>('basic')

  useEffect(() => {
    if (!isNew && schoolId) {
      getSchool(schoolId).then(s => {
        if (s) setSchool({
          ...s,
          programTags:    s.programTags    ?? [],
          // pricePerWeek → price4Weeks 마이그레이션
          courses: (s.courses ?? []).map(c => ({
            ...c,
            price4Weeks: (c as unknown as Record<string,number>).price4Weeks
              ?? (c as unknown as Record<string,number>).pricePerWeek
              ?? 0,
          })),
          dormitories: (s.dormitories ?? []).map(d => ({
            ...d,
            price4Weeks: (d as unknown as Record<string,number>).price4Weeks
              ?? (d as unknown as Record<string,number>).pricePerWeek
              ?? 0,
          })),
          surcharges:     s.surcharges     ?? [],
          promotions:     s.promotions     ?? [],
          localFees:      s.localFees      ?? [],
          packages:       s.packages       ?? [],
        })
        setLoading(false)
      })
    }
  }, [schoolId, isNew])

  const update = (field: string, value: unknown) =>
    setSchool(prev => ({ ...prev, [field]: value }))

  const handleSave = async () => {
    setSaving(true)
    try {
      const cleaned = cleanForFirestore({ ...school, ...(schoolId ? { id: schoolId } : {}) })
      await saveSchool(cleaned as Partial<School> & { id?: string })
      setSaved(true)
      setTimeout(() => { setSaved(false); if (isNew) router.push('/schools') }, 1500)
    } catch (e) {
      console.error(e)
      alert('저장 중 오류가 발생했습니다. 콘솔을 확인해주세요.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!schoolId) return
    if (!confirm(`"${school.name}"을 삭제할까요? 되돌릴 수 없습니다.`)) return
    await deleteSchool(schoolId)
    router.push('/schools')
  }

  if (loading) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    </AdminLayout>
  )

  const section = (id: string, title: string, badge?: number) => (
    <button
      onClick={() => setOpenSection(openSection === id ? '' : id)}
      className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="font-semibold text-gray-800">{title}</span>
        {badge !== undefined && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
            {badge}
          </span>
        )}
      </div>
      {openSection === id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
    </button>
  )

  return (
    <AdminLayout>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.back()} className="btn-secondary p-2">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">
              {isNew ? '학원 추가' : school.name || '학원 수정'}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">{isNew ? '새 캠퍼스를 등록합니다' : '학원 정보를 수정합니다'}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {!isNew && (
              <button onClick={() => {
                const exportData = { ...school }
                const blob = new Blob([JSON.stringify([exportData], null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${school.name}_${new Date().toISOString().split('T')[0]}.json`
                a.click()
                URL.revokeObjectURL(url)
              }} className="btn-secondary flex items-center gap-1.5 text-sm">
                <span>⬇</span> JSON 내보내기
              </button>
            )}
            {!isNew && <button onClick={handleDelete} className="btn-danger">삭제</button>}
            <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
              {saved ? <><Check size={14} /> 저장됨</> : saving ? '저장 중...' : <><Save size={14} /> 저장</>}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {/* ── 기본 정보 ── */}
          <div className="card overflow-hidden">
            {section('basic', '기본 정보')}
            {openSection === 'basic' && (
              <div className="px-5 pb-5 border-t border-gray-100 space-y-4 pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">학원명 *</label>
                    <input value={school.name} onChange={e => update('name', e.target.value)}
                      className="input-field" placeholder="예: BAGUIO JIC 챌린저캠퍼스" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">지역 *</label>
                    <select value={school.region} onChange={e => update('region', e.target.value as Region)} className="input-field">
                      {REGIONS.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">학원 형태</label>
                    <select value={school.schoolType} onChange={e => update('schoolType', e.target.value as SchoolType)} className="input-field">
                      <option value="general">일반 (주중외출 O)</option>
                      <option value="sparta">스파르타 (주중외출 X)</option>
                      <option value="both">일반+스파르타 둘 다</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">최소 수강 주수</label>
                    <input type="number" min={1} value={school.minWeeks}
                      onChange={e => update('minWeeks', Number(e.target.value))} className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">4주 미만 등록</label>
                    <select value={school.allowShortTerm ? 'yes' : 'no'}
                      onChange={e => update('allowShortTerm', e.target.value === 'yes')} className="input-field">
                      <option value="no">불가</option>
                      <option value="yes">가능</option>
                    </select>
                  </div>
                </div>
                {/* 단기가 설정 — 4주 미만 등록 가능일 때만 표시 */}
                {school.allowShortTerm && (
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">코스 단기가 설정 <span className="text-xs text-gray-400">(전체 코스 공통 적용)</span></p>
                      <ShortTermRatesEditor
                        price4Weeks={school.courses[0]?.price4Weeks ?? 0}
                        rates={school.courseShortTermRates}
                        onChange={r => update('courseShortTermRates', r)}
                        label="코스"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-2">기숙사 단기가 설정 <span className="text-xs text-gray-400">(전체 기숙사 공통 적용)</span></p>
                      <ShortTermRatesEditor
                        price4Weeks={school.dormitories[0]?.price4Weeks ?? 0}
                        rates={school.dormShortTermRates}
                        onChange={r => update('dormShortTermRates', r)}
                        label="기숙사"
                      />
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">지원 프로그램</label>
                  <div className="flex flex-wrap gap-2">
                    {PROGRAM_TAGS.map(tag => {
                      const active = (school.programTags ?? []).includes(tag)
                      return (
                        <button key={tag} type="button"
                          onClick={() => update('programTags', active
                            ? school.programTags.filter(t => t !== tag)
                            : [...(school.programTags ?? []), tag]
                          )}
                          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
                        >{tag}</button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── 등록비 ── */}
          <div className="card overflow-hidden">
            {section('regFee', '등록비')}
            {openSection === 'regFee' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs text-gray-500">1회성 등록비. 현지납부비(PHP)와 별도로 견적 총액에 포함됩니다.</p>
                <RegistrationFeeEditor
                  fee={school.registrationFee}
                  onChange={v => update('registrationFee', v)}
                />
              </div>
            )}
          </div>

          {/* ── 엠버시 자체 할인 ── */}
          <div className="card overflow-hidden">
            {section('agencyDiscount', '✂️ 엠버시 자체 할인 규칙')}
            {openSection === 'agencyDiscount' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
                <p className="text-xs text-gray-500 bg-red-50 border border-red-100 rounded-lg p-3">
                  견적 시 자동 적용되어 <span className="text-red-600 font-semibold">빨간색으로 강조</span> 표시됩니다.
                  학원 수수료 범위 내에서 우리가 줄 수 있는 최대 할인을 설정하세요.
                </p>
                {school.agencyDiscount ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">할인 유형</label>
                        <select value={school.agencyDiscount.type}
                          onChange={e => update('agencyDiscount', { ...school.agencyDiscount!, type: e.target.value as 'percent' | 'amount_per_week' | 'amount_flat' })}
                          className="input-field text-sm">
                          <option value="percent">퍼센트 (%)</option>
                          <option value="amount_per_week">주당 금액 (원/주)</option>
                          <option value="amount_flat">고정 금액 (원)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">
                          {school.agencyDiscount.type === 'percent' ? '할인율 (%)' :
                           school.agencyDiscount.type === 'amount_per_week' ? '주당 금액 (원)' : '고정 금액 (원)'}
                        </label>
                        <input type="number" value={school.agencyDiscount.value}
                          onChange={e => update('agencyDiscount', { ...school.agencyDiscount!, value: Number(e.target.value) })}
                          className="input-field text-sm"
                          placeholder={school.agencyDiscount.type === 'percent' ? '예: 5 (5%)'  : '예: 100000'} />
                      </div>
                      {school.agencyDiscount.type !== 'amount_flat' && (
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">최대 한도 (원, 선택)</label>
                          <input type="number" value={school.agencyDiscount.maxAmount ?? ''}
                            onChange={e => update('agencyDiscount', { ...school.agencyDiscount!, maxAmount: e.target.value ? Number(e.target.value) : undefined })}
                            className="input-field text-sm" placeholder="예: 200000" />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">적용 범위</label>
                        <select value={school.agencyDiscount.applyTo}
                          onChange={e => update('agencyDiscount', { ...school.agencyDiscount!, applyTo: e.target.value as 'all' | 'course_only' | 'dorm_only' | 'package_only' })}
                          className="input-field text-sm">
                          <option value="all">전체 (학비+기숙사+패키지)</option>
                          <option value="course_only">학비만</option>
                          <option value="dorm_only">기숙사만</option>
                          <option value="package_only">패키지만</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-gray-500 mb-1">설명 메모 (견적서에 표시)</label>
                        <input value={school.agencyDiscount.note}
                          onChange={e => update('agencyDiscount', { ...school.agencyDiscount!, note: e.target.value })}
                          className="input-field text-sm" placeholder="예: 수수료 25% 내 최대 할인" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                      <div className="flex-1 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-red-600 font-medium">✂️ 설정된 할인 규칙</p>
                        <p className="text-xs text-red-700 mt-0.5">
                          {school.agencyDiscount.type === 'percent' ? `${school.agencyDiscount.value}%` :
                           school.agencyDiscount.type === 'amount_per_week' ? `주당 ${school.agencyDiscount.value.toLocaleString()}원` :
                           `${school.agencyDiscount.value.toLocaleString()}원 고정`}
                          {school.agencyDiscount.maxAmount ? ` (최대 ${school.agencyDiscount.maxAmount.toLocaleString()}원)` : ''}
                          {' · '}{school.agencyDiscount.applyTo === 'all' ? '전체' :
                           school.agencyDiscount.applyTo === 'course_only' ? '학비만' :
                           school.agencyDiscount.applyTo === 'dorm_only' ? '기숙사만' : '패키지만'}
                        </p>
                        {school.agencyDiscount.note && <p className="text-xs text-red-500 mt-0.5">{school.agencyDiscount.note}</p>}
                      </div>
                      <button onClick={() => update('agencyDiscount', undefined)}
                        className="btn-danger text-xs px-3 py-2">삭제</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => update('agencyDiscount', { type: 'percent', value: 0, applyTo: 'all', note: '' })}
                    className="btn-secondary text-sm flex items-center gap-2">
                    + 자체 할인 규칙 추가
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── 비용 인상 ── */}
          <div className="card overflow-hidden">
            {section('priceIncrease', '비용 인상 예정')}
            {openSection === 'priceIncrease' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-500 mb-3">
                  설정한 날짜가 되면 코스·기숙사 가격에 자동 반영됩니다. 반영 후 "기본가에 적용" 버튼으로 정리하세요.
                </p>
                <PriceIncreaseEditor
                  pi={school.priceIncrease}
                  courses={school.courses}
                  dormitories={school.dormitories}
                  onChange={v => update('priceIncrease', v)}
                  onApply={async () => {
                    if (!school.priceIncrease) return
                    if (!confirm('코스·기숙사 기본가에 인상분을 반영하고 인상 설정을 초기화할까요?')) return
                    const pi = school.priceIncrease
                    const toKrwSimple = (a: number, cur: string) =>
                      cur === 'USD' ? a * 1380 : cur === 'PHP' ? a * 25 : a
                    update('courses', school.courses.map(c => {
                      const item = pi.courses.find(x => x.id === c.id)
                      if (!item || item.add === 0) return c
                      const base = (c as unknown as Record<string,number>).price4Weeks ?? 0
                      return { ...c, price4Weeks: base + toKrwSimple(item.add, pi.currency) * 4 }
                    }))
                    update('dormitories', school.dormitories.map(d => {
                      const item = pi.dormitories.find(x => x.id === d.id)
                      if (!item || item.add === 0) return d
                      const base = (d as unknown as Record<string,number>).price4Weeks ?? 0
                      return { ...d, price4Weeks: base + toKrwSimple(item.add, pi.currency) * 4 }
                    }))
                    update('priceIncrease', undefined)
                  }}
                />
              </div>
            )}
          </div>

          {/* ── 코스 ── */}
          <div className="card overflow-hidden">
            {section('courses', '코스', school.courses.length)}
            {openSection === 'courses' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs text-gray-500">
                  주당 가격(4주 기준)을 입력하세요. 4주 미만 단기가는 각 코스 행의 <strong>단기가 설정</strong>에서 입력합니다.
                </p>
                {school.courses.map((course, i) => (
                  <CourseRow
                    key={course.id} course={course}
                    onChange={c => update('courses', school.courses.map((x, j) => j === i ? c : x))}
                    onDelete={() => update('courses', school.courses.filter((_, j) => j !== i))}
                  />
                ))}
                <button onClick={() => update('courses', [...school.courses, {
                  id: uuid(), name: '', target: '성인', price4Weeks: 0, currency: 'KRW'
                }])} className="btn-secondary flex items-center gap-2 text-sm w-full justify-center py-2.5 border-dashed">
                  <Plus size={14} /> 코스 추가
                </button>
              </div>
            )}
          </div>

          {/* ── 기숙사 ── */}
          <div className="card overflow-hidden">
            {section('dormitories', '기숙사', school.dormitories.length)}
            {openSection === 'dormitories' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs text-gray-500">특정 기간만 운영하는 기숙사는 운영기간을 입력하세요.</p>
                {school.dormitories.map((dorm, i) => (
                  <DormRow
                    key={dorm.id} dorm={dorm}
                    onChange={d => update('dormitories', school.dormitories.map((x, j) => j === i ? d : x))}
                    onDelete={() => update('dormitories', school.dormitories.filter((_, j) => j !== i))}
                  />
                ))}
                <button onClick={() => update('dormitories', [...school.dormitories, {
                  id: uuid(), name: '', target: '성인', price4Weeks: 0, currency: 'KRW'
                }])} className="btn-secondary flex items-center gap-2 text-sm w-full justify-center py-2.5 border-dashed">
                  <Plus size={14} /> 기숙사 추가
                </button>
              </div>
            )}
          </div>

          {/* ── 서차지 ── */}
          <div className="card overflow-hidden">
            {section('surcharges', '성수기 서차지', school.surcharges.length)}
            {openSection === 'surcharges' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                {school.surcharges.map((s, i) => (
                  <SurchargeRow key={s.id} surcharge={s}
                    onChange={v => update('surcharges', school.surcharges.map((x, j) => j === i ? v : x))}
                    onDelete={() => update('surcharges', school.surcharges.filter((_, j) => j !== i))}
                  />
                ))}
                <button onClick={() => update('surcharges', [...school.surcharges, {
                  id: uuid(), label: '', startDate: '', endDate: '',
                  price4Weeks: 50000, currency: 'KRW', discountAllowed: true
                }])} className="btn-secondary flex items-center gap-2 text-sm w-full justify-center py-2.5 border-dashed">
                  <Plus size={14} /> 서차지 추가
                </button>
              </div>
            )}
          </div>

          {/* ── 프로모션 ── */}
          <div className="card overflow-hidden">
            {section('promotions', '프로모션 / 할인', school.promotions.length)}
            {openSection === 'promotions' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                {school.promotions.map((p, i) => (
                  <PromotionRow key={p.id} promotion={p}
                    onChange={v => update('promotions', school.promotions.map((x, j) => j === i ? v : x))}
                    onDelete={() => update('promotions', school.promotions.filter((_, j) => j !== i))}
                  />
                ))}
                <button onClick={() => update('promotions', [...school.promotions, {
                  id: uuid(), label: '', basisType: 'start_date' as const,
                  alwaysApply: false,
                  startDate: '', endDate: '', discountType: 'percent' as const,
                  discountValue: 10,
                  applyToCourses: true, applyToDorms: true, applyToSurcharge: false,
                }])} className="btn-secondary flex items-center gap-2 text-sm w-full justify-center py-2.5 border-dashed">
                  <Plus size={14} /> 프로모션 추가
                </button>
              </div>
            )}
          </div>

          {/* ── 현지납부비 ── */}
          <div className="card overflow-hidden">
            {section('localFees', '현지납부비 (PHP)', school.localFees.length)}
            {openSection === 'localFees' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs text-gray-500">SSP, I-CARD, 비자연장비, 교재비 등</p>
                {school.localFees.map((lf, i) => (
                  <LocalFeeRow key={lf.id} fee={lf}
                    onChange={v => update('localFees', school.localFees.map((x, j) => j === i ? v : x))}
                    onDelete={() => update('localFees', school.localFees.filter((_, j) => j !== i))}
                  />
                ))}
                <button onClick={() => update('localFees', [...school.localFees, { id: uuid(), name: '', amount: 0, currency: 'PHP' as Currency, trigger: 'always' as const, chargeUnit: 'flat' as const }])}
                  className="btn-secondary flex items-center gap-2 text-sm w-full justify-center py-2.5 border-dashed">
                  <Plus size={14} /> 항목 추가
                </button>
              </div>
            )}
          </div>

          {/* ── 패키지 ── */}
          <div className="card overflow-hidden">
            {section('packages', '패키지 (가족연수 등)', school.packages.length)}
            {openSection === 'packages' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
                <p className="text-xs text-gray-500">
                  가족연수, 올인클루시브 등 별도 패키지 상품. 주수×인원 행렬로 가격 입력 가능합니다.
                </p>
                {school.packages.map((pkg, i) => (
                  <PackageRow key={pkg.id} pkg={pkg}
                    onChange={v => update('packages', school.packages.map((x, j) => j === i ? v : x))}
                    onDelete={() => update('packages', school.packages.filter((_, j) => j !== i))}
                  />
                ))}
                <button onClick={() => update('packages', [...school.packages, {
                  id: uuid(),
                  label: '',
                  season: '연중',
                  currency: 'KRW' as Currency,
                  columns: ['1인'],
                  priceMatrix: [{ weeks: 4, prices: [{ label: '1인', amount: 0 }] }],
                  additionalRules: [],
                  includes: '',
                  excludes: '',
                }])} className="btn-secondary flex items-center gap-2 text-sm w-full justify-center py-2.5 border-dashed">
                  <Plus size={14} /> 패키지 추가
                </button>
              </div>
            )}
          </div>

          {/* ── 규정 ── */}
          <div className="card overflow-hidden">
            {section('rules', '규정 안내 텍스트')}
            {openSection === 'rules' && (
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
                {[
                  { field: 'refundPolicy', label: '환불 규정' },
                  { field: 'dormitoryRules', label: '기숙사 규정' },
                  { field: 'generalNotes', label: '기타 유의사항' },
                ].map(({ field, label }) => (
                  <div key={field}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                    <textarea
                      value={(school as unknown as Record<string, string>)[field] ?? ''}
                      onChange={e => update(field, e.target.value)}
                      className="input-field h-32 resize-y"
                      placeholder={`${label}을 자유롭게 입력하세요...`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => router.back()} className="btn-secondary">취소</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
            {saved ? <><Check size={14} /> 저장됨</> : saving ? '저장 중...' : <><Save size={14} /> 저장하기</>}
          </button>
        </div>
      </div>
    </AdminLayout>
  )
}

// ── 단기가 설정 서브컴포넌트 ──────────────────────────────────────────────────
function ShortTermRatesEditor({ price4Weeks, rates, onChange, label = '' }: {
  price4Weeks: number
  rates?: ShortTermRates
  onChange: (r: ShortTermRates | undefined) => void
  label?: string
}) {
  const enabled = !!rates
  const r = rates ?? { mode: 'percent', week1: 40, week2: 65, week3: 80, week4Included: false }

  const toggle = () => onChange(enabled ? undefined : r)
  const set = (patch: Partial<ShortTermRates>) => onChange({ ...r, ...patch })

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <div className="flex items-center gap-2 mb-2">
        <button type="button" onClick={toggle}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${enabled ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'}`}>
          <Settings2 size={11} />
          {label} 단기가 설정 {enabled ? '켜짐' : '꺼짐'}
        </button>
        {enabled && (
          <div className="flex gap-1">
            <button type="button" onClick={() => set({ mode: 'percent' })}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${r.mode === 'percent' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-300'}`}>
              4주가격의 %
            </button>
            <button type="button" onClick={() => set({ mode: 'fixed' })}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${r.mode === 'fixed' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-300'}`}>
              주당 고정금액
            </button>
          </div>
        )}
      </div>

      {enabled && (
        <div className="space-y-2">
          {r.mode === 'percent' && (
            <p className="text-xs text-gray-400">각 코스·기숙사 4주 가격의 몇 %를 받을지 입력하세요.</p>
          )}
          {r.mode === 'fixed' && (
            <p className="text-xs text-gray-400">주당 고정금액 입력 시 모든 코스·기숙사에 동일 금액이 적용됩니다.</p>
          )}
          <div className="grid grid-cols-4 gap-2">
          {([1, 2, 3, 4] as const).map(w => {
            const isWeek4 = w === 4
            const fieldKey = `week${w}` as 'week1' | 'week2' | 'week3' | 'week4'
            const val = isWeek4 ? (r.week4 ?? 0) : r[fieldKey as 'week1' | 'week2' | 'week3']

            return (
              <div key={w} className={`rounded-lg p-2 ${isWeek4 && !r.week4Included ? 'bg-gray-50 opacity-50' : 'bg-indigo-50'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">{w}주</span>
                  {isWeek4 && (
                    <input type="checkbox" checked={r.week4Included}
                      onChange={e => set({ week4Included: e.target.checked })}
                      className="w-3 h-3 accent-indigo-600" title="4주도 별도 설정" />
                  )}
                </div>
                {(!isWeek4 || r.week4Included) ? (
                  <div>
                    <input
                      type="number"
                      value={val}
                      onChange={e => {
                        const n = Number(e.target.value)
                        if (isWeek4) set({ week4: n })
                        else set({ [fieldKey]: n } as Partial<ShortTermRates>)
                      }}
                      className="w-full text-xs border border-indigo-200 rounded px-1.5 py-1 bg-white text-right"
                      placeholder="0"
                    />
                    <p className="text-xs text-indigo-500 text-right mt-0.5">
                      {r.mode === 'percent' ? `${val}%` : `${(val as number).toLocaleString()}원/주`}
                    </p>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 py-1 text-center">4주가격 그대로</div>
                )}
              </div>
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── CourseRow ──────────────────────────────────────────────────────────────────
function CourseRow({ course, onChange, onDelete }: {
  course: Course
  onChange: (c: Course) => void; onDelete: () => void
}) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg">
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2 items-end">
        <div className="col-span-6 md:col-span-3">
          <label className="block text-xs text-gray-500 mb-1">코스명</label>
          <input value={course.name} onChange={e => onChange({ ...course, name: e.target.value })}
            className="input-field text-sm" placeholder="인텐시브" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">대상</label>
          <input value={course.target} onChange={e => onChange({ ...course, target: e.target.value })}
            className="input-field text-sm" placeholder="성인" />
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="block text-xs text-gray-500 mb-1">4주 기준 가격</label>
          <input type="number" value={(course as unknown as Record<string,number>).price4Weeks ?? (course as unknown as Record<string,number>).pricePerWeek ?? 0}
            onChange={e => onChange({ ...course, price4Weeks: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">통화</label>
          <select value={course.currency} onChange={e => onChange({ ...course, currency: e.target.value as Currency })}
            className="input-field text-sm">
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">메모</label>
          <input value={course.note ?? ''} onChange={e => onChange({ ...course, note: e.target.value })}
            className="input-field text-sm" placeholder="-" />
        </div>
        <div className="col-span-1 flex justify-end">
          <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

    </div>
  )
}

// ── DormRow ────────────────────────────────────────────────────────────────────
function DormRow({ dorm, onChange, onDelete }: {
  dorm: Dormitory
  onChange: (d: Dormitory) => void; onDelete: () => void
}) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2">
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2 items-end">
        <div className="col-span-6 md:col-span-3">
          <label className="block text-xs text-gray-500 mb-1">기숙사명</label>
          <input value={dorm.name} onChange={e => onChange({ ...dorm, name: e.target.value })}
            className="input-field text-sm" placeholder="1인실" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">대상</label>
          <input value={dorm.target} onChange={e => onChange({ ...dorm, target: e.target.value })}
            className="input-field text-sm" placeholder="성인" />
        </div>
        <div className="col-span-6 md:col-span-3">
          <label className="block text-xs text-gray-500 mb-1">4주 기준 가격</label>
          <input type="number" value={(dorm as unknown as Record<string,number>).price4Weeks ?? (dorm as unknown as Record<string,number>).pricePerWeek ?? 0}
            onChange={e => onChange({ ...dorm, price4Weeks: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">통화</label>
          <select value={dorm.currency} onChange={e => onChange({ ...dorm, currency: e.target.value as Currency })}
            className="input-field text-sm">
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-3 md:col-span-2 flex justify-end items-end">
          <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">운영 시작 (MM-DD, 없으면 빈칸)</label>
          <input value={dorm.operationPeriod?.startDate ?? ''}
            onChange={e => onChange({ ...dorm, operationPeriod: { startDate: e.target.value, endDate: dorm.operationPeriod?.endDate ?? '' } })}
            className="input-field text-sm" placeholder="07-01" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">운영 종료</label>
          <input value={dorm.operationPeriod?.endDate ?? ''}
            onChange={e => onChange({ ...dorm, operationPeriod: { startDate: dorm.operationPeriod?.startDate ?? '', endDate: e.target.value } })}
            className="input-field text-sm" placeholder="08-31" />
        </div>
      </div>

    </div>
  )
}

// ── SurchargeRow ───────────────────────────────────────────────────────────────
function SurchargeRow({ surcharge, onChange, onDelete }: {
  surcharge: Surcharge; onChange: (s: Surcharge) => void; onDelete: () => void
}) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2">
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2 items-end">
        <div className="col-span-6 md:col-span-3">
          <label className="block text-xs text-gray-500 mb-1">구분명</label>
          <input value={surcharge.label} onChange={e => onChange({ ...surcharge, label: e.target.value })}
            className="input-field text-sm" placeholder="2026 여름 서차지" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">시작일</label>
          <input type="date" value={surcharge.startDate} onChange={e => onChange({ ...surcharge, startDate: e.target.value })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">종료일</label>
          <input type="date" value={surcharge.endDate} onChange={e => onChange({ ...surcharge, endDate: e.target.value })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">주당 금액</label>
          <input type="number" value={surcharge.pricePerWeek}
            onChange={e => onChange({ ...surcharge, pricePerWeek: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">통화</label>
          <select value={surcharge.currency} onChange={e => onChange({ ...surcharge, currency: e.target.value as Currency })}
            className="input-field text-sm">
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">할인 적용</label>
          <select value={surcharge.discountAllowed ? 'yes' : 'no'}
            onChange={e => onChange({ ...surcharge, discountAllowed: e.target.value === 'yes' })}
            className="input-field text-sm">
            <option value="yes">가능</option>
            <option value="no">불가</option>
          </select>
        </div>
        <div className="col-span-1 md:col-span-1 flex justify-end items-end">
          <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PromotionRow ───────────────────────────────────────────────────────────────
function PromotionRow({ promotion, onChange, onDelete }: {
  promotion: Promotion; onChange: (p: Promotion) => void; onDelete: () => void
}) {
  const toCourses   = promotion.applyToCourses   !== false
  const toDorms     = promotion.applyToDorms     !== false
  const toSurcharge = promotion.applyToSurcharge === true

  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2">
      {/* 프로모션명 + 할인 + 삭제 */}
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2 items-end">
        <div className="col-span-5">
          <label className="block text-xs text-gray-500 mb-1">프로모션명</label>
          <input value={promotion.label} onChange={e => onChange({ ...promotion, label: e.target.value })}
            className="input-field text-sm" placeholder="유학원 자체 할인 / 비수기 할인" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">타입</label>
          <select value={promotion.discountType} onChange={e => onChange({ ...promotion, discountType: e.target.value as 'percent' | 'amount' })}
            className="input-field text-sm">
            <option value="percent">%</option>
            <option value="amount">금액</option>
          </select>
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">{promotion.discountType === 'percent' ? '할인 %' : '할인 금액'}</label>
          <input type="number" value={promotion.discountValue}
            onChange={e => onChange({ ...promotion, discountValue: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-2" />
        <div className="col-span-1 md:col-span-1 flex justify-end items-end">
          <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 항상 적용 토글 + 날짜 */}
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2 items-end">
        <div className="col-span-2 flex items-center gap-2 pb-1">
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 cursor-pointer">
            <input type="checkbox" checked={!!promotion.alwaysApply}
              onChange={e => onChange({ ...promotion, alwaysApply: e.target.checked })}
              className="w-3.5 h-3.5 accent-blue-600" />
            항상 적용
          </label>
        </div>
        {!promotion.alwaysApply && (
          <>
            <div className="col-span-3 md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">기준일</label>
              <select value={promotion.basisType} onChange={e => onChange({ ...promotion, basisType: e.target.value as Promotion['basisType'] })}
                className="input-field text-sm">
                <option value="start_date">연수 시작일</option>
                <option value="enrollment_date">등록일</option>
                <option value="contract_date">계약일</option>
                <option value="departure_date">출국일</option>
              </select>
            </div>
            <div className="col-span-3 md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">시작일</label>
              <input type="date" value={promotion.startDate} onChange={e => onChange({ ...promotion, startDate: e.target.value })}
                className="input-field text-sm" />
            </div>
            <div className="col-span-3 md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">종료일</label>
              <input type="date" value={promotion.endDate} onChange={e => onChange({ ...promotion, endDate: e.target.value })}
                className="input-field text-sm" />
            </div>
          </>
        )}
        {promotion.alwaysApply && (
          <div className="col-span-6 flex items-end pb-1">
            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">날짜 무관하게 항상 적용됩니다</span>
          </div>
        )}
      </div>

      {/* 적용 대상 + 조건 */}
      <div className="flex items-center gap-4 flex-wrap pt-1">
        <span className="text-xs text-gray-500 font-medium">적용 대상:</span>
        {[
          { key: 'applyToCourses', label: '코스 학비', checked: toCourses },
          { key: 'applyToDorms',   label: '기숙사비', checked: toDorms },
          { key: 'applyToSurcharge', label: '서차지', checked: toSurcharge },
        ].map(({ key, label, checked }) => (
          <label key={key} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={checked}
              onChange={e => onChange({ ...promotion, [key]: e.target.checked })}
              className="w-3.5 h-3.5 accent-blue-600" />
            {label}
          </label>
        ))}
        <div className="flex-1 min-w-32">
          <input value={promotion.condition ?? ''} onChange={e => onChange({ ...promotion, condition: e.target.value })}
            className="input-field text-xs py-1.5" placeholder="조건 메모 (예: 12주 이상)" />
        </div>
      </div>
    </div>
  )
}

// ── LocalFeeRow ────────────────────────────────────────────────────────────────
const TRIGGER_OPTIONS = [
  { value: 'always',     label: '입국 시 1회',     desc: '도착 후 무조건 1회 납부' },
  { value: 'per_week',   label: '주당',            desc: '연수 주수 × 금액' },
  { value: 'per_4weeks', label: '4주당',           desc: '4주마다 1회 (올림 계산)' },
  { value: 'over_weeks', label: 'N주 초과 시 1회', desc: '기준 주수 초과 시 발생 (비자연장 등)' },
  { value: 'optional',   label: '선택 (미포함)',   desc: '참고용, 총액 미포함' },
] as const

const CHARGE_UNIT_OPTIONS = [
  { value: 'flat',       label: '고정 (팀/방)' },
  { value: 'per_person', label: '인당' },
  { value: 'per_trip',   label: '편도당' },
  { value: 'per_night',  label: '박당' },
] as const

function LocalFeeRow({ fee, onChange, onDelete }: {
  fee: LocalFee; onChange: (f: LocalFee) => void; onDelete: () => void
}) {
  const trigger    = fee.trigger ?? 'always'
  const chargeUnit = fee.chargeUnit ?? 'flat'
  const isOptional = trigger === 'optional'

  const triggerDesc = TRIGGER_OPTIONS.find(t => t.value === trigger)?.desc ?? ''

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isOptional ? 'border-gray-200 bg-gray-50' : 'border-indigo-100 bg-indigo-50/30'}`}>
      {/* 행 1: 항목명 + 금액 + 범위최대 + 통화 + 삭제 */}
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2 items-end">
        <div className="col-span-6 md:col-span-4">
          <label className="block text-xs text-gray-500 mb-1">항목명</label>
          <input value={fee.name} onChange={e => onChange({ ...fee, name: e.target.value })}
            className="input-field text-sm" placeholder="SSP, 비자연장비, 셔틀비..." />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">금액</label>
          <input type="number" value={fee.amount} min={0}
            onChange={e => onChange({ ...fee, amount: Number(e.target.value) })}
            className="input-field text-sm text-right" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">최대 (범위)</label>
          <input type="number" value={fee.amountMax ?? ''} min={0}
            onChange={e => onChange({ ...fee, amountMax: e.target.value ? Number(e.target.value) : undefined })}
            className="input-field text-sm text-right" placeholder="없으면 비움" />
        </div>
        <div className="col-span-3 md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">통화</label>
          <select value={fee.currency ?? 'PHP'}
            onChange={e => onChange({ ...fee, currency: e.target.value as Currency })}
            className="input-field text-sm">
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-3 md:col-span-2 flex justify-end items-end">
          <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 행 2: 발생 조건 + 청구 단위 + N주 기준 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500">발생:</label>
          <select value={trigger}
            onChange={e => onChange({ ...fee, trigger: e.target.value as LocalFee['trigger'], triggerWeeks: undefined })}
            className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
            {TRIGGER_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        {trigger === 'over_weeks' && (
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">기준:</label>
            <input type="number" value={fee.triggerWeeks ?? ''} min={1}
              onChange={e => onChange({ ...fee, triggerWeeks: e.target.value ? Number(e.target.value) : undefined })}
              className="w-14 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white text-center"
              placeholder="4" />
            <span className="text-xs text-gray-400">주 초과 시</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <label className="text-xs text-gray-500">단위:</label>
          <select value={chargeUnit}
            onChange={e => onChange({ ...fee, chargeUnit: e.target.value as LocalFee['chargeUnit'] })}
            className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white">
            {CHARGE_UNIT_OPTIONS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
        <span className="text-xs text-indigo-500 bg-indigo-50 rounded px-2 py-0.5">{triggerDesc}</span>
        <input value={fee.note ?? ''} onChange={e => onChange({ ...fee, note: e.target.value })}
          className="flex-1 min-w-24 text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"
          placeholder="메모" />
      </div>
    </div>
  )
}

// ── RegistrationFeeEditor ──────────────────────────────────────────────────
function RegistrationFeeEditor({ fee, onChange }: {
  fee?: RegistrationFee
  onChange: (f: RegistrationFee | undefined) => void
}) {
  const enabled = !!fee
  const f = fee ?? { amount: 0, currency: 'KRW' as Currency }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-sm font-medium text-gray-700">등록비 있음</label>
        <input type="checkbox" checked={enabled}
          onChange={e => onChange(e.target.checked ? f : undefined)}
          className="w-4 h-4 accent-blue-600" />
      </div>
      {enabled && (
        <div className="grid grid-cols-12 gap-2 items-end bg-gray-50 p-3 rounded-lg">
          <div className="col-span-5">
            <label className="block text-xs text-gray-500 mb-1">금액</label>
            <input type="number" value={f.amount}
              onChange={e => onChange({ ...f, amount: Number(e.target.value) })}
              className="input-field text-sm" placeholder="0" />
          </div>
          <div className="col-span-6 md:col-span-3">
            <label className="block text-xs text-gray-500 mb-1">통화</label>
            <select value={f.currency}
              onChange={e => onChange({ ...f, currency: e.target.value as Currency })}
              className="input-field text-sm">
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-6 md:col-span-4">
            <label className="block text-xs text-gray-500 mb-1">메모</label>
            <input value={f.note ?? ''} onChange={e => onChange({ ...f, note: e.target.value })}
              className="input-field text-sm" placeholder="예: 신규 등록 시 1회" />
          </div>
        </div>
      )}
    </div>
  )
}

// ── PackageRow ─────────────────────────────────────────────────────────────────
function PackageRow({ pkg, onChange, onDelete }: {
  pkg: Package; onChange: (p: Package) => void; onDelete: () => void
}) {
  const [showIncludes, setShowIncludes] = useState(false)

  const columns = pkg.columns ?? ['1인']
  const matrix  = pkg.priceMatrix ?? []
  const rules   = pkg.additionalRules ?? []

  // 열 추가
  const addColumn = () => {
    const label = `${columns.length + 1}인`
    onChange({
      ...pkg,
      columns: [...columns, label],
      priceMatrix: matrix.map(row => ({
        ...row,
        prices: [...row.prices, { label, amount: 0 }],
      })),
    })
  }

  // 열 삭제
  const removeColumn = (ci: number) => {
    if (columns.length <= 1) return
    onChange({
      ...pkg,
      columns: columns.filter((_, i) => i !== ci),
      priceMatrix: matrix.map(row => ({
        ...row,
        prices: row.prices.filter((_, i) => i !== ci),
      })),
    })
  }

  // 열 헤더 변경
  const renameColumn = (ci: number, label: string) => {
    const newCols = columns.map((c, i) => i === ci ? label : c)
    onChange({
      ...pkg,
      columns: newCols,
      priceMatrix: matrix.map(row => ({
        ...row,
        prices: row.prices.map((p, i) => i === ci ? { ...p, label } : p),
      })),
    })
  }

  // 행(주수) 추가
  const addRow = () => {
    const lastWeeks = matrix.length > 0 ? matrix[matrix.length - 1].weeks : 0
    const nextWeeks = lastWeeks === 0 ? 4 : lastWeeks + 4
    onChange({
      ...pkg,
      priceMatrix: [...matrix, {
        weeks: nextWeeks,
        prices: columns.map(label => ({ label, amount: 0 })),
      }],
    })
  }

  // 행 삭제
  const removeRow = (ri: number) =>
    onChange({ ...pkg, priceMatrix: matrix.filter((_, i) => i !== ri) })

  // 주수 변경
  const setRowWeeks = (ri: number, weeks: number) =>
    onChange({ ...pkg, priceMatrix: matrix.map((r, i) => i === ri ? { ...r, weeks } : r) })

  // 금액 변경
  const setPrice = (ri: number, ci: number, amount: number) =>
    onChange({
      ...pkg,
      priceMatrix: matrix.map((row, i) => i !== ri ? row : {
        ...row,
        prices: row.prices.map((p, j) => j !== ci ? p : { ...p, amount }),
      }),
    })

  // 추가 규정
  const addRule = () =>
    onChange({ ...pkg, additionalRules: [...rules, { id: uuid(), condition: '', addAmount: 0, currency: pkg.currency }] })
  const updateRule = (ri: number, patch: Partial<PackageAdditionalRule>) =>
    onChange({ ...pkg, additionalRules: rules.map((r, i) => i === ri ? { ...r, ...patch } : r) })
  const removeRule = (ri: number) =>
    onChange({ ...pkg, additionalRules: rules.filter((_, i) => i !== ri) })

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
        <input value={pkg.label} onChange={e => onChange({ ...pkg, label: e.target.value })}
          className="flex-1 text-sm font-semibold bg-transparent border-0 outline-none placeholder-gray-400 text-gray-900"
          placeholder="패키지명 (예: 세부 비수기 가족연수 올인클루시브)" />
        <input value={pkg.season ?? ''} onChange={e => onChange({ ...pkg, season: e.target.value })}
          className="w-20 text-xs border border-gray-200 rounded px-2 py-1 bg-white" placeholder="비수기" />
        <select value={pkg.currency} onChange={e => onChange({ ...pkg, currency: e.target.value as Currency })}
          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white">
          {CURRENCIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <div className="flex gap-1">
          <input type="date" value={pkg.startDate ?? ''} onChange={e => onChange({ ...pkg, startDate: e.target.value })}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white w-32" placeholder="시작일" />
          <span className="text-xs text-gray-400 self-center">~</span>
          <input type="date" value={pkg.endDate ?? ''} onChange={e => onChange({ ...pkg, endDate: e.target.value })}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white w-32" placeholder="종료일" />
        </div>
        <button onClick={onDelete} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {/* 가격 행렬 */}
      <div className="px-4 py-3 overflow-x-auto">
        <div className="text-xs font-medium text-gray-500 mb-2">가격표</div>
        <table className="border-collapse text-sm" style={{ minWidth: `${columns.length * 120 + 80}px` }}>
          <thead>
            <tr>
              <th className="text-xs text-gray-400 font-normal py-1.5 pr-3 text-left w-16">주수</th>
              {columns.map((col, ci) => (
                <th key={ci} className="py-1.5 px-1 min-w-28">
                  <div className="flex items-center gap-1">
                    <input value={col} onChange={e => renameColumn(ci, e.target.value)}
                      className="flex-1 text-xs text-center border border-gray-200 rounded px-1.5 py-1 bg-white font-medium" />
                    {columns.length > 1 && (
                      <button onClick={() => removeColumn(ci)} className="text-red-300 hover:text-red-500 flex-shrink-0">
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="py-1.5 px-1 w-8">
                <button onClick={addColumn} title="열 추가"
                  className="text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded p-0.5">
                  <Plus size={14} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, ri) => (
              <tr key={ri} className="border-t border-gray-100">
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-1">
                    <input type="number" value={row.weeks} min={1}
                      onChange={e => setRowWeeks(ri, Number(e.target.value))}
                      className="w-12 text-xs text-center border border-gray-200 rounded px-1.5 py-1 bg-white font-medium" />
                    <span className="text-xs text-gray-400">주</span>
                  </div>
                </td>
                {(row.prices ?? []).map((cell, ci) => (
                  <td key={ci} className="py-1.5 px-1">
                    <input type="number" value={cell.amount} min={0} step={10000}
                      onChange={e => setPrice(ri, ci, Number(e.target.value))}
                      className="w-full text-xs text-right border border-gray-200 rounded px-2 py-1 bg-white focus:border-blue-300 focus:ring-1 focus:ring-blue-200 outline-none"
                      placeholder="0" />
                  </td>
                ))}
                <td className="py-1.5 px-1">
                  <button onClick={() => removeRow(ri)} className="text-red-300 hover:text-red-500">
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button onClick={addRow}
          className="mt-2 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
          <Plus size={12} /> 주수 행 추가
        </button>
      </div>

      {/* 추가 규정 */}
      <div className="px-4 pb-3 border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500">추가 규정 (성인 2인 +150만원 등)</span>
          <button onClick={addRule} className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
            <Plus size={11} /> 추가
          </button>
        </div>
        {rules.map((rule, ri) => (
          <div key={rule.id} className="flex items-center gap-2 mb-1.5">
            <input value={rule.condition} onChange={e => updateRule(ri, { condition: e.target.value })}
              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5" placeholder="조건 (예: 성인 2인 시)" />
            <span className="text-xs text-gray-400">+</span>
            <input type="number" value={rule.addAmount} step={10000}
              onChange={e => updateRule(ri, { addAmount: Number(e.target.value) })}
              className="w-28 text-xs text-right border border-gray-200 rounded px-2 py-1.5" />
            <select value={rule.currency} onChange={e => updateRule(ri, { currency: e.target.value as Currency })}
              className="text-xs border border-gray-200 rounded px-1.5 py-1.5">
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <button onClick={() => removeRule(ri)} className="text-red-300 hover:text-red-500"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      {/* 포함/불포함 토글 */}
      <div className="px-4 pb-3 border-t border-gray-100 pt-2">
        <button onClick={() => setShowIncludes(!showIncludes)}
          className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
          {showIncludes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          포함/불포함 항목 {showIncludes ? '접기' : '펼치기'}
        </button>
        {showIncludes && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">✅ 포함 항목 (줄바꿈으로 구분)</label>
              <textarea value={pkg.includes ?? ''} onChange={e => onChange({ ...pkg, includes: e.target.value })}
                className="input-field text-xs h-28 resize-none"
                placeholder={'레지던스 숙박\n식사 (중식&석식)\n공항 픽업\n...'} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">❌ 불포함 항목 (줄바꿈으로 구분)</label>
              <textarea value={pkg.excludes ?? ''} onChange={e => onChange({ ...pkg, excludes: e.target.value })}
                className="input-field text-xs h-28 resize-none"
                placeholder={'왕복 항공권\n여행자보험\n개인비용\n...'} />
            </div>
          </div>
        )}
      </div>

      {/* 메모 */}
      <div className="px-4 pb-3">
        <input value={pkg.note ?? ''} onChange={e => onChange({ ...pkg, note: e.target.value })}
          className="input-field text-xs" placeholder="메모 (예: *성인 2인인 경우 150만원 추가)" />
      </div>
    </div>
  )
}

// ── PriceIncreaseEditor ────────────────────────────────────────────────────
function PriceIncreaseEditor({ pi, courses, dormitories, onChange, onApply }: {
  pi?: PriceIncrease
  courses: Course[]
  dormitories: Dormitory[]
  onChange: (v: PriceIncrease | undefined) => void
  onApply: () => void
}) {
  const enabled = !!pi
  const today = new Date().toISOString().split('T')[0]
  const isActive = pi && pi.fromDate <= today

  // 체크박스 켜면 기존 코스/기숙사 목록으로 초기화
  const initPI = (): PriceIncrease => ({
    fromDate: '',
    label: '',
    currency: 'KRW' as Currency,
    courses: courses.map(c => ({ id: c.id, name: c.name, add: 0 })),
    dormitories: dormitories.map(d => ({ id: d.id, name: d.name, add: 0 })),
  })

  // 기존 pi에 없는 코스/기숙사가 추가됐을 때 동기화
  const syncedPI = (): PriceIncrease => {
    if (!pi) return initPI()
    const syncedCourses = courses.map(c => ({
      id: c.id, name: c.name,
      add: pi.courses.find(x => x.id === c.id)?.add ?? 0,
    }))
    const syncedDorms = dormitories.map(d => ({
      id: d.id, name: d.name,
      add: pi.dormitories.find(x => x.id === d.id)?.add ?? 0,
    }))
    return { ...pi, courses: syncedCourses, dormitories: syncedDorms }
  }

  const p = syncedPI()

  const setAdd = (type: 'courses' | 'dormitories', id: string, add: number) => {
    onChange({
      ...p,
      [type]: p[type].map(x => x.id === id ? { ...x, add } : x),
    })
  }

  const getBase4w = (item: Course | Dormitory) =>
    (item as unknown as Record<string,number>).price4Weeks
    ?? (item as unknown as Record<string,number>).pricePerWeek ?? 0

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-sm font-medium text-gray-700">비용 인상 예정 있음</label>
        <input type="checkbox" checked={enabled}
          onChange={e => onChange(e.target.checked ? initPI() : undefined)}
          className="w-4 h-4 accent-blue-600" />
        {isActive && (
          <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium animate-pulse">
            🔴 현재 적용 중
          </span>
        )}
        {pi && !isActive && (
          <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
            📢 {pi.fromDate}부터 예정
          </span>
        )}
      </div>

      {enabled && (
        <div className="space-y-4 bg-orange-50 border border-orange-200 rounded-xl p-4">
          {/* 기본 설정 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">인상 적용일</label>
              <input type="date" value={p.fromDate}
                onChange={e => onChange({ ...p, fromDate: e.target.value })}
                className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">구분명</label>
              <input value={p.label ?? ''} onChange={e => onChange({ ...p, label: e.target.value })}
                className="input-field text-sm" placeholder="2026 하반기 인상" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">인상액 통화</label>
              <select value={p.currency} onChange={e => onChange({ ...p, currency: e.target.value as Currency })}
                className="input-field text-sm">
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* 코스별 인상 */}
          {p.courses.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">코스별 인상 (주당 추가금액)</p>
              <div className="space-y-1.5">
                {p.courses.map(item => {
                  const course = courses.find(c => c.id === item.id)
                  const base = course ? getBase4w(course) : 0
                  return (
                    <div key={item.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-orange-100">
                      <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{item.name}</span>
                      <span className="text-xs text-gray-400 w-36 text-right flex-shrink-0">
                        4주 {base.toLocaleString()}{course?.currency}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-orange-500">+</span>
                        <input type="number" value={item.add} min={0}
                          onChange={e => setAdd('courses', item.id, Number(e.target.value))}
                          className="w-24 border border-orange-200 rounded px-2 py-1 text-sm text-right bg-white focus:ring-1 focus:ring-orange-300 outline-none"
                          placeholder="0" />
                        <span className="text-xs text-gray-500">{p.currency}/주</span>
                      </div>
                      {item.add > 0 && (
                        <span className="text-xs text-orange-600 flex-shrink-0 w-28 text-right">
                          → 4주 {(base + item.add * 4).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 기숙사별 인상 */}
          {p.dormitories.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">기숙사별 인상 (주당 추가금액)</p>
              <div className="space-y-1.5">
                {p.dormitories.map(item => {
                  const dorm = dormitories.find(d => d.id === item.id)
                  const base = dorm ? getBase4w(dorm) : 0
                  return (
                    <div key={item.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-orange-100">
                      <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{item.name}</span>
                      <span className="text-xs text-gray-400 w-36 text-right flex-shrink-0">
                        4주 {base.toLocaleString()}{dorm?.currency}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-orange-500">+</span>
                        <input type="number" value={item.add} min={0}
                          onChange={e => setAdd('dormitories', item.id, Number(e.target.value))}
                          className="w-24 border border-orange-200 rounded px-2 py-1 text-sm text-right bg-white focus:ring-1 focus:ring-orange-300 outline-none"
                          placeholder="0" />
                        <span className="text-xs text-gray-500">{p.currency}/주</span>
                      </div>
                      {item.add > 0 && (
                        <span className="text-xs text-orange-600 flex-shrink-0 w-28 text-right">
                          → 4주 {(base + item.add * 4).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {isActive && (
            <div className="flex items-center gap-3 pt-1 border-t border-orange-200">
              <p className="text-xs text-orange-700 flex-1">
                인상이 적용 중입니다. 기본가에 반영하면 각 코스·기숙사 가격이 업데이트되고 이 설정이 초기화됩니다.
              </p>
              <button type="button" onClick={onApply}
                className="flex-shrink-0 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium rounded-lg transition-colors">
                기본가에 반영 후 초기화
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
