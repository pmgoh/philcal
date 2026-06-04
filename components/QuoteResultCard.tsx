'use client'
import type { CalcResult } from '@/lib/calcEngine'
import type { School } from '@/types'

// 견적 결과 카드. 표현 규칙:
//  본문 순서: 학비(항목+총합) → 기숙사(항목+총합) → 프로모션(없으면 '없음') → 서차지(여부) → 유학원 할인 → 등록비 → 총합
//  하단 근거: 프로모션 근거(조건→적용액) · 서차지 상세(기간·주수) · 유학원 할인 근거
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

  const courseTotal = calc.courseItems.reduce((s, i) => s + i.krwAmount, 0)
  const dormTotal = calc.dormItems.reduce((s, i) => s + i.krwAmount, 0)
  const hasSurcharge = calc.surchargeKrw > 0 && calc.surchargeItems.length > 0
  const multiCourse = calc.courseItems.length > 1
  const multiDorm = calc.dormItems.length > 1

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
          {/* 1. 학비 (항목 나열 + 총합) */}
          {calc.courseItems.map((it, i) => (
            <tr key={`c${i}`} className="border-b border-gray-50">
              <td className="py-1.5 text-gray-700">{i === 0 && <span className="text-gray-400 text-xs mr-1.5">학비</span>}{it.label.replace(/^코스:\s*/, '')}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-600">{krw(it.krwAmount)}</td>
            </tr>
          ))}
          {multiCourse && (
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <td className="py-1.5 pl-7 text-gray-700 font-medium">학비 합계</td>
              <td className="py-1.5 text-right tabular-nums font-semibold text-gray-900">{krw(courseTotal)}</td>
            </tr>
          )}

          {/* 2. 기숙사 (항목 나열 + 총합) */}
          {calc.dormItems.map((it, i) => (
            <tr key={`d${i}`} className="border-b border-gray-50">
              <td className="py-1.5 text-gray-700">{i === 0 && <span className="text-gray-400 text-xs mr-1.5">기숙사</span>}{it.label.replace(/^기숙사:\s*/, '')}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-600">{krw(it.krwAmount)}</td>
            </tr>
          ))}
          {multiDorm && (
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <td className="py-1.5 pl-7 text-gray-700 font-medium">기숙사 합계</td>
              <td className="py-1.5 text-right tabular-nums font-semibold text-gray-900">{krw(dormTotal)}</td>
            </tr>
          )}

          {/* 3. 프로모션 (학원 자체 할인) — 없으면 '없음' 명시 */}
          {appliedSchool.length > 0 ? (
            appliedSchool.map((l, i) => (
              <tr key={`ps${i}`} className="border-b border-gray-100 text-green-700">
                <td className="py-1.5"><span className="text-green-400 text-xs mr-1.5">프로모션</span>{l.label}</td>
                <td className="py-1.5 text-right tabular-nums">-{krw(l.discountKrw)}</td>
              </tr>
            ))
          ) : (
            <tr className="border-b border-gray-100 text-gray-400">
              <td className="py-1.5"><span className="text-gray-300 text-xs mr-1.5">프로모션</span>해당 없음</td>
              <td className="py-1.5 text-right tabular-nums">—</td>
            </tr>
          )}

          {/* 4. 서차지 (성수기) — 여부 표시 */}
          {hasSurcharge ? (
            calc.surchargeItems.map((it, i) => (
              <tr key={`s${i}`} className="border-b border-gray-100 text-orange-700">
                <td className="py-1.5"><span className="text-orange-400 text-xs mr-1.5">서차지</span>{it.label.replace(/^서차지:\s*/, '')}</td>
                <td className="py-1.5 text-right tabular-nums">+{krw(it.krwAmount)}</td>
              </tr>
            ))
          ) : (
            <tr className="border-b border-gray-100 text-gray-400">
              <td className="py-1.5"><span className="text-gray-300 text-xs mr-1.5">서차지</span>{dateUnset ? '입국일 미정 (확정 시 반영)' : '해당 없음'}</td>
              <td className="py-1.5 text-right tabular-nums">—</td>
            </tr>
          )}

          {/* 5. 유학원 할인 — 내부 프로모션명 숨김 */}
          {appliedAgency.length > 0 && appliedAgency.map((l, i) => (
            <tr key={`pa${i}`} className="border-b border-gray-100 text-green-700">
              <td className="py-1.5"><span className="text-green-400 text-xs mr-1.5">유학원</span>유학원 할인</td>
              <td className="py-1.5 text-right tabular-nums">-{krw(l.discountKrw)}</td>
            </tr>
          ))}

          {/* 6. 등록비 */}
          {calc.registrationFeeKrw > 0 && (
            <tr className="border-b border-gray-100">
              <td className="py-1.5 text-gray-700"><span className="text-gray-400 text-xs mr-1.5">등록비</span>1회 납부</td>
              <td className="py-1.5 text-right tabular-nums text-gray-600">{krw(calc.registrationFeeKrw)}</td>
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
      <p className="text-xs text-gray-400">※ 학비·기숙사·등록비·서차지·할인을 합한 금액입니다. 현지납부비는 별도(아래 참조).</p>


      {/* 경고 */}
      {calc.warnings.length > 0 && (
        <div className="space-y-0.5">
          {calc.warnings.map((w, i) => <p key={i} className="text-xs text-red-600">{w}</p>)}
        </div>
      )}
    </div>
  )
}
