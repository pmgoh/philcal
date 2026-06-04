'use client'

// 단계식 견적 계산기.
// 견적 챗봇과 동일한 계산 엔진(/api/quote의 directCalc)을 쓰되,
// 입력을 슬롯 머신 순서대로 한 단계씩 확인하며 진행한다(설문형).
//  순서: (자연어 시작) → 1.학원 → 2.총주수 → 3.코스(선택→주수, 합 채울때까지) →
//        4.기숙(동일) → 5.시작일 → 계산
// 검색은 이미 로드된 목록을 키워드로 필터(드롭다운 펼침)만 한다.

import { useState, useEffect, useMemo } from 'react'
import { getSchools, getExchangeRate, getPromotions, getSchoolAliases } from '@/lib/db'
import { schoolHasMode, MODE_LABELS, type SchoolMode } from '@/lib/schoolMode'
import { extractSlots } from '@/lib/slotMachine'
import QuoteResultCard from '@/components/QuoteResultCard'
import { PromotionPanel, EvidenceCard, LocalFeePanel, PeriodTimeline, MarkdownText, CalcEvidenceTable, DiscountEvidenceTable } from '@/components/QuoteEvidence'
import AdminLayout from '@/components/AdminLayout'
import MondayPicker from '@/components/MondayPicker'
import QuoteFormModal from '@/components/QuoteFormModal'
import type { School, ExchangeRate, LocalFee } from '@/types'
import type { PromoEntry } from '@/lib/db'
import type { CalcResult } from '@/lib/calcEngine'
import { Search, Check, Pencil, Calculator, Home, ArrowRight, RotateCcw, FileText } from 'lucide-react'

type Picked = { id: string; name: string; price4Weeks: number; weeks: number }

