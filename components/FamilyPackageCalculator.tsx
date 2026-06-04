'use client'

// 패키지형 가족연수 입력.
// 코스형과 다름: 코스/기숙 선택 없음(패키지에 포함). 인원수=패키지 row, 주수=패키지 column.
//  예: SMEAG 딸락/엔칸토 가족 — "3인 가족" row × "8W" column = 정액.
//  엔칸토/조이풀은 인당/주당 2.5만 유학원 할인(familyEligible) 적용.
import { useState } from 'react'
import type { School } from '@/types'
import MondayPicker from '@/components/MondayPicker'
import { Users, Calculator } from 'lucide-react'

export type FamilyPackageResult = {
  packageId: string
  columnLabel: string      // row label (인원) — calcEngine은 columnLabel로 row 매칭
  weeks: number
  persons: number
  startDate: string
}

// row label에서 인원수 추출 ("3인..." → 3)
function personsOf(label: string): number {
  const m = label.match(/(\d)\s*인/)
  return m ? parseInt(m[1], 10) : 1
}
// column label에서 주수 추출 ("8W"/"8주" → 8)
function weeksOf(col: string): number | null {
  const m = col.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

export default function FamilyPackageCalculator({ school, onCalculate }: {
  school: School
  onCalculate: (r: FamilyPackageResult) => void
}) {
  const familyPkgs = (school.packages ?? []).filter(p =>
    (p as { programType?: string }).programType === 'family' ||
    ((( p.priceMatrix as unknown as { rows?: Array<{ label?: string }> })?.rows) ?? []).some(r => /\d\s*인|가족/.test(r.label ?? ''))
  )

  const [pkgId, setPkgId] = useState<string | null>(familyPkgs.length === 1 ? familyPkgs[0].id : null)
  const [rowLabel, setRowLabel] = useState<string | null>(null)
  const [colLabel, setColLabel] = useState<string | null>(null)
  const [personsOverride, setPersonsOverride] = useState<number | null>(null)   // 예외: 룸정원 ≠ 실제 인원
  const [startDate, setStartDate] = useState('')

  const pkg = familyPkgs.find(p => p.id === pkgId)
  const pm = pkg?.priceMatrix as unknown as { rows?: Array<{ label: string; prices: number[] }>; columns?: string[] } | undefined
  const rows = pm?.rows ?? []
  const cols = pm?.columns ?? []

  const priceOf = (rLabel: string, cIdx: number): number => {
    const row = rows.find(r => r.label === rLabel)
    return (row?.prices ?? [])[cIdx] ?? 0
  }

  const step = familyPkgs.length > 1 && !pkgId ? 'pkg'
    : !rowLabel ? 'persons'
    : !colLabel ? 'weeks'
    : !startDate ? 'startDate'
    : 'ready'

  const run = () => {
    if (!pkg || !rowLabel || !colLabel) return
    const w = weeksOf(colLabel)
    if (!w) return
    onCalculate({
      packageId: pkg.id,
      columnLabel: rowLabel,   // calcEngine은 row를 columnLabel 인자로 받음(패키지 행렬 조회)
      weeks: w,
      persons: personsOverride ?? personsOf(rowLabel),   // 예외 조정값 우선, 없으면 룸정원
      startDate,
    })
  }

  return (
    <div className="space-y-4">
      {/* 진행 요약 */}
      {(rowLabel || colLabel) && (
        <div className="bg-gray-50 rounded-xl px-5 py-3 space-y-2 text-sm">
          {pkg && familyPkgs.length > 1 && <div className="flex justify-between"><span className="text-gray-400">패키지</span><span>{(pkg as { name?: string; label?: string }).name ?? (pkg as { label?: string }).label}</span></div>}
          {rowLabel && <div className="flex justify-between"><span className="text-gray-400">인원</span><span>{rowLabel}</span></div>}
          {colLabel && <div className="flex justify-between"><span className="text-gray-400">기간</span><span>{colLabel}</span></div>}
        </div>
      )}

      {/* 패키지 선택 (여러 개면) */}
      {step === 'pkg' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-base font-medium text-gray-800 mb-4">어떤 가족 패키지인가요?</p>
          <div className="space-y-2">
            {familyPkgs.map(p => (
              <button key={p.id} onClick={() => setPkgId(p.id)}
                className="w-full text-left px-4 py-3 rounded-xl bg-gray-50 hover:bg-blue-50 text-sm">{(p as { name?: string; label?: string }).name ?? (p as { label?: string }).label}</button>
            ))}
          </div>
        </div>
      )}

      {/* 인원수 (패키지 row) */}
      {step === 'persons' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users size={18} className="text-blue-500" />
            <p className="text-base font-medium text-gray-800">몇 분이 함께 연수하시나요?</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {rows.map(r => (
              <button key={r.label} onClick={() => setRowLabel(r.label)}
                className="px-5 py-3 rounded-xl bg-gray-100 hover:bg-blue-100 text-sm font-medium">{r.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* 주수 (패키지 column) */}
      {step === 'weeks' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-base font-medium text-gray-800 mb-4">기간을 선택해주세요</p>
          <div className="flex gap-2 flex-wrap">
            {cols.map((c, ci) => (
              <button key={c} onClick={() => setColLabel(c)}
                className="px-5 py-3 rounded-xl bg-gray-100 hover:bg-blue-100 text-sm font-medium flex flex-col items-center gap-1">
                <span>{c}</span>
                <span className="text-xs text-gray-400">{priceOf(rowLabel!, ci).toLocaleString()}원</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 시작일 + 인원수 확인 */}
      {step === 'startDate' && rowLabel && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          {/* 인원수 확인 — 기본은 룸정원, 예외 시 조정 */}
          {(() => {
            const roomCap = personsOf(rowLabel)
            const actual = personsOverride ?? roomCap
            return (
              <div className="mb-5 pb-5 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-700 mb-2">실제 등록 인원 확인</p>
                <p className="text-xs text-gray-400 mb-3">
                  선택하신 「{rowLabel}」기준 <b>{roomCap}명</b>으로 계산됩니다.
                  {personsOverride != null && personsOverride !== roomCap && (
                    <span className="text-amber-600"> (조정됨: {personsOverride}명 — 인원수와 기숙사 정원이 다름)</span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">인원 조정:</span>
                  {[2, 3, 4, 5, 6].map(n => (
                    <button key={n} onClick={() => setPersonsOverride(n === roomCap ? null : n)}
                      className={`px-3 py-1.5 rounded-lg text-sm ${actual === n ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-50 text-gray-500'}`}>{n}명</button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-300 mt-2">※ 보통 기숙사 정원과 인원이 같습니다. 다를 경우에만 조정하세요.</p>
              </div>
            )
          })()}
          <p className="text-base font-medium text-gray-800 mb-1">입국(시작) 예정일이 언제인가요?</p>
          <p className="text-xs text-gray-400 mb-4">입학은 월요일만 가능합니다.</p>
          <MondayPicker value={startDate} onSelect={setStartDate} />
          <button onClick={run} className="w-full mt-3 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm">입국일 미정으로 진행</button>
        </div>
      )}

      {/* 계산 */}
      {step === 'ready' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <p className="text-base font-medium text-gray-800 mb-4">입력이 완료됐어요. 계산할까요?</p>
          <button onClick={run} className="btn-primary w-full flex items-center justify-center gap-2 py-3">
            <Calculator size={16} /> 가족연수 계산하기
          </button>
        </div>
      )}
    </div>
  )
}
