'use client'
import { useState, useEffect, useRef } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { getSchools, getExchangeRate, getPromotions } from '@/lib/db'
import type { School, ExchangeRate, LocalFee } from '@/types'
import { Send, RotateCcw, Copy, Check, ChevronDown, ChevronUp, DollarSign, FileText, MessageSquare, Calculator } from 'lucide-react'
import { formatKrw } from '@/lib/utils'
import QuoteFormModal from '@/components/QuoteFormModal'
import QuoteResultCard from '@/components/QuoteResultCard'
import DirectCalculator from '@/components/DirectCalculator'
import type { CalcResult } from '@/lib/calcEngine'
import { inferSchoolMode, MODE_LABELS, type SchoolMode } from '@/lib/schoolMode'

// ── 메시지 타입 ───────────────────────────────────────────────────────────────
type MessageRole = 'user' | 'assistant'

interface BaseMessage { role: MessageRole; content: string }

interface AssistantResultMessage extends BaseMessage {
  role: 'assistant'
  type: 'result'
  evidenceMessage?: string
  discountEvidence?: string
  regulationWarning?: string
  localFees?: LocalFee[]
  localFeePhp?: number
  localFeeKrwEstimate?: number
  startDate?: string
  enrollmentDate?: string
  totalWeeks?: number
  surchargeItems?: Array<{ label: string; weeks: number }>
  calcResult?: CalcResult
  school?: School
  // 검증 봇 결과
  verification?: string
  verifying?: boolean
  verifyError?: string
}

interface AssistantNeedInfoMessage extends BaseMessage {
  role: 'assistant'
  type: 'need_info'
  question: string
  suggestions?: string[]
  allowFreeText?: boolean
  isDateQuestion?: boolean   // 시작일 질문이면 달력(데이트피커) 표시
}

interface AssistantAnswerMessage extends BaseMessage {
  role: 'assistant'
  type: 'answer'
}

// [v5] 사용자 확인 카드. LLM이 정보 다 모았다고 confirm 보내면, calculate 직전에
// 사용자에게 "이 값으로 계산할게요" 카드 노출. 사용자가 [계산하기] 누르면 calculate 진행.
interface AssistantConfirmMessage extends BaseMessage {
  role: 'assistant'
  type: 'confirm'
  confirmCard: {
    schoolId: string
    schoolName: string
    totalWeeks?: number
    courses: { courseId: string; weeks: number }[]
    courseLabels: string[]
    dormitories: { dormitoryId: string; weeks: number }[]
    dormLabels: string[]
    packages?: { packageId: string; weeks: number; columnLabel: string }[]
    packageLabels?: string[]
    startDate: string
    startDateLabel: string
    enrollmentDate: string
  }
}

interface UserMessage extends BaseMessage { role: 'user'; type: 'user' }

type ChatMessage = UserMessage | AssistantResultMessage | AssistantNeedInfoMessage | AssistantAnswerMessage | AssistantConfirmMessage

// ── 초기 메시지 ───────────────────────────────────────────────────────────────
const INITIAL_MSG: AssistantAnswerMessage = {
  role: 'assistant', type: 'answer',
  content: '안녕하세요! 필리핀 어학연수 견적 상담입니다.\n\n학원, 기간, 코스, 기숙사, 입국 예정일을 알려주시면 바로 계산해드립니다.',
}

