'use client'
// 견적 결과 표시 공용 컴포넌트 (챗봇·계산기 공유).
// MarkdownText / PromotionPanel / PeriodTimeline / LocalFeePanel / EvidenceCard
import { useState } from 'react'
import { ChevronDown, ChevronUp, DollarSign } from 'lucide-react'
import { formatKrw } from '@/lib/utils'
import type { School, LocalFee } from '@/types'
import type { PromotionLineItem, CalcResult } from '@/lib/calcEngine'

export function MarkdownText({ text, isUser = false }: { text: string; isUser?: boolean }) {
  const lines = text.split('\n')
  const textColor = isUser ? 'text-white' : 'text-gray-800'
  const subColor  = isUser ? 'text-blue-100' : 'text-gray-500'
  const boldClass = isUser ? 'text-white' : 'text-gray-900'

  const renderInline = (raw: string) =>
    raw.replace(/\*\*(.*?)\*\*/g, `<strong class="font-semibold ${boldClass}">$1</strong>`)
       .replace(/\*(.*?)\*/g, `<em class="${subColor}">$1</em>`)

  // 파이프 테이블 감지 및 그룹화
  const result: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 파이프 테이블 시작 감지
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      // 구분선 제외하고 파싱
      const rows = tableLines.filter(l => !/^\s*\|[-:\s|]+\|\s*$/.test(l))
      const parsed = rows.map(r =>
        r.split('|').slice(1, -1).map(cell => cell.trim())
      )
      if (parsed.length > 0) {
        const headers = parsed[0]
        const body = parsed.slice(1)
        result.push(
          <div key={i} className="overflow-x-auto my-2">
            <table className="text-xs w-full border-collapse rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-100">
                  {headers.map((h, hi) => (
                    <th key={hi} className="px-3 py-2 text-left font-semibold text-gray-700 border border-gray-200"
                      dangerouslySetInnerHTML={{ __html: renderInline(h) }} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 border border-gray-200 text-gray-700"
                        dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      continue
    }

    // 나머지 기존 렌더링
    if (line.startsWith('### ')) {
      const inner = line.slice(4).replace(/\*\*(.*?)\*\*/g, '$1')
      result.push(<h3 key={i} className={`font-bold text-base mt-2 mb-0.5 ${isUser ? 'text-blue-100' : 'text-blue-700'}`}>{inner}</h3>)
    } else if (line.startsWith('## ')) {
      result.push(<h2 key={i} className={`font-bold text-base mt-2 mb-1 ${isUser ? 'text-white' : 'text-gray-900'}`}>{line.slice(3)}</h2>)
    } else if (line.startsWith('**') && line.endsWith('**') && !line.slice(2, -2).includes('**')) {
      result.push(<p key={i} className={`font-semibold text-sm ${boldClass}`}>{line.slice(2, -2)}</p>)
    } else if (line === '---') {
      result.push(<hr key={i} className={`my-2 ${isUser ? 'border-blue-400' : 'border-gray-200'}`} />)
    } else if (line === '') {
      result.push(<div key={i} className="h-1" />)
    } else if (line.includes('!!AGENCY_DISCOUNT!!')) {
      const cleaned = line.replace('!!AGENCY_DISCOUNT!!', '').replace(/^-\s*/, '')
      result.push(
        <div key={i} className="flex gap-2 items-start bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 my-1">
          <span className="text-red-500 font-bold text-sm flex-shrink-0">✂️</span>
          <span className="text-red-700 font-semibold text-sm" dangerouslySetInnerHTML={{ __html: renderInline(cleaned) }} />
        </div>
      )
    } else if (line.startsWith('> 💡')) {
      result.push(
        <div key={i} className="bg-red-50 border-l-4 border-red-400 px-3 py-1.5 rounded-r-lg my-1">
          <p className="text-sm text-red-700 font-semibold">{line.slice(2)}</p>
        </div>
      )
    } else if (line.startsWith('> ')) {
      result.push(<p key={i} className={`text-xs italic pl-3 border-l-2 ${isUser ? 'border-blue-300 text-blue-100' : 'border-gray-300 text-gray-500'}`}>{line.slice(2)}</p>)
    } else if (line.startsWith('- ')) {
      result.push(
        <div key={i} className={`flex gap-2 text-sm ${textColor}`}>
          <span className="mt-0.5 flex-shrink-0 opacity-60">•</span>
          <span dangerouslySetInnerHTML={{ __html: renderInline(line.slice(2)) }} />
        </div>
      )
    } else if (line.startsWith('*') && line.endsWith('*')) {
      result.push(<p key={i} className={`text-xs italic ${subColor}`}>{line.slice(1, -1)}</p>)
    } else {
      result.push(<p key={i} className={`text-sm ${textColor}`} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />)
    }
    i++
  }

  return <div className="space-y-0.5 leading-relaxed">{result}</div>
}


// ── 프로모션 목록 패널 ───────────────────────────────────────────────────────
// calcResult.promotionLines를 적용/보류/미적용으로 나눠 보여준다.
// - applied: 자동 적용된 할인 (초록, 할인액 표시)
// - pending: 시작일 미정이라 보류 (노랑) — 데이트피커로 날짜 정하면 재계산
// - unmet:   조건 미충족 등 미적용 (회색, 사유 표시) — 다른 프로모션이 뭐가 있는지 보여줌
export function PromotionPanel({ lines, dateUnset, onPickDate }: {
  lines: PromotionLineItem[]
  dateUnset: boolean
  onPickDate?: (date: string) => void
}) {
  const applied = lines.filter(l => l.status === 'applied')
  const pending = lines.filter(l => l.status === 'pending')
  const others  = lines.filter(l => l.status === 'unmet' || l.status === 'manual')
  if (applied.length === 0 && pending.length === 0 && others.length === 0) return null

  const fmt = (n: number) => n.toLocaleString() + '원'

  return (
    <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden text-sm">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-medium text-gray-700 text-xs">
        프로모션 · 할인 내역
      </div>
      <div className="divide-y divide-gray-100">
        {/* 적용된 할인 */}
        {applied.map(l => (
          <div key={l.id} className="px-4 py-2.5 flex items-start gap-2 bg-emerald-50/40">
            <span className="shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">적용</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-2">
                <span className="font-medium text-gray-800">{l.kind === 'agency' ? '유학원 할인' : l.label}{l.kind === 'agency' && <span className="ml-1 text-[10px] text-emerald-700">(유학원)</span>}</span>
                <span className="font-semibold text-emerald-700 shrink-0">−{fmt(l.discountKrw)}</span>
              </div>
              {l.basis && <div className="text-xs text-gray-500 mt-0.5">{l.basis}</div>}
            </div>
          </div>
        ))}

        {/* 날짜 미정 보류 */}
        {pending.map(l => (
          <div key={l.id} className="px-4 py-2.5 flex items-start gap-2 bg-amber-50/50">
            <span className="shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">보류</span>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-gray-800">{l.label}</span>
              <div className="text-xs text-amber-700 mt-0.5">
                시작일이 정해지면 적용 여부가 확정됩니다{l.periodNote ? ` · ${l.periodNote}` : ''}
              </div>
            </div>
          </div>
        ))}

        {/* 미적용 (다른 프로모션 존재 안내) */}
        {others.map(l => (
          <div key={l.id} className="px-4 py-2.5 flex items-start gap-2 opacity-70">
            <span className="shrink-0 mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-300 text-gray-600">미적용</span>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-gray-600 line-through decoration-gray-300">{l.label}</span>
              {(l.unmetReason || l.basis) && <div className="text-xs text-gray-400 mt-0.5">{l.unmetReason || l.basis}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* 날짜 미정 + 보류 항목 있을 때: 데이트피커로 확정 */}
      {dateUnset && pending.length > 0 && onPickDate && (
        <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-amber-800 font-medium">시작일을 정하면 보류 항목이 확정됩니다:</span>
          <input
            type="date"
            className="text-xs border border-amber-300 rounded-lg px-2 py-1 bg-white"
            onChange={e => { if (e.target.value) onPickDate(e.target.value) }}
          />
        </div>
      )}
    </div>
  )
}

// ── 기간 타임라인 ────────────────────────────────────────────────────────────
export function PeriodTimeline({ startDate, totalWeeks, surchargeItems }: {
  startDate?: string
  totalWeeks?: number
  surchargeItems?: Array<{ label: string; weeks: number }>
}) {
  if (!startDate || !totalWeeks) return null
  const end = new Date(startDate)
  end.setDate(end.getDate() + totalWeeks * 7)

  return (
    <div className="mt-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">📅 연수기간</span>
        <span className="font-semibold text-slate-800">{startDate} ~ {end.toISOString().split('T')[0]}</span>
        <span className="text-blue-600 font-bold">({totalWeeks}주)</span>
      </div>
      {(surchargeItems ?? []).map((sc, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-orange-700">
          <span>🔥 서차지 구간</span>
          <span className="font-medium">{sc.label}</span>
        </div>
      ))}
    </div>
  )
}
export function LocalFeePanel({ fees, php, krwEstimate, weeks, phpToKrw }: {
  fees: LocalFee[]; php: number; krwEstimate: number; weeks?: number; phpToKrw: number
}) {
  const [open, setOpen] = useState(false)
  // 택일 그룹별 선택 인덱스 (groupId → 선택된 멤버 index)
  const [groupSel, setGroupSel] = useState<Record<string, number>>({})
  if (!fees.length) return null

  const triggerLabel = (f: LocalFee) => {
    const t = f.trigger ?? 'always'
    if (t === 'always')     return '1회'
    if (t === 'per_week')   return weeks ? `주당×${weeks}` : '주당'
    if (t === 'per_4weeks') return weeks ? `4주당×${Math.ceil(weeks/4)}` : '4주당'
    if (t === 'over_weeks') return `${f.triggerWeeks??4}주 초과시`
    if (t === 'optional')   return '선택'
    return ''
  }
  const unitLabel = (f: LocalFee) => {
    const u = f.chargeUnit ?? 'flat'
    if (u === 'per_person') return '/인'
    if (u === 'per_trip')   return '/편도'
    if (u === 'per_night')  return '/박'
    return ''
  }
  const calcAmount = (f: LocalFee): number => {
    const t = f.trigger ?? 'always'
    if (t === 'optional')   return f.amount
    if (!weeks)             return f.amount
    if (t === 'per_week')   return f.amount * weeks
    if (t === 'per_4weeks') return f.amount * Math.ceil(weeks / 4)
    if (t === 'over_weeks') return weeks > (f.triggerWeeks ?? 4) ? f.amount : 0
    return f.amount
  }

  // 택일 그룹 분리
  const groups: Record<string, LocalFee[]> = {}
  const singles: LocalFee[] = []
  for (const f of fees) {
    const g = (f as { exclusiveGroup?: string }).exclusiveGroup
    if (g) { (groups[g] ??= []).push(f) }
    else singles.push(f)
  }
  const groupKeys = Object.keys(groups)
  const selectedIdx = (g: string) => groupSel[g] ?? Math.max(0, groups[g].findIndex(m => (m as {groupDefault?: boolean}).groupDefault))
  const cycleGroup = (g: string, dir: number) => {
    const len = groups[g].length
    const cur = selectedIdx(g)
    setGroupSel(s => ({ ...s, [g]: (cur + dir + len) % len }))
  }

  // 합계 재계산 (단독 + 그룹 선택분)
  const recalcEstimate = () => {
    let p = 0, k = 0
    for (const f of singles) {
      if ((f.trigger ?? 'always') === 'optional') continue
      const a = calcAmount(f)
      if (f.currency === 'KRW') k += a; else p += a
    }
    for (const g of groupKeys) {
      const sel = groups[g][selectedIdx(g)]
      const a = calcAmount(sel)
      if (sel.currency === 'KRW') k += a; else p += a
    }
    return Math.round(p * phpToKrw) + k
  }
  const liveEstimate = groupKeys.length > 0 ? recalcEstimate() : krwEstimate

  const renderFeeRow = (f: LocalFee, key: string) => {
    const amt = calcAmount(f)
    const isOptional = (f.trigger ?? 'always') === 'optional'
    if (amt === 0 && !isOptional) return null
    const isKrw = f.currency === 'KRW'
    return (
      <div key={key} className="flex justify-between items-center text-sm">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className={`truncate text-sm ${isOptional ? 'text-gray-400' : 'text-gray-700'}`}>{f.name}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${isOptional ? 'bg-gray-100 text-gray-400' : 'bg-amber-50 text-amber-600'}`}>
            {triggerLabel(f)}{unitLabel(f)}
          </span>
        </div>
        <span className={`font-medium flex-shrink-0 ml-2 ${isOptional ? 'text-gray-400' : 'text-gray-800'}`}>
          {isKrw ? formatKrw(amt) : `₱${amt.toLocaleString()}${f.amountMax ? `~${f.amountMax.toLocaleString()}` : ''}`}
          {!isKrw && <span className="text-xs text-gray-400 ml-1">(약 {formatKrw(Math.round(amt * phpToKrw))})</span>}
          {isOptional && <span className="text-xs text-gray-400 ml-1">[선택]</span>}
        </span>
      </div>
    )
  }

  return (
    <div className="mt-3 border border-amber-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors text-sm">
        <div className="flex items-center gap-2 text-amber-800 font-medium">
          <DollarSign size={14} />
          현지납부비 {weeks ? `(${weeks}주 기준)` : ''}
          <span className="text-xs text-amber-600 font-normal">약 {formatKrw(liveEstimate)}</span>
        </div>
        {open ? <ChevronUp size={14} className="text-amber-600" /> : <ChevronDown size={14} className="text-amber-600" />}
      </button>
      {open && (
        <div className="bg-white px-3 py-2 space-y-1.5">
          <p className="text-xs text-gray-400 mb-2">※ 현지 도착 후 직접 납부. 견적 총액 미포함.</p>
          {singles.map((f, i) => renderFeeRow(f, `s${i}`))}
          {/* 택일 그룹 — < >로 선택 */}
          {groupKeys.map(g => {
            const idx = selectedIdx(g)
            const sel = groups[g][idx]
            const amt = calcAmount(sel)
            const isKrw = sel.currency === 'KRW'
            return (
              <div key={g} className="flex justify-between items-center text-sm bg-blue-50 rounded-lg px-2 py-1.5">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <button onClick={() => cycleGroup(g, -1)} className="text-blue-500 hover:text-blue-700 px-1 font-bold">‹</button>
                  <span className="truncate text-sm text-gray-700">{sel.name}</span>
                  <button onClick={() => cycleGroup(g, 1)} className="text-blue-500 hover:text-blue-700 px-1 font-bold">›</button>
                  <span className="text-xs text-blue-400">({idx + 1}/{groups[g].length} 택일)</span>
                </div>
                <span className="font-medium flex-shrink-0 ml-2 text-gray-800">
                  {isKrw ? formatKrw(amt) : `₱${amt.toLocaleString()}`}
                  {!isKrw && <span className="text-xs text-gray-400 ml-1">(약 {formatKrw(Math.round(amt * phpToKrw))})</span>}
                </span>
              </div>
            )
          })}
          <div className="border-t border-gray-100 pt-1.5 flex justify-between text-sm font-semibold">
            <span className="text-gray-700">합계 (선택 제외)</span>
            <span className="text-amber-700">약 {formatKrw(liveEstimate)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 근거 데이터 카드 ──────────────────────────────────────────────────────────
export function EvidenceCard({ text, school }: { text: string; school?: School }) {
  const [open, setOpen] = useState(false)
  const [showSchoolData, setShowSchoolData] = useState(false)
  return (
    <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center bg-gray-50 px-3 py-2 gap-2">
        <button onClick={() => setOpen(!open)}
          className="flex-1 flex items-center justify-between text-sm hover:opacity-80">
          <span className="text-gray-600 font-medium text-xs">📎 견적 근거 데이터</span>
          {open ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
        </button>
        {school && (
          <button onClick={() => setShowSchoolData(!showSchoolData)}
            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-1 bg-white flex-shrink-0">
            학원 비용표
          </button>
        )}
      </div>
      {open && (
        <div className="bg-white px-3 py-2">
          <MarkdownText text={text} />
        </div>
      )}
      {showSchoolData && school && (
        <div className="bg-white border-t border-gray-100 px-3 py-3 overflow-x-auto">
          <p className="text-xs font-semibold text-gray-700 mb-2">{school.name} 비용표 (읽기 전용)</p>
          {/* 코스 */}
          {(school.courses ?? []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-1 font-medium">코스</p>
              <table className="text-xs w-full border-collapse">
                <thead><tr className="bg-gray-50">
                  <th className="text-left px-2 py-1 border border-gray-100">코스명</th>
                  <th className="text-left px-2 py-1 border border-gray-100">대상</th>
                  <th className="text-right px-2 py-1 border border-gray-100">4주 기준</th>
                </tr></thead>
                <tbody>{school.courses.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-2 py-1 border border-gray-100">{c.name}</td>
                    <td className="px-2 py-1 border border-gray-100 text-gray-500">{c.target}</td>
                    <td className="px-2 py-1 border border-gray-100 text-right font-medium">
                      {((c as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}{c.currency}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {/* 기숙사 */}
          {(school.dormitories ?? []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-1 font-medium">기숙사</p>
              <table className="text-xs w-full border-collapse">
                <thead><tr className="bg-gray-50">
                  <th className="text-left px-2 py-1 border border-gray-100">기숙사명</th>
                  <th className="text-left px-2 py-1 border border-gray-100">대상</th>
                  <th className="text-right px-2 py-1 border border-gray-100">4주 기준</th>
                </tr></thead>
                <tbody>{school.dormitories.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-2 py-1 border border-gray-100">{d.name}</td>
                    <td className="px-2 py-1 border border-gray-100 text-gray-500">{d.target}</td>
                    <td className="px-2 py-1 border border-gray-100 text-right font-medium">
                      {((d as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}{d.currency}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {/* 서차지(성수기 추가비) 규정 */}
          {(school.surcharges ?? []).length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 mb-1 font-medium">서차지(성수기 추가비) 규정</p>
              <table className="text-xs w-full border-collapse">
                <thead><tr className="bg-gray-50">
                  <th className="text-left px-2 py-1 border border-gray-100">기간</th>
                  <th className="text-left px-2 py-1 border border-gray-100">적용</th>
                  <th className="text-right px-2 py-1 border border-gray-100">주당</th>
                </tr></thead>
                <tbody>{(school.surcharges ?? []).map((sc, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-2 py-1 border border-gray-100">{sc.startDate}~{sc.endDate}</td>
                    <td className="px-2 py-1 border border-gray-100 text-gray-500">{sc.label}</td>
                    <td className="px-2 py-1 border border-gray-100 text-right font-medium">
                      {(sc.pricePerWeek ?? 0).toLocaleString()}{sc.currency}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {/* 패키지 */}
          {(school.packages ?? []).length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1 font-medium">패키지</p>
              {school.packages.map(p => {
                // priceMatrix 객체형({columns,rows}) → 배열형([{weeks,prices}]) 정규화
                const rawPm = (p as { priceMatrix?: unknown }).priceMatrix
                let cols = (p.columns ?? []) as string[]
                let matrix: Array<{ weeks: number; prices: Array<{ label: string; amount: number }> }> = []
                const weekOf = (c: string) => { const m = String(c).match(/(\d+)\s*(?:w|W|주)/); return m ? parseInt(m[1],10) : null }
                if (Array.isArray(rawPm)) {
                  matrix = rawPm as typeof matrix
                } else if (rawPm && typeof rawPm === 'object') {
                  const obj = rawPm as { columns?: string[]; rows?: Array<{ label?: string; prices?: number[] }> }
                  const colList = obj.columns ?? []
                  const rows = obj.rows ?? []
                  const weekCols = colList.map(weekOf)
                  if (weekCols.length > 0 && weekCols.every(w => w !== null)) {
                    cols = rows.map(r => r.label ?? '기본')
                    matrix = (weekCols as number[]).map((wk, ci) => ({
                      weeks: wk,
                      prices: rows.map(r => ({ label: r.label ?? '기본', amount: (r.prices ?? [])[ci] ?? 0 })),
                    }))
                  } else {
                    cols = colList
                    matrix = rows.map(r => ({
                      weeks: weekOf(r.label ?? '') ?? 4,
                      prices: colList.map((c, ci) => ({ label: c, amount: (r.prices ?? [])[ci] ?? 0 })),
                    }))
                  }
                }
                return (
                <div key={p.id} className="mb-2">
                  <p className="text-xs font-medium text-gray-700">{p.label} <span className="text-gray-400">({p.season})</span></p>
                  <table className="text-xs w-full border-collapse mt-1">
                    <thead><tr className="bg-gray-50">
                      <th className="text-left px-2 py-1 border border-gray-100">주수</th>
                      {cols.map(col => <th key={col} className="text-right px-2 py-1 border border-gray-100">{col}</th>)}
                    </tr></thead>
                    <tbody>{matrix.map(row => (
                      <tr key={row.weeks} className="hover:bg-gray-50">
                        <td className="px-2 py-1 border border-gray-100 font-medium">{row.weeks}주</td>
                        {(row.prices ?? []).map(cell => (
                          <td key={cell.label} className="px-2 py-1 border border-gray-100 text-right">
                            {(cell.amount/10000).toFixed(0)}만
                          </td>
                        ))}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )})}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 질문 버블 (need_info) ─────────────────────────────────────────────────────

// ── 계산 근거 표 (데이터 직접 표시 — 파싱 없이 calcResult 그대로) ──────────────
// 요약 글이 아니라 표로 보여줘, 단가·주수·금액이 데이터와 맞는지 눈으로 검증 가능하게 한다.
export function CalcEvidenceTable({ calc, phpToKrw }: { calc: CalcResult; phpToKrw: number }) {
  const krw = (n: number) => n.toLocaleString() + '원'
  const rows: Array<{ kind: string; name: string; weeks: number; unit: number; cur: string; amount: number }> = []
  for (const it of calc.courseItems) rows.push({ kind: '학비', name: it.label.replace(/^코스:\s*/, ''), weeks: it.weeks, unit: it.unitPrice, cur: it.currency, amount: it.krwAmount })
  for (const it of calc.dormItems) rows.push({ kind: '기숙사', name: it.label.replace(/^기숙사:\s*/, ''), weeks: it.weeks, unit: it.unitPrice, cur: it.currency, amount: it.krwAmount })
  if (rows.length === 0) return null
  return (
    <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-700">📐 계산 근거 (항목별)</div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full border-collapse">
          <thead><tr className="bg-gray-50 text-gray-500">
            <th className="text-left px-2 py-1.5 border-b border-gray-100">구분</th>
            <th className="text-left px-2 py-1.5 border-b border-gray-100">항목</th>
            <th className="text-right px-2 py-1.5 border-b border-gray-100">주수</th>
            <th className="text-right px-2 py-1.5 border-b border-gray-100">4주 단가</th>
            <th className="text-right px-2 py-1.5 border-b border-gray-100">금액</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-2 py-1.5 border-b border-gray-50 text-gray-400">{r.kind}</td>
                <td className="px-2 py-1.5 border-b border-gray-50 text-gray-700">{r.name}</td>
                <td className="px-2 py-1.5 border-b border-gray-50 text-right">{r.weeks}주</td>
                <td className="px-2 py-1.5 border-b border-gray-50 text-right text-gray-500">{(r.unit * 4).toLocaleString()}{r.cur === 'KRW' ? '원' : r.cur}</td>
                <td className="px-2 py-1.5 border-b border-gray-50 text-right font-medium">{krw(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 할인 근거 표 (데이터 직접 표시) ───────────────────────────────────────────
// 어떤 프로모션이 어떤 조건으로 얼마 적용/미적용됐는지 표로. (요약 글 대체)
export function DiscountEvidenceTable({ lines }: { lines: PromotionLineItem[] }) {
  const krw = (n: number) => n.toLocaleString() + '원'
  if (!lines || lines.length === 0) return null
  const statusLabel: Record<string, string> = { applied: '적용', pending: '보류', unmet: '미적용', manual: '수동' }
  const statusColor: Record<string, string> = {
    applied: 'text-emerald-600', pending: 'text-amber-600', unmet: 'text-gray-400', manual: 'text-blue-600',
  }
  return (
    <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-700">💸 할인 근거 (조건 → 적용액)</div>
      <div className="overflow-x-auto">
        <table className="text-xs w-full border-collapse">
          <thead><tr className="bg-gray-50 text-gray-500">
            <th className="text-left px-2 py-1.5 border-b border-gray-100">상태</th>
            <th className="text-left px-2 py-1.5 border-b border-gray-100">프로모션</th>
            <th className="text-left px-2 py-1.5 border-b border-gray-100">조건/근거</th>
            <th className="text-right px-2 py-1.5 border-b border-gray-100">적용액</th>
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className={`px-2 py-1.5 border-b border-gray-50 ${statusColor[l.status]}`}>{statusLabel[l.status] ?? l.status}</td>
                <td className="px-2 py-1.5 border-b border-gray-50 text-gray-700">{l.kind === 'agency' ? '유학원 할인' : l.label}</td>
                <td className="px-2 py-1.5 border-b border-gray-50 text-gray-500">{l.basis || l.unmetReason || l.periodNote || '—'}</td>
                <td className="px-2 py-1.5 border-b border-gray-50 text-right font-medium">{l.status === 'applied' ? `-${krw(l.discountKrw)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
