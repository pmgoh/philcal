'use client'
import { useState, useRef } from 'react'
import { v4 as uuid } from 'uuid'
import { saveSchool } from '@/lib/db'
import type { School, Course, Dormitory } from '@/types'
import { Upload, X, Check, AlertTriangle, ChevronDown, ChevronUp, FileJson } from 'lucide-react'

interface Props {
  onClose: () => void
  onImported: () => void
}

interface ValidationError {
  field: string
  message: string
}

// JSON에서 학원 데이터를 정규화 (id 부여, 배열 기본값 등)
function normalizeSchool(raw: Record<string, unknown>): Omit<School, 'id' | 'createdAt' | 'updatedAt'> {
  const courses: Course[] = ((raw.courses as Course[]) ?? []).map(c => ({
    ...c, id: c.id || uuid()
  }))
  const dormitories: Dormitory[] = ((raw.dormitories as Dormitory[]) ?? []).map(d => ({
    ...d, id: d.id || uuid(),
    operationPeriod: d.operationPeriod ?? undefined,
  }))

  return {
    name:             (raw.name as string)             ?? '',
    region:           (raw.region as School['region']) ?? '기타',
    schoolType:       (raw.schoolType as School['schoolType']) ?? 'general',
    programTags:      (raw.programTags as School['programTags']) ?? [],
    minWeeks:         (raw.minWeeks as number)         ?? 4,
    allowShortTerm:   (raw.allowShortTerm as boolean)  ?? false,
    registrationFee:  (raw.registrationFee as School['registrationFee']) ?? undefined,
    courseShortTermRates: (raw.courseShortTermRates as School['courseShortTermRates']) ?? undefined,
    dormShortTermRates:   (raw.dormShortTermRates   as School['dormShortTermRates'])   ?? undefined,
    priceIncrease:    (raw.priceIncrease as School['priceIncrease']) ?? undefined,
    courses,
    dormitories,
    surcharges:       ((raw.surcharges  as School['surcharges'])  ?? []).map(s => ({ ...s, id: s.id || uuid() })),
    promotions:       ((raw.promotions  as School['promotions'])  ?? []).map(p => ({ ...p, id: p.id || uuid() })),
    localFees:        ((raw.localFees   as School['localFees'])   ?? []).map(f => ({ ...f, id: f.id || uuid() })),
    packages:         ((raw.packages    as School['packages'])    ?? []).map(p => ({ ...p, id: p.id || uuid() })),
    refundPolicy:     (raw.refundPolicy   as string) ?? '',
    dormitoryRules:   (raw.dormitoryRules as string) ?? '',
    generalNotes:     (raw.generalNotes   as string) ?? '',
    isActive:         (raw.isActive as boolean) ?? true,
  }
}

// 기본 유효성 검사 (패키지 전용 학원은 courses/dormitories 없어도 허용)
function validate(data: ReturnType<typeof normalizeSchool>): ValidationError[] {
  const errors: ValidationError[] = []
  if (!data.name?.trim()) errors.push({ field: 'name', message: '학원명이 없습니다.' })
  if (!data.region) errors.push({ field: 'region', message: '지역이 없습니다.' })

  // 코스도 없고 패키지도 없을 때만 에러
  if (data.courses.length === 0 && data.packages.length === 0) {
    errors.push({ field: 'courses', message: '코스 또는 패키지가 하나도 없습니다.' })
  }
  data.courses.forEach((c, i) => {
    if (!c.name) errors.push({ field: `courses[${i}]`, message: `코스 ${i + 1}번 이름이 없습니다.` })
    if (!c.price4Weeks) errors.push({ field: `courses[${i}].price`, message: `코스 "${c.name}" 가격이 0입니다.` })
  })
  data.dormitories.forEach((d, i) => {
    if (!d.name) errors.push({ field: `dormitories[${i}]`, message: `기숙사 ${i + 1}번 이름이 없습니다.` })
  })
  return errors
}

