'use client'
import { useState, useRef, useCallback } from 'react'
import { X, Plus, Trash2, Download, Copy, Check, Pencil } from 'lucide-react'
import { formatKrw } from '@/lib/utils'
import type { CalcResult } from '@/lib/calcEngine'
import type { School, LocalFee } from '@/types'

// ── 견적서 항목 ───────────────────────────────────────────────────────────────
interface QuoteLineItem {
  id: string
  label: string
  amount: number      // 원화
  isDiscount: boolean // 할인이면 음수 표시
  editable: boolean
}

interface Props {
  school: School
  calcResult: CalcResult
  startDate: string
  localFees?: LocalFee[]   // API에서 필터링된 현지납부비
  phpToKrw: number
  onClose: () => void
}

function uid() { return Math.random().toString(36).slice(2, 8) }

// CalcResult → 초기 라인 아이템 변환
function buildInitialItems(school: School, calc: CalcResult): QuoteLineItem[] {
  const items: QuoteLineItem[] = []

  // 등록비
  if (calc.registrationFeeKrw > 0 && calc.registrationFee) {
    items.push({ id: uid(), label: '입학금', amount: calc.registrationFeeKrw, isDiscount: false, editable: true })
  }

  // 패키지
  for (const pi of (calc.packageItems ?? [])) {
    items.push({ id: uid(), label: `${pi.pkg.label} / ${pi.columnLabel} / ${pi.weeks}주`, amount: pi.totalKrw, isDiscount: false, editable: true })
  }

  // 코스
  for (const ci of (calc.courseItems ?? [])) {
    items.push({ id: uid(), label: ci.label.replace('코스: ', '학비 '), amount: ci.krwAmount, isDiscount: false, editable: true })
  }

  // 기숙사
  for (const di of (calc.dormItems ?? [])) {
    items.push({ id: uid(), label: di.label.replace('기숙사: ', '기숙사비 '), amount: di.krwAmount, isDiscount: false, editable: true })
  }

  // 서차지
  for (const sc of (calc.surchargeItems ?? [])) {
    items.push({ id: uid(), label: sc.label.replace('서차지: ', '성수기 추가 비용 '), amount: sc.krwAmount, isDiscount: false, editable: true })
  }

  // 수속비 (기본값 0, 편집 가능)
  items.push({ id: uid(), label: '수속비', amount: 0, isDiscount: false, editable: true })

  // 어학원 프로모션 할인 — promotionLines 우선 (각 프로모션 개별 라인 + 근거)
  const appliedSchool = (calc.promotionLines ?? []).filter(l => l.kind === 'school' && l.status === 'applied')
  const appliedAgency = (calc.promotionLines ?? []).filter(l => l.kind === 'agency' && l.status === 'applied')
  if (appliedSchool.length > 0 || appliedAgency.length > 0) {
    for (const l of appliedSchool) {
      items.push({ id: uid(), label: `${l.label}`, amount: l.discountKrw, isDiscount: true, editable: true })
    }
    for (const l of appliedAgency) {
      items.push({ id: uid(), label: `유학원 할인 · ${l.label.replace(' (유학원 할인)','')}`, amount: l.discountKrw, isDiscount: true, editable: true })
    }
  } else {
    // 구버전 폴백: 합계 라인
    const totalPromoDiscount = calc.promotionDiscount + calc.surchargeDiscount
    if (totalPromoDiscount > 0 && calc.promotionLabel) {
      items.push({ id: uid(), label: `어학원 프로모션 할인 (${calc.promotionLabel})`, amount: totalPromoDiscount, isDiscount: true, editable: true })
    }
    if ((calc.agencyDiscountKrw ?? 0) > 0) {
      items.push({ id: uid(), label: `엠버시유학 할인`, amount: calc.agencyDiscountKrw, isDiscount: true, editable: true })
    }
  }

  return items
}

