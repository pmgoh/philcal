import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, CalcResult } from '@/lib/calcEngine'
import { formatKrw, formatCurrency } from '@/lib/utils'
import type { School, LocalFee, ExchangeRate } from '@/types'

const SYSTEM_PROMPT = `당신은 필리핀 어학연수 견적 AI입니다. 엠버시유학 내부 전용 시스템입니다.

[절대 규칙]
- 응답은 JSON 객체 하나만. 첫 글자 반드시 {
- 생각 과정, 설명, 코드블록 전부 금지

[핵심 원칙]
- 코스와 기숙사가 모두 확정되어야만 견적 계산 가능
- 코스 미지정 → 반드시 되물음 (자동 선택 절대 금지)
- 기숙사 미지정 → 반드시 되물음 (자동 선택 절대 금지)
- 학원명이 여러 캠퍼스에 걸칠 경우 → 되물음

[가격 구조 이해]
- price4Weeks: 4주 기준 총액 (예: 1,800,000원)
- N주 계산: price4Weeks / 4 × N
- 예: 8주 = 1,800,000 / 4 × 8 = 3,600,000원
- 서차지: 주당 금액 × 해당 주수 (별도 계산)
- 할인: 학비+기숙사에 적용, 서차지엔 discountAllowed 따라

[응답 형식]

단일 견적:
{"action":"calculate","schoolId":"ID","courseId":"코스ID또는이름","dormitoryId":"기숙사ID또는이름","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD","message":"요약"}

복수 견적 (1인실+2인실 같이):
{"action":"multi_calculate","items":[{"label":"1인실","schoolId":"ID","courseId":"ID","dormitoryId":"ID","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD"},{"label":"2인실","schoolId":"ID","courseId":"ID","dormitoryId":"ID","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD"}]}

정보 부족 (코스/기숙사 미지정):
{"action":"need_info","question":"질문","type":"select","suggestions":["선택지1","선택지2"],"allowFreeText":false}

일반 질문 (규정, 서차지 안내 등):
{"action":"answer","message":"답변 - 해당 학원 규정을 참고해서 구체적으로"}

[매칭 규칙]
- 학원명: 부분 일치
- 날짜 없으면 오늘+30일
- weeks는 반드시 정수`

function extractJson(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/\`\`\`(?:json)?\n?/g, '').replace(/\`\`\`/g, '').trim()
  try { return JSON.parse(stripped) } catch {}
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)) } catch {}
  }
  return null
}

function buildQuoteMessage(school: School, weeks: number, startDate: string, calcResult: CalcResult, label?: string): string {
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + weeks * 7)
  const endStr = endDate.toISOString().split('T')[0]

  const lines: string[] = []
  lines.push(label ? `## ${school.name} — ${label}` : `## ${school.name}`)
  lines.push(`**${startDate} ~ ${endStr} (${weeks}주)**`)
  lines.push('')
  lines.push('### 비용 내역')

  for (const item of calcResult.items) {
    lines.push(`- ${item.label}: **${formatKrw(item.krwAmount)}**`)
    if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
  }

  if (calcResult.surchargeItems.length > 0) {
    lines.push('')
    lines.push('**성수기 서차지**')
    for (const sc of calcResult.surchargeItems) {
      lines.push(`- ${sc.label}: **+${formatKrw(sc.krwAmount)}**`)
    }
  }

  const totalDiscount = calcResult.promotionDiscount + calcResult.surchargeDiscount
  if (calcResult.promotionLabel && totalDiscount > 0) {
    lines.push('')
    lines.push(`**유학원 할인: ${calcResult.promotionLabel}**`)
    if (calcResult.promotionDiscount > 0) lines.push(`- 학비+기숙사 할인: **-${formatKrw(calcResult.promotionDiscount)}**`)
    if (calcResult.surchargeDiscount > 0) lines.push(`- 서차지 할인: **-${formatKrw(calcResult.surchargeDiscount)}**`)
  }

  if (calcResult.registrationFee && calcResult.registrationFeeKrw > 0) {
    const rf = calcResult.registrationFee
    lines.push('')
    lines.push(`**등록비 (1회)**: ${rf.currency === 'KRW' ? formatKrw(rf.amount) : formatCurrency(rf.amount, rf.currency)}${rf.note ? ` *(${rf.note})*` : ''}`)
  }

  lines.push('')
  lines.push('---')
  lines.push(`### 💰 총 견적: **${formatKrw(calcResult.totalKrw)}**`)
  lines.push('*(현지납부비 별도 — 아래 버튼에서 확인)*')

  if (calcResult.warnings.length > 0) lines.push('\n' + calcResult.warnings.join('\n'))
  if (calcResult.notes.length > 0) lines.push('\n' + calcResult.notes.join('\n'))

  return lines.join('\n')
}

