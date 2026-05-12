'use client'
import { useEffect, useState, useRef } from 'react'
import { getSchool, saveSchool, getPromotions, savePromotion } from '@/lib/db'
import type { School } from '@/types'
import type { PromoEntry } from '@/lib/db'
import { Send, Check, X, Bot, AlertTriangle, RotateCcw } from 'lucide-react'

// target: 'school' | 'promo'
interface PatchOp {
  target?: 'school' | 'promo'
  path?: string            // school op: 최상위 필드
  index?: number           // school op: 배열 인덱스
  field?: string           // school op: 변경할 필드명
  value?: unknown          // school op: 새 값
  promoId?: string         // promo op: 프로모션 id
  promoField?: string      // promo op: 변경할 필드명
  promoValue?: unknown     // promo op: 새 값
}
interface ChangeItem { field: string; label: string; before: string; after: string }
interface ChatMsg {
  role: 'user' | 'ai'
  type: 'text' | 'confirm' | 'patch_result'
  content: string
  changes?: ChangeItem[]
  ops?: PatchOp[]
  approved?: boolean | null
}

function applySchoolPatch(school: School, ops: PatchOp[]): School {
  const s = JSON.parse(JSON.stringify(school)) as Record<string, unknown>
  for (const op of ops) {
    if (op.target === 'promo') continue  // promo ops는 별도 처리
    const path = op.path
    if (!path) continue

    if (op.index !== undefined && op.field !== undefined) {
      // 배열 항목 수정
      if (!Array.isArray(s[path])) {
        console.warn(`[applyPatch] ${path} 는 배열이 아님`)
        continue
      }
      const arr = s[path] as Record<string, unknown>[]
      if (arr[op.index] === undefined) {
        console.warn(`[applyPatch] ${path}[${op.index}] 없음`)
        continue
      }
      arr[op.index][op.field] = op.value
    } else if (op.field !== undefined) {
      // 중첩 객체 수정 (registrationFee.amount 등)
      if (s[path] === undefined || s[path] === null) {
        // 없으면 빈 객체로 초기화
        s[path] = {}
      }
      ;(s[path] as Record<string, unknown>)[op.field] = op.value
    } else {
      // 최상위 필드 직접 수정
      s[path] = op.value
    }
  }
  return s as unknown as School
}

function applyPromoPatch(promos: PromoEntry[], ops: PatchOp[]): PromoEntry[] {
  const updated = JSON.parse(JSON.stringify(promos)) as PromoEntry[]
  for (const op of ops) {
    if (op.target !== 'promo' || !op.promoId || !op.promoField) continue
    const idx = updated.findIndex(p => p.id === op.promoId)
    if (idx === -1) {
      console.warn(`[applyPromoPatch] promoId ${op.promoId} 없음`)
      continue
    }
    ;(updated[idx] as unknown as Record<string, unknown>)[op.promoField] = op.promoValue
  }
  return updated
}