export default function CalculatorPage() {
  const [schools, setSchools] = useState<School[]>([])
  const [rate, setRate] = useState<ExchangeRate | null>(null)
  const [promotions, setPromotions] = useState<PromoEntry[]>([])
  const [aliasData, setAliasData] = useState<Record<string, string[]>>({})
  const [loaded, setLoaded] = useState(false)

  const [mode, setMode] = useState<SchoolMode>('regular')

  // ── 슬롯 상태 ──
  const [school, setSchool] = useState<School | null>(null)
  const [totalWeeks, setTotalWeeks] = useState<number | null>(null)
  const [courses, setCourses] = useState<Picked[]>([])
  const [dorms, setDorms] = useState<Picked[]>([])
  const [noDorm, setNoDorm] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [startDateSet, setStartDateSet] = useState(false)

  // 자연어 첫 입력
  const [nlInput, setNlInput] = useState('')
  const [nlDone, setNlDone] = useState(false)

  // 계산 결과
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [evidence, setEvidence] = useState<{ evidenceMessage?: string; discountEvidence?: string; localFeePhp?: number; localFeeKrwEstimate?: number; localFees?: unknown[] }>({})
  const [calcing, setCalcing] = useState(false)
  const [calcError, setCalcError] = useState('')
  const [showQuoteModal, setShowQuoteModal] = useState(false)

  useEffect(() => {
    Promise.all([getSchools(), getExchangeRate(), getPromotions(), getSchoolAliases()]).then(([s, r, p, a]) => {
      setSchools(s); setRate(r); setPromotions(p)
      const am: Record<string, string[]> = {}
      a.forEach(d => { am[d.schoolCode] = d.aliases })
      setAliasData(am)
      setLoaded(true)
    })
  }, [])

  // 모드에 맞는 학원만
  const modeSchools = useMemo(() => schools.filter(s => schoolHasMode(s, mode)), [schools, mode])

  // 자연어 입력 → 슬롯 추출로 초기값 세팅
  const startFromNL = () => {
    setNlDone(true)
    if (!nlInput.trim()) return
    const { slots } = extractSlots([nlInput], modeSchools as School[], aliasData)
    if (slots.schoolId) {
      const sc = schools.find(s => s.id === slots.schoolId)
      if (sc) setSchool(sc)
    }
    if (slots.totalWeeks) setTotalWeeks(slots.totalWeeks)
    // 코스/기숙은 단계에서 확인 (자연어로 다 채우지 않고 확인 위주)
  }

  const reset = () => {
    setSchool(null); setTotalWeeks(null); setCourses([]); setDorms([])
    setNoDorm(false); setStartDate(''); setStartDateSet(false)
    setNlInput(''); setNlDone(false); setCalcResult(null); setCalcError('')
  }

  // 현재 채워진 주수 합
  const courseWeeks = courses.reduce((s, c) => s + c.weeks, 0)
  const dormWeeks = dorms.reduce((s, d) => s + d.weeks, 0)

  // 단계 판정
  const step = !school ? 'school'
    : !totalWeeks ? 'weeks'
    : courseWeeks < totalWeeks ? 'course'
    : !noDorm && dormWeeks < totalWeeks ? 'dorm'
    : !startDateSet ? 'startDate'
    : 'ready'

  // 계산 실행 (챗봇과 동일 엔진)
  const runCalc = async () => {
    if (!school) return
    setCalcing(true); setCalcError('')
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],
          schoolsData: schools, rateData: rate, promotionsData: promotions,
          mode, aliasData,
          directCalc: {
            schoolId: school.id,
            startDate, enrollmentDate: startDate,
            courses: courses.map(c => ({ courseId: c.id, weeks: c.weeks })),
            dormitories: dorms.map(d => ({ dormitoryId: d.id, weeks: d.weeks })),
            packages: [],
          },
        }),
      })
      const data = await res.json()
      if (data.calcResult) {
        setCalcResult(data.calcResult)
        setEvidence({
          evidenceMessage: data.evidenceMessage,
          discountEvidence: data.discountEvidence,
          localFeePhp: data.localFeePhp,
          localFeeKrwEstimate: data.localFeeKrwEstimate,
          localFees: data.localFees,
        })
      }
      else setCalcError(data.question || data.error || '계산에 실패했습니다.')
    } catch (e) {
      setCalcError(String(e))
    } finally {
      setCalcing(false)
    }
  }

  if (!loaded) return (
    <AdminLayout>
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    </AdminLayout>
  )

  return (
    <AdminLayout>
    <div className="max-w-2xl mx-auto p-4 md:p-6 pb-24">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calculator size={20} className="text-blue-600" />
          <h1 className="text-base font-bold text-gray-900">단계식 계산기</h1>
        </div>
        <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <RotateCcw size={13} /> 처음부터
        </button>
      </div>

      {/* 모드 선택 */}
      <div className="flex gap-2 mb-4">
        {(['regular', 'camp_family'] as SchoolMode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); reset() }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* 자연어 시작 (선택) */}
      {!nlDone && (
        <div className="card p-4 mb-4">
          <p className="text-sm font-medium text-gray-800 mb-2">어떤 견적인지 자유롭게 입력하거나, 바로 단계별로 진행하세요.</p>
          <div className="flex gap-2">
            <input value={nlInput} onChange={e => setNlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startFromNL()}
              placeholder="예: ev 12주" className="input-field flex-1 text-sm" />
            <button onClick={startFromNL} className="btn-primary text-sm whitespace-nowrap flex items-center gap-1">
              시작 <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {nlDone && (
        <div className="space-y-3">
          {/* 진행 요약 (확정된 슬롯) */}
          <ProgressSummary
            school={school} totalWeeks={totalWeeks} courses={courses} dorms={dorms}
            noDorm={noDorm} startDate={startDate} startDateSet={startDateSet}
            onEditSchool={() => { setSchool(null); setCalcResult(null) }}
            onEditWeeks={() => { setTotalWeeks(null); setCourses([]); setDorms([]); setCalcResult(null) }}
            onEditCourses={() => { setCourses([]); setCalcResult(null) }}
            onEditDorms={() => { setDorms([]); setNoDorm(false); setCalcResult(null) }}
            onEditStart={() => { setStartDateSet(false); setCalcResult(null) }}
          />

          {/* 단계별 카드 */}
          {!calcResult && step === 'school' && (
            <SearchSelect title="학원을 선택하세요"
              items={modeSchools.map(s => ({ id: s.id, name: s.name, sub: `${s.region ?? ''} ${(s.programTags ?? []).slice(0, 2).join('·')}` }))}
              onSelect={id => { const s = schools.find(x => x.id === id); if (s) setSchool(s) }} />
          )}

          {!calcResult && step === 'weeks' && (
            <StepCard title="총 몇 주 과정인가요?">
              <WeekButtons onPick={w => setTotalWeeks(w)} />
            </StepCard>
          )}

          {!calcResult && step === 'course' && school && (
            <CoursePicker school={school} totalWeeks={totalWeeks!} already={courses} remaining={totalWeeks! - courseWeeks}
              onAdd={(p) => setCourses([...courses, p])} />
          )}

          {!calcResult && step === 'dorm' && school && (
            <DormPicker school={school} totalWeeks={totalWeeks!} already={dorms} remaining={totalWeeks! - dormWeeks}
              onAdd={(p) => setDorms([...dorms, p])} onNoDorm={() => setNoDorm(true)} />
          )}

          {!calcResult && step === 'startDate' && (
            <StepCard title="입국(시작) 예정일이 언제인가요?" subtitle="입학은 월요일만 가능합니다. 미정이면 날짜 없이 기본 견적으로 진행 (서차지는 확정 시 반영)">
              <MondayPicker value={startDate} onSelect={d => { setStartDate(d); setStartDateSet(true) }} />
              <button onClick={() => { setStartDate(''); setStartDateSet(true) }}
                className="text-sm px-3 py-2 mt-2 w-full rounded-lg bg-gray-100 text-gray-600">입국일 미정으로 진행</button>
            </StepCard>
          )}

          {!calcResult && step === 'ready' && (
            <StepCard title="입력이 완료됐어요. 계산할까요?">
              <button onClick={runCalc} disabled={calcing}
                className="btn-primary w-full text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {calcing ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> 계산 중...</>
                  : <><Calculator size={15} /> 계산하기</>}
              </button>
              {calcError && <p className="text-xs text-red-600 mt-2">{calcError}</p>}
            </StepCard>
          )}

          {/* 결과 — 챗봇과 동일 항목·순서 */}
          {calcResult && school && rate && (
            <div className="card p-4">
              <QuoteResultCard school={school} calc={calcResult} startDate={startDate} />

              {/* 기간 타임라인 (서차지 구간) */}
              <PeriodTimeline
                startDate={startDate}
                totalWeeks={calcResult.totalWeeks}
                surchargeItems={calcResult.surchargeItems.map(s => ({ label: s.label, weeks: s.weeks }))}
              />

              {/* 현지비 */}
              {(calcResult.localFees ?? []).length > 0 && (
                <LocalFeePanel
                  fees={(evidence.localFees ?? calcResult.localFees) as LocalFee[]}
                  php={evidence.localFeePhp ?? calcResult.localFeePhp}
                  krwEstimate={evidence.localFeeKrwEstimate ?? calcResult.localFeeKrwEstimate}
                  weeks={calcResult.totalWeeks}
                  phpToKrw={rate.phpToKrw}
                />
              )}
              {/* 학원 비용표 */}
              {evidence.evidenceMessage && <EvidenceCard text={evidence.evidenceMessage} school={school} />}
              {/* 계산 근거 표 (항목별 단가·주수·금액 — 데이터 직접) */}
              <CalcEvidenceTable calc={calcResult} phpToKrw={rate.phpToKrw} />
              {/* 프로모션·할인 내역 */}
              {calcResult.promotionLines && (
                <PromotionPanel lines={calcResult.promotionLines} dateUnset={!startDate} />
              )}
              {/* 할인 근거 표 (조건→적용액 — 데이터 직접) */}
              {calcResult.promotionLines && <DiscountEvidenceTable lines={calcResult.promotionLines} />}

              <button onClick={() => setShowQuoteModal(true)}
                className="btn-primary w-full text-sm flex items-center justify-center gap-2 mt-3">
                <FileText size={15} /> 견적서 뽑기
              </button>
            </div>
          )}
        </div>
      )}

      {/* 견적서 모달 */}
      {showQuoteModal && calcResult && school && rate && (
        <QuoteFormModal
          school={school}
          calcResult={calcResult}
          startDate={startDate}
          localFees={calcResult.localFees ?? []}
          phpToKrw={rate.phpToKrw}
          onClose={() => setShowQuoteModal(false)}
        />
      )}
    </div>
    </AdminLayout>
  )
}