function buildEvidenceMessage(school: School, weeks: number, startDate: string, calcResult: CalcResult, rate: ExchangeRate): string {
  const lines: string[] = ['**📎 계산 근거**']
  if (calcResult.courseUsed) {
    const c = calcResult.courseUsed
    const p4w = (c as unknown as Record<string,number>).price4Weeks ?? (c as unknown as Record<string,number>).pricePerWeek ?? 0
    const krw = calcResult.items.find(i => i.label.includes('코스'))?.krwAmount ?? 0
    lines.push(`- 코스: ${c.name} — 4주 기준 ${p4w.toLocaleString()}${c.currency} → ${weeks}주 = ${formatKrw(krw)}`)
  }
  if (calcResult.dormUsed) {
    const d = calcResult.dormUsed
    const p4w = (d as unknown as Record<string,number>).price4Weeks ?? (d as unknown as Record<string,number>).pricePerWeek ?? 0
    const krw = calcResult.items.find(i => i.label.includes('기숙사'))?.krwAmount ?? 0
    lines.push(`- 기숙사: ${d.name} — 4주 기준 ${p4w.toLocaleString()}${d.currency} → ${weeks}주 = ${formatKrw(krw)}`)
  }
  if (calcResult.surchargeItems.length > 0) {
    for (const sc of calcResult.surchargeItems) lines.push(`- ${sc.label}`)
  }
  if (calcResult.promotionLabel) {
    lines.push(`- 프로모션: ${calcResult.promotionLabel}`)
    if (calcResult.promotionDiscount > 0) lines.push(`  학비+기숙사 할인: -${formatKrw(calcResult.promotionDiscount)}`)
    if (calcResult.surchargeDiscount > 0) lines.push(`  서차지 할인: -${formatKrw(calcResult.surchargeDiscount)}`)
  }
  if (calcResult.registrationFee) {
    const rf = calcResult.registrationFee
    lines.push(`- 등록비: ${(rf.amount ?? 0).toLocaleString()}${rf.currency}`)
  }
  lines.push(`- 적용 환율: ₱1=${rate.phpToKrw}원 / $1=${rate.usdToKrw}원`)
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const { messages, schoolsData, rateData } = await req.json()
    const schools = (schoolsData as School[]) ?? []
    const rate = rateData as ExchangeRate

    const schoolsSummary = schools.map(s => ({
      id: s.id, name: s.name, region: s.region,
      minWeeks: s.minWeeks, allowShortTerm: s.allowShortTerm,
      programTags: s.programTags ?? [],
      courses: (s.courses ?? []).map(c => ({
        id: c.id, name: c.name, target: c.target,
        price4Weeks: (c as unknown as Record<string,number>).price4Weeks ?? (c as unknown as Record<string,number>).pricePerWeek ?? 0,
        currency: c.currency,
      })),
      dormitories: (s.dormitories ?? []).map(d => ({
        id: d.id, name: d.name, target: d.target,
        price4Weeks: (d as unknown as Record<string,number>).price4Weeks ?? (d as unknown as Record<string,number>).pricePerWeek ?? 0,
        currency: d.currency,
      })),
      surcharges: (s.surcharges ?? []).map(sc => ({
        label: sc.label, start: sc.startDate, end: sc.endDate,
        pricePerWeek: sc.pricePerWeek, currency: sc.currency,
        discountAllowed: sc.discountAllowed,
      })),
      promotions: (s.promotions ?? []).map(p => ({
        label: p.label, basisType: p.basisType,
        start: p.startDate, end: p.endDate,
        discount: `${p.discountValue}${p.discountType === 'percent' ? '%' : p.currency ?? 'KRW'}`,
        condition: p.condition,
      })),
      refundPolicy: s.refundPolicy ? s.refundPolicy.slice(0, 200) : '',
      dormitoryRules: s.dormitoryRules ? s.dormitoryRules.slice(0, 100) : '',
      generalNotes: s.generalNotes ? s.generalNotes.slice(0, 100) : '',
    }))

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ action: 'answer', message: 'API 키 미설정' }, { status: 500 })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: SYSTEM_PROMPT + `\n\n[학원 데이터]\n${JSON.stringify(schoolsSummary)}\n\n[오늘]\n${new Date().toISOString().split('T')[0]}`,
        messages,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[quote] Anthropic error', res.status, errText)
      return NextResponse.json({ action: 'answer', message: `AI 오류 (${res.status})` }, { status: 500 })
    }

    const aiData = await res.json()
    const rawText = aiData.content?.[0]?.text ?? ''
    console.log('[quote] raw:', rawText.slice(0, 400))

    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    // ── 단일 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'calculate') {
      const school = schools.find(s => s.id === parsed.schoolId)
      if (!school) return NextResponse.json({ action: 'need_info', question: '학원을 찾을 수 없습니다. 학원을 다시 선택해주세요.', type: 'select', suggestions: schools.map(s => s.name), allowFreeText: false })

      const calcResult = calculateQuote({
        school, weeks: Number(parsed.weeks),
        startDate: parsed.startDate as string,
        enrollmentDate: (parsed.enrollmentDate as string) || (parsed.startDate as string),
        courseId: (parsed.courseId as string) || '',
        dormitoryId: (parsed.dormitoryId as string) || '',
      }, rate)

      return NextResponse.json({
        action: 'result',
        message: buildQuoteMessage(school, Number(parsed.weeks), parsed.startDate as string, calcResult),
        evidenceMessage: buildEvidenceMessage(school, Number(parsed.weeks), parsed.startDate as string, calcResult, rate),
        localFees: calcResult.localFees,
        localFeePhp: calcResult.localFeePhp,
        localFeeKrwEstimate: calcResult.localFeeKrwEstimate,
        weeksForFees: Number(parsed.weeks),
      })
    }

    // ── 복수 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'multi_calculate') {
      type MultiItem = { label: string; schoolId: string; courseId: string; dormitoryId: string; weeks: number; startDate: string; enrollmentDate: string }
      const items = (parsed.items as MultiItem[]) ?? []
      const resultParts: string[] = []
      const evidenceParts: string[] = []
      let combinedLocalFees: LocalFee[] = []
      let maxLocalFeePhp = 0
      let maxLocalFeeKrw = 0

      for (const item of items) {
        const school = schools.find(s => s.id === item.schoolId)
        if (!school) { resultParts.push(`**${item.label}**: 학원을 찾을 수 없습니다.`); continue }
        const calcResult = calculateQuote({
          school, weeks: Number(item.weeks),
          startDate: item.startDate,
          enrollmentDate: item.enrollmentDate || item.startDate,
          courseId: item.courseId || '',
          dormitoryId: item.dormitoryId || '',
        }, rate)
        resultParts.push(buildQuoteMessage(school, Number(item.weeks), item.startDate, calcResult, item.label))
        evidenceParts.push(buildEvidenceMessage(school, Number(item.weeks), item.startDate, calcResult, rate))
        if (combinedLocalFees.length === 0) combinedLocalFees = calcResult.localFees
        maxLocalFeePhp = Math.max(maxLocalFeePhp, calcResult.localFeePhp)
        maxLocalFeeKrw = Math.max(maxLocalFeeKrw, calcResult.localFeeKrwEstimate)
      }

      return NextResponse.json({
        action: 'result',
        message: resultParts.join('\n\n---\n\n'),
        evidenceMessage: evidenceParts.join('\n\n'),
        localFees: combinedLocalFees,
        localFeePhp: maxLocalFeePhp,
        localFeeKrwEstimate: maxLocalFeeKrw,
        weeksForFees: items[0]?.weeks ?? 0,
      })
    }

    return NextResponse.json(parsed)

  } catch (err) {
    console.error('[quote] error:', err)
    return NextResponse.json({ action: 'answer', message: `오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
