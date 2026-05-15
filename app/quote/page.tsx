'use client'
import { useState, useEffect, useRef } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { getSchools, getExchangeRate, getPromotions } from '@/lib/db'
import type { School, ExchangeRate, LocalFee } from '@/types'
import { Send, RotateCcw, Copy, Check, ChevronDown, ChevronUp, DollarSign, FileText, MessageSquare, Calculator } from 'lucide-react'
import { formatKrw } from '@/lib/utils'
import QuoteFormModal from '@/components/QuoteFormModal'
import DirectCalculator from '@/components/DirectCalculator'
import type { CalcResult } from '@/lib/calcEngine'

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
  totalWeeks?: number
  surchargeItems?: Array<{ label: string; weeks: number }>
  calcResult?: CalcResult
  school?: School
}

interface AssistantNeedInfoMessage extends BaseMessage {
  role: 'assistant'
  type: 'need_info'
  question: string
  suggestions?: string[]
  allowFreeText?: boolean
}

interface AssistantAnswerMessage extends BaseMessage {
  role: 'assistant'
  type: 'answer'
}

interface UserMessage extends BaseMessage { role: 'user'; type: 'user' }

type ChatMessage = UserMessage | AssistantResultMessage | AssistantNeedInfoMessage | AssistantAnswerMessage

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

  return (
    <div className="mt-3 border border-amber-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors text-sm">
        <div className="flex items-center gap-2 text-amber-800 font-medium">
          <DollarSign size={14} />
          현지납부비 {weeks ? `(${weeks}주 기준)` : ''}
          <span className="text-xs text-amber-600 font-normal">
            {php > 0 ? `₱${php.toLocaleString()} · ` : ''}약 {formatKrw(krwEstimate)}
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-amber-600" /> : <ChevronDown size={14} className="text-amber-600" />}
      </button>
      {open && (
        <div className="bg-white px-3 py-2 space-y-1.5">
          <p className="text-xs text-gray-400 mb-2">※ 현지 도착 후 직접 납부. 견적 총액 미포함.</p>
          {fees.map((f, i) => {
            const amt = calcAmount(f)
            const isOptional = (f.trigger ?? 'always') === 'optional'
            if (amt === 0 && !isOptional) return null
            const isKrw = f.currency === 'KRW'
            return (
              <div key={i} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className={`truncate text-sm ${isOptional ? 'text-gray-400' : 'text-gray-700'}`}>{f.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${isOptional ? 'bg-gray-100 text-gray-400' : 'bg-amber-50 text-amber-600'}`}>
                    {triggerLabel(f)}{unitLabel(f)}
                  </span>
                </div>
                <span className={`font-medium flex-shrink-0 ml-2 ${isOptional ? 'text-gray-400' : 'text-gray-800'}`}>
                  {isKrw
                    ? formatKrw(amt)
                    : `₱${amt.toLocaleString()}${f.amountMax ? `~${f.amountMax.toLocaleString()}` : ''}`}
                  {!isKrw && <span className="text-xs text-gray-400 ml-1">(약 {formatKrw(Math.round(amt * phpToKrw))})</span>}
                  {isOptional && <span className="text-xs text-gray-400 ml-1">[선택]</span>}
                </span>
              </div>
            )
          })}
          <div className="border-t border-gray-100 pt-1.5 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">합계 (선택 제외)</span>
            <span className="text-amber-700">약 {formatKrw(krwEstimate)}</span>
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
              {school.packages.map(p => (
                <div key={p.id} className="mb-2">
                  <p className="text-xs font-medium text-gray-700">{p.label} <span className="text-gray-400">({p.season})</span></p>
                  <table className="text-xs w-full border-collapse mt-1">
                    <thead><tr className="bg-gray-50">
                      <th className="text-left px-2 py-1 border border-gray-100">주수</th>
                      {p.columns.map(col => <th key={col} className="text-right px-2 py-1 border border-gray-100">{col}</th>)}
                    </tr></thead>
                    <tbody>{(p.priceMatrix ?? []).map(row => (
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
              ))}
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
      {msg.suggestions && msg.suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {msg.suggestions.map((s, i) => (
            <button key={i} onClick={() => handleSelect(s)}
              className="w-full text-left px-3 py-2.5 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 rounded-xl text-sm text-gray-800 hover:text-blue-700 transition-all font-medium flex items-center justify-between group">
              <span>{s}</span>
              <span className="text-gray-300 group-hover:text-blue-400 text-xs">선택 →</span>
            </button>
          ))}
        </div>
      )}
      {msg.allowFreeText !== false && (
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

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: UserMessage = { role: 'user', type: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: buildApiMessages(messages, text.trim()),
          schoolsData: schools,
          promotionsData: promotions,
          rateData: rate,
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
        }
        setMessages(prev => [...prev, needMsg])
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
                <div className="max-w-[85vw] md:max-w-2xl flex-1 min-w-0">

                  {/* 견적 결과 */}
                  {msg.type === 'result' && (() => {
                    const m = msg as AssistantResultMessage
                    return (
                      <div className="bg-white border border-blue-100 rounded-2xl rounded-tl-sm px-3 md:px-4 py-3 shadow-sm overflow-x-auto">
                        <MarkdownText text={m.content} />
                        {/* 기간 타임라인 */}
                        <PeriodTimeline
                          startDate={m.startDate}
                          totalWeeks={m.totalWeeks}
                          surchargeItems={m.surchargeItems}
                        />
                        {/* 견적서 뽑기 버튼 */}
                        {m.totalWeeks && m.totalWeeks > 0 && (() => {
                          const school = m.school ?? schools.find(s => m.content.includes(s.name))
                          const calcResult = m.calcResult
                          if (!school || !calcResult) return null
                          return (
                            <button
                              onClick={() => setQuoteModal({ calcResult, school, startDate: m.startDate ?? '', localFees: m.localFees ?? [] })}
                              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors">
                              <FileText size={15} /> 견적서 뽑기
                            </button>
                          )
                        })()}
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
