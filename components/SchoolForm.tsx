'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { v4 as uuid } from 'uuid'
import AdminLayout from '@/components/AdminLayout'
import { getSchool, saveSchool, deleteSchool } from '@/lib/db'
import type {
  School, Course, Dormitory, ShortTermRates,
  Surcharge, Promotion, LocalFee, Package, RegistrationFee,
  Region, SchoolType, ProgramTag, Currency, LocalFeeCondition
} from '@/types'
import { calcShortTermPrice } from '@/types'
import {
  Plus, Trash2, ChevronDown, ChevronUp, Save,
  ArrowLeft, AlertCircle, Check, Settings2
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
  registrationFee: undefined,
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
          courses:        s.courses        ?? [],
          dormitories:    s.dormitories    ?? [],
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
      <div className="p-8 max-w-4xl mx-auto">
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
          <div className="flex gap-2">
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
                <div className="grid grid-cols-2 gap-4">
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
                <div className="grid grid-cols-3 gap-4">
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
                    allowShortTerm={school.allowShortTerm}
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
                    allowShortTerm={school.allowShortTerm}
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
                  startDate: '', endDate: '', discountType: 'percent' as const,
                  discountValue: 10, surchargeCompatible: false
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
                <button onClick={() => update('localFees', [...school.localFees, { id: uuid(), name: '', amount: 0, condition: 'one_time' as const }])}
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
              <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs text-gray-500">총액 제시 방식의 패키지</p>
                {school.packages.map((pkg, i) => (
                  <PackageRow key={pkg.id} pkg={pkg}
                    onChange={v => update('packages', school.packages.map((x, j) => j === i ? v : x))}
                    onDelete={() => update('packages', school.packages.filter((_, j) => j !== i))}
                  />
                ))}
                <button onClick={() => update('packages', [...school.packages, {
                  id: uuid(), label: '', condition: '', totalPrice: 0, currency: 'KRW', includes: ''
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
function ShortTermRatesEditor({ price4Weeks, rates, onChange }: {
  price4Weeks: number
  rates?: ShortTermRates
  onChange: (r: ShortTermRates | undefined) => void
}) {
  const enabled = !!rates
  const r = rates ?? { mode: 'percent', week1: 40, week2: 65, week3: 80, week4Included: false }

  const base4w = price4Weeks

  const toggle = () => onChange(enabled ? undefined : r)
  const set = (patch: Partial<ShortTermRates>) => onChange({ ...r, ...patch })

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <div className="flex items-center gap-2 mb-2">
        <button type="button" onClick={toggle}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${enabled ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-gray-50 text-gray-400 border-gray-200 hover:border-gray-300'}`}>
          <Settings2 size={11} />
          단기가 설정 {enabled ? '켜짐' : '꺼짐'}
        </button>
        {enabled && (
          <div className="flex gap-1">
            <button type="button" onClick={() => set({ mode: 'percent' })}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${r.mode === 'percent' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-300'}`}>
              4주가격의 %
            </button>
            <button type="button" onClick={() => set({ mode: 'fixed' })}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${r.mode === 'fixed' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-300'}`}>
              직접 입력
            </button>
          </div>
        )}
      </div>

      {enabled && (
        <div className="grid grid-cols-4 gap-2">
          {([1, 2, 3, 4] as const).map(w => {
            const isWeek4 = w === 4
            const fieldKey = `week${w}` as 'week1' | 'week2' | 'week3' | 'week4'
            const val = isWeek4 ? (r.week4 ?? base4w) : r[fieldKey as 'week1' | 'week2' | 'week3']
            const preview = isWeek4
              ? (r.week4Included ? r.week4 ?? base4w : base4w)
              : calcShortTermPrice(price4Weeks, w as 1|2|3, r)

            return (
              <div key={w} className={`rounded-lg p-2 ${isWeek4 && !r.week4Included ? 'bg-gray-50 opacity-60' : 'bg-indigo-50'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">{w}주</span>
                  {isWeek4 && (
                    <input type="checkbox" checked={r.week4Included}
                      onChange={e => set({ week4Included: e.target.checked })}
                      className="w-3 h-3 accent-indigo-600" title="4주도 별도 입력" />
                  )}
                </div>
                {(!isWeek4 || r.week4Included) ? (
                  <input
                    type="number"
                    value={isWeek4 ? (r.week4 ?? base4w) : val}
                    onChange={e => {
                      const n = Number(e.target.value)
                      if (isWeek4) set({ week4: n })
                      else set({ [fieldKey]: n } as Partial<ShortTermRates>)
                    }}
                    className="w-full text-xs border border-indigo-200 rounded px-1.5 py-1 bg-white"
                    placeholder={r.mode === 'percent' ? '예: 40' : '금액'}
                  />
                ) : (
                  <div className="text-xs text-gray-400 py-1">자동 ({(price4Weeks * 4).toLocaleString()})</div>
                )}
                {price4Weeks > 0 && preview > 0 && (
                  <div className="text-xs text-indigo-600 mt-0.5 font-medium">
                    {r.mode === 'percent' && !isWeek4 ? `→ ${preview.toLocaleString()}` : ''}
                    {(isWeek4 && r.week4Included) || r.mode === 'fixed' ? `${preview.toLocaleString()}` : ''}
                  </div>
                )}
                {r.mode === 'percent' && !isWeek4 && (
                  <div className="text-xs text-gray-400">{val}%</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── CourseRow ──────────────────────────────────────────────────────────────────
function CourseRow({ course, allowShortTerm, onChange, onDelete }: {
  course: Course; allowShortTerm: boolean
  onChange: (c: Course) => void; onDelete: () => void
}) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">코스명</label>
          <input value={course.name} onChange={e => onChange({ ...course, name: e.target.value })}
            className="input-field text-sm" placeholder="인텐시브" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">대상</label>
          <input value={course.target} onChange={e => onChange({ ...course, target: e.target.value })}
            className="input-field text-sm" placeholder="성인" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">4주 기준 가격</label>
          <input type="number" value={course.price4Weeks}
            onChange={e => onChange({ ...course, price4Weeks: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-2">
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
      {allowShortTerm && (
        <ShortTermRatesEditor
          price4Weeks={course.price4Weeks}
          rates={course.shortTermRates}
          onChange={r => onChange({ ...course, shortTermRates: r })}
        />
      )}
    </div>
  )
}

// ── DormRow ────────────────────────────────────────────────────────────────────
function DormRow({ dorm, allowShortTerm, onChange, onDelete }: {
  dorm: Dormitory; allowShortTerm: boolean
  onChange: (d: Dormitory) => void; onDelete: () => void
}) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">기숙사명</label>
          <input value={dorm.name} onChange={e => onChange({ ...dorm, name: e.target.value })}
            className="input-field text-sm" placeholder="1인실" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">대상</label>
          <input value={dorm.target} onChange={e => onChange({ ...dorm, target: e.target.value })}
            className="input-field text-sm" placeholder="성인" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">4주 기준 가격</label>
          <input type="number" value={dorm.price4Weeks}
            onChange={e => onChange({ ...dorm, price4Weeks: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">통화</label>
          <select value={dorm.currency} onChange={e => onChange({ ...dorm, currency: e.target.value as Currency })}
            className="input-field text-sm">
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-2 flex justify-end items-end">
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
      {allowShortTerm && (
        <ShortTermRatesEditor
          price4Weeks={dorm.price4Weeks}
          rates={dorm.shortTermRates}
          onChange={r => onChange({ ...dorm, shortTermRates: r })}
        />
      )}
    </div>
  )
}

// ── SurchargeRow ───────────────────────────────────────────────────────────────
function SurchargeRow({ surcharge, onChange, onDelete }: {
  surcharge: Surcharge; onChange: (s: Surcharge) => void; onDelete: () => void
}) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">구분명</label>
          <input value={surcharge.label} onChange={e => onChange({ ...surcharge, label: e.target.value })}
            className="input-field text-sm" placeholder="2026 여름 서차지" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">시작일</label>
          <input type="date" value={surcharge.startDate} onChange={e => onChange({ ...surcharge, startDate: e.target.value })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">종료일</label>
          <input type="date" value={surcharge.endDate} onChange={e => onChange({ ...surcharge, endDate: e.target.value })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-2">
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
        <div className="col-span-1 flex justify-end items-end">
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
  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">프로모션명</label>
          <input value={promotion.label} onChange={e => onChange({ ...promotion, label: e.target.value })}
            className="input-field text-sm" placeholder="비수기 할인" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">기준</label>
          <select value={promotion.basisType} onChange={e => onChange({ ...promotion, basisType: e.target.value as 'enrollment_date' | 'start_date' })}
            className="input-field text-sm">
            <option value="start_date">연수 시작일</option>
            <option value="enrollment_date">등록일</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">시작일</label>
          <input type="date" value={promotion.startDate} onChange={e => onChange({ ...promotion, startDate: e.target.value })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 mb-1">종료일</label>
          <input type="date" value={promotion.endDate} onChange={e => onChange({ ...promotion, endDate: e.target.value })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">타입</label>
          <select value={promotion.discountType} onChange={e => onChange({ ...promotion, discountType: e.target.value as 'percent' | 'amount' })}
            className="input-field text-sm">
            <option value="percent">%</option>
            <option value="amount">금액</option>
          </select>
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">값</label>
          <input type="number" value={promotion.discountValue}
            onChange={e => onChange({ ...promotion, discountValue: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-1 flex justify-end items-end">
          <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-400 mb-1">조건</label>
          <input value={promotion.condition ?? ''} onChange={e => onChange({ ...promotion, condition: e.target.value })}
            className="input-field text-sm" placeholder="12주 이상" />
        </div>
        <div className="flex items-center gap-3 pt-4">
          <label className="text-xs text-gray-500">서차지 기간 적용 가능</label>
          <input type="checkbox" checked={promotion.surchargeCompatible}
            onChange={e => onChange({ ...promotion, surchargeCompatible: e.target.checked })}
            className="w-4 h-4 accent-blue-600" />
        </div>
      </div>
    </div>
  )
}

// ── LocalFeeRow ────────────────────────────────────────────────────────────────
const LOCAL_FEE_CONDITIONS = [
  { value: 'one_time',   label: '1회성',          desc: '무조건 1번 납부' },
  { value: 'per_week',   label: '주당',            desc: '금액 × 연수주수' },
  { value: 'min_weeks',  label: '특정 주수 이상',  desc: '지정 주수 이상일 때만' },
  { value: 'optional',   label: '옵션',            desc: '선택 납부 (총액 미포함)' },
] as const

function LocalFeeRow({ fee, onChange, onDelete }: {
  fee: LocalFee; onChange: (f: LocalFee) => void; onDelete: () => void
}) {
  const cond = fee.condition ?? 'one_time'
  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-4">
          <label className="block text-xs text-gray-500 mb-1">항목명</label>
          <input value={fee.name} onChange={e => onChange({ ...fee, name: e.target.value })}
            className="input-field text-sm" placeholder="SSP, 비자연장비, 교재비..." />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">금액 (PHP)</label>
          <input type="number" value={fee.amount} onChange={e => onChange({ ...fee, amount: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">조건</label>
          <select value={cond}
            onChange={e => onChange({ ...fee, condition: e.target.value as LocalFee['condition'], minWeeks: undefined })}
            className="input-field text-sm">
            {LOCAL_FEE_CONDITIONS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        {cond === 'min_weeks' ? (
          <div className="col-span-1">
            <label className="block text-xs text-gray-500 mb-1">최소주수</label>
            <input type="number" min={1} value={fee.minWeeks ?? ''}
              onChange={e => onChange({ ...fee, minWeeks: e.target.value ? Number(e.target.value) : undefined })}
              className="input-field text-sm" placeholder="4" />
          </div>
        ) : (
          <div className="col-span-1" />
        )}
        <div className="col-span-1 flex justify-end items-end">
          <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {/* 조건 설명 + 메모 */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-indigo-600 bg-indigo-50 rounded px-2 py-0.5">
          {LOCAL_FEE_CONDITIONS.find(c => c.value === cond)?.desc}
          {cond === 'per_week' && ' (견적 주수에 따라 계산)'}
          {cond === 'min_weeks' && fee.minWeeks && ` — ${fee.minWeeks}주 이상`}
        </span>
        <input value={fee.note ?? ''} onChange={e => onChange({ ...fee, note: e.target.value })}
          className="input-field text-sm flex-1" placeholder="메모 (선택)" />
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
          <div className="col-span-3">
            <label className="block text-xs text-gray-500 mb-1">통화</label>
            <select value={f.currency}
              onChange={e => onChange({ ...f, currency: e.target.value as Currency })}
              className="input-field text-sm">
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-4">
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
  return (
    <div className="bg-gray-50 p-3 rounded-lg space-y-2">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">패키지명</label>
          <input value={pkg.label} onChange={e => onChange({ ...pkg, label: e.target.value })}
            className="input-field text-sm" placeholder="가족연수 여름 패키지" />
        </div>
        <div className="col-span-3">
          <label className="block text-xs text-gray-500 mb-1">조건</label>
          <input value={pkg.condition} onChange={e => onChange({ ...pkg, condition: e.target.value })}
            className="input-field text-sm" placeholder="부모 1인 + 자녀 1인" />
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">주수</label>
          <input type="number" min={1} value={pkg.weeks ?? ''}
            onChange={e => onChange({ ...pkg, weeks: e.target.value ? Number(e.target.value) : undefined })}
            className="input-field text-sm" placeholder="4" />
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">최소</label>
          <input type="number" min={1} value={pkg.minWeeks ?? ''}
            onChange={e => onChange({ ...pkg, minWeeks: e.target.value ? Number(e.target.value) : undefined })}
            className="input-field text-sm" placeholder="-" />
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">최대</label>
          <input type="number" min={1} value={pkg.maxWeeks ?? ''}
            onChange={e => onChange({ ...pkg, maxWeeks: e.target.value ? Number(e.target.value) : undefined })}
            className="input-field text-sm" placeholder="-" />
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">금액</label>
          <input type="number" value={pkg.totalPrice} onChange={e => onChange({ ...pkg, totalPrice: Number(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div className="col-span-1">
          <label className="block text-xs text-gray-500 mb-1">통화</label>
          <select value={pkg.currency} onChange={e => onChange({ ...pkg, currency: e.target.value as Currency })}
            className="input-field text-sm">
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-span-1 flex justify-end items-end">
          <button onClick={onDelete} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <textarea value={pkg.includes} onChange={e => onChange({ ...pkg, includes: e.target.value })}
        className="input-field text-sm h-14 resize-none" placeholder="학비, 기숙사, 식사, 액티비티 포함..." />
    </div>
  )
}
