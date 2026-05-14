'use client'
import { useState, useRef, useEffect } from 'react'
import { v4 as uuid } from 'uuid'
import { saveSchool, getSchools, saveBatchSchools } from '@/lib/db'
import type { School, Course, Dormitory } from '@/types'
import { Upload, X, Check, AlertTriangle, ChevronDown, ChevronUp, FileJson, ArrowRight, Eye, EyeOff } from 'lucide-react'

interface Props {
  onClose: () => void
  onImported: () => void
}

interface ValidationError { field: string; message: string }

// ── 변경 diff 항목 ────────────────────────────────────────────────────────────
interface DiffItem {
  field: string
  label: string
  before: string
  after: string
  severity: 'danger' | 'warn' | 'info'
}

function diffSchools(before: School, after: ReturnType<typeof normalizeSchool>): DiffItem[] {
  const diffs: DiffItem[] = []

  const check = (field: string, label: string, b: unknown, a: unknown, severity: DiffItem['severity'] = 'warn') => {
    const bs = typeof b === 'object' ? JSON.stringify(b) : String(b ?? '')
    const as_ = typeof a === 'object' ? JSON.stringify(a) : String(a ?? '')
    if (bs !== as_) diffs.push({ field, label, before: bs, after: as_, severity })
  }

  check('name', '학원명', before.name, after.name, 'danger')
  check('region', '지역', before.region, after.region, 'danger')
  check('minWeeks', '최소 주수', before.minWeeks, after.minWeeks, 'warn')
  check('allowShortTerm', '단기가 여부', before.allowShortTerm, after.allowShortTerm, 'warn')

  // 코스 변경
  if (before.courses.length !== after.courses.length) {
    diffs.push({ field: 'courses', label: '코스 수', before: `${before.courses.length}개`, after: `${after.courses.length}개`, severity: 'warn' })
  } else {
    before.courses.forEach((c, i) => {
      const a = after.courses[i]
      if (!a) return
      if (c.price4Weeks !== a.price4Weeks) diffs.push({ field: `courses[${i}]`, label: `코스 "${c.name}" 가격`, before: `${c.price4Weeks.toLocaleString()}원`, after: `${a.price4Weeks.toLocaleString()}원`, severity: 'danger' })
      if (c.name !== a.name) diffs.push({ field: `courses[${i}].name`, label: `코스명 ${i+1}번`, before: c.name, after: a.name, severity: 'warn' })
    })
  }

  // 기숙사 변경
  if (before.dormitories.length !== after.dormitories.length) {
    diffs.push({ field: 'dormitories', label: '기숙사 수', before: `${before.dormitories.length}개`, after: `${after.dormitories.length}개`, severity: 'warn' })
  } else {
    before.dormitories.forEach((d, i) => {
      const a = after.dormitories[i]
      if (!a) return
      if (d.price4Weeks !== a.price4Weeks) diffs.push({ field: `dormitories[${i}]`, label: `기숙사 "${d.name}" 가격`, before: `${d.price4Weeks.toLocaleString()}원`, after: `${a.price4Weeks.toLocaleString()}원`, severity: 'danger' })
    })
  }

  // 패키지 변경
  if (before.packages.length !== after.packages.length) {
    diffs.push({ field: 'packages', label: '패키지 수', before: `${before.packages.length}개`, after: `${after.packages.length}개`, severity: 'warn' })
  } else {
    before.packages.forEach((p, i) => {
      const a = after.packages[i]
      if (!a) return
      if (p.label !== a.label) diffs.push({ field: `packages[${i}]`, label: `패키지명 ${i+1}번`, before: p.label, after: a.label, severity: 'warn' })
      const bMatrix = JSON.stringify(p.priceMatrix)
      const aMatrix = JSON.stringify(a.priceMatrix)
      if (bMatrix !== aMatrix) diffs.push({ field: `packages[${i}].price`, label: `패키지 "${p.label}" 가격표`, before: '(기존 가격표)', after: '(새 가격표)', severity: 'danger' })
    })
  }

  // 프로모션 날짜 — null(미확인)은 비교에서 제외
  const beforePromos = before.promotions ?? []
  const afterPromos = after.promotions ?? []
  if (beforePromos.length > 0 && afterPromos.length > 0) {
    const bDate = beforePromos[0]?.startDate ?? ''
    const aDate = afterPromos[0]?.startDate ?? ''
    if (bDate !== aDate) diffs.push({ field: 'promotions.startDate', label: '프로모션 기준 연도', before: bDate, after: aDate, severity: 'danger' })
  }

  // 일반 메모
  if (before.generalNotes !== after.generalNotes) {
    diffs.push({ field: 'generalNotes', label: '일반 유의사항', before: before.generalNotes.slice(0, 60) + '...', after: (after.generalNotes ?? '').slice(0, 60) + '...', severity: 'info' })
  }

  return diffs
}

