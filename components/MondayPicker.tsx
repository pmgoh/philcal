'use client'

// 입학일(월요일) 전용 달력.
// 필리핀 어학연수 입학은 월요일만 가능하므로, 월요일만 클릭 가능하게 한다.
// 비-월요일은 흐리게(비활성). 토·일은 직전/해당 주 월요일로 안내한다.
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function MondayPicker({ value, onSelect }: {
  value?: string
  onSelect: (date: string) => void
}) {
  const today = new Date()
  const init = value ? new Date(value + 'T00:00:00') : today
  const [viewY, setViewY] = useState(init.getFullYear())
  const [viewM, setViewM] = useState(init.getMonth())   // 0-11

  const first = new Date(viewY, viewM, 1)
  const startDow = first.getDay()                         // 0(일)~6(토)
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate()

  const cells: Array<Date | null> = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewY, viewM, d))

  const prevMonth = () => {
    if (viewM === 0) { setViewY(viewY - 1); setViewM(11) }
    else setViewM(viewM - 1)
  }
  const nextMonth = () => {
    if (viewM === 11) { setViewY(viewY + 1); setViewM(0) }
    else setViewM(viewM + 1)
  }

  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-white">
      {/* 월 네비 */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronLeft size={18} /></button>
        <span className="text-sm font-semibold text-gray-800">{viewY}년 {MONTHS[viewM]}</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronRight size={18} /></button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DOW.map((d, i) => (
          <div key={d} className={`text-center text-[11px] py-1 ${i === 1 ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>{d}</div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />
          const isMonday = d.getDay() === 1
          const isPast = d < todayMid
          const selected = value === ymd(d)
          const selectable = isMonday   // 과거 월요일도 선택 가능 (지난 자료 검산용)
          return (
            <button
              key={ymd(d)}
              disabled={!selectable}
              onClick={() => selectable && onSelect(ymd(d))}
              className={[
                'text-center text-sm py-1.5 rounded-lg transition-colors',
                selected ? 'bg-blue-600 text-white font-semibold'
                  : selectable && !isPast ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium cursor-pointer'
                  : selectable && isPast ? 'bg-gray-50 text-gray-500 hover:bg-gray-100 cursor-pointer'  // 지난 월요일(검산용, 흐리게)
                  : 'text-gray-300 cursor-not-allowed',                 // 비-월요일
              ].join(' ')}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-gray-400 mt-2 text-center">입학은 <span className="text-blue-600 font-medium">월요일</span>만 선택할 수 있습니다.</p>
    </div>
  )
}
