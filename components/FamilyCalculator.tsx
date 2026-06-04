'use client'

// 가족연수 입력 (코스형).
// 일반연수와 다른 점: 여러 명이 함께 → 총 인원수 + 인원별 코스 선택 + 인원수에 맞는 N인실.
//  - 가족은 같은 기간(총주수 공통)
//  - 기숙사는 인원수 = capacity 인 방으로 필터 (단, 종류 여러개일 수 있으니 선택 구간 유지)
//  - 계산: 인원별 코스를 courses 배열에 모두 담아 calcEngine에 전달(학비 합산), 기숙 1개(가족 공용)
import { useState } from 'react'
import type { School } from '@/types'
import MondayPicker from '@/components/MondayPicker'
import { Search, User, UserPlus, Home, Pencil, Calculator } from 'lucide-react'

type MemberCourse = { memberNo: number; courseId: string; courseName: string; price4Weeks: number } | null

export type FamilyResult = {
  members: number
  totalWeeks: number
  courses: Array<{ courseId: string; weeks: number }>   // 인원별 (중복 courseId 가능)
  dormitoryId: string | null
  startDate: string
}

export default function FamilyCalculator({ school, onCalculate }: {
  school: School
  onCalculate: (r: FamilyResult) => void
}) {
  const [members, setMembers] = useState<number | null>(null)
  const [totalWeeks, setTotalWeeks] = useState<number | null>(null)
  const [memberCourses, setMemberCourses] = useState<MemberCourse[]>([])
  const [editingMember, setEditingMember] = useState<number | null>(null)
  const [dormId, setDormId] = useState<string | null>(null)
  const [startDate, setStartDate] = useState('')

  const courseList = (school.courses ?? [])
    .filter(c => ((c as unknown as Record<string, number>).price4Weeks ?? 0) > 0)
    .map(c => ({ id: c.id, name: c.name, price: (c as unknown as Record<string, number>).price4Weeks ?? 0, target: (c as { target?: string }).target }))

  // 인원수 정하면 멤버 슬롯 초기화
  const pickMembers = (n: number) => {
    setMembers(n)
    setMemberCourses(Array.from({ length: n }, (_, i) => null))
    setEditingMember(0)
  }

  const allCoursesPicked = members != null && memberCourses.every(m => m != null)

  // 인원수에 맞는 기숙사 (capacity === 인원수). capacity 없으면(가족실 등) 인원 무관 후보로 포함
  const dormCandidates = (school.dormitories ?? [])
    .filter(d => ((d as unknown as Record<string, number>).price4Weeks ?? 0) > 0)
    .filter(d => {
      const cap = (d as { capacity?: number }).capacity
      return cap == null || cap === members   // capacity 없으면 가변(가족실) → 포함
    })
    .map(d => ({ id: d.id, name: d.name, price: (d as unknown as Record<string, number>).price4Weeks ?? 0 }))

  const step = members == null ? 'members'
    : totalWeeks == null ? 'weeks'
    : !allCoursesPicked ? 'courses'
    : !dormId ? 'dorm'
    : !startDate ? 'startDate'
    : 'ready'

  const runCalc = () => {
    if (members == null || totalWeeks == null) return
    onCalculate({
      members,
      totalWeeks,
      courses: memberCourses.filter(Boolean).map(m => ({ courseId: m!.courseId, weeks: totalWeeks })),
      dormitoryId: dormId,
      startDate,
    })
  }

  return (
    <div className="space-y-4">
      {/* 진행 요약 */}
      {(members || totalWeeks) && (
        <div className="bg-gray-50 rounded-xl px-5 py-3 space-y-2 text-sm">
          {members && <div className="flex justify-between"><span className="text-gray-400">인원</span><span>{members}명</span></div>}
          {totalWeeks && <div className="flex justify-between"><span className="text-gray-400">기간</span><span>{totalWeeks}주 (가족 공통)</span></div>}
          {memberCourses.some(Boolean) && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-400 flex-shrink-0">코스</span>
              <span className="text-right">{memberCourses.filter(Boolean).map((m, i) => `${i + 1}번 ${m!.courseName}`).join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* 1. 인원수 */}
      {step === 'members' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-base font-medium text-gray-800 mb-4">몇 분이 함께 연수하시나요?</p>
          <div className="flex gap-2 flex-wrap">
            {[2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => pickMembers(n)}
                className="px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-blue-100 text-sm font-medium">{n}명</button>
            ))}
          </div>
        </div>
      )}

      {/* 2. 총 주수 */}
      {step === 'weeks' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-base font-medium text-gray-800 mb-1">총 몇 주 과정인가요?</p>
          <p className="text-xs text-gray-400 mb-4">가족 구성원 모두 동일한 기간으로 진행됩니다.</p>
          <div className="flex gap-2 flex-wrap mb-3">
            {[2, 4, 8, 12, 16, 24].map(w => (
              <button key={w} onClick={() => setTotalWeeks(w)}
                className="px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-blue-100 text-sm font-medium">{w}주</button>
            ))}
          </div>
          <WeekDirect onPick={setTotalWeeks} />
        </div>
      )}

      {/* 3. 인원별 코스 */}
      {step === 'courses' && members != null && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-base font-medium text-gray-800 mb-4">각 구성원의 코스를 선택해주세요</p>
          <div className="space-y-3">
            {memberCourses.map((mc, i) => {
              const isEditing = editingMember === i
              return (
                <div key={i}>
                  <div className={`flex items-center gap-3 p-4 rounded-xl ${isEditing ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}>
                    <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                      {mc ? <User size={18} className="text-blue-500" /> : <UserPlus size={18} className="text-blue-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 mb-0.5">{i + 1}번 구성원</p>
                      {mc ? <p className="text-sm font-medium truncate">{mc.courseName} <span className="text-xs text-gray-400 font-normal">{mc.price4Weeks.toLocaleString()}원/4주</span></p>
                        : <p className="text-sm text-gray-500">코스를 선택해주세요</p>}
                    </div>
                    {mc && !isEditing && (
                      <button onClick={() => setEditingMember(i)} className="flex-shrink-0 text-blue-500 text-sm flex items-center gap-1">
                        <Pencil size={13} /> 변경
                      </button>
                    )}
                  </div>
                  {isEditing && (
                    <div className="mt-2 border border-gray-200 rounded-xl p-3">
                      <CourseSearchList list={courseList} onPick={(it) => {
                        const next = [...memberCourses]
                        next[i] = { memberNo: i, courseId: it.id, courseName: it.name, price4Weeks: it.price }
                        setMemberCourses(next)
                        const nextEmpty = next.findIndex(m => m == null)
                        setEditingMember(nextEmpty >= 0 ? nextEmpty : null)
                      }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. 기숙사 (인원수 = N인실) */}
      {step === 'dorm' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="bg-blue-50 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm text-blue-700 flex items-center gap-2">
              <Home size={15} /> {members}명이 함께 쓰는 <b>{members}인실</b>입니다. 종류를 선택해주세요.
            </p>
          </div>
          {dormCandidates.length > 0 ? (
            <div className="space-y-2">
              {dormCandidates.map(d => (
                <button key={d.id} onClick={() => setDormId(d.id)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-gray-50 hover:bg-blue-50 text-left">
                  <span className="text-sm text-gray-800">{d.name}</span>
                  <span className="text-sm text-gray-400">{d.price.toLocaleString()}원/4주</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{members}인실 기숙사 데이터가 없습니다. 학원에 직접 문의가 필요합니다.</p>
          )}
        </div>
      )}

      {/* 5. 시작일 */}
      {step === 'startDate' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-base font-medium text-gray-800 mb-1">입국(시작) 예정일이 언제인가요?</p>
          <p className="text-xs text-gray-400 mb-4">입학은 월요일만 가능합니다. 미정이면 날짜 없이 진행.</p>
          <MondayPicker value={startDate} onSelect={setStartDate} />
          <button onClick={() => runCalc()} className="w-full mt-3 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm">입국일 미정으로 진행</button>
        </div>
      )}

      {/* 계산 */}
      {step === 'ready' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-base font-medium text-gray-800 mb-4">입력이 완료됐어요. 계산할까요?</p>
          <button onClick={runCalc} className="btn-primary w-full flex items-center justify-center gap-2 py-3">
            <Calculator size={16} /> 가족연수 계산하기
          </button>
        </div>
      )}
    </div>
  )
}

function WeekDirect({ onPick }: { onPick: (w: number) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="flex gap-2">
      <input value={v} onChange={e => setV(e.target.value.replace(/\D/g, ''))} placeholder="직접 입력 (주)"
        className="input-field flex-1 text-sm" />
      <button onClick={() => v && onPick(parseInt(v, 10))} disabled={!v} className="btn-primary text-sm disabled:opacity-40">확인</button>
    </div>
  )
}

function CourseSearchList({ list, onPick }: {
  list: Array<{ id: string; name: string; price: number; target?: string }>
  onPick: (it: { id: string; name: string; price: number }) => void
}) {
  const [q, setQ] = useState('')
  const filtered = q.trim() ? list.filter(it => it.name.toLowerCase().includes(q.toLowerCase())) : list
  return (
    <div>
      {list.length > 5 && (
        <div className="relative mb-2">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="코스 검색" className="input-field w-full text-sm pl-9" />
        </div>
      )}
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.map(it => (
          <button key={it.id} onClick={() => onPick(it)}
            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-blue-50 flex items-center justify-between">
            <span className="text-sm text-gray-800">{it.name}{it.target && it.target !== '성인일반' && <span className="ml-1.5 text-xs text-blue-400">{it.target}</span>}</span>
            <span className="text-xs text-gray-400">{it.price.toLocaleString()}원/4주</span>
          </button>
        ))}
      </div>
    </div>
  )
}