export default function EditDataChat({ schoolId }: { schoolId: string }) {
  const [school, setSchool] = useState<School | null>(null)
  const [promos, setPromos] = useState<PromoEntry[]>([])
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const apiHistory = useRef<{ role: string; content: string }[]>([])

  useEffect(() => {
    Promise.all([getSchool(schoolId), getPromotions()]).then(([s, allPromos]) => {
      setSchool(s)
      const myPromos = allPromos.filter(p => s && p.schoolName === s.name)
      setPromos(myPromos)
      if (s) setMessages([{
        role: 'ai', type: 'text',
        content: `**${s.name}** 데이터 수정 채팅입니다.\n코스 가격, 기숙사 가격, 프로모션 날짜/할인, 서차지, 규정 등을 자연어로 수정하세요.`,
      }])
    })
  }, [schoolId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const sendMessage = async (text: string) => {
    if (!school || !text.trim() || loading) return
    setInput('')
    setLoading(true)
    apiHistory.current = [...apiHistory.current, { role: 'user', content: text }]
    setMessages(prev => [...prev, { role: 'user', type: 'text', content: text }])

    try {
      const res = await fetch('/api/edit-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiHistory.current, school, promos }),
      })
      const data = await res.json()
      console.log('[edit-data] response:', JSON.stringify(data).slice(0, 500))

      if (data.action === 'confirm') {
        const ops: PatchOp[] = data.ops ?? []
        console.log('[edit-data] ops:', JSON.stringify(ops))
        setMessages(prev => [...prev, {
          role: 'ai', type: 'confirm',
          content: data.summary ?? '',
          changes: data.changes ?? [],
          ops,
          approved: null,
        }])
        apiHistory.current = [...apiHistory.current, {
          role: 'assistant',
          content: `변경사항:\n${(data.changes ?? []).map((c: ChangeItem) => `- ${c.label}: ${c.before} → ${c.after}`).join('\n')}\n\n저장할까요?`,
        }]
      } else {
        setMessages(prev => [...prev, {
          role: 'ai', type: 'text',
          content: data.message ?? JSON.stringify(data),
        }])
        apiHistory.current = [...apiHistory.current, { role: 'assistant', content: data.message ?? '' }]
      }
    } catch (e) {
      console.error('[edit-data]', e)
      setMessages(prev => [...prev, { role: 'ai', type: 'text', content: `오류: ${e}` }])
    } finally { setLoading(false) }
  }

  const handleApprove = async (msgIdx: number) => {
    if (!school) return
    const confirmMsg = messages[msgIdx]
    const ops = confirmMsg.ops ?? []
    console.log('[approve] ops:', JSON.stringify(ops))

    if (ops.length === 0) {
      setMessages(prev => [...prev, { role: 'ai', type: 'text', content: '⚠️ 적용할 변경 내역이 없습니다. 다시 시도해주세요.' }])
      return
    }

    setSaving(true)
    try {
      const schoolOps = ops.filter(o => o.target !== 'promo')
      const promoOps  = ops.filter(o => o.target === 'promo')

      // 학원 데이터 저장
      if (schoolOps.length > 0) {
        const updated = applySchoolPatch(school, schoolOps)
        await saveSchool(updated)
        setSchool(updated)
        console.log('[approve] school saved')
      }

      // 프로모션 저장
      if (promoOps.length > 0) {
        const updatedPromos = applyPromoPatch(promos, promoOps)
        // 변경된 프로모션만 저장
        const changedIds = new Set(promoOps.map(o => o.promoId))
        for (const p of updatedPromos) {
          if (changedIds.has(p.id)) {
            await savePromotion(p)
            console.log('[approve] promo saved:', p.id)
          }
        }
        setPromos(updatedPromos)
      }

      setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, approved: true } : m))
      setMessages(prev => [...prev, {
        role: 'ai', type: 'patch_result',
        content: `✅ 저장 완료 (학원 ${schoolOps.length}개 · 프로모션 ${promoOps.length}개)`,
        approved: true,
      }])
      apiHistory.current = [...apiHistory.current,
        { role: 'user', content: '네, 저장해주세요.' },
        { role: 'assistant', content: '저장 완료했습니다.' },
      ]
    } catch (e) {
      console.error('[approve error]', e)
      setMessages(prev => [...prev, { role: 'ai', type: 'text', content: `저장 실패: ${e}` }])
    } finally { setSaving(false) }
  }

  const handleReject = (msgIdx: number) => {
    setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, approved: false } : m))
    setMessages(prev => [...prev, { role: 'ai', type: 'text', content: '취소했습니다. 다시 말씀해 주세요.' }])
    apiHistory.current = [...apiHistory.current,
      { role: 'user', content: '취소해주세요.' },
      { role: 'assistant', content: '취소했습니다.' },
    ]
  }

  if (!school) return <div className="p-8 text-center text-gray-400">불러오는 중...</div>

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 100px)' }}>
      <div className="flex justify-end px-4 py-2 border-b border-gray-100">
        <span className="text-xs text-gray-400 mr-auto">프로모션 {promos.length}개 로드됨</span>
        <button onClick={() => {
          setMessages([{ role: 'ai', type: 'text', content: `**${school.name}** 수정 채팅을 초기화했습니다.` }])
          apiHistory.current = []
        }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <RotateCcw size={12} /> 초기화
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => {
          if (msg.role === 'user') return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80vw] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-2.5">
                <p className="text-sm">{msg.content}</p>
              </div>
            </div>
          )

          return (
            <div key={i} className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                <Bot size={13} />
              </div>
              <div className="max-w-[85vw] flex-1">
                {msg.type === 'confirm' && msg.approved === null && (
                  <div className="bg-white border border-amber-200 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
                    <div className="bg-amber-50 px-4 py-3 border-b border-amber-100">
                      <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                        <AlertTriangle size={14} /> {msg.content || '변경사항 확인'}
                      </p>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {(msg.changes ?? []).map((c, ci) => (
                        <div key={ci} className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
                          <span className="text-xs text-gray-500 flex-1 min-w-0">{c.label}</span>
                          <span className="text-xs text-red-500 line-through">{c.before}</span>
                          <span className="text-gray-400 text-xs">→</span>
                          <span className="text-xs text-green-700 font-semibold">{c.after}</span>
                        </div>
                      ))}
                      {(msg.ops ?? []).length === 0 && (
                        <div className="px-4 py-2 text-xs text-red-500">⚠️ ops 없음 — 저장 불가</div>
                      )}
                    </div>
                    <div className="flex gap-2 px-4 py-3 bg-gray-50">
                      <button onClick={() => handleApprove(i)} disabled={saving || (msg.ops ?? []).length === 0}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">
                        <Check size={14} /> {saving ? '저장 중...' : '저장'}
                      </button>
                      <button onClick={() => handleReject(i)} disabled={saving}
                        className="px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-sm">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {msg.type === 'confirm' && msg.approved === true && (
                  <div className="bg-white border border-green-200 rounded-2xl rounded-tl-sm px-4 py-3">
                    <p className="text-sm text-green-600 flex items-center gap-2"><Check size={14} /> 승인됨</p>
                  </div>
                )}
                {msg.type === 'confirm' && msg.approved === false && (
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
                    <p className="text-sm text-gray-400 flex items-center gap-2"><X size={14} /> 취소됨</p>
                  </div>
                )}
                {msg.type === 'patch_result' && (
                  <div className="bg-white border border-green-200 rounded-2xl rounded-tl-sm px-4 py-3">
                    <p className="text-sm text-green-700 font-semibold">{msg.content}</p>
                  </div>
                )}
                {msg.type === 'text' && (
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {loading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-white flex-shrink-0">
              <Bot size={13} />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">
                {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:`${i*0.15}s`}} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-200 bg-white">
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {['코스 가격 변경', '기숙사 가격 변경', '프로모션 날짜 수정', '프로모션 할인 변경', '등록비 변경'].map(ex => (
            <button key={ex} onClick={() => sendMessage(ex)}
              className="text-xs px-2.5 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full hover:bg-purple-100">
              {ex}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
            className="input-field flex-1 text-sm" placeholder="어떤 내용을 수정할까요?" disabled={loading} />
          <button onClick={() => sendMessage(input)} disabled={!input.trim() || loading}
            className="btn-primary px-3 flex-shrink-0"><Send size={14} /></button>
        </div>
      </div>
    </div>
  )
}