// ── 마크다운 렌더러 ──────────────────────────────────────────────────────────
function MarkdownText({ text, isUser = false }: { text: string; isUser?: boolean }) {
  const lines = text.split('\n')
  const textColor = isUser ? 'text-white' : 'text-gray-800'
  const subColor  = isUser ? 'text-blue-100' : 'text-gray-500'
  const boldClass = isUser ? 'text-white' : 'text-gray-900'

  const renderInline = (raw: string) =>
    raw.replace(/\*\*(.*?)\*\*/g, `<strong class="font-semibold ${boldClass}">$1</strong>`)
       .replace(/\*(.*?)\*/g, `<em class="${subColor}">$1</em>`)

  // 파이프 테이블 감지 및 그룹화
  const result: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 파이프 테이블 시작 감지
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      // 구분선 제외하고 파싱
      const rows = tableLines.filter(l => !/^\s*\|[-:\s|]+\|\s*$/.test(l))
      const parsed = rows.map(r =>
        r.split('|').slice(1, -1).map(cell => cell.trim())
      )
      if (parsed.length > 0) {
        const headers = parsed[0]
        const body = parsed.slice(1)
        result.push(
          <div key={i} className="overflow-x-auto my-2">
            <table className="text-xs w-full border-collapse rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-100">
                  {headers.map((h, hi) => (
                    <th key={hi} className="px-3 py-2 text-left font-semibold text-gray-700 border border-gray-200"
                      dangerouslySetInnerHTML={{ __html: renderInline(h) }} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 border border-gray-200 text-gray-700"
                        dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      continue
    }

    // 나머지 기존 렌더링
    if (line.startsWith('### ')) {
      const inner = line.slice(4).replace(/\*\*(.*?)\*\*/g, '$1')
      result.push(<h3 key={i} className={`font-bold text-base mt-2 mb-0.5 ${isUser ? 'text-blue-100' : 'text-blue-700'}`}>{inner}</h3>)
    } else if (line.startsWith('## ')) {
      result.push(<h2 key={i} className={`font-bold text-base mt-2 mb-1 ${isUser ? 'text-white' : 'text-gray-900'}`}>{line.slice(3)}</h2>)
    } else if (line.startsWith('**') && line.endsWith('**') && !line.slice(2, -2).includes('**')) {
      result.push(<p key={i} className={`font-semibold text-sm ${boldClass}`}>{line.slice(2, -2)}</p>)
    } else if (line === '---') {
      result.push(<hr key={i} className={`my-2 ${isUser ? 'border-blue-400' : 'border-gray-200'}`} />)
    } else if (line === '') {
      result.push(<div key={i} className="h-1" />)
    } else if (line.includes('!!AGENCY_DISCOUNT!!')) {
      const cleaned = line.replace('!!AGENCY_DISCOUNT!!', '').replace(/^-\s*/, '')
      result.push(
        <div key={i} className="flex gap-2 items-start bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 my-1">
          <span className="text-red-500 font-bold text-sm flex-shrink-0">✂️</span>
          <span className="text-red-700 font-semibold text-sm" dangerouslySetInnerHTML={{ __html: renderInline(cleaned) }} />
        </div>
      )
    } else if (line.startsWith('> 💡')) {
      result.push(
        <div key={i} className="bg-red-50 border-l-4 border-red-400 px-3 py-1.5 rounded-r-lg my-1">
          <p className="text-sm text-red-700 font-semibold">{line.slice(2)}</p>
        </div>
      )
    } else if (line.startsWith('> ')) {
      result.push(<p key={i} className={`text-xs italic pl-3 border-l-2 ${isUser ? 'border-blue-300 text-blue-100' : 'border-gray-300 text-gray-500'}`}>{line.slice(2)}</p>)
    } else if (line.startsWith('- ')) {
      result.push(
        <div key={i} className={`flex gap-2 text-sm ${textColor}`}>
          <span className="mt-0.5 flex-shrink-0 opacity-60">•</span>
          <span dangerouslySetInnerHTML={{ __html: renderInline(line.slice(2)) }} />
        </div>
      )
    } else if (line.startsWith('*') && line.endsWith('*')) {
      result.push(<p key={i} className={`text-xs italic ${subColor}`}>{line.slice(1, -1)}</p>)
    } else {
      result.push(<p key={i} className={`text-sm ${textColor}`} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />)
    }
    i++
  }

  return <div className="space-y-0.5 leading-relaxed">{result}</div>
}

// ── 기간 타임라인 ────────────────────────────────────────────────────────────
function PeriodTimeline({ startDate, totalWeeks, surchargeItems }: {
  startDate?: string
  totalWeeks?: number
  surchargeItems?: Array<{ label: string; weeks: number }>
}) {
  if (!startDate || !totalWeeks) return null
  const end = new Date(startDate)
  end.setDate(end.getDate() + totalWeeks * 7)

  return (
    <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">📅 연수기간</span>
        <span className="font-semibold text-slate-800">{startDate} ~ {end.toISOString().split('T')[0]}</span>
        <span className="text-blue-600 font-bold">({totalWeeks}주)</span>
      </div>
      {(surchargeItems ?? []).map((sc, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-orange-700">
          <span>🔥 서차지 구간</span>
          <span className="font-medium">{sc.label}</span>
        </div>
      ))}
    </div>
  )
}
function LocalFeePanel({ fees, php, krwEstimate, weeks, phpToKrw }: {
  fees: LocalFee[]; php: number; krwEstimate: number; weeks?: number; phpToKrw: number
}) {
  const [open, setOpen] = useState(false)
  // 택일 그룹별 선택 인덱스 (groupId → 선택된 멤버 index)
  const [groupSel, setGroupSel] = useState<Record<string, number>>({})
  if (!fees.length) return null

  const triggerLabel = (f: LocalFee) => {
    const t = f.trigger ?? 'always'
    if (t === 'always')     return '1회'
    if (t === 'per_week')   return weeks ? `주당×${weeks}` : '주당'
    if (t === 'per_4weeks') return weeks ? `4주당×${Math.ceil(weeks/4)}` : '4주당'
    if (t === 'over_weeks') return `${f.triggerWeeks??4}주 초과시`
    if (t === 'optional')   return '선택'
    return ''
  }
  const unitLabel = (f: LocalFee) => {
    const u = f.chargeUnit ?? 'flat'
    if (u === 'per_person') return '/인'
    if (u === 'per_trip')   return '/편도'
    if (u === 'per_night')  return '/박'
    return ''
  }
  const calcAmount = (f: LocalFee): number => {
    const t = f.trigger ?? 'always'
    if (t === 'optional')   return f.amount
    if (!weeks)             return f.amount
    if (t === 'per_week')   return f.amount * weeks
    if (t === 'per_4weeks') return f.amount * Math.ceil(weeks / 4)
    if (t === 'over_weeks') return weeks > (f.triggerWeeks ?? 4) ? f.amount : 0
    return f.amount
  }

  // 택일 그룹 분리
  const groups: Record<string, LocalFee[]> = {}
  const singles: LocalFee[] = []
  for (const f of fees) {
    const g = (f as { exclusiveGroup?: string }).exclusiveGroup
    if (g) { (groups[g] ??= []).push(f) }
    else singles.push(f)
  }
  const groupKeys = Object.keys(groups)
  const selectedIdx = (g: string) => groupSel[g] ?? Math.max(0, groups[g].findIndex(m => (m as {groupDefault?: boolean}).groupDefault))
  const cycleGroup = (g: string, dir: number) => {
    const len = groups[g].length
    const cur = selectedIdx(g)
    setGroupSel(s => ({ ...s, [g]: (cur + dir + len) % len }))
  }

  // 합계 재계산 (단독 + 그룹 선택분)
  const recalcEstimate = () => {
    let p = 0, k = 0
    for (const f of singles) {
      if ((f.trigger ?? 'always') === 'optional') continue
      const a = calcAmount(f)
      if (f.currency === 'KRW') k += a; else p += a
    }
    for (const g of groupKeys) {
      const sel = groups[g][selectedIdx(g)]
      const a = calcAmount(sel)
      if (sel.currency === 'KRW') k += a; else p += a
    }
    return Math.round(p * phpToKrw) + k
  }
  const liveEstimate = groupKeys.length > 0 ? recalcEstimate() : krwEstimate

  const renderFeeRow = (f: LocalFee, key: string) => {
    const amt = calcAmount(f)
    const isOptional = (f.trigger ?? 'always') === 'optional'
    if (amt === 0 && !isOptional) return null
    const isKrw = f.currency === 'KRW'
    return (
      <div key={key} className="flex justify-between items-center text-sm">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`truncate text-sm ${isOptional ? 'text-gray-400' : 'text-gray-700'}`}>{f.name}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${isOptional ? 'bg-gray-100 text-gray-400' : 'bg-amber-50 text-amber-600'}`}>
            {triggerLabel(f)}{unitLabel(f)}
          </span>
        </div>
        <span className={`font-medium flex-shrink-0 ml-2 ${isOptional ? 'text-gray-400' : 'text-gray-800'}`}>
          {isKrw ? formatKrw(amt) : `₱${amt.toLocaleString()}${f.amountMax ? `~${f.amountMax.toLocaleString()}` : ''}`}
          {!isKrw && <span className="text-xs text-gray-400 ml-1">(약 {formatKrw(Math.round(amt * phpToKrw))})</span>}
          {isOptional && <span className="text-xs text-gray-400 ml-1">[선택]</span>}
        </span>
      </div>
    )
  }

  return (
    <div className="mt-3 border border-amber-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors text-sm">
        <div className="flex items-center gap-2 text-amber-800 font-medium">
          <DollarSign size={14} />
          현지납부비 {weeks ? `(${weeks}주 기준)` : ''}
          <span className="text-xs text-amber-600 font-normal">약 {formatKrw(liveEstimate)}</span>
        </div>
        {open ? <ChevronUp size={14} className="text-amber-600" /> : <ChevronDown size={14} className="text-amber-600" />}
      </button>
      {open && (
        <div className="bg-white px-3 py-2 space-y-1.5">
          <p className="text-xs text-gray-400 mb-2">※ 현지 도착 후 직접 납부. 견적 총액 미포함.</p>
          {singles.map((f, i) => renderFeeRow(f, `s${i}`))}
          {/* 택일 그룹 — < >로 선택 */}
          {groupKeys.map(g => {
            const idx = selectedIdx(g)
            const sel = groups[g][idx]
            const amt = calcAmount(sel)
            const isKrw = sel.currency === 'KRW'
            return (
              <div key={g} className="flex justify-between items-center text-sm bg-blue-50 rounded-lg px-2 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <button onClick={() => cycleGroup(g, -1)} className="text-blue-500 hover:text-blue-700 px-1 font-bold">‹</button>
                  <span className="truncate text-sm text-gray-700">{sel.name}</span>
                  <button onClick={() => cycleGroup(g, 1)} className="text-blue-500 hover:text-blue-700 px-1 font-bold">›</button>
                  <span className="text-xs text-blue-400">({idx + 1}/{groups[g].length} 택일)</span>
                </div>
                <span className="font-medium flex-shrink-0 ml-2 text-gray-800">
                  {isKrw ? formatKrw(amt) : `₱${amt.toLocaleString()}`}
                  {!isKrw && <span className="text-xs text-gray-400 ml-1">(약 {formatKrw(Math.round(amt * phpToKrw))})</span>}
                </span>
              </div>
            )
          })}
          <div className="border-t border-gray-100 pt-1.5 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">합계 (선택 제외)</span>
            <span className="text-amber-700">약 {formatKrw(liveEstimate)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 근거 데이터 카드 ──────────────────────────────────────────────────────────
function EvidenceCard({ text, school }: { text: string; school?: School }) {
  const [open, setOpen] = useState(false)
  const [showSchoolData, setShowSchoolData] = useState(false)
  return (
    <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center bg-gray-50 px-3 py-2 gap-2">
        <button onClick={() => setOpen(!open)}
          className="flex-1 flex items-center justify-between text-sm hover:opacity-80">
          <span className="text-gray-600 font-medium text-xs">📎 견적 근거 데이터</span>
          {open ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
        </button>
        {school && (
          <button onClick={() => setShowSchoolData(!showSchoolData)}
            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-1 bg-white flex-shrink-0">
            학원 비용표
          </button>
        )}
      </div>
      {open && (
        <div className="bg-white px-3 py-2">
          <MarkdownText text={text} />
        </div>
      )}
      {showSchoolData && school && (
        <div className="bg-white border-t border-gray-100 px-3 py-3 overflow-x-auto">
          <p className="text-xs font-semibold text-gray-700 mb-2">{school.name} 비용표 (읽기 전용)</p>
          {/* 코스 */}
          {(school.courses ?? []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-1 font-medium">코스</p>
              <table className="text-xs w-full border-collapse">
                <thead><tr className="bg-gray-50">
                  <th className="text-left px-2 py-1 border border-gray-100">코스명</th>
                  <th className="text-left px-2 py-1 border border-gray-100">대상</th>
                  <th className="text-right px-2 py-1 border border-gray-100">4주 기준</th>
                </tr></thead>
                <tbody>{school.courses.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-2 py-1 border border-gray-100">{c.name}</td>
                    <td className="px-2 py-1 border border-gray-100 text-gray-500">{c.target}</td>
                    <td className="px-2 py-1 border border-gray-100 text-right font-medium">
                      {((c as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}{c.currency}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {/* 기숙사 */}
          {(school.dormitories ?? []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-1 font-medium">기숙사</p>
              <table className="text-xs w-full border-collapse">
                <thead><tr className="bg-gray-50">
                  <th className="text-left px-2 py-1 border border-gray-100">기숙사명</th>
                  <th className="text-left px-2 py-1 border border-gray-100">대상</th>
                  <th className="text-right px-2 py-1 border border-gray-100">4주 기준</th>
                </tr></thead>
                <tbody>{school.dormitories.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-2 py-1 border border-gray-100">{d.name}</td>
                    <td className="px-2 py-1 border border-gray-100 text-gray-500">{d.target}</td>
                    <td className="px-2 py-1 border border-gray-100 text-right font-medium">
                      {((d as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}{d.currency}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {/* 패키지 */}
          {(school.packages ?? []).length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium">패키지</p>
              {school.packages.map(p => {
                // priceMatrix 객체형({columns,rows}) → 배열형([{weeks,prices}]) 정규화
                const rawPm = (p as { priceMatrix?: unknown }).priceMatrix
                let cols = (p.columns ?? []) as string[]
                let matrix: Array<{ weeks: number; prices: Array<{ label: string; amount: number }> }> = []
                const weekOf = (c: string) => { const m = String(c).match(/(\d+)\s*(?:w|W|주)/); return m ? parseInt(m[1],10) : null }
                if (Array.isArray(rawPm)) {
                  matrix = rawPm as typeof matrix
                } else if (rawPm && typeof rawPm === 'object') {
                  const obj = rawPm as { columns?: string[]; rows?: Array<{ label?: string; prices?: number[] }> }
                  const colList = obj.columns ?? []
                  const rows = obj.rows ?? []
                  const weekCols = colList.map(weekOf)
                  if (weekCols.length > 0 && weekCols.every(w => w !== null)) {
                    cols = rows.map(r => r.label ?? '기본')
                    matrix = (weekCols as number[]).map((wk, ci) => ({
                      weeks: wk,
                      prices: rows.map(r => ({ label: r.label ?? '기본', amount: (r.prices ?? [])[ci] ?? 0 })),
                    }))
                  } else {
                    cols = colList
                    matrix = rows.map(r => ({
                      weeks: weekOf(r.label ?? '') ?? 4,
                      prices: colList.map((c, ci) => ({ label: c, amount: (r.prices ?? [])[ci] ?? 0 })),
                    }))
                  }
                }
                return (
                <div key={p.id} className="mb-2">
                  <p className="text-xs font-medium text-gray-700">{p.label} <span className="text-gray-400">({p.season})</span></p>
                  <table className="text-xs w-full border-collapse mt-1">
                    <thead><tr className="bg-gray-50">
                      <th className="text-left px-2 py-1 border border-gray-100">주수</th>
                      {cols.map(col => <th key={col} className="text-right px-2 py-1 border border-gray-100">{col}</th>)}
                    </tr></thead>
                    <tbody>{matrix.map(row => (
                      <tr key={row.weeks} className="hover:bg-gray-50">
                        <td className="px-2 py-1 border border-gray-100 font-medium">{row.weeks}주</td>
                        {(row.prices ?? []).map(cell => (
                          <td key={cell.label} className="px-2 py-1 border border-gray-100 text-right">
                            {(cell.amount/10000).toFixed(0)}만
                          </td>
                        ))}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )})}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 질문 버블 (need_info) ─────────────────────────────────────────────────────
function NeedInfoBubble({
  msg, onSelect,
}: {
  msg: AssistantNeedInfoMessage
  onSelect: (v: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [custom, setCustom] = useState('')

  const handleSelect = (v: string) => {
    setSelected(v)
    onSelect(v)
  }

  if (selected) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-800">{msg.question}</p>
        <div className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-xl text-sm text-blue-700 font-medium border border-blue-200">
          <span>✓</span> {selected}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-800 font-medium">{msg.question}</p>

      {/* [v5 UI] 시작일 질문이면 달력 표시 — 날짜를 클릭으로 선택 */}
      {msg.isDateQuestion && (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleSelect('미정 (날짜 없이 기본 견적)')}
            className="w-full px-3 py-2.5 bg-white hover:bg-amber-50 border border-amber-200 hover:border-amber-300 rounded-xl text-sm text-amber-700 font-medium transition-all text-left">
            📋 미정 — 날짜 없이 기본 견적 보기
          </button>
          <div className="flex items-center gap-2 px-3 py-2.5 bg-white border border-gray-200 rounded-xl">
            <span className="text-sm text-gray-500 whitespace-nowrap">날짜 선택</span>
            <input
              type="date"
              onChange={e => { if (e.target.value) handleSelect(e.target.value) }}
              className="flex-1 text-sm bg-transparent outline-none cursor-pointer"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={custom}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) handleSelect(custom.trim()) }}
              className="input-field text-sm flex-1"
              placeholder='예: 8월 초, 7~8월 (대략적 시기)'
            />
            <button onClick={() => { if (custom.trim()) handleSelect(custom.trim()) }}
              disabled={!custom.trim()}
              className="btn-primary px-3 text-sm">입력</button>
          </div>
        </div>
      )}

      {!msg.isDateQuestion && msg.suggestions && msg.suggestions.length > 0 && (
        <div className={msg.suggestions.length > 8 ? 'grid grid-cols-1 lg:grid-cols-2 gap-1.5' : 'flex flex-col gap-1.5'}>
          {msg.suggestions.map((s, i) => {
            // "이름 (가격/4주)" 형태면 이름과 가격 분리해서 정렬
            const m = s.match(/^(.*?)\s*\(([\d,]+원\/4주)\)$/)
            return (
              <button key={i} onClick={() => handleSelect(s)}
                className="w-full text-left px-3 py-2.5 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-xl text-sm text-gray-800 hover:text-blue-700 transition-all font-medium flex items-center justify-between gap-3 group">
                {m ? (
                  <>
                    <span className="truncate flex-1">{m[1]}</span>
                    <span className="text-xs text-gray-500 group-hover:text-blue-500 tabular-nums whitespace-nowrap flex-shrink-0">{m[2]}</span>
                  </>
                ) : (
                  <>
                    <span className="flex-1">{s}</span>
                    <span className="text-gray-300 group-hover:text-blue-400 text-xs whitespace-nowrap flex-shrink-0">선택 →</span>
                  </>
                )}
              </button>
            )
          })}
        </div>
      )}
      {!msg.isDateQuestion && msg.allowFreeText !== false && (
        <div className="flex gap-2 pt-1 border-t border-gray-100">
          <input
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) handleSelect(custom.trim()) }}
            className="input-field text-sm flex-1"
            placeholder="직접 입력..."
          />
          <button onClick={() => { if (custom.trim()) handleSelect(custom.trim()) }}
            disabled={!custom.trim()}
            className="btn-primary px-3 text-sm">전송</button>
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function QuotePage() {
  const [schools, setSchools] = useState<School[]>([])
  const [promotions, setPromotions] = useState<import('@/lib/db').PromoEntry[]>([])
  const [rate, setRate] = useState<ExchangeRate>({ phpToKrw: 25, usdToKrw: 1380, updatedAt: '' })
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MSG])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [quoteModal, setQuoteModal] = useState<{ calcResult: CalcResult; school: School; startDate: string; localFees: LocalFee[] } | null>(null)
  const [tab, setTab] = useState<'chat' | 'direct'>('chat')
  // 챗봇 모드: 'regular'(일반 연수) | 'camp_family'(캠프·가족·주니어).
  // 모드 변경 시 채팅 이력 리셋 — 이전 모드에서 정해진 학원이 새 모드에 없을 수 있고, LLM 컨텍스트가 꼬이지 않게.
  const [mode, setMode] = useState<SchoolMode>('regular')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([getSchools(), getExchangeRate(), getPromotions()]).then(([s, r, p]) => {
      setSchools(s); setRate(r); setPromotions(p)
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // API 메시지 형태 변환 (role: user|assistant, content: string)
  const buildApiMessages = (msgs: ChatMessage[], userText: string) => {
    const history = msgs
      .filter(m => !(m.role === 'assistant' && m.type === 'result' && (m as AssistantResultMessage).evidenceMessage === m.content))
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    return [...history, { role: 'user' as const, content: userText }]
  }

  const verifyQuote = async (messageIndex: number) => {
    setMessages(prev => prev.map((m, i) => {
      if (i !== messageIndex) return m
      if (m.role !== 'assistant' || m.type !== 'result') return m
      return { ...(m as AssistantResultMessage), verifying: true, verifyError: undefined }
    }))

    try {
      const target = messages[messageIndex]
      if (target?.role !== 'assistant' || target.type !== 'result') return
      const m = target as AssistantResultMessage

      const res = await fetch('/api/quote/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school: m.school,
          calcResult: m.calcResult,
          startDate: m.startDate,
          enrollmentDate: m.enrollmentDate,
          rate,
          message: m.content,
        }),
      })
      const data = await res.json()

      setMessages(prev => prev.map((mm, i) => {
        if (i !== messageIndex) return mm
        if (mm.role !== 'assistant' || mm.type !== 'result') return mm
        return {
          ...(mm as AssistantResultMessage),
          verifying: false,
          verification: data.ok ? data.verification : undefined,
          verifyError: data.ok ? undefined : (data.error ?? '검증 실패'),
        }
      }))
    } catch (err) {
      setMessages(prev => prev.map((mm, i) => {
        if (i !== messageIndex) return mm
        if (mm.role !== 'assistant' || mm.type !== 'result') return mm
        return {
          ...(mm as AssistantResultMessage),
          verifying: false,
          verifyError: err instanceof Error ? err.message : String(err),
        }
      }))
    }
  }

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: UserMessage = { role: 'user', type: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      // 현재 모드에 해당하는 학원만 LLM에 전달. 모드가 다른 학원은 안 보이게 해서 헷갈림 방지.
      const filteredSchools = schools.filter(s => inferSchoolMode(s) === mode)
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: buildApiMessages(messages, text.trim()),
          schoolsData: filteredSchools,
          promotionsData: promotions,
          rateData: rate,
          mode,
        }),
      })
      const data = await res.json()

      if (data.action === 'result') {
        const resultMsg: AssistantResultMessage = {
          role: 'assistant', type: 'result',
          content: data.message,
          evidenceMessage: data.evidenceMessage,
          discountEvidence: data.discountEvidence,
          regulationWarning: data.regulationWarning,
          localFees: data.localFees ?? [],
          localFeePhp: data.localFeePhp ?? 0,
          localFeeKrwEstimate: data.localFeeKrwEstimate ?? 0,
          startDate: data.startDate,
          enrollmentDate: data.enrollmentDate,
          totalWeeks: data.totalWeeks,
          surchargeItems: data.surchargeItems ?? [],
          calcResult: data.calcResult,
          school: data.schoolData
            ?? (data.calcResult ? schools.find(s => s.id === data.schoolId) : undefined),
        }
        setMessages(prev => [...prev, resultMsg])

      } else if (data.action === 'multi_result') {
        // 각 학원 결과를 별도 메시지로 추가
        const newMsgs: AssistantResultMessage[] = (data.results ?? []).map((r: {
          schoolName: string; schoolId: string; message: string
          evidenceMessage?: string; discountEvidence?: string
          localFees?: LocalFee[]; localFeePhp?: number; localFeeKrwEstimate?: number
          totalWeeks?: number; calcResult?: CalcResult; schoolData?: School; error?: string
        }) => ({
          role: 'assistant' as const, type: 'result' as const,
          content: r.error ? `**${r.schoolName}**: ${r.error}` : r.message,
          evidenceMessage: r.evidenceMessage,
          discountEvidence: r.discountEvidence,
          localFees: r.localFees ?? [],
          localFeePhp: r.localFeePhp ?? 0,
          localFeeKrwEstimate: r.localFeeKrwEstimate ?? 0,
          totalWeeks: r.totalWeeks,
          calcResult: r.calcResult,
          school: r.schoolData ?? schools.find(s => s.id === r.schoolId),
        }))
        setMessages(prev => [...prev, ...newMsgs])
      } else if (data.action === 'need_info') {
        const needMsg: AssistantNeedInfoMessage = {
          role: 'assistant', type: 'need_info',
          content: data.question ?? data.message ?? '',
          question: data.question ?? data.message ?? '',
          suggestions: data.suggestions ?? [],
          allowFreeText: data.allowFreeText !== false,
          isDateQuestion: data.isDateQuestion === true,
        }
        setMessages(prev => [...prev, needMsg])
      } else if (data.action === 'confirm' && data.confirmCard) {
        // [v5] 사용자 확인 카드 표시. 사용자가 [계산하기] 누르면 그때 calculate.
        const confirmMsg: AssistantConfirmMessage = {
          role: 'assistant', type: 'confirm',
          content: data.message ?? '아래 내용으로 계산할게요.',
          confirmCard: data.confirmCard,
        }
        setMessages(prev => [...prev, confirmMsg])
      } else {
        const answerMsg: AssistantAnswerMessage = {
          role: 'assistant', type: 'answer',
          content: data.message ?? '응답 처리 오류',
        }
        setMessages(prev => [...prev, answerMsg])
      }
    } catch (e) {
      console.error(e)
      const errMsg: AssistantAnswerMessage = {
        role: 'assistant', type: 'answer',
        content: '오류가 발생했습니다. 다시 시도해주세요.',
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  const reset = () => setMessages([INITIAL_MSG])

  const copyLastResult = async () => {
    const last = [...messages].reverse().find(m => m.role === 'assistant' && m.type === 'result')
    if (!last) return
    await navigator.clipboard.writeText(last.content)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  // 예시 빠른 입력
  const EXAMPLES = [
    'CIA 세부 8주, 8월 1일 입국, 1인실·2인실 견적',
    'JIC 바기오 12주, 7월 입국, 인텐시브',
    'PINES 바기오 서차지 얼마야?',
  ]

  return (
    <AdminLayout>
      <div className="flex flex-col bg-gray-50" style={{ height: 'calc(100dvh - 56px)' }}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 md:px-6 py-3 border-b border-gray-200 bg-white shadow-sm flex-shrink-0">
          <div>
            <h1 className="text-sm md:text-base font-bold text-gray-900">견적 챗봇</h1>
            <p className="text-xs text-gray-400">{schools.length}개 학원 · ₱1={rate.phpToKrw}원</p>
          </div>
          <div className="flex gap-1.5">
            {tab === 'chat' && (
              <>
                <button onClick={copyLastResult} className="btn-secondary flex items-center gap-1 text-xs py-1.5 px-2.5">
                  {copied ? <><Check size={11} /> 복사됨</> : <><Copy size={11} /> <span className="hidden sm:inline">마지막 견적 </span>복사</>}
                </button>
                <button onClick={reset} className="btn-secondary flex items-center gap-1 text-xs py-1.5 px-2.5">
                  <RotateCcw size={11} /> 초기화
                </button>
              </>
            )}
          </div>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
          <button
            onClick={() => setTab('chat')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'chat'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <MessageSquare size={14} />
            챗봇 상담
          </button>
          <button
            onClick={() => setTab('direct')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === 'direct'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Calculator size={14} />
            직접 계산
          </button>
        </div>

        {/* 직접 계산 탭 */}
        {tab === 'direct' && (
          <div className="flex-1 overflow-y-auto bg-gray-50">
            <DirectCalculator schools={schools} promos={promotions} rate={rate} />
          </div>
        )}

        {/* 챗봇 탭 (기존 내용) */}
        {tab === 'chat' && (
        <>
        {/* 모드 토글 — 일반 연수 / 캠프·가족·주니어. 모드 변경 시 채팅 이력 리셋(이전 모드 학원이 새 모드에 없을 수 있고 LLM 컨텍스트가 꼬이지 않게). */}
        <div className="px-3 md:px-4 pt-3 pb-2 bg-white border-b border-gray-100 flex-shrink-0">
          <div className="text-xs font-medium text-gray-500 mb-1.5">어떤 견적인가요?</div>
          <div className="grid grid-cols-2 gap-1.5">
            {(['regular', 'camp_family'] as SchoolMode[]).map(m => (
              <button key={m}
                onClick={() => {
                  if (m === mode) return
                  setMode(m)
                  reset()  // 모드 바뀌면 채팅도 처음부터
                }}
                className={`px-3 py-2 text-xs font-medium rounded-md border transition-colors
                  ${mode === m
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:bg-blue-50'}`}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* 메시지 영역 */}
        <div className="flex-1 overflow-y-auto px-3 md:px-4 py-4 space-y-3">
          {messages.map((msg, i) => {
            if (msg.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85vw] md:max-w-lg bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-2.5">
                    <p className="text-sm text-white">{msg.content}</p>
                  </div>
                </div>
              )
            }

            // AI 메시지
            return (
              <div key={i} className="flex justify-start gap-2">
                <div className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">AI</div>
                <div className={`max-w-[85vw] flex-1 min-w-0 ${msg.type === 'result' ? 'md:max-w-3xl' : msg.type === 'need_info' ? 'md:max-w-3xl' : 'md:max-w-2xl'}`}>

                  {/* 견적 결과 */}
                  {msg.type === 'result' && (() => {
                    const m = msg as AssistantResultMessage
                    const resultSchool = m.school ?? schools.find(s => m.content.includes(s.name))
                    return (
                      <div className="bg-white border border-blue-100 rounded-2xl rounded-tl-sm px-3 md:px-5 py-4 shadow-sm">
                        {/* calcResult 있으면 표, 없으면 마크다운 폴백 */}
                        {m.calcResult && resultSchool ? (
                          <>
                            <QuoteResultCard school={resultSchool} calc={m.calcResult} startDate={m.startDate} />
                            <p className="text-[10px] text-gray-300 mt-2 text-right">v7-2026.05.28</p>
                          </>
                        ) : (
                          <MarkdownText text={m.content} />
                        )}
                        {/* 기간 타임라인 */}
                        <PeriodTimeline
                          startDate={m.startDate}
                          totalWeeks={m.totalWeeks}
                          surchargeItems={m.surchargeItems}
                        />
                        {/* 견적서 뽑기 + 검증 버튼 */}
                        {m.totalWeeks && m.totalWeeks > 0 && (() => {
                          const school = m.school ?? schools.find(s => m.content.includes(s.name))
                          const calcResult = m.calcResult
                          if (!school || !calcResult) return null
                          return (
                            <div className="mt-3 flex gap-2">
                              <button
                                onClick={() => setQuoteModal({ calcResult, school, startDate: m.startDate ?? '', localFees: m.localFees ?? [] })}
                                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors">
                                <FileText size={15} /> 견적서 뽑기
                              </button>
                              <button
                                onClick={() => verifyQuote(i)}
                                disabled={m.verifying}
                                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                {m.verifying ? (
                                  <>
                                    <div className="w-3.5 h-3.5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                                    검증 중...
                                  </>
                                ) : (
                                  <>🔍 검증하기</>
                                )}
                              </button>
                            </div>
                          )
                        })()}
                        {/* 검증 결과 */}
                        {m.verification && (
                          <div className="mt-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3">
                            <p className="text-xs font-semibold text-amber-700 mb-1.5">🔍 검증 봇 (의심 모드)</p>
                            <div className="text-sm text-gray-800 leading-relaxed">
                              <MarkdownText text={m.verification} />
                            </div>
                          </div>
                        )}
                        {m.verifyError && (
                          <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                            <p className="text-xs font-semibold text-red-700 mb-1">❌ 검증 실패</p>
                            <p className="text-sm text-red-800">{m.verifyError}</p>
                          </div>
                        )}
                        {/* 규정 검토 결과 */}
                        {m.regulationWarning && (
                          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                            <p className="text-xs font-semibold text-amber-700 mb-1.5">📋 규정 검토 결과</p>
                            <div className="text-sm text-amber-800 whitespace-pre-line leading-relaxed">{m.regulationWarning}</div>
                          </div>
                        )}
                        {m.localFees && m.localFees.length > 0 && (
                          <LocalFeePanel
                            fees={m.localFees}
                            php={m.localFeePhp ?? 0}
                            krwEstimate={m.localFeeKrwEstimate ?? 0}
                            phpToKrw={rate.phpToKrw}
                          />
                        )}
                        {m.evidenceMessage && <EvidenceCard text={m.evidenceMessage} school={m.school} />}
                        {m.discountEvidence && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-red-600 font-medium px-3 py-2 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                              ✂️ 할인 근거 보기
                            </summary>
                            <div className="mt-1.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                              <MarkdownText text={m.discountEvidence} />
                            </div>
                          </details>
                        )}
                      </div>
                    )
                  })()}

                  {/* 질문 (need_info) */}
                  {msg.type === 'need_info' && (() => {
                    const m = msg as AssistantNeedInfoMessage
                    return (
                      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                        <NeedInfoBubble msg={m} onSelect={v => sendMessage(v)} />
                      </div>
                    )
                  })()}

                  {/* [v5] 사용자 확인 카드 - LLM이 모은 값을 계산 직전에 검증 */}
                  {msg.type === 'confirm' && (() => {
                    const m = msg as AssistantConfirmMessage
                    const c = m.confirmCard
                    const hasPackages = (c.packageLabels?.length ?? 0) > 0
                    const hasCourses = c.courseLabels.length > 0
                    return (
                      <div className="bg-amber-50 border border-amber-300 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm space-y-2">
                        <p className="text-sm text-amber-900 font-medium">{m.content}</p>
                        <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-1.5 text-sm">
                          <div className="flex"><span className="text-gray-500 w-20">학원</span><span className="font-medium">{c.schoolName}</span></div>
                          <div className="flex"><span className="text-gray-500 w-20">기간</span><span className="font-medium">{c.totalWeeks}주</span></div>
                          {hasPackages && (
                            <div className="flex"><span className="text-gray-500 w-20">패키지</span><span className="font-medium">{c.packageLabels!.join(', ')}</span></div>
                          )}
                          {hasCourses && (
                            <div className="flex"><span className="text-gray-500 w-20">코스</span><span className="font-medium">{c.courseLabels.join(', ')}</span></div>
                          )}
                          {/* 기숙사: 패키지 학원은 패키지에 포함이므로 숨김. 일반 학원이거나 기숙사 별도 입력 시만 표시 */}
                          {!hasPackages && (
                            <div className="flex"><span className="text-gray-500 w-20">기숙사</span><span className="font-medium">{c.dormLabels.join(', ') || '-'}</span></div>
                          )}
                          <div className="flex"><span className="text-gray-500 w-20">시작일</span><span className={`font-medium ${c.startDate ? '' : 'text-gray-500 italic'}`}>{c.startDateLabel}</span></div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => sendMessage('계산해주세요')}
                            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium py-2 rounded-lg transition-colors">
                            계산하기
                          </button>
                          <button
                            onClick={() => sendMessage('수정할게요')}
                            className="px-4 bg-white border border-amber-300 hover:bg-amber-50 text-amber-700 text-sm py-2 rounded-lg transition-colors">
                            수정
                          </button>
                        </div>
                      </div>
                    )
                  })()}

                  {/* 일반 답변 */}
                  {msg.type === 'answer' && (
                    <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                      <MarkdownText text={msg.content} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* 로딩 */}
          {loading && (
            <div className="flex justify-start gap-2">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">AI</div>
              <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                <div className="flex gap-1 items-center">
                  {[0, 150, 300].map(d => (
                    <div key={d} className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 입력 영역 */}
        <div className="px-3 md:px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
          {/* 예시 버튼 (초반에만 표시) */}
          {messages.length <= 1 && (
            <div className="flex gap-1.5 flex-wrap mb-2">
              {EXAMPLES.map(ex => (
                <button key={ex} onClick={() => sendMessage(ex)}
                  className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full hover:bg-blue-100 transition-colors">
                  {ex}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="학원, 기간, 코스, 기숙사, 입국일..."
              rows={2}
              className="input-field resize-none flex-1 text-sm"
            />
            <button onClick={() => sendMessage(input)} disabled={!input.trim() || loading}
              className="btn-primary px-3 flex-shrink-0 flex items-center gap-1">
              <Send size={15} />
              <span className="hidden sm:inline text-sm">전송</span>
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1 hidden md:block">Enter 전송 · Shift+Enter 줄바꿈</p>
        </div>
        </>
        )}
      </div>

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
    </AdminLayout>
  )
}