// ── 진행 요약 ──
function ProgressSummary({ school, totalWeeks, courses, dorms, noDorm, startDate, startDateSet,
  onEditSchool, onEditWeeks, onEditCourses, onEditDorms, onEditStart }: {
  school: School | null; totalWeeks: number | null; courses: Picked[]; dorms: Picked[]
  noDorm: boolean; startDate: string; startDateSet: boolean
  onEditSchool: () => void; onEditWeeks: () => void; onEditCourses: () => void; onEditDorms: () => void; onEditStart: () => void
}) {
  const rows: Array<{ label: string; value: string; edit: () => void }> = []
  if (school) rows.push({ label: '학원', value: school.name, edit: onEditSchool })
  if (totalWeeks) rows.push({ label: '기간', value: `${totalWeeks}주`, edit: onEditWeeks })
  if (courses.length) rows.push({ label: '코스', value: courses.map(c => `${c.name} ${c.weeks}주`).join(', '), edit: onEditCourses })
  if (noDorm) rows.push({ label: '기숙사', value: '통학 (없음)', edit: onEditDorms })
  else if (dorms.length) rows.push({ label: '기숙사', value: dorms.map(d => `${d.name} ${d.weeks}주`).join(', '), edit: onEditDorms })
  if (startDateSet) rows.push({ label: '입국일', value: startDate || '미정', edit: onEditStart })
  if (rows.length === 0) return null
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-2.5 space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between text-sm">
          <span><span className="text-gray-400 text-xs mr-2">{r.label}</span>{r.value}</span>
          <button onClick={r.edit} className="text-blue-500 hover:text-blue-700"><Pencil size={13} /></button>
        </div>
      ))}
    </div>
  )
}