// ── 정규화 ────────────────────────────────────────────────────────────────────
function normalizeSchool(raw: Record<string, unknown>): Omit<School, 'createdAt' | 'updatedAt'> {
  const courses: Course[] = ((raw.courses as Course[]) ?? []).map(c => ({ ...c, id: c.id || uuid() }))
  const dormitories: Dormitory[] = ((raw.dormitories as Dormitory[]) ?? []).map(d => ({ ...d, id: d.id || uuid(), operationPeriod: d.operationPeriod ?? undefined }))
  return {
    id: (raw.id as string) || uuid(),
    name: (raw.name as string) ?? '',
    region: (raw.region as School['region']) ?? '기타',
    schoolType: (raw.schoolType as School['schoolType']) ?? 'general',
    programTags: (raw.programTags as School['programTags']) ?? [],
    minWeeks: (raw.minWeeks as number) ?? 4,
    allowShortTerm: (raw.allowShortTerm as boolean) ?? false,
    registrationFee: (raw.registrationFee as School['registrationFee']) ?? undefined,
    courseShortTermRates: (raw.courseShortTermRates as School['courseShortTermRates']) ?? undefined,
    dormShortTermRates: (raw.dormShortTermRates as School['dormShortTermRates']) ?? undefined,
    priceIncrease: (raw.priceIncrease as School['priceIncrease']) ?? undefined,
    courses, dormitories,
    surcharges: ((raw.surcharges as School['surcharges']) ?? []).map(s => ({ ...s, id: s.id || uuid() })),
    // promotions: null이면 null 유지(미확인), 배열이면 정규화
    promotions: raw.promotions === null
      ? null
      : raw.promotions === undefined
        ? null  // 키 자체가 없으면 미확인으로 간주
        : ((raw.promotions as NonNullable<School['promotions']>) ?? []).map(p => ({ ...p, id: p.id || uuid() })),
    localFees: ((raw.localFees as School['localFees']) ?? []).map(f => ({ ...f, id: f.id || uuid() })),
    packages: ((raw.packages as School['packages']) ?? []).map(p => ({ ...p, id: p.id || uuid() })),
    refundPolicy: (raw.refundPolicy as string) ?? '',
    dormitoryRules: (raw.dormitoryRules as string) ?? '',
    generalNotes: (raw.generalNotes as string) ?? '',
    isActive: (raw.isActive as boolean) ?? true,
  }
}

