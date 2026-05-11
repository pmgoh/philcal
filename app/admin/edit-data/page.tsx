'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import AdminLayout from '@/components/AdminLayout'
import { getSchools, saveSchool } from '@/lib/db'
import type { School } from '@/types'
import { Send, Check, X, ChevronDown, Bot, User, AlertTriangle, RotateCcw } from 'lucide-react'

// ─── 타입 ────────────────────────────────────────────────────────────────────
interface PatchOp {
  path: string
  index?: number
  field?: string
  value: unknown
}
interface ChangeItem {
  field: string
  label: string
  before: string
  after: string
}
interface ChatMsg {
  role: 'user' | 'ai'
  type: 'text' | 'confirm' | 'patch_result'
  content: string
  summary?: string
  changes?: ChangeItem[]
  ops?: PatchOp[]
  approved?: boolean | null  // null=pending
}

// ─── 패치 적용 ────────────────────────────────────────────────────────────────
function applyPatch(school: School, ops: PatchOp[]): School {
  const s = JSON.parse(JSON.stringify(school)) as Record<string, unknown>
  for (const op of ops) {
    if (op.index !== undefined && op.field) {
      // 배열 내 특정 항목 필드 수정
      const arr = s[op.path] as Record<string, unknown>[]
      if (arr && arr[op.index]) arr[op.index][op.field] = op.value
    } else if (op.field) {
      // 최상위 객체 필드 수정
      const obj = s[op.path] as Record<string, unknown>
      if (obj) obj[op.field] = op.value
    } else {
      // 최상위 필드 직접 수정
      s[op.path] = op.value
    }
  }
  return s as unknown as School
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────
export default function EditDataPage() {
  const router = useRouter()
  const [schools, setSchools] = useState<School[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [school, setSchool] = useState<School | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const apiHistory = useRef<{ role: string; content: string }[]>([])

  useEffect(() => {
    getSchools().then(list => {
      setSchools(list.filter(s => s.isActive !== false))
    })
  }, [])

  useEffect(() => {
    if (!selectedId) return
    const s = schools.find(s => s.id === selectedId) ?? null
    setSchool(s)
    setMessages([{
      role: 'ai', type: 'text',
      content: s ? `**${s.name}** 데이터 수정 채팅입니다.\n코스 가격, 기숙사 가격, 프로모션, 서차지, 규정 등을 자연어로 수정하세요.\n\n예) "SPEED ESL 4주 가격을 100만원으로 올려줘"` : '',
    }])
    apiHistory.current = []
  }, [selectedId, schools])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text: string) => {
    if (!school || !text.trim() || loading) return
    setInput('')
    setLoading(true)

    const userMsg: ChatMsg = { role: 'user', type: 'text', content: text }
    setMessages(prev => [...prev, userMsg])

    apiHistory.current = [...apiHistory.current, { role: 'user', content: text }]

    try {
      const res = await fetch('/api/edit-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiHistory.current, school }),
      })
      const data = await res.json()

      if (data.action === 'confirm') {
        const aiMsg: ChatMsg = {
          role: 'ai', type: 'confirm',
          content: data.summary ?? '',
          changes: data.changes ?? [],
          ops: undefined,
          approved: null,
        }
        setMessages(prev => [...prev, aiMsg])
        apiHistory.current = [...apiHistory.current, {
          role: 'assistant',
          content: `변경사항 확인 요청:\n${(data.changes ?? []).map((c: ChangeItem) => `- ${c.label}: ${c.before} → ${c.after}`).join('\n')}\n\n이대로 저장할까요?`,
        }]
      } else if (data.action === 'patch' && data.ops) {
        // AI가 바로 patch 주는 경우(확인 후) - 실제 저장
        const updated = applyPatch(school, data.ops as PatchOp[])
        setSaving(true)
        await saveSchool(updated)
        setSchool(updated)
        setSchools(prev => prev.map(s => s.id === updated.id ? updated : s))
        setSaving(false)
        const aiMsg: ChatMsg = {
          role: 'ai', type: 'patch_result',
          content: '✅ 저장 완료',
          ops: data.ops,
          approved: true,
        }
        setMessages(prev => [...prev, aiMsg])
        apiHistory.current = [...apiHistory.current, { role: 'assistant', content: '저장이 완료되었습니다.' }]
      } else {
        const aiMsg: ChatMsg = { role: 'ai', type: 'text', content: data.message ?? JSON.stringify(data) }
        setMessages(prev => [...prev, aiMsg])
        apiHistory.current = [...apiHistory.current, { role: 'assistant', content: data.message ?? '' }]
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', type: 'text', content: `오류: ${e}` }])
    } finally {
      setLoading(false)
    }
  }

  // 확인 카드에서 승인/거절
  const handleApprove = async (msgIdx: number) => {
    const msg = messages[msgIdx]
    if (!school || !msg.changes) return

    // AI에게 "네" 보내서 patch 받기
    setSaving(true)
    apiHistory.current = [...apiHistory.current, { role: 'user', content: '네, 저장해주세요.' }]

    try {
      const res = await fetch('/api/edit-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiHistory.current, school }),
      })
      const data = await res.json()

      if (data.action === 'patch' && data.ops) {
        const updated = applyPatch(school, data.ops as PatchOp[])
        await saveSchool(updated)
        setSchool(updated)
        setSchools(prev => prev.map(s => s.id === updated.id ? updated : s))
        setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, approved: true } : m))
        setMessages(prev => [...prev, { role: 'ai', type: 'patch_result', content: `✅ 저장 완료 (${(data.ops as PatchOp[]).length}개 항목 업데이트)`, approved: true }])
        apiHistory.current = [...apiHistory.current, { role: 'assistant', content: '저장이 완료되었습니다.' }]
      } else {
        // fallback: changes로 직접 패치 시도
        setMessages(prev => [...prev, { role: 'ai', type: 'text', content: data.message ?? '저장 처리 중 문제가 발생했습니다.' }])
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', type: 'text', content: `저장 오류: ${e}` }])
    } finally {
      setSaving(false)
    }
  }

  const handleReject = (msgIdx: number) => {
    setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, approved: false } : m))
    setMessages(prev => [...prev, { role: 'ai', type: 'text', content: '취소했습니다. 다시 말씀해 주세요.' }])
    apiHistory.current = [...apiHistory.current, { role: 'user', content: '아니요, 취소해주세요.' }, { role: 'assistant', content: '취소했습니다. 다시 알려주세요.' }]
  }

  const reset = () => {
    setMessages([{
      role: 'ai', type: 'text',
      content: school ? `**${school.name}** 데이터 수정 채팅입니다.` : '',
    }])
    apiHistory.current = []
  }

  return (
    <AdminLayout>
      <div className="flex flex-col bg-gray-50" style={{ height: 'calc(100dvh - 56px)' }}>
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-gray-900">데이터 수정 채팅</h1>
            <p className="text-xs text-gray-400">학원 비용/규정/프로모션을 대화로 수정</p>
          </div>
          <div className="relative flex-shrink-0">
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="input-field text-sm pr-8 max-w-[200px]">
              <option value="">학원 선택</option>
              {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
          {selectedId && (
            <button onClick={reset} className="p-2 hover:bg-gray-100 rounded-lg" title="대화 초기화">
              <RotateCcw size={14} className="text-gray-500" />
            </button>
          )}
        </div>

        {/* 메시지 */}
        <div className="flex-1 overflow-y-auto px-3 md:px-4 py-4 space-y-3">
          {!selectedId && (
            <div className="text-center py-16 text-gray-400">
              <Bot size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">위에서 수정할 학원을 선택해주세요</p>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === 'user') return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80vw] md:max-w-lg bg-blue-600 text-white rounded-2xl rounded-tr-sm px-3 py-2.5">
                  <p className="text-sm">{msg.content}</p>
                </div>
              </div>
            )

            // AI 메시지
            return (
              <div key={i} className="flex gap-2">
                <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                  <Bot size={13} />
                </div>
                <div className="max-w-[85vw] md:max-w-2xl flex-1">
                  {msg.type === 'confirm' && msg.approved === null && (
                    // 변경 확인 카드
                    <div className="bg-white border border-amber-200 rounded-2xl rounded-tl-sm overflow-hidden shadow-sm">
                      <div className="bg-amber-50 px-4 py-3 border-b border-amber-100">
                        <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                          <AlertTriangle size={14} /> 변경사항 확인해주세요
                        </p>
                        {msg.content && <p className="text-xs text-amber-700 mt-1">{msg.content}</p>}
                      </div>
                      <div className="divide-y divide-gray-50">
                        {(msg.changes ?? []).map((c, ci) => (
                          <div key={ci} className="flex items-center gap-2 px-4 py-2.5">
                            <span className="text-xs text-gray-500 flex-1 truncate">{c.label}</span>
                            <span className="text-xs text-red-500 line-through">{c.before}</span>
                            <span className="text-gray-400 text-xs">→</span>
                            <span className="text-xs text-green-700 font-semibold">{c.after}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 px-4 py-3 bg-gray-50">
                        <button onClick={() => handleApprove(i)} disabled={saving}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors">
                          <Check size={14} /> {saving ? '저장 중...' : '맞아요, 저장해주세요'}
                        </button>
                        <button onClick={() => handleReject(i)} disabled={saving}
                          className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg text-sm transition-colors">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  {msg.type === 'confirm' && msg.approved === true && (
                    <div className="bg-white border border-green-200 rounded-2xl rounded-tl-sm px-4 py-3">
                      <p className="text-sm text-green-700 font-medium flex items-center gap-2">
                        <Check size={14} /> 승인됨 — 저장 처리 중
                      </p>
                    </div>
                  )}

                  {msg.type === 'confirm' && msg.approved === false && (
                    <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
                      <p className="text-sm text-gray-500 flex items-center gap-2">
                        <X size={14} /> 취소됨
                      </p>
                    </div>
                  )}

                  {msg.type === 'patch_result' && (
                    <div className="bg-white border border-green-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                      <p className="text-sm text-green-700 font-semibold flex items-center gap-2">
                        <Check size={14} /> {msg.content}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">Firestore에 저장됐습니다. 학원 관리 페이지에서 확인하세요.</p>
                    </div>
                  )}

                  {msg.type === 'text' && (
                    <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
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
                  {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 입력창 */}
        <div className="px-3 md:px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
          {!selectedId ? (
            <p className="text-sm text-gray-400 text-center py-1">학원을 먼저 선택해주세요</p>
          ) : (
            <>
              <div className="flex gap-2 mb-2 flex-wrap">
                {[
                  'SPEED ESL 4주 가격을 올려줘',
                  '비수기 프로모션 종료일 변경',
                  '서차지 기간 수정해줘',
                  '등록비 금액 바꿔줘',
                ].map(ex => (
                  <button key={ex} onClick={() => sendMessage(ex)}
                    className="text-xs px-2.5 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-full hover:bg-purple-100">
                    {ex}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                  className="input-field flex-1 text-sm"
                  placeholder={`${school?.name ?? ''} 데이터를 어떻게 수정할까요?`}
                  disabled={!selectedId || loading} />
                <button onClick={() => sendMessage(input)} disabled={!input.trim() || loading || !selectedId}
                  className="btn-primary px-3 flex-shrink-0 flex items-center gap-1">
                  <Send size={14} />
                  <span className="hidden sm:inline text-sm">전송</span>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1 hidden md:block">Enter 전송 · 변경사항은 AI가 요약 후 확인을 받아 저장합니다</p>
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
