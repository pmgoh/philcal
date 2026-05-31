'use client'
import { useMemo } from 'react'
import type { School } from '@/types'
import {
  type QuoteState, type CourseRow, type DormRow,
  validateQuote,
} from '@/lib/quoteState'

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 20, 24]

// 상단 상시 견적 카드.
// 정보 위계대로 학원 → 총주수 → 코스 → 기숙 → 시작일을 한 화면에서 편집.
// 자연어(챗봇)로도, 드롭다운(수동)으로도 같은 state를 채운다.
// 검증을 통과해야 [계산하기]가 활성화되고, 누르면 1스택(commit)으로 계산.
export default function QuoteBuilderCard({
  state, schools, onChange, onCalculate, calculating,
}: {
  state: QuoteState
  schools: School[]
  onChange: (next: QuoteState) => void
  onCalculate: () => void
  calculating?: boolean
}) {
  const school = schools.find(s => s.id === state.schoolId) ?? null
  const v = useMemo(() => validateQuote(state, school), [state, school])

  // 같은 이름의 다른 캠퍼스 후보 (EV / EV 라메르)
  const baseName = school?.name.split('(')[0].trim()
  const campusOpts = baseName ? schools.filter(s => s.name.split('(')[0].trim() === baseName) : []

  const hasPackages = (school?.packages?.length ?? 0) > 0 && (school?.courses?.length ?? 0) === 0
  const courseOpts = school?.courses ?? []
  const dormOpts = school?.dormitories ?? []

  // 한 번의 onChange로 패치 + 잠금을 함께 적용 (분리 호출하면 뒤 호출이 앞을 덮어씀 = 선택 안 됨 버그)
  const set = (patch: Partial<QuoteState>, lockKey?: keyof QuoteState['locked']) =>
    onChange({ ...state, ...patch, locked: lockKey ? { ...state.locked, [lockKey]: true } : state.locked })

  // 학원 변경 → 코스/기숙 초기화 (다른 학원 id 무효)
  const setSchool = (id: string) => {
    onChange({ ...state, schoolId: id, courseRows: [], dormRows: [], packageRows: [], locked: { ...state.locked, school: true } })
  }
  // 코스/기숙: state가 비어있어도 idx 0을 직접 만들어 갱신 (표시용 빈 행과 state 불일치 버그 수정)
  const setCourse = (i: number, patch: Partial<CourseRow>) => {
    const base = state.courseRows.length > 0 ? state.courseRows : [{ courseId: '', weeks: state.totalWeeks ?? 4 }]
    set({ courseRows: base.map((r, idx) => idx === i ? { ...r, ...patch } : r) }, 'course')
  }
  const addCourse = () => set({ courseRows: [...(state.courseRows.length > 0 ? state.courseRows : [{ courseId: '', weeks: state.totalWeeks ?? 4 }]), { courseId: '', weeks: state.totalWeeks ?? 4 }] })
  const delCourse = (i: number) => set({ courseRows: state.courseRows.filter((_, idx) => idx !== i) })
  const setDorm = (i: number, patch: Partial<DormRow>) => {
    const base = state.dormRows.length > 0 ? state.dormRows : [{ dormitoryId: '', weeks: state.totalWeeks ?? 4 }]
    set({ dormRows: base.map((r, idx) => idx === i ? { ...r, ...patch } : r) }, 'dorm')
  }
  const addDorm = () => set({ dormRows: [...(state.dormRows.length > 0 ? state.dormRows : [{ dormitoryId: '', weeks: state.totalWeeks ?? 4 }]), { dormitoryId: '', weeks: state.totalWeeks ?? 4 }] })
  const delDorm = (i: number) => set({ dormRows: state.dormRows.filter((_, idx) => idx !== i) })

  // 다음에 채워야 할 슬롯 강조 (UI 길잡이)
  const hi = (slot: string) => v.nextNeeded === slot
    ? 'ring-2 ring-amber-400 ring-offset-1' : ''

  const rowLabel = 'text-gray-500 w-14 shrink-0 text-sm pt-1.5'
  const sel = "border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white"
  const selW = "border border-gray-300 rounded-md px-1 py-1.5 text-sm bg-white shrink-0 w-16"

  // 코스/기숙 행이 비었으면 빈 줄 하나 보장 (편집 가능하게)
  const courseRows = state.courseRows.length > 0 ? state.courseRows : [{ courseId: '', weeks: state.totalWeeks ?? 4 }]
  const dormRows = state.dormRows.length > 0 ? state.dormRows : [{ dormitoryId: '', weeks: state.totalWeeks ?? 4 }]

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gray-800">견적 구성</span>
        {state.schoolId && (
          <button onClick={() => onChange({ schoolId: null, totalWeeks: null, courseRows: [], dormRows: [], packageRows: [], startDate: '', locked: {} })}
            className="text-xs text-gray-400 hover:text-gray-600 underline">처음부터</button>
        )}
      </div>

      {/* 학원 */}
      <div className="flex items-start">
        <span className={rowLabel}>학원</span>
        {campusOpts.length > 1 ? (
          <select value={state.schoolId ?? ''} onChange={e => setSchool(e.target.value)} className={`${sel} flex-1 ${hi('school')}`}>
            {campusOpts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : school ? (
          <span className="font-medium text-sm pt-1.5">{school.name}</span>
        ) : (
          <select value="" onChange={e => e.target.value && setSchool(e.target.value)} className={`${sel} flex-1 ${hi('school')}`}>
            <option value="">학원을 선택하세요</option>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {/* 총 주수 (학원 다음, 독립 기준값) */}
      {state.schoolId && (
        <div className="flex items-center">
          <span className="text-gray-500 w-14 shrink-0 text-sm">총 주수</span>
          <select value={state.totalWeeks ?? ''} onChange={e => set({ totalWeeks: Number(e.target.value) }, 'weeks')}
            className={`${sel} ${hi('weeks')}`}>
            <option value="">선택</option>
            {WEEKS.map(w => <option key={w} value={w}>{w}주</option>)}
          </select>
          <span className="ml-2 text-xs text-gray-400">현지비는 총 주수 기준 자동 계산</span>
        </div>
      )}

      {/* 코스 (학원·주수 후) */}
      {state.schoolId && state.totalWeeks && !hasPackages && (
        <div className="flex items-start">
          <span className={rowLabel}>코스</span>
          <div className={`flex-1 min-w-0 space-y-1.5 rounded-md ${hi('course') ? 'ring-2 ring-amber-400 ring-offset-1 p-1' : ''}`}>
            {courseRows.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select value={r.courseId} onChange={e => setCourse(i, { courseId: e.target.value })} className={`${sel} flex-1 min-w-0`}>
                  <option value="">선택하세요</option>
                  {courseOpts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={r.weeks} onChange={e => setCourse(i, { weeks: Number(e.target.value) })} className={selW}>
                  {WEEKS.map(w => <option key={w} value={w}>{w}주</option>)}
                </select>
                {courseRows.length > 1 && <button onClick={() => delCourse(i)} className="text-gray-400 hover:text-red-500 text-lg leading-none px-1">×</button>}
              </div>
            ))}
            <button onClick={addCourse} className="text-xs text-blue-600 hover:text-blue-800">+ 기간 나눠 추가 (코스 변경)</button>
          </div>
        </div>
      )}

      {/* 기숙사 */}
      {state.schoolId && state.totalWeeks && !hasPackages && dormOpts.length > 0 && (
        <div className="flex items-start">
          <span className={rowLabel}>기숙사</span>
          <div className="flex-1 min-w-0 space-y-1.5">
            {dormRows.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select value={r.dormitoryId} onChange={e => setDorm(i, { dormitoryId: e.target.value })} className={`${sel} flex-1 min-w-0`}>
                  <option value="">통학 (기숙사 없음)</option>
                  {dormOpts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select value={r.weeks} onChange={e => setDorm(i, { weeks: Number(e.target.value) })} className={selW}>
                  {WEEKS.map(w => <option key={w} value={w}>{w}주</option>)}
                </select>
                {dormRows.length > 1 && <button onClick={() => delDorm(i)} className="text-gray-400 hover:text-red-500 text-lg leading-none px-1">×</button>}
              </div>
            ))}
            <button onClick={addDorm} className="text-xs text-blue-600 hover:text-blue-800">+ 방 바꿔 추가 (방 이동)</button>
          </div>
        </div>
      )}

      {/* 시작일 */}
      {state.schoolId && state.totalWeeks && (
        <div className="flex items-center">
          <span className="text-gray-500 w-14 shrink-0 text-sm">시작일</span>
          <input type="date" value={state.startDate} onChange={e => set({ startDate: e.target.value }, 'date')}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white" />
          {state.startDate
            ? <button onClick={() => set({ startDate: '' })} className="ml-2 text-xs text-gray-400 underline">미정</button>
            : <span className="ml-2 text-xs text-gray-400 italic">미정 (기본 견적)</span>}
        </div>
      )}

      {/* 검증 메시지 */}
      {(v.issues.length > 0 || v.warnings.length > 0) && (
        <div className="space-y-1">
          {v.issues.map((m, i) => <p key={'i' + i} className="text-xs text-red-600">• {m}</p>)}
          {v.warnings.map((m, i) => <p key={'w' + i} className="text-xs text-amber-600">• {m}</p>)}
        </div>
      )}

      {/* 계산 버튼 — 검증 통과 시만 활성 */}
      <button onClick={onCalculate} disabled={!v.canCalculate || calculating}
        className={`w-full text-sm font-medium py-2.5 rounded-lg transition-colors ${
          v.canCalculate && !calculating
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}>
        {calculating ? '계산 중…' : v.canCalculate ? '계산하기' : (v.nextNeeded === 'school' ? '학원을 선택하세요' : v.nextNeeded === 'weeks' ? '총 주수를 정하세요' : v.nextNeeded === 'course' ? '코스를 선택하세요' : '입력을 확인하세요')}
      </button>
    </div>
  )
}