function validate(data: ReturnType<typeof normalizeSchool>): ValidationError[] {
  const errors: ValidationError[] = []
  if (!data.name?.trim()) errors.push({ field: 'name', message: '학원명이 없습니다.' })
  if (!data.region) errors.push({ field: 'region', message: '지역이 없습니다.' })
  if (data.courses.length === 0 && data.packages.length === 0) errors.push({ field: 'courses', message: '코스 또는 패키지가 하나도 없습니다.' })
  data.courses.forEach((c, i) => {
    if (!c.name) errors.push({ field: `courses[${i}]`, message: `코스 ${i+1}번 이름이 없습니다.` })
    if (!c.price4Weeks) errors.push({ field: `courses[${i}].price`, message: `코스 "${c.name}" 가격이 0입니다.` })
  })
  return errors
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function JsonImportModal({ onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [jsonText, setJsonText] = useState('')
  const [parsed, setParsed] = useState<ReturnType<typeof normalizeSchool> | null>(null)
  const [parsedArray, setParsedArray] = useState<ReturnType<typeof normalizeSchool>[] | null>(null)
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [parseError, setParseError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')

  // diff 관련
  const [existingSchools, setExistingSchools] = useState<School[]>([])
  const [diffs, setDiffs] = useState<Record<string, DiffItem[]>>({})
  const [showDiff, setShowDiff] = useState<Record<string, boolean>>({})

  useEffect(() => {
    getSchools().then(setExistingSchools)
  }, [])

  const processJson = (text: string) => {
    setParseError(''); setErrors([]); setParsed(null); setParsedArray(null); setDiffs({})
    try {
      const raw = JSON.parse(text)
      const sample = Array.isArray(raw) ? raw[0] : raw

      // ── 타입 검증: 프로모션/기타 JSON 차단 ──────────────────────────────
      if (sample && typeof sample === 'object') {
        // 프로모션 JSON 특징: promoName, schoolName, discountType 필드
        if ('promoName' in sample || ('schoolName' in sample && 'discountType' in sample)) {
          setParseError('❌ 프로모션 JSON이 감지됐습니다. 학원 관리가 아닌 프로모션 탭에서 가져오기 하세요.')
          return
        }
        // 사용자 JSON 특징: uid, email, role + displayName
        if ('uid' in sample && 'email' in sample && 'role' in sample) {
          setParseError('❌ 사용자 데이터 JSON은 가져올 수 없습니다.')
          return
        }
        // 학원 JSON 최소 조건: name + (courses 또는 packages) 중 하나
        if (!('name' in sample) || (!('courses' in sample) && !('packages' in sample))) {
          setParseError('❌ 학원 JSON 형식이 아닙니다. name, courses/packages 필드를 확인하세요.')
          return
        }
      }
      if (Array.isArray(raw)) {
        const normalized = raw.map(r => normalizeSchool(r as Record<string, unknown>))
        const allErrors = normalized.flatMap((n, i) =>
          validate(n).map(e => ({ ...e, field: `[${i}] ${n.name}: ${e.field}` }))
        )
        // 이름 기반 중복 감지: id가 없거나 다른 id인데 같은 이름이 있으면 기존 id 사용
        const resolved = normalized.map(n => {
          const existingById   = existingSchools.find(s => s.id === n.id)
          const existingByName = existingSchools.find(s => s.name === n.name)
          if (!existingById && existingByName) {
            // id 불일치 → 기존 id로 교체 (중복 방지)
            return { ...n, id: existingByName.id, _nameMatched: true }
          }
          return n
        })
        const diffMap: Record<string, DiffItem[]> = {}
        resolved.forEach(n => {
          const existing = existingSchools.find(s => s.id === n.id)
          if (existing) {
            const d = diffSchools(existing, n)
            if (d.length > 0) diffMap[n.id] = d
          }
        })
        setParsedArray(resolved); setErrors(allErrors); setDiffs(diffMap)
      } else {
        const normalized = normalizeSchool(raw as Record<string, unknown>)
        const existingById   = existingSchools.find(s => s.id === normalized.id)
        const existingByName = existingSchools.find(s => s.name === normalized.name)
        const resolved = (!existingById && existingByName)
          ? { ...normalized, id: existingByName.id, _nameMatched: true }
          : normalized
        const errs = validate(resolved)
        if (resolved.id) {
          const existing = existingSchools.find(s => s.id === resolved.id)
          if (existing) {
            const d = diffSchools(existing, resolved)
            if (d.length > 0) setDiffs({ [resolved.id]: d })
          }
        }
        setParsed(resolved); setErrors(errs)
      }
    } catch { setParseError('JSON 형식이 올바르지 않습니다.') }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { const t = ev.target?.result as string; setJsonText(t); processJson(t) }
    reader.readAsText(file)
  }

  const handleSave = async () => {
    if (!parsed && !parsedArray) return
    setSaving(true)
    try {
      if (parsedArray) {
        // 배열은 writeBatch로 원자적 저장 (순차 setDoc은 내부 리스너 충돌 위험)
        await saveBatchSchools(parsedArray)
      } else if (parsed) {
        await saveSchool(JSON.parse(JSON.stringify(parsed)))
      }
      setSaved(true)
      setTimeout(() => { onImported(); onClose() }, 1200)
    } catch (e) { console.error(e); setParseError('저장 중 오류가 발생했습니다.') }
    finally { setSaving(false) }
  }

  const hasBlockingErrors = errors.some(e => e.field === 'name' || e.field === 'region' || e.field.includes('학원명'))
  const isReady = (parsed !== null || parsedArray !== null) && !hasBlockingErrors
  const hasDiffs = Object.keys(diffs).length > 0

  const list = parsedArray ?? (parsed ? [parsed] : [])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-xl w-full md:max-w-2xl max-h-[92dvh] md:max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileJson size={16} className="text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">학원 데이터 가져오기</h2>
              <p className="text-xs text-gray-400">id가 있으면 기존 데이터 덮어쓰기</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X size={16} className="text-gray-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 탭 */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['upload', 'paste'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                {t === 'upload' ? '📁 파일 업로드' : '📋 텍스트 붙여넣기'}
              </button>
            ))}
          </div>

          {tab === 'upload' ? (
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
              onClick={() => fileRef.current?.click()}>
              <FileJson size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">JSON 파일을 클릭하여 선택</p>
              <p className="text-xs text-gray-400 mt-1">배열 [{`{...}`}] 형식으로 여러 학원 동시 등록 가능</p>
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
              {jsonText && <p className="text-xs text-green-600 mt-2">✅ 파일 로드됨</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea value={jsonText} onChange={e => setJsonText(e.target.value)}
                className="w-full h-40 input-field text-xs font-mono resize-none" placeholder='{"name": "학원명", ...}' />
              <button onClick={() => processJson(jsonText)} className="btn-secondary w-full text-sm">JSON 파싱하기</button>
            </div>
          )}

          {parseError && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{parseError}</div>
          )}

          {/* ── 파싱 결과 ── */}
          {list.length > 0 && (
            <div className="space-y-3">
              {/* 학원 목록 */}
              <div className={`rounded-xl border p-4 space-y-2 ${hasDiffs ? 'border-orange-200 bg-orange-50/40' : 'border-green-200 bg-green-50/40'}`}>
                <p className="font-semibold text-gray-900 text-sm">
                  {list.length}개 학원 {hasDiffs ? '⚠️ 변경사항 확인 필요' : '✅ 준비됨'}
                </p>
                {list.map((s, i) => {
                  const schoolId = s.id ?? ''
                  const existing = existingSchools.find(e => e.id === schoolId)
                  const schoolDiffs = diffs[schoolId] ?? []
                  const isUpdate = !!existing
                  const isOpen = showDiff[schoolId]
                  return (
                    <div key={i} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${isUpdate ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                          {isUpdate ? '덮어쓰기' : '신규 추가'}
                        </span>
                        {!!(s as Record<string, unknown>)._nameMatched && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 flex-shrink-0">이름 매칭</span>
                        )}
                        <span className="text-sm font-medium text-gray-800 flex-1 truncate">{s.name}</span>
                        <span className="text-xs text-gray-400">{s.region} · 패키지 {s.packages.length}개 · 코스 {s.courses.length}개</span>
                        {schoolDiffs.length > 0 && (
                          <button onClick={() => setShowDiff(prev => ({ ...prev, [schoolId]: !isOpen }))}
                            className="text-xs text-orange-600 hover:text-orange-800 flex items-center gap-1 flex-shrink-0">
                            {isOpen ? <EyeOff size={12} /> : <Eye size={12} />}
                            변경 {schoolDiffs.length}건
                          </button>
                        )}
                      </div>

                      {/* diff 상세 */}
                      {isOpen && schoolDiffs.length > 0 && (
                        <div className="border-t border-gray-100 divide-y divide-gray-50">
                          {schoolDiffs.map((d, di) => (
                            <div key={di} className={`px-3 py-2 flex items-start gap-2 ${d.severity === 'danger' ? 'bg-red-50' : d.severity === 'warn' ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                              <span className={`text-xs mt-0.5 flex-shrink-0 ${d.severity === 'danger' ? 'text-red-500' : d.severity === 'warn' ? 'text-yellow-600' : 'text-gray-400'}`}>
                                {d.severity === 'danger' ? '🔴' : d.severity === 'warn' ? '🟡' : 'ℹ️'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-gray-700">{d.label}</p>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-xs text-red-600 line-through truncate max-w-32">{d.before}</span>
                                  <ArrowRight size={10} className="text-gray-400 flex-shrink-0" />
                                  <span className="text-xs text-green-700 font-medium truncate max-w-32">{d.after}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* 유효성 경고 */}
              {errors.length > 0 && (
                <div className="space-y-1.5">
                  {errors.map((err, i) => (
                    <div key={i} className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${err.field.includes('name') || err.field.includes('region') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-yellow-50 text-yellow-700 border border-yellow-200'}`}>
                      <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>{err.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 요약 안내 */}
              {hasDiffs && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
                  ⚠️ <strong>덮어쓰기 주의:</strong> 🔴 빨간 항목은 가격·날짜 등 견적에 직접 영향을 주는 변경입니다. 변경 내역을 확인 후 저장해 주세요.
                </div>
              )}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1">취소</button>
          <button onClick={handleSave} disabled={!isReady || saving || saved}
            className="btn-primary flex-1 flex items-center justify-center gap-2">
            {saved ? <><Check size={14} /> 저장됨</>
              : saving ? `저장 중...`
              : hasDiffs ? <><Upload size={14} /> 변경사항 확인 후 저장</>
              : list.length > 1 ? <><Upload size={14} /> {list.length}개 학원 저장</>
              : <><Upload size={14} /> 학원 저장하기</>}
          </button>
        </div>
      </div>
    </div>
  )
}
