'use client'
import { useState, useMemo, useEffect } from 'react'
import type { School, ExchangeRate, Course, Dormitory, LocalFee, Package } from '@/types'
import type { PromoEntry } from '@/lib/db'
import { calculateQuote, type CalcResult, type QuoteInput } from '@/lib/calcEngine'
import { findSchoolForPromo } from '@/lib/schoolMatching'
import { schoolHasMode, MODE_LABELS, type SchoolMode } from '@/lib/schoolMode'
import { formatKrw } from '@/lib/utils'
import QuoteFormModal from './QuoteFormModal'
import {
  ChevronRight, MapPin, Building2, BookOpen, Home, Calendar,
  RefreshCw, Plus, Minus, Check, AlertTriangle, FileText, Table,
} from 'lucide-react'

interface DirectCalculatorProps {
  schools: School[]
  promos: PromoEntry[]
  rate: ExchangeRate
}

/**
 * 직접 계산: 단계별 선택으로 견적 만들기
 * 1. 지역 → 학원 → 입국일 → 코스 → 기숙사 → 주수
 * 2. 결과 + 견적 근거(학원 가격표) + 적용 가능 프로모션 토글
 * 3. 견적서 만들기 버튼
 */
export default function DirectCalculator({ schools, promos, rate }: DirectCalculatorProps) {
  // 모드: 'regular'(일반 연수) | 'camp_family'(캠프·가족·주니어).
  // 학원 목록을 이 모드로 필터링한다(자동 추론: courses>0 → regular, packages만 → camp_family).
  const [mode, setMode] = useState<SchoolMode>('regular')
  const [region, setRegion] = useState<string>('')
  const [schoolId, setSchoolId] = useState<string>('')
  const [courseSelections, setCourseSelections] = useState<Array<{ courseId: string; weeks: number }>>([])
  const [dormSelections, setDormSelections] = useState<Array<{ dormitoryId: string; weeks: number }>>([])
  const [packageSelections, setPackageSelections] = useState<Array<{ packageId: string; weeks: number; columnLabel: string; additionalRuleIds: string[] }>>([])
  const [startDate, setStartDate] = useState<string>('')   // 빈 값 = 시작일 미정 (기본 견적만)
  const [appliedPromoIds, setAppliedPromoIds] = useState<Set<string>>(new Set())
  const [showBasis, setShowBasis] = useState(false)
  const [quoteModal, setQuoteModal] = useState<{
    calcResult: CalcResult; school: School; startDate: string; localFees: LocalFee[]
  } | null>(null)

  // 지역 목록 — 모드에 해당하는 학원이 있는 지역만 표시
  const regions = useMemo(() => {
    const filtered = schools.filter(s => schoolHasMode(s, mode))
    const set = new Set(filtered.map(s => s.region))
    return Array.from(set).sort()
  }, [schools, mode])

  // 선택된 지역의 학원 — 모드 필터 적용
  const schoolsInRegion = useMemo(() => {
    if (!region) return []
    return schools
      .filter(s => s.region === region && schoolHasMode(s, mode))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [schools, region, mode])

  // 선택된 학원
  const selectedSchool = useMemo(() => schools.find(s => s.id === schoolId), [schools, schoolId])

  // 학원에 매칭되는 프로모션
  const schoolPromos = useMemo(() => {
    if (!selectedSchool) return []
    return promos.filter(p => {
      const matched = findSchoolForPromo(
        { schoolId: p.schoolId, schoolCode: p.schoolCode, schoolName: p.schoolName },
        [selectedSchool],
      )
      return matched?.id === selectedSchool.id && p.active !== false
    })
  }, [promos, selectedSchool])

  // 초기화
  const resetFromSchool = () => {
    setSchoolId('')
    setCourseSelections([])
    setDormSelections([])
    setPackageSelections([])
    setAppliedPromoIds(new Set())
    setShowBasis(false)
  }
  const resetFromRegion = () => {
    setRegion('')
    resetFromSchool()
  }
  // 모드 변경 시 — 모드가 바뀌면 이전 학원이 새 모드에 안 보일 수 있으므로 전체 리셋.
  const changeMode = (next: SchoolMode) => {
    if (next === mode) return
    setMode(next)
    resetFromRegion()
  }

  // 코스/기숙사 추가/삭제/수정
  const addCourse = () => setCourseSelections(p => [...p, { courseId: '', weeks: 4 }])
  const removeCourse = (i: number) => setCourseSelections(p => p.filter((_, j) => j !== i))
  const updateCourse = (i: number, patch: Partial<{ courseId: string; weeks: number }>) =>
    setCourseSelections(p => p.map((c, j) => j === i ? { ...c, ...patch } : c))

  const addDorm = () => setDormSelections(p => [...p, { dormitoryId: '', weeks: 4 }])
  const removeDorm = (i: number) => setDormSelections(p => p.filter((_, j) => j !== i))
  const updateDorm = (i: number, patch: Partial<{ dormitoryId: string; weeks: number }>) =>
    setDormSelections(p => p.map((d, j) => j === i ? { ...d, ...patch } : d))

  // 패키지 추가/삭제/수정. 패키지 변경 시 columnLabel과 weeks를 그 패키지의 기본값(첫 행/첫 열)로 자동 세팅.
  const addPackage = () => setPackageSelections(p => [...p, { packageId: '', weeks: 4, columnLabel: '', additionalRuleIds: [] }])
  const removePackage = (i: number) => setPackageSelections(p => p.filter((_, j) => j !== i))
  const updatePackage = (i: number, patch: Partial<{ packageId: string; weeks: number; columnLabel: string; additionalRuleIds: string[] }>) =>
    setPackageSelections(p => p.map((c, j) => j === i ? { ...c, ...patch } : c))

  // 학원 선택 시 자동 세팅:
  // - 코스가 있는 학원이면 코스 1개 자동 추가, 코스 없는(패키지 전용) 학원이면 자동 추가 안 함
  // - 기숙사가 있는 학원이면 기숙사 1개 자동 추가, 없으면 비움
  // - 패키지가 있는 학원이면 패키지 1개 자동 추가
  // - 코스도 패키지도 없는 학원(본사 확인 대기)은 둘 다 비움
  useEffect(() => {
    if (!selectedSchool) return
    const hasCourses = (selectedSchool.courses?.length ?? 0) > 0
    const hasDorms = (selectedSchool.dormitories?.length ?? 0) > 0
    const hasPackages = (selectedSchool.packages?.length ?? 0) > 0

    if (hasCourses && courseSelections.length === 0) {
      setCourseSelections([{ courseId: '', weeks: 4 }])
    }
    if (!hasCourses) {
      setCourseSelections([])
    }
    if (hasDorms && dormSelections.length === 0) {
      setDormSelections([{ dormitoryId: '', weeks: 4 }])
    }
    if (!hasDorms) {
      setDormSelections([])
    }
    if (hasPackages && packageSelections.length === 0) {
      setPackageSelections([{ packageId: '', weeks: 4, columnLabel: '', additionalRuleIds: [] }])
    }
    if (!hasPackages) {
      setPackageSelections([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId])

  // 적용된 프로모션 → School.promotions 형태로 변환
  const buildPromotionsForCalc = (appliedIds: Set<string>) => {
    return schoolPromos
      .filter(p => appliedIds.has(p.id))
      .map(p => ({
        id: p.id,
        label: p.promoName,
        basisType: (p.basisType as 'start_date' | 'enrollment_date' | 'contract_date' | 'departure_date') ?? 'start_date',
        alwaysApply: p.alwaysApply ?? true,
        startDate: p.startDate ?? '',
        endDate: p.endDate ?? '',
        discountType: (p.discountType as 'percent' | 'amount' | 'amount_per_week' | 'amount_per_4weeks') ?? 'amount',
        discountValue: p.discountValue ?? 0,
        applyToCourses: p.applyToCourses ?? true,
        applyToDorms: p.applyToDorms ?? true,
        applyToSurcharge: p.applyToSurcharge ?? false,
        stackable: p.stackable,
        condition: p.condition,
        applicableItems: p.applicableItems,
        minWeeks: (p as { minWeeks?: number }).minWeeks,
        blockMethod: (p as { blockMethod?: 'floor'|'proportional' }).blockMethod,
        methodConfirmed: (p as { methodConfirmed?: boolean }).methodConfirmed,
        stackWith: (p as { stackWith?: string[] }).stackWith,
        exclusiveWith: (p as { exclusiveWith?: string[] }).exclusiveWith,
        relationConfirmed: (p as { relationConfirmed?: boolean }).relationConfirmed,
        agencyDiscount: p.agencyDiscountStatus
          ? {
              status: p.agencyDiscountStatus,
              type: (p.agencyDiscountType as 'percent' | 'amount_per_week' | 'amount_per_4weeks' | 'amount_flat' | 'reg_fee_only' | 'week_tiers') ?? 'percent',
              value: p.agencyDiscountValue ?? 0,
              applyTo: (p.agencyDiscountApplyTo as 'all' | 'course_only' | 'dorm_only' | 'package_only' | 'course_and_dorm') ?? 'all',
              scope: p.agencyDiscountScope,
              minWeeks: p.agencyDiscountMinWeeks,
              regFeeDiscount: p.agencyDiscountRegFee,
              weekTiers: p.agencyDiscountWeekTiers,
              base: (p as { agencyDiscountBase?: 'after_discount'|'before_discount' }).agencyDiscountBase ?? 'after_discount',
              rawText: p.agencyDiscountRawText,
              note: p.agencyDiscountNote ?? '',
            }
          : undefined,
      }))
  }

  // calculateQuote를 적용된 프로모션 셋으로 호출
  const computeWith = (appliedIds: Set<string>): CalcResult | null => {
    if (!selectedSchool) return null
    const validCourses = courseSelections.filter(c => c.courseId)
    const validDorms = dormSelections.filter(d => d.dormitoryId)
    const validPackages = packageSelections.filter(p => p.packageId && p.columnLabel)
    if (validCourses.length === 0 && validDorms.length === 0 && validPackages.length === 0) return null

    const schoolForCalc: School = {
      ...selectedSchool,
      promotions: buildPromotionsForCalc(appliedIds),
    }

    const input: QuoteInput = {
      school: schoolForCalc,
      startDate,
      enrollmentDate: startDate,
      courses: validCourses,
      dormitories: validDorms,
      packages: validPackages,
    }

    try {
      return calculateQuote(input, rate)
    } catch (err) {
      console.error('계산 오류:', err)
      return null
    }
  }

  // 현재 적용 상태 결과
  const calcResult = useMemo(() => computeWith(appliedPromoIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSchool, courseSelections, dormSelections, packageSelections, startDate, schoolPromos, appliedPromoIds, rate])

  // 각 프로모션 토글 시 차감액 미리보기 계산
  const promoPreviewDiffs = useMemo(() => {
    if (!calcResult) return new Map<string, number>()
    const diffs = new Map<string, number>()
    for (const p of schoolPromos) {
      const isApplied = appliedPromoIds.has(p.id)
      const altSet = new Set(appliedPromoIds)
      if (isApplied) altSet.delete(p.id)
      else altSet.add(p.id)
      const altResult = computeWith(altSet)
      if (altResult) {
        // 토글하면 totalKrw가 얼마나 변하는지
        const diff = altResult.totalKrw - calcResult.totalKrw
        diffs.set(p.id, diff)
      }
    }
    return diffs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcResult, schoolPromos, appliedPromoIds])

  const togglePromo = (id: string) => {
    setAppliedPromoIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 견적서 만들기
  const openQuoteForm = () => {
    if (!calcResult || !selectedSchool) return
    setQuoteModal({
      calcResult,
      school: selectedSchool,
      startDate,
      localFees: selectedSchool.localFees ?? [],
    })
  }

  // ── UI ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <header>
        <h2 className="text-lg font-bold text-gray-900">직접 계산</h2>
        <p className="text-xs text-gray-500 mt-1">
          단계별 선택 → 결과 확인 → 프로모션 토글 → 견적서 만들기
        </p>
      </header>

      {/* 모드 토글 — 일반 연수 / 캠프·가족·주니어. 학원 목록을 자동 추론된 모드로 필터링한다. */}
      <div className="card p-4">
        <div className="text-xs font-medium text-gray-500 mb-2">어떤 견적인가요?</div>
        <div className="grid grid-cols-2 gap-2">
          {(['regular', 'camp_family'] as SchoolMode[]).map(m => (
            <button key={m} onClick={() => changeMode(m)}
              className={`px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors
                ${mode === m
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:bg-blue-50'}`}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* 1. 지역 선택 */}
      <Section step={1} icon={<MapPin size={16} />} title="지역 선택"
        value={region} onReset={resetFromRegion}>
        {!region && (
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            {regions.map(r => (
              <button key={r} onClick={() => setRegion(r)}
                className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors">
                {r}
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* 2. 학원 선택 */}
      {region && (
        <Section step={2} icon={<Building2 size={16} />} title="학원 선택"
          value={selectedSchool?.name} subValue={selectedSchool?.campus}
          onReset={resetFromSchool}>
          {!schoolId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {schoolsInRegion.map(s => (
                <button key={s.id} onClick={() => setSchoolId(s.id)}
                  className="text-left px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors">
                  <div className="font-medium text-gray-900">{s.name}</div>
                  {s.campus && s.campus !== '본원' && (
                    <div className="text-xs text-gray-500">{s.campus}</div>
                  )}
                </button>
              ))}
              {schoolsInRegion.length === 0 && (
                <div className="col-span-full text-center py-6 text-sm text-gray-400">
                  이 지역에 등록된 학원이 없습니다.
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* 3. 입국일 (선택) */}
      {selectedSchool && (
        <Section step={3} icon={<Calendar size={16} />} title="입국 예정일 (선택)" value={startDate || '미정'}>
          <div className="space-y-1.5">
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            {!startDate && (
              <p className="text-xs text-gray-500">
                날짜를 정하지 않아도 기본 견적(학비·기숙사·등록비)은 계산됩니다. 성수기 추가비·기간 한정 프로모션은 날짜를 정하면 반영됩니다.
              </p>
            )}
            {startDate && (
              <button onClick={() => setStartDate('')}
                className="text-xs text-gray-400 hover:text-gray-600 underline">
                날짜 미정으로 되돌리기
              </button>
            )}
          </div>
        </Section>
      )}

      {/* 4. 코스 선택 */}
      {selectedSchool && (
        <Section step={4} icon={<BookOpen size={16} />} title="코스 선택" subtitle={`${selectedSchool.name}의 코스`}>
          <div className="space-y-2">
            {courseSelections.map((c, i) => (
              <ItemSelectorRow key={i} items={selectedSchool.courses ?? []}
                selectedId={c.courseId} weeks={c.weeks}
                onSelect={id => updateCourse(i, { courseId: id })}
                onWeeks={w => updateCourse(i, { weeks: w })}
                onDelete={courseSelections.length > 1 ? () => removeCourse(i) : undefined}
                getName={(item) => (item as Course).name}
                getId={(item) => (item as Course).id} />
            ))}
            <button onClick={addCourse}
              className="w-full px-3 py-2 text-xs text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-center gap-1">
              <Plus size={12} /> 코스 추가
            </button>
          </div>
        </Section>
      )}

      {/* 5. 기숙사 선택 */}
      {selectedSchool && (selectedSchool.dormitories?.length ?? 0) > 0 && (
        <Section step={5} icon={<Home size={16} />} title="기숙사 선택" subtitle="옵션 — 기숙사 없이도 견적 가능">
          <div className="space-y-2">
            {dormSelections.map((d, i) => (
              <ItemSelectorRow key={i} items={selectedSchool.dormitories ?? []}
                selectedId={d.dormitoryId} weeks={d.weeks}
                onSelect={id => updateDorm(i, { dormitoryId: id })}
                onWeeks={w => updateDorm(i, { weeks: w })}
                onDelete={dormSelections.length > 1 ? () => removeDorm(i) : undefined}
                getName={(item) => (item as Dormitory).name}
                getId={(item) => (item as Dormitory).id} />
            ))}
            <button onClick={addDorm}
              className="w-full px-3 py-2 text-xs text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-center gap-1">
              <Plus size={12} /> 기숙사 추가
            </button>
          </div>
        </Section>
      )}

      {/* 기숙사 없는 학원 안내 (영어유치원 등 외부 거주 전제 학원) */}
      {selectedSchool && (selectedSchool.dormitories?.length ?? 0) === 0 && (
        <Section step={5} icon={<Home size={16} />} title="기숙사" subtitle="이 학원은 기숙사를 운영하지 않습니다">
          <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-3 py-2 rounded">
            ℹ️ {selectedSchool.name}은(는) 자료 기준 기숙사를 직접 운영하지 않습니다. 외부 거주 전제이며, 견적에 기숙사비는 포함되지 않습니다.
          </div>
        </Section>
      )}

      {/* 6. 패키지 선택 - 학원에 packages가 있을 때만 표시 */}
      {selectedSchool && (selectedSchool.packages?.length ?? 0) > 0 && (
        <Section step={6} icon={<BookOpen size={16} />} title="패키지 선택"
          subtitle={`${selectedSchool.name}의 정액 패키지 (가족캠프·주니어캠프·정액 코스 등)`}>
          <div className="space-y-2">
            {packageSelections.map((p, i) => (
              <PackageSelectorRow key={i}
                packages={filterAvailablePackages(selectedSchool.packages ?? [], startDate)}
                allPackages={selectedSchool.packages ?? []}
                packageId={p.packageId}
                columnLabel={p.columnLabel}
                weeks={p.weeks}
                onSelectPackage={id => {
                  // 패키지 변경 시 weeks/columnLabel을 그 패키지 기본값으로
                  const pkg = (selectedSchool.packages ?? []).find(pk => pk.id === id)
                  const firstRow = pkg?.priceMatrix?.[0]
                  const firstWeeks = firstRow?.weeks ?? 4
                  const firstCol = firstRow?.prices?.[0]?.label ?? ''
                  updatePackage(i, { packageId: id, weeks: firstWeeks, columnLabel: firstCol })
                }}
                onSelectColumn={lbl => updatePackage(i, { columnLabel: lbl })}
                onWeeks={w => updatePackage(i, { weeks: w })}
                onDelete={packageSelections.length > 1 ? () => removePackage(i) : undefined}
              />
            ))}
            <button onClick={addPackage}
              className="w-full px-3 py-2 text-xs text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-center gap-1">
              <Plus size={12} /> 패키지 추가
            </button>
            {startDate && filterAvailablePackages(selectedSchool.packages ?? [], startDate).length < (selectedSchool.packages?.length ?? 0) && (
              <div className="text-xs text-gray-500 px-1">
                ℹ️ 시작일({startDate}) 기준 유효한 패키지만 표시. 전체 패키지는 시작일을 비우면 볼 수 있습니다.
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 결과 + 프로모션 토글 */}
      {calcResult && (
        <ResultPanel result={calcResult} promos={schoolPromos}
          appliedIds={appliedPromoIds} previewDiffs={promoPreviewDiffs}
          onToggle={togglePromo}
          onOpenQuote={openQuoteForm}
          startDate={startDate} setStartDate={setStartDate} />
      )}

      {/* 견적 근거 (학원 가격표) */}
      {selectedSchool && calcResult && (
        <BasisPanel school={selectedSchool} show={showBasis} onToggle={() => setShowBasis(s => !s)}
          appliedPromos={schoolPromos.filter(p => appliedPromoIds.has(p.id))} />
      )}

      {/* 견적서 모달 */}
      {quoteModal && (
        <QuoteFormModal
          school={quoteModal.school}
          calcResult={quoteModal.calcResult}
          startDate={quoteModal.startDate}
          localFees={quoteModal.localFees}
          phpToKrw={rate.phpToKrw}
          onClose={() => setQuoteModal(null)}
        />
      )}
    </div>
  )
}

// ─── 섹션 컨테이너 ──────────────────────────────────────────────────────
function Section({
  step, icon, title, subtitle, value, subValue, onReset, children,
}: {
  step: number; icon: React.ReactNode; title: string; subtitle?: string
  value?: string; subValue?: string; onReset?: () => void; children: React.ReactNode
}) {
  const filled = value !== undefined && value !== ''
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${filled ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
            {filled ? <Check size={12} /> : step}
          </div>
          <div>
            <div className="font-medium text-gray-900 text-sm flex items-center gap-1.5">
              {icon}{title}
            </div>
            {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
          </div>
        </div>
        {filled && onReset && (
          <button onClick={onReset} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <RefreshCw size={11} /> 변경
          </button>
        )}
      </div>
      {filled && (
        <div className="text-sm text-gray-700 pl-8">
          <span className="font-medium">{value}</span>
          {subValue && <span className="text-gray-500 ml-2">{subValue}</span>}
        </div>
      )}
      {children && <div className="pl-8 mt-2">{children}</div>}
    </div>
  )
}

// ─── 아이템 선택 행 ────────────────────────────────────────────────────
function ItemSelectorRow<T>({
  items, selectedId, weeks, onSelect, onWeeks, onDelete, getName, getId,
}: {
  items: T[]; selectedId: string; weeks: number
  onSelect: (id: string) => void; onWeeks: (w: number) => void
  onDelete?: () => void; getName: (item: T) => string; getId: (item: T) => string
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 bg-gray-50 rounded-lg">
      <select value={selectedId} onChange={e => onSelect(e.target.value)}
        className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded bg-white">
        <option value="">선택 안 함</option>
        {items.map(item => (
          <option key={getId(item)} value={getId(item)}>{getName(item)}</option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <input type="number" min={1} max={52} value={weeks}
          onChange={e => onWeeks(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 px-2 py-1.5 text-sm border border-gray-200 rounded text-right" />
        <span className="text-xs text-gray-500">주</span>
        {onDelete && (
          <button onClick={onDelete} className="p-1 text-gray-400 hover:text-red-600">
            <Minus size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── 결과 패널 (프로모션 미리보기 차감액 + 견적 만들기 버튼) ──────────
function ResultPanel({
  result, promos, appliedIds, previewDiffs, onToggle, onOpenQuote, startDate, setStartDate,
}: {
  result: CalcResult
  promos: PromoEntry[]
  appliedIds: Set<string>
  previewDiffs: Map<string, number>
  onToggle: (id: string) => void
  onOpenQuote: () => void
  startDate: string
  setStartDate: (d: string) => void
}) {
  return (
    <div className="card p-4 bg-gradient-to-b from-blue-50/60 to-white border-blue-200 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">계산 결과</h3>
        <div className="text-xs text-gray-500">{result.totalWeeks}주</div>
      </div>

      {/* 비용 내역 — 고정 순서: 등록비 → 코스 → 기숙사 → 현지납부비 → 프로모션 → 유학원할인 */}
      <div className="space-y-1 text-sm">
        {/* 1. 등록비 */}
        {result.registrationFeeKrw > 0 && (
          <PriceLine label="등록비" value={result.registrationFeeKrw} sub />
        )}
        {/* 2. 코스 */}
        {result.courseItems.map((item, i) => (
          <PriceLine key={`c-${i}`} label={item.label} value={item.krwAmount} />
        ))}
        {/* 3. 기숙사 */}
        {result.dormItems.map((item, i) => (
          <PriceLine key={`d-${i}`} label={item.label} value={item.krwAmount} />
        ))}
        {/* 4. 서차지 (성수기) */}
        {result.surchargeItems.map((item, i) => (
          <PriceLine key={`s-${i}`} label={item.label} value={item.krwAmount} sub />
        ))}
        {/* 5. 현지납부비 — 별도 표기 (원화 합계 미포함) */}
        {result.localFeePhp > 0 && (
          <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
            <span>현지납부비 (현지 직접 납부)</span>
            <span>₱{result.localFeePhp.toLocaleString()} · 약 {result.localFeeKrwEstimate.toLocaleString()}원</span>
          </div>
        )}
        {/* 6. 프로모션 (학원 자체 할인) */}
        {result.promotionLines.filter(l => l.kind === 'school' && l.status === 'applied').map((l) => (
          <PriceLine key={`ps-${l.id}`} label={`${l.label} (${l.basis})`} value={-l.discountKrw} discount />
        ))}
        {/* 7. 유학원 할인 */}
        {result.promotionLines.filter(l => l.kind === 'agency' && l.status === 'applied').map((l) => (
          <PriceLine key={`pa-${l.id}`} label="유학원 할인" value={-l.discountKrw} discount />
        ))}
        {/* 구버전 폴백 */}
        {result.promotionLines.length === 0 && result.promotionDiscount > 0 && (
          <PriceLine label={`프로모션 할인${result.promotionLabel ? ` (${result.promotionLabel})` : ''}`}
            value={-result.promotionDiscount} discount />
        )}
        {result.promotionLines.length === 0 && result.agencyDiscountKrw > 0 && (
          <PriceLine label={`유학원 자체 할인${result.agencyDiscountNote ? ` (${result.agencyDiscountNote})` : ''}`}
            value={-result.agencyDiscountKrw} discount />
        )}
      </div>

      {/* 조건 미충족 프로모션 — 회색 안내 (적용 안 됐지만 존재함을 알림) */}
      {result.promotionLines.filter(l => l.status === 'unmet').length > 0 && (
        <div className="space-y-1 pt-2">
          <p className="text-xs text-gray-400 font-medium">조건 미충족 (미적용)</p>
          {result.promotionLines.filter(l => l.status === 'unmet').map((l) => (
            <div key={`pu-${l.id}`} className="flex items-center justify-between text-xs text-gray-400">
              <span>{l.label} — {l.unmetReason}</span>
              <span className="line-through">{l.basis}</span>
            </div>
          ))}
        </div>
      )}

      {/* 날짜 미정 보류 항목 — 데이트피커로 확정 유도 */}
      {result.promotionLines.filter(l => l.status === 'pending').length > 0 && (
        <div className="space-y-2 pt-3 border-t border-amber-200 bg-amber-50/50 -mx-1 px-3 py-2 rounded">
          <div className="flex items-center gap-1.5">
            <Calendar size={13} className="text-amber-600" />
            <p className="text-xs text-amber-700 font-medium">입국일을 정하면 아래 항목이 견적에 반영됩니다</p>
          </div>
          {result.promotionLines.filter(l => l.status === 'pending').map((l) => (
            <div key={`pp-${l.id}`} className="flex items-center justify-between text-xs text-amber-800">
              <span>{l.label}</span>
              <span className="text-amber-600">{l.periodNote ?? l.basis}</span>
            </div>
          ))}
          <input type="date" value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm bg-white"
            placeholder="입국일 선택" />
        </div>
      )}

      <div className="pt-3 border-t border-blue-200 flex items-baseline justify-between">
        <span className="text-sm font-medium text-gray-700">최종 견적</span>
        <span className="text-2xl font-bold text-blue-700">{formatKrw(result.totalKrw)}</span>
      </div>

      {/* 경고/안내 */}
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((w, i) => {
            const isCritical = w.includes('[단기-미확인]') || w.includes('🔴')
            return isCritical ? (
              <div key={i} className="text-sm text-red-800 bg-red-50 border border-red-300 px-3 py-2 rounded flex items-start gap-2 font-medium">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-red-600" />
                <span>{w}</span>
              </div>
            ) : (
              <div key={i} className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{w}</span>
              </div>
            )
          })}
        </div>
      )}
      {result.notes.length > 0 && (
        <div className="space-y-1">
          {result.notes.map((n, i) => (
            <div key={i} className="text-xs text-gray-600 px-2 py-1">{n}</div>
          ))}
        </div>
      )}

      {/* 프로모션 적용/해제 - 차감액 미리보기 표시 */}
      <div className="pt-3 border-t border-blue-200">
        <h4 className="text-sm font-medium text-gray-900 mb-2">
          적용 가능 프로모션 ({promos.length}개)
        </h4>
        {promos.length === 0 ? (
          <p className="text-xs text-gray-500">이 학원에 등록된 활성 프로모션이 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {promos.map(p => (
              <PromoToggle key={p.id} promo={p}
                applied={appliedIds.has(p.id)}
                diff={previewDiffs.get(p.id) ?? 0}
                onToggle={() => onToggle(p.id)} />
            ))}
          </div>
        )}
      </div>

      {/* 견적서 만들기 버튼 */}
      <div className="pt-3 border-t border-blue-200">
        <button onClick={onOpenQuote}
          className="w-full btn-primary flex items-center justify-center gap-2 py-2.5">
          <FileText size={16} />
          견적서 만들기
        </button>
        <p className="text-xs text-gray-400 mt-1.5 text-center">
          위 결과로 견적서를 작성/저장합니다
        </p>
      </div>
    </div>
  )
}

function PriceLine({ label, value, sub, discount }: { label: string; value: number; sub?: boolean; discount?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${sub ? 'text-xs text-gray-500' : 'text-sm text-gray-700'}`}>
      <span className="truncate flex-1">{label}</span>
      <span className={`font-medium tabular-nums ${discount ? 'text-red-600' : ''}`}>
        {formatKrw(value)}
      </span>
    </div>
  )
}

function PromoToggle({
  promo, applied, diff, onToggle,
}: {
  promo: PromoEntry; applied: boolean; diff: number; onToggle: () => void
}) {
  const status = promo.agencyDiscountStatus
  const statusBadge = status === 'disabled'
    ? { color: 'bg-gray-100 text-gray-500', label: '학원할인 X' }
    : status === 'unconfirmed'
    ? { color: 'bg-amber-100 text-amber-700', label: '확인 필요' }
    : null

  // diff 표시:
  // - 적용 안 됨 → diff < 0 (적용 시 할인됨) / diff > 0 (적용 시 비용 증가 - 드물 케이스)
  // - 적용 됨 → diff > 0 (해제 시 비용 증가)
  const diffLabel = (() => {
    if (diff === 0) return null
    if (!applied) {
      return diff < 0
        ? `적용 시 ${formatKrw(-diff)} 할인`
        : `적용 시 ${formatKrw(diff)} 추가`
    } else {
      return diff > 0
        ? `해제 시 ${formatKrw(diff)} 추가`
        : `해제 시 ${formatKrw(-diff)} 할인`
    }
  })()

  return (
    <button onClick={onToggle}
      className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
        applied
          ? 'bg-blue-100 border-blue-400 ring-1 ring-blue-300'
          : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50'
      }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${applied ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
              {applied && <Check size={10} className="text-white" />}
            </div>
            <span className="text-sm font-medium text-gray-900 truncate">{promo.promoName}</span>
            {statusBadge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusBadge.color}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
          {promo.promoContent && (
            <div className="text-xs text-gray-500 mt-1 line-clamp-2 pl-5.5">
              {promo.promoContent}
            </div>
          )}
          {promo.noteRaw && (
            <div className="text-[11px] text-gray-400 mt-0.5 line-clamp-1 pl-5.5">
              비고: {promo.noteRaw}
            </div>
          )}
        </div>
        {diffLabel && (
          <div className={`text-xs font-medium whitespace-nowrap ${diff < 0 ? 'text-green-600' : diff > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {diffLabel}
          </div>
        )}
      </div>
    </button>
  )
}

// ─── 견적 근거 패널 (학원 가격표 + 적용된 프로모션) ────────────────────
function BasisPanel({
  school, show, onToggle, appliedPromos,
}: {
  school: School; show: boolean; onToggle: () => void; appliedPromos: PromoEntry[]
}) {
  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2">
          <Table size={16} className="text-gray-500" />
          <span className="font-medium text-sm text-gray-900">견적 근거 (학원 데이터)</span>
        </div>
        <ChevronRight size={16} className={`text-gray-400 transition-transform ${show ? 'rotate-90' : ''}`} />
      </button>

      {show && (
        <div className="border-t border-gray-100 p-4 space-y-4">
          {/* 학원 기본 정보 */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">학원 정보</h4>
            <DataTable rows={[
              ['학원명', school.name],
              ['지역', school.region],
              ['캠퍼스', school.campus || '-'],
              ['학원 코드', school.schoolCode || '-'],
              ['학원 형태', school.schoolType === 'sparta' ? '스파르타' : school.schoolType === 'both' ? '일반+스파르타' : '일반'],
              ['최소 등록 주수', `${school.minWeeks}주`],
            ]} />
          </div>

          {/* 코스 가격표 */}
          {(school.courses?.length ?? 0) > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">코스 가격 (학원 자료)</h4>
              <DataTable
                headers={['코스명', '주당/4주 가격', '통화']}
                rows={(school.courses ?? []).map(c => [
                  c.name,
                  `${(getCoursePrice(c)).toLocaleString()}`,
                  c.currency ?? '-',
                ])}
              />
            </div>
          )}

          {/* 기숙사 가격표 */}
          {(school.dormitories?.length ?? 0) > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">기숙사 가격 (학원 자료)</h4>
              <DataTable
                headers={['기숙사명', '주당/4주 가격', '통화']}
                rows={(school.dormitories ?? []).map(d => [
                  d.name,
                  `${(getDormPrice(d)).toLocaleString()}`,
                  d.currency ?? '-',
                ])}
              />
            </div>
          )}

          {/* 등록비 */}
          {school.registrationFee && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">등록비</h4>
              <DataTable rows={[
                ['금액', `${school.registrationFee.amount?.toLocaleString() ?? 0}`],
                ['통화', school.registrationFee.currency ?? '-'],
              ]} />
            </div>
          )}

          {/* 현지 납부비 */}
          {(school.localFees?.length ?? 0) > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">현지 납부비</h4>
              <DataTable
                headers={['항목', '금액', '통화']}
                rows={(school.localFees ?? []).map(f => [
                  f.name, f.amount.toLocaleString(), f.currency,
                ])}
              />
            </div>
          )}

          {/* 적용된 프로모션 자료 원문 */}
          {appliedPromos.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                적용된 프로모션 자료 원문 ({appliedPromos.length}개)
              </h4>
              <div className="space-y-2">
                {appliedPromos.map(p => (
                  <div key={p.id} className="border border-gray-200 rounded p-3 bg-gray-50 text-xs space-y-1">
                    <div className="font-medium text-gray-900 text-sm">{p.promoName}</div>
                    {p.applyPeriodNote && (
                      <div><span className="text-gray-500">적용 기간:</span> {p.applyPeriodNote}</div>
                    )}
                    {p.promoContent && (
                      <div><span className="text-gray-500">프로모션 내용:</span> {p.promoContent}</div>
                    )}
                    {p.agencyDiscountRawText && (
                      <div><span className="text-gray-500">유학원 프로모션:</span> {p.agencyDiscountRawText}</div>
                    )}
                    {p.noteRaw && (
                      <div><span className="text-gray-500">비고:</span> {p.noteRaw}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getCoursePrice(c: Course): number {
  return (c as unknown as { price4Weeks?: number; pricePerWeek?: number }).price4Weeks
    ?? (c as unknown as { price4Weeks?: number; pricePerWeek?: number }).pricePerWeek
    ?? 0
}
function getDormPrice(d: Dormitory): number {
  return (d as unknown as { price4Weeks?: number; pricePerWeek?: number }).price4Weeks
    ?? (d as unknown as { price4Weeks?: number; pricePerWeek?: number }).pricePerWeek
    ?? 0
}

function DataTable({ headers, rows }: { headers?: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded">
      <table className="w-full text-xs">
        {headers && (
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="text-left px-3 py-2 font-medium text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
              {row.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 && !headers ? 'font-medium text-gray-700 w-1/3' : 'text-gray-900'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── 패키지 필터링 ──────────────────────────────────────────────────────
// 시작일(startDate)이 주어지면, 해당 날짜에 유효한 패키지만 반환.
// 매칭 규칙:
//   1. 패키지에 startDate/endDate가 있으면 그 범위에 있는 것
//   2. 패키지에 schedules가 있으면 어느 일정 기간에 들어가는 것
//   3. 둘 다 없으면 항상 표시(연중)
// startDate가 비어있으면 전체 표시.
function filterAvailablePackages(packages: Package[], startDate: string): Package[] {
  if (!startDate || !startDate.trim()) return packages
  return packages.filter(p => {
    // 1. 직접 범위
    if (p.startDate && p.endDate) {
      if (startDate >= p.startDate && startDate <= p.endDate) return true
    }
    // 2. schedules 중 어느 일정에 들어가는지
    if (p.schedules && p.schedules.length > 0) {
      const match = p.schedules.some(s => startDate >= s.startDate && startDate <= s.endDate)
      if (match) return true
      // schedules가 있는데 어느 일정에도 안 맞으면 제외
      return false
    }
    // 3. 기간 정보 없으면 연중으로 보고 표시
    if (!p.startDate && !p.endDate && (!p.schedules || p.schedules.length === 0)) return true
    return false
  })
}

// ─── 패키지 선택 행 ──────────────────────────────────────────────────────
function PackageSelectorRow({
  packages, allPackages, packageId, columnLabel, weeks,
  onSelectPackage, onSelectColumn, onWeeks, onDelete,
}: {
  packages: Package[]        // 시즌 필터 통과한 것 (드롭다운에 표시)
  allPackages: Package[]     // 전체 (선택된 패키지가 필터 밖이어도 찾기 위함)
  packageId: string
  columnLabel: string
  weeks: number
  onSelectPackage: (id: string) => void
  onSelectColumn: (lbl: string) => void
  onWeeks: (w: number) => void
  onDelete?: () => void
}) {
  // 현재 선택된 패키지 객체 - 필터 밖이라도 전체에서 찾기 (사용자가 시작일 바꿔 필터 변경된 경우)
  const selectedPkg = allPackages.find(p => p.id === packageId)
  const availableWeeks = selectedPkg?.priceMatrix?.map(r => r.weeks) ?? []
  const currentRow = selectedPkg?.priceMatrix?.find(r => r.weeks === weeks) ?? selectedPkg?.priceMatrix?.[0]
  const availableColumns = currentRow?.prices?.map(c => c.label) ?? selectedPkg?.columns ?? []

  return (
    <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-lg">
      {/* 패키지 + 삭제 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select value={packageId} onChange={e => onSelectPackage(e.target.value)}
          className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded bg-white">
          <option value="">패키지 선택...</option>
          {packages.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}{p.season ? ` [${p.season}]` : ''}
            </option>
          ))}
        </select>
        {onDelete && (
          <button onClick={onDelete} className="p-1 text-gray-400 hover:text-red-600 self-end sm:self-center">
            <Minus size={14} />
          </button>
        )}
      </div>

      {/* 선택된 패키지가 있을 때만 주수/구성 옵션 표시 */}
      {selectedPkg && (
        <div className="flex flex-col sm:flex-row gap-2 pl-1">
          {/* 주수 */}
          {availableWeeks.length > 1 ? (
            <select value={weeks} onChange={e => onWeeks(Number(e.target.value))}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded bg-white">
              {availableWeeks.map(w => <option key={w} value={w}>{w}주</option>)}
            </select>
          ) : availableWeeks.length === 1 ? (
            <span className="px-2 py-1.5 text-xs text-gray-600">{availableWeeks[0]}주 (고정)</span>
          ) : (
            <input type="number" min={1} max={52} value={weeks}
              onChange={e => onWeeks(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 px-2 py-1.5 text-xs border border-gray-200 rounded text-right" />
          )}

          {/* 구성(columnLabel) */}
          {availableColumns.length > 0 && (
            <select value={columnLabel} onChange={e => onSelectColumn(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded bg-white">
              <option value="">구성 선택...</option>
              {availableColumns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      )}

      {/* 선택된 패키지 설명(시즌·일정·포함내역 요약) */}
      {selectedPkg && (
        <div className="text-xs text-gray-500 pl-1 space-y-0.5">
          {selectedPkg.season && <div>시즌: {selectedPkg.season}</div>}
          {selectedPkg.startDate && selectedPkg.endDate && (
            <div>유효기간: {selectedPkg.startDate} ~ {selectedPkg.endDate}</div>
          )}
          {selectedPkg.note && <div className="text-gray-600">{selectedPkg.note}</div>}
        </div>
      )}
    </div>
  )
}