// ── 단계 카드 래퍼 ──
function StepCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-sm font-medium text-gray-800 mb-1">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  )
}

// ── 검색-선택 (이미 로드된 목록을 키워드 필터) ──
function SearchSelect({ title, items, onSelect }: {
  title: string; items: Array<{ id: string; name: string; sub?: string }>; onSelect: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const filtered = q.trim() ? items.filter(it => (it.name + ' ' + (it.sub ?? '')).toLowerCase().includes(q.toLowerCase())) : items
  return (
    <div className="card p-4">
      <p className="text-sm font-medium text-gray-800 mb-2">{title}</p>
      <div className="relative mb-2">
        <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="검색 (키워드)"
          className="input-field w-full text-sm pl-9" />
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {filtered.map(it => (
          <button key={it.id} onClick={() => onSelect(it.id)}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 flex items-center justify-between group">
            <span className="text-sm text-gray-800">{it.name}</span>
            {it.sub && <span className="text-xs text-gray-400">{it.sub}</span>}
          </button>
        ))}
        {filtered.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">검색 결과가 없습니다.</p>}
      </div>
    </div>
  )
}

// ── 주수 버튼 ──
function WeekButtons({ onPick }: { onPick: (w: number) => void }) {
  const [custom, setCustom] = useState('')
  const common = [1, 2, 3, 4, 8, 12, 16, 20, 24]
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {common.map(w => (
          <button key={w} onClick={() => onPick(w)}
            className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-blue-100 text-sm">{w}주</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={custom} onChange={e => setCustom(e.target.value.replace(/\D/g, ''))} placeholder="직접 입력"
          className="input-field flex-1 text-sm" />
        <button onClick={() => custom && onPick(parseInt(custom, 10))} disabled={!custom}
          className="btn-primary text-sm disabled:opacity-40">확인</button>
      </div>
    </div>
  )
}

// ── 코스 선택 + 주수 (남은 주수까지) ──
function CoursePicker({ school, totalWeeks, already, remaining, onAdd }: {
  school: School; totalWeeks: number; already: Picked[]; remaining: number; onAdd: (p: Picked) => void
}) {
  const [sel, setSel] = useState<{ id: string; name: string; price: number } | null>(null)
  const list = (school.courses ?? [])
    .filter(c => ((c as unknown as Record<string, number>).price4Weeks ?? 0) > 0)
    .map(c => ({ id: c.id, name: c.name, price: (c as unknown as Record<string, number>).price4Weeks ?? 0 }))
  const partial = already.length > 0
  return (
    <div className="card p-4">
      {partial && (
        <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 text-xs text-amber-700">
          총 {totalWeeks}주 중 {totalWeeks - remaining}주 선택됨. 나머지 <b>{remaining}주</b>의 코스를 선택해주세요.
        </div>
      )}
      {!sel ? (
        <>
          <p className="text-sm font-medium text-gray-800 mb-2">{partial ? '나머지 코스' : '어떤 코스로 수강하실까요?'}</p>
          <CourseSearchList list={list} onPick={(it) => setSel(it)} />
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-800 mb-1"><span className="text-blue-600">{sel.name}</span>, 몇 주?</p>
          <p className="text-xs text-gray-400 mb-3">남은 {remaining}주 중</p>
          <WeekPicker max={remaining} onPick={(w) => { onAdd({ ...sel, price4Weeks: sel.price, weeks: w }); setSel(null) }} />
          <button onClick={() => setSel(null)} className="text-xs text-gray-400 mt-2">← 다른 코스 선택</button>
        </>
      )}
    </div>
  )
}

function CourseSearchList({ list, onPick }: { list: Array<{ id: string; name: string; price: number }>; onPick: (it: { id: string; name: string; price: number }) => void }) {
  const [q, setQ] = useState('')
  const filtered = q.trim() ? list.filter(it => it.name.toLowerCase().includes(q.toLowerCase())) : list
  return (
    <div>
      {list.length > 5 && (
        <div className="relative mb-2">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="코스 검색" className="input-field w-full text-sm pl-9" />
        </div>
      )}
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.map(it => (
          <button key={it.id} onClick={() => onPick(it)}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 flex items-center justify-between">
            <span className="text-sm text-gray-800">{it.name}</span>
            <span className="text-xs text-gray-400">{it.price.toLocaleString()}원/4주</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 기숙사 선택 + 주수 ──
function DormPicker({ school, totalWeeks, already, remaining, onAdd, onNoDorm }: {
  school: School; totalWeeks: number; already: Picked[]; remaining: number; onAdd: (p: Picked) => void; onNoDorm: () => void
}) {
  const [sel, setSel] = useState<{ id: string; name: string; price: number } | null>(null)
  const list = (school.dormitories ?? [])
    .filter(d => ((d as unknown as Record<string, number>).price4Weeks ?? 0) > 0)
    .map(d => ({ id: d.id, name: d.name, price: (d as unknown as Record<string, number>).price4Weeks ?? 0 }))
  const partial = already.length > 0
  if (list.length === 0) {
    return (
      <div className="card p-4 text-sm text-gray-600">
        이 학원은 기숙사 데이터가 없어 통학 전제로 진행합니다.
        <button onClick={onNoDorm} className="btn-primary text-sm mt-2 w-full">통학으로 진행</button>
      </div>
    )
  }
  return (
    <div className="card p-4">
      {partial && (
        <div className="bg-amber-50 rounded-lg px-3 py-2 mb-3 text-xs text-amber-700">
          나머지 <b>{remaining}주</b>의 기숙사를 선택해주세요.
        </div>
      )}
      {!sel ? (
        <>
          <p className="text-sm font-medium text-gray-800 mb-2">{partial ? '나머지 기숙사' : '기숙사는 어떻게 하실까요?'}</p>
          <CourseSearchList list={list} onPick={(it) => setSel(it)} />
          {!partial && (
            <button onClick={onNoDorm} className="w-full text-left px-3 py-2 mt-1 rounded-lg hover:bg-gray-50 text-sm text-gray-500 flex items-center gap-2">
              <Home size={14} /> 통학 (기숙사 없음)
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-800 mb-1"><span className="text-blue-600">{sel.name}</span>, 몇 주?</p>
          <p className="text-xs text-gray-400 mb-3">남은 {remaining}주 중</p>
          <WeekPicker max={remaining} onPick={(w) => { onAdd({ ...sel, price4Weeks: sel.price, weeks: w }); setSel(null) }} />
          <button onClick={() => setSel(null)} className="text-xs text-gray-400 mt-2">← 다른 기숙사 선택</button>
        </>
      )}
    </div>
  )
}

// ── 주수 선택 (남은 만큼) ──
function WeekPicker({ max, onPick }: { max: number; onPick: (w: number) => void }) {
  const [custom, setCustom] = useState('')
  const opts = Array.from(new Set([4, 8, 12, max].filter(w => w > 0 && w <= max))).sort((a, b) => a - b)
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {opts.map(w => (
          <button key={w} onClick={() => onPick(w)}
            className={`px-3 py-1.5 rounded-lg text-sm ${w === max ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 hover:bg-blue-100'}`}>
            {w}주{w === max ? ' (전체)' : ''}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={custom} onChange={e => setCustom(e.target.value.replace(/\D/g, ''))} placeholder={`최대 ${max}주`}
          className="input-field flex-1 text-sm" />
        <button onClick={() => { const w = parseInt(custom, 10); if (w > 0 && w <= max) onPick(w) }}
          disabled={!custom} className="btn-primary text-sm disabled:opacity-40">확인</button>
      </div>
    </div>
  )
}
