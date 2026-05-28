'use client'
import { useRef, useState } from 'react'
import { X, Download, Copy, Check } from 'lucide-react'
import type { School } from '@/types'
import type { PromoEntry } from '@/lib/db'

interface Props {
  school: School
  promotions: PromoEntry[]   // 해당 학원 프로모션 (이미 필터링된 것)
  onClose: () => void
}

// 학원 데이터시트 — 학원 담당자 검수용 팩트 표.
// 안내 문구 없이 데이터만 정렬. PNG로 저장/카톡 복사 → 메신저로 담당자에게 전달.
export default function SchoolDatasheet({ school, promotions, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const copyAsPng = async () => {
    if (!printRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
      canvas.toBlob(async (blob) => {
        if (!blob) return
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch { alert('클립보드 복사 실패. PNG 저장을 이용하세요.') }
      })
    } catch { alert('이미지 생성 실패') }
  }

  const savePng = async () => {
    if (!printRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `${school.schoolCode ?? school.name ?? 'school'}_데이터시트.png`
      a.click()
    } catch { alert('이미지 저장 실패') }
  }

  const fmtKrw = (n?: number) => (n ?? 0).toLocaleString() + '원'
  const fmtCur = (n: number, c: string) => {
    if (c === 'KRW') return n.toLocaleString() + '원'
    if (c === 'PHP') return '₱' + n.toLocaleString()
    return n.toLocaleString() + c
  }
  const rates = school.courseShortTermRates
  const dormRates = school.dormShortTermRates

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: 8, maxWidth: 720, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
          <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>학원 데이터시트</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={copyAsPng} className="btn-secondary flex items-center gap-1 text-sm">
              {copied ? <><Check size={14} /> 복사됨</> : <><Copy size={14} /> 카톡 복사</>}
            </button>
            <button onClick={savePng} className="btn-secondary flex items-center gap-1 text-sm">
              <Download size={14} /> PNG 저장
            </button>
            <button onClick={onClose} className="btn-secondary p-2"><X size={14} /></button>
          </div>
        </div>

        <div ref={printRef} style={{ padding: '24px 28px', background: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#111' }}>
          <div style={{ borderBottom: '2px solid #111', paddingBottom: 10, marginBottom: 16 }}>
            <p style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>{school.name ?? school.schoolCode} — 데이터 확인표</p>
            <p style={{ fontSize: 12, color: '#666', margin: '4px 0 0' }}>기준일 {new Date().toISOString().split('T')[0]} · 지역 {school.region ?? '-'}</p>
          </div>

          {/* 수업료 */}
          <Section title="수업료 (4주 기준)">
            <Table rows={[
              ['코스', '대상', '4주'],
              ...((school.courses ?? []).map(c => [
                c.name, ((c as unknown as Record<string, string>).target ?? '-'), fmtKrw(c.price4Weeks)
              ]))
            ]} />
            {rates && (
              <p style={{ fontSize: 12, color: '#444', margin: '6px 0 0', background: '#f5f5f0', padding: '6px 10px', borderRadius: 4 }}>
                단기(4주 미만) 수업료 계산 — 1주 <b>{rates.week1 ?? '?'}%</b> · 2주 <b>{rates.week2 ?? '?'}%</b> · 3주 <b>{rates.week3 ?? '?'}%</b>
                {school.shortTermDataStatus === 'unconfirmed' && <span style={{ color: '#a32d2d' }}> · 자료 미확인(정비례 추정)</span>}
              </p>
            )}
          </Section>

          {/* 기숙사 */}
          {(school.dormitories ?? []).length > 0 && (
            <Section title="기숙사 (4주 기준)">
              <Table rows={[
                ['기숙사', '4주'],
                ...((school.dormitories ?? []).map(d => [d.name, fmtKrw(d.price4Weeks)]))
              ]} />
              {dormRates && (
                <p style={{ fontSize: 12, color: '#444', margin: '6px 0 0', background: '#f5f5f0', padding: '6px 10px', borderRadius: 4 }}>
                  단기 기숙사 계산 — 1주 <b>{dormRates.week1 ?? '?'}%</b> · 2주 <b>{dormRates.week2 ?? '?'}%</b> · 3주 <b>{dormRates.week3 ?? '?'}%</b>
                </p>
              )}
            </Section>
          )}

          {/* 등록비 */}
          {school.registrationFee && (
            <Section title="등록비">
              <Table rows={[
                ['항목', '금액', '비고'],
                ['등록비 (1회)', fmtCur(school.registrationFee.amount, school.registrationFee.currency ?? 'KRW'), school.registrationFee.note ?? '-']
              ]} />
            </Section>
          )}

          {/* 현지납부비 */}
          {(school.localFees ?? []).length > 0 && (
            <Section title="현지납부비 (현지 직접 납부)">
              <Table rows={[
                ['항목', '금액', '주기'],
                ...((school.localFees ?? []).map(lf => [
                  lf.name,
                  fmtCur(lf.amount ?? 0, lf.currency ?? 'PHP'),
                  ((lf as unknown as Record<string, string>).frequency) ?? '-'
                ]))
              ]} />
            </Section>
          )}

          {/* 서차지 */}
          {(school.surcharges ?? []).length > 0 && (
            <Section title="성수기 추가비 (서차지)">
              <Table rows={[
                ['시즌', '주당 추가비', '기간', '할인 적용'],
                ...((school.surcharges ?? []).map(sc => [
                  sc.label,
                  fmtCur(sc.pricePerWeek ?? 0, sc.currency ?? 'KRW') + '/주',
                  `${sc.startDate} ~ ${sc.endDate}`,
                  sc.discountAllowed ? '가능' : '불가'
                ]))
              ]} />
            </Section>
          )}

          {/* 프로모션 */}
          {promotions.length > 0 && (
            <Section title="프로모션 · 할인">
              {promotions.map((p, i) => <PromoCard key={i} promo={p} />)}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <p style={{ fontSize: 14, fontWeight: 600, margin: '0 0 6px', borderBottom: '1px solid #ddd', paddingBottom: 4 }}>{title}</p>
      {children}
    </div>
  )
}

function Table({ rows }: { rows: (string|number|React.ReactNode)[][] }) {
  if (rows.length === 0) return null
  const [header, ...body] = rows
  return (
    <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #999', color: '#555' }}>
          {header.map((c, i) => (
            <th key={i} style={{ padding: '5px 6px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 500 }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, ri) => (
          <tr key={ri} style={{ borderBottom: '0.5px solid #e5e5e5' }}>
            {row.map((c, ci) => (
              <td key={ci} style={{ padding: '5px 6px', textAlign: ci === 0 ? 'left' : 'right' }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PromoCard({ promo }: { promo: PromoEntry }) {
  const fmtKrw = (n: number) => n.toLocaleString() + '원'
  const discountText = (() => {
    const t = promo.discountType
    const v = promo.discountValue ?? 0
    if (t === 'percent') return `${v}% 할인`
    if (t === 'amount_per_week') return `주당 ${fmtKrw(v)}`
    if (t === 'amount_per_4weeks') return `4주당 ${fmtKrw(v)}${promo.blockMethod === 'proportional' ? ' (비례)' : ' (4주 단위)'}`
    if (t === 'week_tiers') {
      const tiers = (promo as unknown as { weekTiers?: { minWeeks: number; amount: number }[] }).weekTiers ?? []
      return tiers.map(t => `${t.minWeeks}주: ${fmtKrw(t.amount)}`).join(' / ')
    }
    if (t === 'amount') return v > 0 ? fmtKrw(v) : '-'
    return '-'
  })()

  const agencyText = (() => {
    const st = promo.agencyDiscountStatus
    if (st === 'disabled') return '유학원 할인 없음'
    if (st === 'unconfirmed') return '유학원 할인 미확인'
    const t = promo.agencyDiscountType
    const v = promo.agencyDiscountValue ?? 0
    const base = promo.agencyDiscountBase === 'after_discount' ? '학원할인 차감 후' : '학원할인 차감 전'
    if (t === 'percent') return `${v}% (${base})`
    if (t === 'amount_per_week') return `주당 ${fmtKrw(v)}`
    if (t === 'amount_per_4weeks') return `4주당 ${fmtKrw(v)}`
    if (t === 'amount_flat') return `${fmtKrw(v)} 정액`
    if (t === 'reg_fee_only') return '등록비 할인'
    return '-'
  })()

  return (
    <div style={{ border: '0.5px solid #ccc', borderRadius: 4, padding: '8px 12px', marginBottom: 6, fontSize: 12.5 }}>
      <p style={{ fontWeight: 500, margin: '0 0 4px' }}>{promo.promoName}</p>
      <table style={{ width: '100%', fontSize: 12, color: '#444' }}>
        <tbody>
          <tr><td style={{ padding: '2px 0', color: '#666', width: 110 }}>할인 내용</td><td>{discountText}</td></tr>
          {promo.minWeeks != null && <tr><td style={{ padding: '2px 0', color: '#666' }}>적용 조건</td><td>{promo.minWeeks}주 이상</td></tr>}
          {(promo.startDate || promo.endDate) && <tr><td style={{ padding: '2px 0', color: '#666' }}>적용 기간</td><td>{promo.startDate ?? ''} ~ {promo.endDate ?? ''}</td></tr>}
          {promo.alwaysApply && <tr><td style={{ padding: '2px 0', color: '#666' }}>적용 기간</td><td>상시</td></tr>}
          {promo.agencyDiscountStatus && <tr><td style={{ padding: '2px 0', color: '#666' }}>유학원 할인</td><td>{agencyText}</td></tr>}
          {promo.agencyDiscountRawText && <tr><td style={{ padding: '2px 0', color: '#666' }}>원문</td><td>{promo.agencyDiscountRawText}</td></tr>}
          {((promo.stackWith?.length ?? 0) > 0) && <tr><td style={{ padding: '2px 0', color: '#666' }}>중복 가능</td><td>{promo.stackWith!.join(', ')}</td></tr>}
          {((promo.exclusiveWith?.length ?? 0) > 0) && <tr><td style={{ padding: '2px 0', color: '#666' }}>택일</td><td>{promo.exclusiveWith!.join(', ')}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