export default function JsonImportModal({ onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [jsonText, setJsonText] = useState('')
  const [parsed, setParsed] = useState<ReturnType<typeof normalizeSchool> | null>(null)
  const [parsedArray, setParsedArray] = useState<ReturnType<typeof normalizeSchool>[] | null>(null)
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [parseError, setParseError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setJsonText(text)
      processJson(text)
    }
    reader.readAsText(file)
  }

  const processJson = (text: string) => {
    setParseError('')
    setErrors([])
    setParsed(null)
    setParsedArray(null)
    try {
      const raw = JSON.parse(text)
      if (Array.isArray(raw)) {
        // 배열 모드: 여러 학원 일괄 import
        const normalized = raw.map(r => normalizeSchool(r as Record<string, unknown>))
        const allErrors = normalized.flatMap((n, i) =>
          validate(n).map(e => ({ ...e, field: `[${i}] ${n.name}: ${e.field}` }))
        )
        setParsedArray(normalized)
        setErrors(allErrors)
      } else {
        // 단일 객체 모드
        const normalized = normalizeSchool(raw)
        const errs = validate(normalized)
        setParsed(normalized)
        setErrors(errs)
      }
    } catch {
      setParseError('JSON 형식이 올바르지 않습니다. 형식을 확인해주세요.')
    }
  }

  const handlePaste = () => processJson(jsonText)

  const handleSave = async () => {
    if (!parsed && !parsedArray) return
    setSaving(true)
    try {
      if (parsedArray) {
        // 배열 일괄 저장
        for (const school of parsedArray) {
          const clean = JSON.parse(JSON.stringify(school))
          await saveSchool(clean)
        }
      } else if (parsed) {
        const clean = JSON.parse(JSON.stringify(parsed))
        await saveSchool(clean)
      }
      setSaved(true)
      setTimeout(() => { onImported(); onClose() }, 1200)
    } catch (e) {
      console.error(e)
      setParseError('저장 중 오류가 발생했습니다. 콘솔을 확인해주세요.')
    } finally {
      setSaving(false)
    }
  }

  const hasBlockingErrors = errors.some(e =>
    e.field === 'name' || e.field === 'region' || e.field.includes('학원명')
  )
  const isReady = (parsed !== null || parsedArray !== null) && !hasBlockingErrors

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileJson size={16} className="text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">JSON으로 학원 가져오기</h2>
              <p className="text-xs text-gray-400">PDF 추출 결과를 바로 등록합니다</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* 탭 */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['upload', 'paste'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {t === 'upload' ? '📁 파일 업로드' : '📋 텍스트 붙여넣기'}
              </button>
            ))}
          </div>

          {/* 파일 업로드 */}
          {tab === 'upload' && (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-colors"
            >
              <Upload size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-600">JSON 파일을 클릭해서 선택하세요</p>
              <p className="text-xs text-gray-400 mt-1">.json 파일만 지원</p>
              <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
            </div>
          )}

          {/* 텍스트 붙여넣기 */}
          {tab === 'paste' && (
            <div className="space-y-2">
              <textarea
                value={jsonText}
                onChange={e => setJsonText(e.target.value)}
                className="input-field h-40 resize-none font-mono text-xs"
                placeholder={'{\n  "name": "학원명",\n  "region": "세부",\n  ...\n}'}
              />
              <button onClick={handlePaste} disabled={!jsonText.trim()}
                className="btn-primary w-full">
                JSON 분석하기
              </button>
            </div>
          )}

          {/* 파싱 에러 */}
          {parseError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{parseError}</p>
            </div>
          )}

          {/* 파싱 성공 - 배열 미리보기 */}
          {parsedArray && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <p className="font-semibold text-green-900 mb-2">📦 {parsedArray.length}개 학원 일괄 등록 준비됨</p>
                <div className="space-y-1">
                  {parsedArray.map((s, i) => (
                    <div key={i} className="flex justify-between text-xs text-green-700 bg-white/70 rounded px-2 py-1.5">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-green-500">{s.region} · 패키지 {s.packages.length}개 · 코스 {s.courses.length}개</span>
                    </div>
                  ))}
                </div>
              </div>
              {errors.length > 0 && (
                <div className="space-y-1.5">
                  {errors.map((err, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 bg-yellow-50 text-yellow-700 border border-yellow-200">
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>{err.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 파싱 성공 - 단일 미리보기 */}
          {parsed && (
            <div className="space-y-3">
              {/* 요약 카드 */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-semibold text-blue-900 text-lg">{parsed.name || '(학원명 없음)'}</p>
                    <p className="text-sm text-blue-600">{parsed.region} · {parsed.schoolType === 'sparta' ? '스파르타' : parsed.schoolType === 'general' ? '일반' : '스파르타/일반'}</p>
                  </div>
                  <div className="text-right text-sm text-blue-700 space-y-0.5">
                    <div>코스 {parsed.courses.length}개</div>
                    <div>기숙사 {parsed.dormitories.length}개</div>
                    <div>패키지 {parsed.packages.length}개</div>
                    <div>프로모션 {parsed.promotions.length}개</div>
                  </div>
                </div>

                {/* 코스 목록 미리보기 */}
                {parsed.courses.length > 0 && (
                  <div className="space-y-1">
                    {parsed.courses.slice(0, 3).map((c, i) => (
                      <div key={i} className="flex justify-between text-xs text-blue-700 bg-white/60 rounded px-2 py-1">
                        <span>{c.name} <span className="text-blue-400">({c.target})</span></span>
                        <span className="font-medium">{c.price4Weeks.toLocaleString()}{c.currency === 'KRW' ? '원' : c.currency}/주</span>
                      </div>
                    ))}
                    {parsed.courses.length > 3 && (
                      <p className="text-xs text-blue-500 text-center">+{parsed.courses.length - 3}개 더</p>
                    )}
                  </div>
                )}
              </div>

              {/* 유효성 경고 */}
              {errors.length > 0 && (
                <div className="space-y-1.5">
                  {errors.map((err, i) => (
                    <div key={i} className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                      err.field === 'name' || err.field === 'region'
                        ? 'bg-red-50 text-red-700 border border-red-200'
                        : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                    }`}>
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>{err.message}</span>
                    </div>
                  ))}
                  {errors.some(e => e.field !== 'name' && e.field !== 'region') && (
                    <p className="text-xs text-gray-400 px-1">⚠️ 경고 항목은 저장 후 수동으로 수정 가능합니다.</p>
                  )}
                </div>
              )}

              {/* 전체 JSON 미리보기 토글 */}
              <button onClick={() => setShowPreview(!showPreview)}
                className="w-full flex items-center justify-between text-sm text-gray-500 hover:text-gray-700 py-1">
                <span>전체 데이터 보기</span>
                {showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              {showPreview && (
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs overflow-auto max-h-48 text-gray-600">
                  {JSON.stringify(parsed, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">취소</button>
          <button
            onClick={handleSave}
            disabled={!isReady || saving || saved}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {saved
              ? <><Check size={14} /> 저장됨</>
              : saving
                ? `저장 중...`
                : parsedArray
                  ? <><Upload size={14} /> {parsedArray.length}개 학원 일괄 등록</>
                  : errors.length > 0 && !hasBlockingErrors
                    ? <><Upload size={14} /> 경고 무시하고 저장</>
                    : <><Upload size={14} /> 학원 등록하기</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
