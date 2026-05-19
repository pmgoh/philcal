'use client'
import { useState, useMemo, useEffect } from 'react'
import type { School, ExchangeRate, Course, Dormitory, LocalFee } from '@/types'
import type { PromoEntry } from '@/lib/db'
import { calculateQuote, type CalcResult, type QuoteInput } from '@/lib/calcEngine'
import { findSchoolForPromo } from '@/lib/schoolMatching'
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
  const [region, setRegion] = useState<string>('')
  const [schoolId, setSchoolId] = useState<string>('')
  const [courseSelections, setCourseSelections] = useState<Array<{ courseId: string; weeks: number }>>([])
  const [dormSelections, setDormSelections] = useState<Array<{ dormitoryId: string; weeks: number }>>([])
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [appliedPromoIds, setAppliedPromoIds] = useState<Set<string>>(new Set())
  const [showBasis, setShowBasis] = useState(false)
  const [quoteModal, setQuoteModal] = useState<{
    calcResult: CalcResult; school: School; startDate: string; localFees: LocalFee[]
  } | null>(null)

  // 지역 목록
  const regions = useMemo(() => {
    const set = new Set(schools.map(s => s.region))
    return Array.from(set).sort()
  }, [schools])

  // 선택된 지역의 학원
  const schoolsInRegion = useMemo(() => {
    if (!region) return []
    return schools.filter(s => s.region === region).sort((a, b) => a.name.localeCompare(b.name))
  }, [schools, region])

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
    setAppliedPromoIds(new Set())
    setShowBasis(false)
  }
  const resetFromRegion = () => {
    setRegion('')
    resetFromSchool()
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

  // 학원 선택 시 코스/기숙사 1개씩 자동 추가
  useEffect(() => {
    if (selectedSchool && courseSelections.length === 0) {
      setCourseSelections([{ courseId: '', weeks: 4 }])
    }
    if (selectedSchool && dormSelections.length === 0) {
      setDormSelections([{ dormitoryId: '', weeks: 4 }])
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
    if (validCourses.length === 0 && validDorms.length === 0) return null

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
    [selectedSchool, courseSelections, dormSelections, startDate, schoolPromos, appliedPromoIds, rate])

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

      {/* 3. 입국일 */}
      {selectedSchool && (
        <Section step={3} icon={<Calendar size={16} />} title="입국 예정일" value={startDate}>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
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
      {selectedSchool && (
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

      {/* 결과 + 프로모션 토글 */}
      {calcResult && (
        <ResultPanel result={calcResult} promos={schoolPromos}
          appliedIds={appliedPromoIds} previewDiffs={promoPreviewDiffs}
          onToggle={togglePromo}
          onOpenQuote={openQuoteForm} />
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
  result, promos, appliedIds, previewDiffs, onToggle, onOpenQuote,
}: {
  result: CalcResult
  promos: PromoEntry[]
  appliedIds: Set<string>
  previewDiffs: Map<string, number>
  onToggle: (id: string) => void
  onOpenQuote: () => void
}) {
  return (
    <div className="card p-4 bg-gradient-to-b from-blue-50/60 to-white border-blue-200 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">계산 결과</h3>
        <div className="text-xs text-gray-500">{result.totalWeeks}주</div>
      </div>

      {/* 비용 내역 */}
      <div className="space-y-1 text-sm">
        {result.courseItems.map((item, i) => (
          <PriceLine key={`c-${i}`} label={item.label} value={item.krwAmount} />
        ))}
        {result.dormItems.map((item, i) => (
          <PriceLine key={`d-${i}`} label={item.label} value={item.krwAmount} />
        ))}
        {result.surchargeItems.map((item, i) => (
          <PriceLine key={`s-${i}`} label={item.label} value={item.krwAmount} sub />
        ))}
        {result.registrationFeeKrw > 0 && (
          <PriceLine label="등록비" value={result.registrationFeeKrw} sub />
        )}
        {result.promotionDiscount > 0 && (
          <PriceLine label={`프로모션 할인${result.promotionLabel ? ` (${result.promotionLabel})` : ''}`}
            value={-result.promotionDiscount} discount />
        )}
        {result.agencyDiscountKrw > 0 && (
          <PriceLine label={`유학원 자체 할인${result.agencyDiscountNote ? ` (${result.agencyDiscountNote})` : ''}`}
            value={-result.agencyDiscountKrw} discount />
        )}
      </div>

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
