'use client'
import type { CalcResult } from '@/lib/calcEngine'
import type { School } from '@/types'

// 견적 결과를 정렬된 표로 표시. 마크다운 텍스트 나열 대신 구조화된 calcResult 사용.
export default function QuoteResultCard({
  school, calc, startDate,
}: {
  school: School
  calc: CalcResult
  startDate?: string
}) {
  const krw = (n: number) => n.toLocaleString() + '원'
  const dateUnset = !startDate

  const appliedSchool = calc.promotionLines.filter(l => l.kind === 'school' && l.status === 'applied')
  const appliedAgency = calc.promotionLines.filter(l => l.kind === 'agency' && l.status === 'applied')
  const unmet = calc.promotionLines.filter(l => l.status === 'unmet')
  const pending = calc.promotionLines.filter(l => l.status === 'pending')

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
        <div>
          <p className="font-bold text-base text-gray-900">{school.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">총 {calc.totalWeeks}주{startDate ? ` · ${startDate} 입국` : ' · 입국일 미정'}</p>
        </div>
        <p className="text-lg font-bold text-blue-700">{krw(calc.totalKrw)}</p>
      </div>

      {/* 비용 표 */}
      <table className="w-full text-sm border-collapse">
        <tbody>
          {calc.courseItems.map((it, i) => (
            <tr key={`c${i}`} className="border-b border-gray-100">
              <td className="py-1.5 text-gray-700">{i === 0 && <span className="text-gray-400 text-xs mr-1.5">학비</span>}{it.label}</td>
              <td className="py-1.5 text-right tabular-nums">{krw(it.krwAmount)}</td>
            </tr>
          ))}
          {calc.dormItems.map((it, i) => (
            <tr key={`d${i}`} className="border-b border-gray-100">
              <td className="py-1.5 text-gray-700">{i === 0 && <span className="text-gray-400 text-xs mr-1.5">기숙사</span>}{it.label}</td>
              <td className="py-1.5 text-right tabular-nums">{krw(it.krwAmount)}</td>
            </tr>
          ))}
          {calc.surchargeKrw > 0 && calc.surchargeItems.map((it, i) => (
            <tr key={`s${i}`} className="border-b border-gray-100 text-orange-700">
              <td className="py-1.5"><span className="text-orange-400 text-xs mr-1.5">성수기</span>{it.label}</td>
              <td className="py-1.5 text-right tabular-nums">+{krw(it.krwAmount)}</td>
            </tr>
          ))}
          {appliedSchool.map((l, i) => (
            <tr key={`ps${i}`} className="border-b border-gray-100 text-green-700">
              <td className="py-1.5"><span className="text-green-400 text-xs mr-1.5">할인</span>{l.label}</td>
              <td className="py-1.5 text-right tabular-nums">-{krw(l.discountKrw)}</td>
            </tr>
          ))}
          {appliedAgency.map((l, i) => (
            <tr key={`pa${i}`} className="border-b border-gray-100 text-green-700">
              <td className="py-1.5"><span className="text-green-400 text-xs mr-1.5">유학원</span>{l.label.replace(' (유학원 할인)', '')}</td>
              <td className="py-1.5 text-right tabular-nums">-{krw(l.discountKrw)}</td>
            </tr>
          ))}
          {calc.registrationFeeKrw > 0 && (
            <tr className="border-b border-gray-100">
              <td className="py-1.5 text-gray-700"><span className="text-gray-400 text-xs mr-1.5">등록비</span>1회 납부</td>
              <td className="py-1.5 text-right tabular-nums">{krw(calc.registrationFeeKrw)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300">
            <td className="py-2 font-bold text-gray-900">연수비용 총합</td>
            <td className="py-2 text-right font-bold text-blue-700 tabular-nums">{krw(calc.totalKrw)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-gray-400">현지납부비 별도 (약 {Math.round(calc.localFeeKrwEstimate).toLocaleString()}원)</p>

      {/* 조건 미충족 프로모션 */}
      {unmet.length > 0 && (
        <div className="bg-gray-50 rounded-lg px-3 py-2">
          <p className="text-xs font-medium text-gray-600 mb-1">조건 충족 시 적용 가능</p>
          {unmet.map((l, i) => (
            <p key={i} className="text-xs text-gray-500">· {l.label} ({l.unmetReason})</p>
          ))}
        </div>
      )}

      {/* 날짜 미정 보류 항목 */}
      {dateUnset && pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <p className="text-xs font-medium text-amber-800 mb-1">📅 입국일 정하면 반영될 항목</p>
          {pending.map((l, i) => (
            <p key={i} className="text-xs text-amber-700">· {l.label}{l.periodNote ? ` (${l.periodNote})` : ''}</p>
          ))}
          <p className="text-xs text-amber-600 mt-1">날짜 확정 시 성수기 추가비·기간 한정 프로모션이 반영됩니다.</p>
        </div>
      )}

      {/* 경고 */}
      {calc.warnings.length > 0 && (
        <div className="space-y-0.5">
          {calc.warnings.map((w, i) => <p key={i} className="text-xs text-red-600">{w}</p>)}
        </div>
      )}
    </div>
  )
}
