'use client'
import { useState, useRef, useCallback } from 'react'
import AdminLayout from '@/components/AdminLayout'
import { Upload, FileText, ImageIcon, X, Copy, Download, CheckCircle, AlertCircle, Loader, ChevronDown, ChevronUp } from 'lucide-react'

type ParseMode = 'school' | 'promotion'

interface ParseResult {
  ok?: boolean
  result?: unknown[]
  raw?: string
  error?: string
  warning?: string
}

const MODE_CONFIG: Record<ParseMode, { label: string; desc: string; color: string }> = {
  school:    { label: '학원 데이터', desc: '코스·기숙사·패키지·현지납부비 등 학원 전체 정보', color: 'blue' },
  promotion: { label: '프로모션',    desc: '할인 조건·기간·유학원 할인 등 프로모션 정보',    color: 'red'  },
}

export default function JsonToolPage() {
  const [mode, setMode] = useState<ParseMode>('school')
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [steps, setSteps] = useState<{ label: string; done: boolean }[]>([])
  const [result, setResult] = useState<ParseResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter(f =>
      f.type.startsWith('image/') || f.type === 'application/pdf'
    )
    setFiles(prev => [...prev, ...arr])
  }, [])

  const removeFile = (i: number) => setFiles(prev => prev.filter((_, idx) => idx !== i))

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    addFiles(e.dataTransfer.files)
  }

  const handleParse = async () => {
    if (!files.length) return
    setLoading(true); setResult(null); setSteps([])
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      fd.append('mode', mode)
      if (note) fd.append('note', note)

      const res = await fetch('/api/json-tool', { method: 'POST', body: fd })
      if (!res.body) throw new Error('응답 없음')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = JSON.parse(line.slice(6))
          if (data.step) {
            setSteps(prev => {
              const next = [...prev]
              if (next.length < data.step) {
                next.push({ label: data.label, done: false })
              } else {
                next[data.step - 1] = { label: data.label, done: false }
              }
              return next
            })
          }
          if (data.done) {
            setSteps(prev => prev.map(s => ({ ...s, done: true })))
            setResult({ ok: true, result: data.result, raw: data.raw, warning: data.warning })
          }
          if (data.error) {
            setResult({ error: data.error })
          }
        }
      }
    } catch (e) {
      setResult({ error: String(e) })
    } finally { setLoading(false) }
  }

  const jsonText = result?.raw ?? ''

  const handleCopy = async () => {
    await navigator.clipboard.writeText(jsonText)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([jsonText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${mode}_${Date.now()}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  const resultCount = Array.isArray(result?.result) ? result.result.length : 0

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* 헤더 */}
        <div>
          <h1 className="text-lg font-bold text-gray-900">학원 데이터 JSON 파서</h1>
          <p className="text-sm text-gray-500 mt-0.5">PDF 또는 이미지를 올리면 JSON으로 변환합니다</p>
        </div>

        {/* 모드 선택 */}
        <div className="flex gap-2">
          {(Object.entries(MODE_CONFIG) as [ParseMode, typeof MODE_CONFIG[ParseMode]][]).map(([key, cfg]) => (
            <button key={key} onClick={() => { setMode(key); setResult(null) }}
              className={`flex-1 py-3 px-4 rounded-xl border-2 text-left transition-all ${
                mode === key
                  ? cfg.color === 'blue'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-red-500 bg-red-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}>
              <p className={`text-sm font-semibold ${mode === key ? (cfg.color === 'blue' ? 'text-blue-700' : 'text-red-700') : 'text-gray-700'}`}>
                {cfg.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{cfg.desc}</p>
            </button>
          ))}
        </div>

        {/* 파일 업로드 */}
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}>
          <input ref={inputRef} type="file" multiple accept="image/*,.pdf"
            className="hidden" onChange={e => e.target.files && addFiles(e.target.files)} />
          <Upload size={28} className="mx-auto text-gray-400 mb-2" />
          <p className="text-sm font-medium text-gray-600">클릭 또는 드래그하여 파일 추가</p>
          <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG, WEBP · 여러 파일 가능</p>
        </div>

        {/* 파일 목록 */}
        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-white border border-gray-200 rounded-xl">
                {f.type === 'application/pdf'
                  ? <FileText size={16} className="text-red-500 flex-shrink-0" />
                  : <ImageIcon size={16} className="text-blue-500 flex-shrink-0" />}
                <span className="text-sm text-gray-700 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)}KB</span>
                <button onClick={e => { e.stopPropagation(); removeFile(i) }}
                  className="p-1 hover:bg-red-50 rounded-lg">
                  <X size={14} className="text-gray-400 hover:text-red-500" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 추가 지시사항 */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">추가 지시사항 (선택)</label>
          <input value={note} onChange={e => setNote(e.target.value)}
            className="input-field w-full text-sm"
            placeholder={mode === 'school'
              ? '예: 현지납부비 포함 처리 / 성수기 패키지만 뽑아줘'
              : '예: 비수기 프로모션만 / 유학원 할인 10% 적용'} />
        </div>

        {/* 파싱 버튼 */}
        <button onClick={handleParse} disabled={!files.length || loading}
          className="w-full btn-primary py-3 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2">
          {loading
            ? <><Loader size={16} className="animate-spin" /> 파싱 중...</>
            : `📄 ${MODE_CONFIG[mode].label} JSON 파싱`}
        </button>

        {/* 진행 상태 */}
        {loading && steps.length > 0 && (
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
                s.done ? 'bg-green-50 border-green-200 text-green-700' : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}>
                {s.done
                  ? <CheckCircle size={15} className="flex-shrink-0" />
                  : <Loader size={15} className="animate-spin flex-shrink-0" />}
                {s.label}
              </div>
            ))}
          </div>
        )}

        {/* 결과 */}
        {result && (
          <div className="space-y-3">
            <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium ${
              result.ok ? 'bg-green-50 border border-green-200 text-green-800'
                        : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {result.ok
                ? <><CheckCircle size={16} /> 파싱 성공 — {resultCount}개 항목 추출</>
                : <><AlertCircle size={16} /> {result.error}</>}
            </div>
            {result.ok && result.warning && (
              <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                <AlertCircle size={16} /> {result.warning}
              </div>
            )}

            {jsonText && (
              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-medium text-gray-500">JSON 출력</span>
                  <div className="flex gap-2">
                    <button onClick={handleCopy}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                      {copied ? <><CheckCircle size={12} className="text-green-600" /> 복사됨</> : <><Copy size={12} /> 복사</>}
                    </button>
                    <button onClick={handleDownload}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                      <Download size={12} /> 다운로드
                    </button>
                  </div>
                </div>
                <pre className="text-xs text-gray-700 p-4 overflow-x-auto max-h-[500px] overflow-y-auto bg-white font-mono leading-relaxed">
                  {jsonText}
                </pre>
              </div>
            )}

            {/* 요약 */}
            {result.ok && Array.isArray(result.result) && (
              <div>
                <button onClick={() => setShowSummary(!showSummary)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                  {showSummary ? <ChevronUp size={12} /> : <ChevronDown size={12} />} 파싱 요약
                </button>
                {showSummary && (
                  <div className="mt-2 space-y-1.5">
                    {mode === 'school'
                      ? (result.result as Record<string, unknown>[]).map((s, i) => (
                          <div key={i} className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-xs space-y-0.5">
                            <p className="font-semibold text-gray-800">{String(s.name ?? '-')}</p>
                            <div className="flex gap-4 text-gray-500">
                              <span>지역: {String(s.region ?? '-')}</span>
                              <span>코스: {Array.isArray(s.courses) ? s.courses.length : 0}개</span>
                              <span>기숙사: {Array.isArray(s.dormitories) ? s.dormitories.length : 0}개</span>
                              <span>패키지: {Array.isArray(s.packages) ? s.packages.length : 0}개</span>
                              <span>현지비: {Array.isArray(s.localFees) ? s.localFees.length : 0}개</span>
                            </div>
                          </div>
                        ))
                      : (result.result as Record<string, unknown>[]).map((p, i) => (
                          <div key={i} className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-xs">
                            <span className="font-semibold text-gray-800">{String(p.schoolName ?? '-')}</span>
                            <span className="text-gray-400 mx-1">·</span>
                            <span className="text-gray-600">{String(p.promoName ?? '-')}</span>
                            <span className="ml-2 text-gray-400">{String(p.startDate ?? '')}~{String(p.endDate ?? '')}</span>
                          </div>
                        ))
                    }
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  )
}