export default function QuoteFormModal({ school, calcResult, startDate, localFees: localFeesProp, phpToKrw, onClose }: Props) {
  const [items, setItems] = useState<QuoteLineItem[]>(() => buildInitialItems(school, calcResult))
  const [weeks, setWeeks] = useState(calcResult.totalWeeks)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  const total = items.reduce((s, i) => s + (i.isDiscount ? -i.amount : i.amount), 0)

  const updateItem = (id: string, patch: Partial<QuoteLineItem>) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))

  const deleteItem = (id: string) =>
    setItems(prev => prev.filter(i => i.id !== id))

  const addItem = () =>
    setItems(prev => [...prev, { id: uid(), label: '항목', amount: 0, isDiscount: false, editable: true }])

  // 현지납부비: API 필터링 결과 우선, 없으면 자체 필터링
  const totalWeeks = calcResult.totalWeeks
  const localItems = localFeesProp ?? (calcResult.localFees ?? []).filter(f => {
    const t = f.trigger ?? 'always'
    if (t === 'optional') return false
    if (t === 'always') return true
    if (t === 'per_week' || t === 'per_4weeks') return true
    if (t === 'over_weeks') return totalWeeks > (f.triggerWeeks ?? 4)
    return true
  })

  const captureAndCopy = useCallback(async () => {
    if (!printRef.current) return
    setIsCapturing(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })
      canvas.toBlob(async (blob) => {
        if (!blob) return
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          setCopied(true)
          setTimeout(() => setCopied(false), 2500)
        } catch {
          // 클립보드 실패시 다운로드
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = `${school.name}_견적서.png`
          a.click(); URL.revokeObjectURL(url)
        }
      }, 'image/png')
    } finally {
      setIsCapturing(false)
    }
  }, [school.name])

  const captureAndDownload = useCallback(async () => {
    if (!printRef.current) return
    setIsCapturing(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url; a.download = `${school.name}_${weeks}주_견적서.png`
      a.click()
    } finally {
      setIsCapturing(false)
    }
  }, [school.name, weeks])

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 p-0 md:p-4">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-2xl h-[92dvh] md:max-h-[90vh] flex flex-col">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">견적서 편집</h2>
          <div className="flex items-center gap-2">
            <button onClick={captureAndCopy} disabled={isCapturing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
              {copied ? <><Check size={14} /> 복사됨!</> : <><Copy size={14} /> 카톡 복사</>}
            </button>
            <button onClick={captureAndDownload} disabled={isCapturing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
              <Download size={14} /> PNG 저장
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* ── 미리보기 (캡처 대상) ── */}
          <div ref={printRef} className="bg-white font-sans" style={{ padding: '28px', minWidth: '480px', fontFamily: 'Noto Sans KR, Apple SD Gothic Neo, sans-serif' }}>

            {/* 타이틀 */}
            <div className="text-center mb-5">
              <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a2e', marginBottom: '4px' }}>연수비용표</h1>
            </div>

            {/* 학원명 + 주수 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e03e2d', paddingBottom: '6px', marginBottom: '16px' }}>
              <span style={{ fontSize: '15px', fontWeight: '700', color: '#e03e2d' }}>{school.name}</span>
              <span style={{ fontSize: '15px', fontWeight: '700', color: '#e03e2d' }}>{weeks}주</span>
            </div>

            {/* 비용 항목 테이블 */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '6px 4px', fontSize: '13px', color: item.isDiscount ? '#e03e2d' : '#222' }}>
                      {item.label}
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', fontSize: '13px', fontWeight: '600', color: item.isDiscount ? '#e03e2d' : '#111', whiteSpace: 'nowrap' }}>
                      {item.isDiscount ? '-' : ''}{item.amount.toLocaleString()}원
                    </td>
                  </tr>
                ))}
                {/* 합계 */}
                <tr style={{ borderTop: '2px solid #222' }}>
                  <td style={{ padding: '10px 4px', fontSize: '14px', fontWeight: '800', color: '#1a1a2e' }}>어학원 비용 총액</td>
                  <td style={{ padding: '10px 4px', textAlign: 'right', fontSize: '16px', fontWeight: '800', color: '#1a1a2e', whiteSpace: 'nowrap' }}>
                    {total.toLocaleString()}원
                  </td>
                </tr>
              </tbody>
            </table>

            {/* 현지납부비 */}
            {localItems.length > 0 && (
              <div style={{ marginTop: '16px', background: '#f8f9ff', borderRadius: '8px', padding: '12px' }}>
                <p style={{ fontSize: '12px', fontWeight: '700', color: '#444', marginBottom: '8px' }}>
                  현지납부 예상비용 <span style={{ fontSize: '11px', fontWeight: '400', color: '#888' }}>(1인 기준, 도착 후 학원에 납부)</span>
                  <span style={{ fontSize: '10px', color: '#aaa', marginLeft: '8px' }}>환율 ₱1={phpToKrw}원</span>
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {localItems.map((lf, i) => {
                      const phpAmt = (lf.trigger ?? 'always') === 'per_week' ? lf.amount * weeks : lf.amount
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e8eaf0' }}>
                          <td style={{ padding: '4px 2px', fontSize: '12px', color: '#555' }}>{lf.name}</td>
                          <td style={{ padding: '4px 2px', textAlign: 'right', fontSize: '12px', color: '#555' }}>
                            {phpAmt.toLocaleString()}페소
                          </td>
                          <td style={{ padding: '4px 2px', textAlign: 'right', fontSize: '12px', color: '#888', width: '90px' }}>
                            {Math.round(phpAmt * phpToKrw).toLocaleString()}원
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* 면책 문구 */}
            <div style={{ marginTop: '14px', padding: '10px', background: '#fff8e1', borderRadius: '6px', borderLeft: '3px solid #f59e0b' }}>
              <p style={{ fontSize: '10px', color: '#78716c', lineHeight: '1.6', margin: 0 }}>
                ※ 본 내역서는 참고용으로 확정 금액이 아닙니다.<br/>
                환율 및 프로모션 변경 등으로 변경될 수 있습니다.<br/>
                현지납부비용은 현지 사정에 따라 변경될 수 있으며 개인 사용량에 따라 실제 납부 비용과 차이가 있을 수 있습니다.
              </p>
            </div>

            {/* 엠버시 브랜딩 */}
            <div style={{ marginTop: '12px', textAlign: 'right' }}>
              <span style={{ fontSize: '11px', color: '#aaa' }}>엠버시유학 · philcal.vercel.app</span>
            </div>
          </div>

          {/* ── 편집 패널 ── */}
          <div className="mt-6 border-t border-gray-100 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">항목 편집</h3>
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 flex items-center gap-1.5">
                  주수
                  <input type="number" value={weeks} min={1} max={52}
                    onChange={e => setWeeks(Number(e.target.value))}
                    className="w-16 border border-gray-200 rounded px-2 py-1 text-sm text-center" />
                  주
                </label>
                <button onClick={addItem}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-2.5 py-1.5">
                  <Plus size={12} /> 항목 추가
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {items.map(item => (
                <div key={item.id} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2.5 py-2">
                  <input type="checkbox" checked={item.isDiscount} title="할인 항목"
                    onChange={e => updateItem(item.id, { isDiscount: e.target.checked })}
                    className="w-3.5 h-3.5 accent-red-500 flex-shrink-0" />
                  {editingId === item.id ? (
                    <input autoFocus value={item.label}
                      onChange={e => updateItem(item.id, { label: e.target.value })}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                      className="flex-1 border border-blue-300 rounded px-2 py-0.5 text-sm bg-white min-w-0" />
                  ) : (
                    <span className={`flex-1 text-sm cursor-pointer hover:text-blue-600 truncate ${item.isDiscount ? 'text-red-500' : 'text-gray-700'}`}
                      onClick={() => setEditingId(item.id)}>
                      {item.label}
                    </span>
                  )}
                  <input type="number" value={item.amount} min={0}
                    onChange={e => updateItem(item.id, { amount: Number(e.target.value) })}
                    className="w-24 md:w-32 border border-gray-200 rounded px-2 py-1 text-sm text-right bg-white flex-shrink-0" />
                  <span className="text-xs text-gray-400 flex-shrink-0">원</span>
                  <button onClick={() => deleteItem(item.id)}
                    className="p-1 text-red-300 hover:text-red-500 flex-shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between px-3 py-2 bg-gray-100 rounded-lg">
              <span className="text-sm font-semibold text-gray-700">총액</span>
              <span className="text-base font-bold text-blue-700">{formatKrw(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
