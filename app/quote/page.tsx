'use client'
import { useState, useEffect, useRef } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { getSchools, getExchangeRate, getPromotions, getSchoolAliases } from '@/lib/db'
import type { School, ExchangeRate, LocalFee } from '@/types'
import { Send, RotateCcw, Copy, Check, ChevronDown, ChevronUp, DollarSign, FileText } from 'lucide-react'
import { formatKrw } from '@/lib/utils'
import QuoteFormModal from '@/components/QuoteFormModal'
import QuoteResultCard from '@/components/QuoteResultCard'
import { MarkdownText, PromotionPanel, PeriodTimeline, LocalFeePanel, EvidenceCard, CalcEvidenceTable, DiscountEvidenceTable } from '@/components/QuoteEvidence'
import QuoteBuilderCard from '@/components/QuoteBuilderCard'
import { type QuoteState, emptyQuoteState, mergeAuto, commitQuote, validateQuote } from '@/lib/quoteState'
import { schoolsMentioned } from '@/lib/parseQuoteIntent'
import type { CalcResult, PromotionLineItem } from '@/lib/calcEngine'
import { schoolHasMode, MODE_LABELS, type SchoolMode } from '@/lib/schoolMode'

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
  version?: string
  calcInput?: {
    schoolId: string
    courses?: { courseId: string; weeks: number }[]
    dormitories?: { dormitoryId: string; weeks: number }[]
    packages?: { packageId: string; weeks: number; columnLabel: string }[]
  }
  // 검증 봇 결과
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
  showCalculateButton?: boolean
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
  // 챗봇 모드: 'regular'(일반 연수) | 'camp_family'(캠프·가족·주니어).
  // 모드 변경 시 채팅 이력 리셋 — 이전 모드에서 정해진 학원이 새 모드에 없을 수 있고, LLM 컨텍스트가 꼬이지 않게.
  const [mode, setMode] = useState<SchoolMode>('regular')
  // [토큰 절감] 대화에서 학원이 특정되면 그 학원 id를 기억. 이후 메시지는 해당 학원(+동일 이름
  // 다른 캠퍼스)만 LLM에 보내 프롬프트 토큰을 줄인다(전체 81개 → 1~2개). 사용자가 새 학원명을
  // 말하거나 초기화하면 해제. rate limit(429) 방지의 핵심.
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(null)
  // 코드 파서용 별칭 (Firestore에서 로드 → route에 함께 전송해 파서가 코드 기본값과 병합)
  const [aliasData, setAliasData] = useState<Record<string, string[]>>({})
  // 배포 버전 (항상 화면에 노출 — 배포 반영 여부를 견적 안 내도 확인 가능)
  const [appVersion, setAppVersion] = useState<string>('')
  // 단일 견적 상태 — 자연어(챗봇)와 드롭다운(수동)이 함께 채우는 temp 객체.
  const [quote, setQuote] = useState<QuoteState>(emptyQuoteState())

  // 상단 카드 [계산하기] → 현재 상태를 commit(1스택)하여 directCalc로 계산.
  const calculateFromCard = () => {
    const school = schools.find(s => s.id === quote.schoolId) ?? null
    const c = commitQuote(quote, school)
    if (!c) return
    sendMessage('계산해주세요', c)
  }
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([getSchools(), getExchangeRate(), getPromotions()]).then(([s, r, p]) => {
      setSchools(s); setRate(r); setPromotions(p)
    })
    // 별칭은 실패해도 파서가 코드 기본 별칭으로 동작하므로 조용히 무시
    getSchoolAliases().then(docs => {
      const map: Record<string, string[]> = {}
      for (const d of docs) map[d.schoolCode] = d.aliases
      setAliasData(map)
    }).catch(() => {})
    // 배포 버전 — 항상 화면에 노출
    fetch('/api/quote').then(r => r.json()).then(d => setAppVersion(d.version ?? '')).catch(() => {})
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


  const sendMessage = async (text: string, directCalc?: {
    schoolId: string; startDate?: string; enrollmentDate?: string
    courses?: { courseId: string; weeks: number }[]
    dormitories?: { dormitoryId: string; weeks: number }[]
    packages?: { packageId: string; weeks: number; columnLabel: string }[]
  }) => {
    if (!text.trim() || loading) return
    const userMsg: UserMessage = { role: 'user', type: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      // [LLM 우회] 확인 카드에서 확정값이 directCalc로 오면 계산 직행.
      // 학원 데이터(schoolsData) 전체를 보낼 필요가 없으므로 해당 학원 1개만 전달 → 토큰 0.
      if (directCalc) {
        const oneSchool = schools.filter(s => s.id === directCalc.schoolId)
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [], schoolsData: oneSchool, promotionsData: promotions,
            rateData: rate, mode, directCalc,
          }),
        })
        const data = await res.json()
        if (data.action === 'result') {
          const resultMsg: AssistantResultMessage = {
            role: 'assistant', type: 'result', content: data.message,
            evidenceMessage: data.evidenceMessage, discountEvidence: data.discountEvidence,
            regulationWarning: data.regulationWarning, localFees: data.localFees ?? [],
            localFeePhp: data.localFeePhp ?? 0, localFeeKrwEstimate: data.localFeeKrwEstimate ?? 0,
            startDate: data.startDate, enrollmentDate: data.enrollmentDate, totalWeeks: data.totalWeeks,
            surchargeItems: data.surchargeItems ?? [], calcResult: data.calcResult,
            school: data.schoolData ?? (data.calcResult ? schools.find(s => s.id === data.schoolId) : undefined),
            version: data._version,
            calcInput: { schoolId: directCalc.schoolId, courses: directCalc.courses, dormitories: directCalc.dormitories, packages: directCalc.packages },
          }
          setMessages(prev => [...prev, resultMsg])
        } else if (data.action === 'need_info') {
          setMessages(prev => [...prev, { role: 'assistant', type: 'need_info', content: data.question ?? '', suggestions: data.suggestions, allowFreeText: data.allowFreeText, isDateQuestion: data.isDateQuestion } as AssistantNeedInfoMessage])
        } else {
          setMessages(prev => [...prev, { role: 'assistant', type: 'answer', content: data.message ?? '오류' } as AssistantAnswerMessage])
        }
        setLoading(false)
        return
      }

      // 현재 모드에 해당하는 학원만 LLM에 전달. 모드가 다른 학원은 안 보이게 해서 헷갈림 방지.
      const modeSchools = schools.filter(s => schoolHasMode(s, mode))
      // [토큰 절감] 사용자가 이번 메시지에서 '다른 학원/처음부터' 등 학원 전환 의사를 보이면 활성학원 해제.
      const wantsReset = /다른\s*학원|처음부터|초기화|학원\s*바꾸|reset/i.test(text)
      // 활성 학원이 정해져 있고, 사용자가 명시적으로 다른 학원명을 말하지 않았다면 그 학원(+동일 이름
      // 다른 캠퍼스)만 전달. 전체(81개·46k토큰) 대신 1~2개(~1k토큰)만 보내 429를 막는다.
      let filteredSchools = modeSchools
      if (activeSchoolId && !wantsReset) {
        const active = schools.find(s => s.id === activeSchoolId)
        if (active) {
          // 사용자가 활성 학원이 아닌 '다른 학원'을 거론하면 좁히지 않음(전환 허용).
          // [중요] 풀네임 앞글자가 아니라 파서로 판정 — "펠라" 같은 별칭으로도 전환을 감지해야 한다.
          // 학원 별칭/이름이 실제 거론된 학원만 본다. 방·주수·코스는 안 걸림.
          const activeBase = active.name.split('(')[0].trim()
          const mentioned = schoolsMentioned(text, modeSchools, aliasData)
          const mentionsOther = mentioned.some(id =>
            id !== activeSchoolId && schools.find(s => s.id === id)?.name.split('(')[0].trim() !== activeBase)
          if (!mentionsOther) {
            filteredSchools = modeSchools.filter(s => s.id === activeSchoolId || s.name.split('(')[0].trim() === activeBase)
          }
        }
      }
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: buildApiMessages(messages, text.trim()),
          schoolsData: filteredSchools,
          promotionsData: promotions,
          rateData: rate,
          mode,
          aliasData,
        }),
      })
      const data = await res.json()

      // [토큰 절감] 응답에서 학원이 특정되면 활성 학원으로 기억 → 이후 메시지는 그 학원만 전달.
      const respSchoolId = (data.confirmCard?.schoolId as string | undefined)
        ?? (data.schoolId as string | undefined)
        ?? (data.schoolData?.id as string | undefined)
      if (respSchoolId) setActiveSchoolId(respSchoolId)

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
          version: data._version,
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
        // 파서/LLM이 추출한 값을 상단 견적 카드(quoteState)에 병합한다.
        // 사용자가 손댄 슬롯은 잠겨 있어 덮어쓰지 않음. 대화 중간 카드는 더 이상 안 띄움.
        const c = data.confirmCard
        setQuote(prev => mergeAuto(prev, {
          schoolId: c.schoolId,
          totalWeeks: c.totalWeeks,
          courseRows: (c.courses ?? []).filter((r: { courseId: string }) => r.courseId),
          dormRows: (c.dormitories ?? []).filter((r: { dormitoryId: string }) => r.dormitoryId),
          startDate: c.startDate,
        }))
        // 짧은 안내만 대화에 남김 (선택지·카드 없음). 구성이 모였으면 채팅에도 계산 버튼 표시.
        const msg: AssistantAnswerMessage = {
          role: 'assistant', type: 'answer',
          content: data.message ?? '왼쪽 견적 구성에 반영했어요. 확인하고 [계산하기]를 누르세요.',
          showCalculateButton: data.showCalculateButton ?? true,
        }
        setMessages(prev => [...prev, msg])
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

  const reset = () => { setMessages([INITIAL_MSG]); setActiveSchoolId(null) }

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
            <p className="text-xs text-gray-400">{schools.length}개 학원 · ₱1={rate.phpToKrw}원{appVersion ? ` · ${appVersion}` : ''}</p>
          </div>
          <div className="flex gap-1.5">
            <>
              <button onClick={copyLastResult} className="btn-secondary flex items-center gap-1 text-xs py-1.5 px-2.5">
                {copied ? <><Check size={11} /> 복사됨</> : <><Copy size={11} /> <span className="hidden sm:inline">마지막 견적 </span>복사</>}
              </button>
              <button onClick={reset} className="btn-secondary flex items-center gap-1 text-xs py-1.5 px-2.5">
                <RotateCcw size={11} /> 초기화
              </button>
            </>
          </div>
        </div>

        {/* 본문: 좌(계산기) | 우(채팅) 2분할. 사이드바까지 합쳐 전체 3분할. */}
        <div className="flex-1 flex flex-row min-h-0">

        {/* ── 왼쪽: 계산기 (모드 토글 + 견적 카드) ── */}
        <div className="w-[480px] xl:w-[540px] flex-shrink-0 flex flex-col border-r border-gray-200 bg-gray-50 overflow-y-auto">
          {/* 모드 토글 — 학원보다 상위 필터라 맨 위에 둔다 */}
          <div className="px-4 pt-3 pb-2 flex-shrink-0">
            <div className="text-xs font-medium text-gray-500 mb-1.5">어떤 견적인가요?</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(['regular', 'camp_family'] as SchoolMode[]).map(m => (
                <button key={m}
                  onClick={() => { if (m === mode) return; setMode(m); reset() }}
                  className={`px-3 py-2 text-xs font-medium rounded-md border transition-colors
                    ${mode === m
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:bg-blue-50'}`}>
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          {/* 견적 카드 */}
          <div className="px-4 pb-4 flex-shrink-0">
            <QuoteBuilderCard
              state={quote}
              schools={schools.filter(s => schoolHasMode(s, mode))}
              onChange={setQuote}
              onCalculate={calculateFromCard}
              calculating={loading}
            />
          </div>
        </div>

        {/* ── 오른쪽: 채팅 ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
        {(
        <>
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
                            <p className="text-[10px] text-gray-300 mt-2 text-right">{m.version ?? appVersion ?? ''}</p>
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
                        {/* 견적서 뽑기 버튼 */}
                        {m.totalWeeks && m.totalWeeks > 0 && (() => {
                          const school = m.school ?? schools.find(s => m.content.includes(s.name))
                          const calcResult = m.calcResult
                          if (!school || !calcResult) return null
                          return (
                            <div className="mt-3">
                              <button
                                onClick={() => setQuoteModal({ calcResult, school, startDate: m.startDate ?? '', localFees: m.localFees ?? [] })}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors">
                                <FileText size={15} /> 견적서 뽑기
                              </button>
                            </div>
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
                        {m.calcResult && <CalcEvidenceTable calc={m.calcResult} phpToKrw={rate.phpToKrw} />}
                        {m.calcResult?.promotionLines && (
                          <PromotionPanel
                            lines={m.calcResult.promotionLines}
                            dateUnset={!m.startDate}
                            onPickDate={m.calcInput ? (date) => sendMessage(`${date} 시작으로 다시 계산`, {
                              schoolId: m.calcInput!.schoolId,
                              startDate: date,
                              enrollmentDate: date,
                              courses: m.calcInput!.courses,
                              dormitories: m.calcInput!.dormitories,
                              packages: m.calcInput!.packages,
                            }) : undefined}
                          />
                        )}
                        {m.calcResult?.promotionLines && <DiscountEvidenceTable lines={m.calcResult.promotionLines} />}
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
                      {(msg as AssistantAnswerMessage).showCalculateButton && (() => {
                        const sc = schools.find(s => s.id === quote.schoolId) ?? null
                        const cv = validateQuote(quote, sc)
                        return (
                          <button onClick={calculateFromCard} disabled={!cv.canCalculate || loading}
                            className={`mt-2.5 w-full text-sm font-medium py-2 rounded-lg transition-colors ${
                              cv.canCalculate && !loading
                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                            {loading ? '계산 중…' : cv.canCalculate ? '⚡ 계산하기' : (cv.nextNeeded === 'school' ? '학원을 선택하세요' : cv.nextNeeded === 'weeks' ? '총 주수를 정하세요' : cv.nextNeeded === 'course' ? '코스를 선택하세요' : '구성을 확인하세요')}
                          </button>
                        )
                      })()}
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
        </div>{/* 오른쪽 채팅 칸 끝 */}
        </div>{/* 2분할 컨테이너 끝 */}
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
