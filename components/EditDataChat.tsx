'use client'
import { useEffect, useState, useRef } from 'react'
import { getSchool, saveSchool, getPromotions, savePromotion } from '@/lib/db'
import type { School } from '@/types'
import type { PromoEntry } from '@/lib/db'
import { Send, Check, X, Bot, AlertTriangle, RotateCcw } from 'lucide-react'

interface ChangeItem { label: string; before: string; after: string }
interface ChatMsg {
  role: 'user' | 'ai'
  type: 'text' | 'confirm' | 'saved'
  content: string
  changes?: ChangeItem[]
  updatedSchool?: School
  updatedPromos?: PromoEntry[] | null
  changedPromoIds?: string[]
  approved?: boolean | null
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
      if (s) {
        const myPromos = allPromos.filter(p => p.schoolName === s.name)
        setPromos(myPromos)
        setMessages([{ role: 'ai', type: 'text',
          content: `**${s.name}** 데이터 수정입니다. 코스·기숙사 가격, 프로모션 날짜/할인, 등록비, 규정 등을 수정할 수 있습니다.\n연결된 프로모션: ${myPromos.length}개` }])
      }
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

      if (data.action === 'confirm') {
        setMessages(prev => [...prev, {
          role: 'ai', type: 'confirm',
          content: data.summary ?? '변경사항 확인',
          changes: data.changes ?? [],
          updatedSchool: data.updatedSchool,
          updatedPromos: data.updatedPromos ?? null,
          changedPromoIds: data.changedPromoIds ?? [],
          approved: null,
        }])
        apiHistory.current = [...apiHistory.current, {
          role: 'assistant',
          content: `변경사항:\n${(data.changes ?? []).map((c: ChangeItem) => `- ${c.label}: ${c.before} → ${c.after}`).join('\n')}\n저장할까요?`,
        }]
      } else {
        setMessages(prev => [...prev, { role: 'ai', type: 'text', content: data.message ?? JSON.stringify(data) }])
        apiHistory.current = [...apiHistory.current, { role: 'assistant', content: data.message ?? '' }]
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', type: 'text', content: `오류: ${e}` }])
    } finally { setLoading(false) }
  }

  const handleApprove = async (msg: ChatMsg, msgIdx: number) => {
    if (!msg.updatedSchool) {
      setMessages(prev => [...prev, { role: 'ai', type: 'text', content: '⚠️ 저장할 데이터가 없습니다. 다시 시도해주세요.' }])
      return
    }
    setSaving(true)
    try {
      // 학원 저장
      await saveSchool(msg.updatedSchool)
      setSchool(msg.updatedSchool)

      // 변경된 프로모션 저장
      let savedPromoCount = 0
      if (msg.updatedPromos && msg.changedPromoIds && msg.changedPromoIds.length > 0) {
        const toSave = msg.updatedPromos.filter(p => msg.changedPromoIds!.includes(p.id))
        for (const p of toSave) { await savePromotion(p) }
        setPromos(msg.updatedPromos)
        savedPromoCount = toSave.length
      }

      setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, approved: true } : m))
      setMessages(prev => [...prev, {
        role: 'ai', type: 'saved',
        content: `✅ 저장 완료${savedPromoCount > 0 ? ` (학원 데이터 + 프로모션 ${savedPromoCount}개)` : ''}`,
      }])
      apiHistory.current = [...apiHistory.current,
        { role: 'user', content: '네, 저장해주세요.' },
        { role: 'assistant', content: '저장 완료.' },
      ]
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', type: 'text', content: `저장 실패: ${e}` }])
    } finally { setSaving(false) }
  }

  const handleReject = (msgIdx: number) => {
    setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, approved: false } : m))
    setMessages(prev => [...prev, { role: 'ai', type: 'text', content: '취소했습니다.' }])
    apiHistory.current = [...apiHistory.current,
      { role: 'user', content: '취소.' },
      { role: 'assistant', content: '취소했습니다.' },
    ]
  }

  if (!school) return <div className="p-8 text-center text-gray-400">불러오는 중...</div>

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 100px)' }}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-xs text-gray-500">프로모션 {promos.length}개 연결됨</span>
        <button onClick={() => {
          setMessages([{ role: 'ai', type: 'text', content: `초기화됐습니다.` }])
          apiHistory.current = []
        }} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <RotateCcw size={12} /> 초기화
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => {
          if (msg.role === 'user') return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80vw] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-2.5 text-sm">{msg.content}</div>
            </div>
          )

          return (
            <div key={i} className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-white flex-shrink-0 mt-0.5"><Bot size={13} /></div>
              <div className="max-w-[85vw] flex-1">

                {/* confirm */}
                {msg.type === 'confirm' && msg.approved === null && (
                  <div className="bg-white border border-amber-200 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
                    <div className="bg-amber-50 px-4 py-3 border-b border-amber-100 flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-600" />
                      <p className="text-sm font-semibold text-amber-900">{msg.content}</p>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {(msg.changes ?? []).map((c, ci) => (
                        <div key={ci} className="flex items-center gap-2 px-4 py-2.5 flex-wrap text-xs">
                          <span className="text-gray-600 flex-1">{c.label}</span>
                          <span className="text-red-500 line-through">{c.before}</span>
                          <span className="text-gray-400">→</span>
                          <span className="text-green-700 font-semibold">{c.after}</span>
                        </div>
                      ))}
                      {!msg.updatedSchool && (
                        <div className="px-4 py-2 text-xs text-red-500">⚠️ 변경 데이터 없음</div>
                      )}
                    </div>
                    <div className="flex gap-2 px-4 py-3 bg-gray-50">
                      <button onClick={() => handleApprove(msg, i)} disabled={saving || !msg.updatedSchool}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">
                        <Check size={14} /> {saving ? '저장 중...' : '저장'}
                      </button>
                      <button onClick={() => handleReject(i)} disabled={saving}
                        className="px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-sm"><X size={14} /></button>
                    </div>
                  </div>
                )}
                {msg.type === 'confirm' && msg.approved === true && (
                  <div className="bg-white border border-green-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-green-600 flex items-center gap-2"><Check size={14} /> 승인됨</div>
                )}
                {msg.type === 'confirm' && msg.approved === false && (
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-400 flex items-center gap-2"><X size={14} /> 취소됨</div>
                )}
                {msg.type === 'saved' && (
                  <div className="bg-white border border-green-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-green-700 font-semibold">{msg.content}</div>
                )}
                {msg.type === 'text' && (
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          )
        })}
        {loading && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-white flex-shrink-0"><Bot size={13} /></div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">{[0,1,2].map(j => <span key={j} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:`${j*0.15}s`}} />)}</div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-200 bg-white">
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {['코스 가격', '기숙사 가격', '프로모션 날짜', '프로모션 할인액', '등록비'].map(ex => (
            <button key={ex} onClick={() => setInput(ex + ' 수정')}
              className="text-xs px-2.5 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full hover:bg-purple-100">{ex}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
            className="input-field flex-1 text-sm" placeholder="무엇을 수정할까요?" disabled={loading} />
          <button onClick={() => sendMessage(input)} disabled={!input.trim() || loading}
            className="btn-primary px-3 flex-shrink-0"><Send size={14} /></button>
        </div>
      </div>
    </div>
  )
}
