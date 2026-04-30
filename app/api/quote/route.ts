import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, CalcResult } from '@/lib/calcEngine'
import { formatKrw, formatCurrency } from '@/lib/utils'
import type { School, LocalFee, ExchangeRate } from '@/types'

const SYSTEM_PROMPT = `당신은 필리핀 어학연수 견적 AI입니다. 엠버시유학 내부 전용 시스템입니다.

[절대 규칙]
- 응답은 JSON 객체 하나만. 첫 글자 반드시 {
- 생각 과정, 설명, 코드블록 전부 금지. 다른 텍스트 없이 JSON만.

[응답 형식]

단일 견적 (weeks는 반드시 숫자):
{"action":"calculate","schoolId":"ID","courseId":"코스ID또는이름","dormitoryId":"기숙사ID또는이름","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD","message":"요약"}

복수 견적 (1인실+2인실 등):
{"action":"multi_calculate","items":[{"label":"1인실","schoolId":"ID","courseId":"ID","dormitoryId":"ID","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD"},{"label":"2인실","schoolId":"ID","courseId":"ID","dormitoryId":"ID","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD"}]}

정보 부족 (질문 + 선택지):
{"action":"need_info","question":"질문 문장","type":"select","suggestions":["선택지1","선택지2","선택지3"],"allowFreeText":true}

일반 질문:
{"action":"answer","message":"답변"}

[매칭 규칙]
- 학원명: 부분 일치 (CIA→Cebu CIA, JIC→BAGUIO JIC)
- 코스: 이름으로 매칭 (인텐시브→Intensive/Power, 일반→General/ESL/Regular)
- 기숙사: 인실 숫자 (1인실→Single/1인실, 2인실→Twin/Double)
- 날짜 없으면 오늘+30일 사용
- 코스 미지정시 첫 번째 코스 자동선택, message에 "코스는 [코스명]으로 계산했습니다" 명시
- weeks는 반드시 정수 숫자로`

function extractJson(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()
  try { return JSON.parse(stripped) } catch {}
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)) } catch {}
  }
  return null
}

function buildQuoteMessage(
  school: School,
  weeks: number,
  startDate: string,
  calcResult: CalcResult,
  label?: string
): string {
  const endDate = new Date(startDate)
  endDate.setDate(endDate.getDate() + weeks * 7)
  const endDateStr = endDate.toISOString().split('T')[0]

  const lines: string[] = []
  const header = label ? `## ${school.name} — ${label}` : `## ${school.name}`
  lines.push(header)
  lines.push(`**${startDate} ~ ${endDateStr} (${weeks}주)**`)
  lines.push('')

  for (const item of calcResult.items) {
    const unitStr = `${item.unitPrice.toLocaleString()}${item.currency === 'KRW' ? '원' : item.currency}/주`
    lines.push(`- ${item.label}: ${unitStr} × ${item.weeks}주 = **${formatKrw(item.krwAmount)}**`)
    if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
  }

  if (calcResult.surchargeItems.length > 0) {
    lines.push('\n**성수기 서차지**')
    for (const sc of calcResult.surchargeItems) {
      lines.push(`- ${sc.label}: ${sc.unitPrice.toLocaleString()}원/주 × ${sc.weeks}주 = **+${formatKrw(sc.krwAmount)}**`)
    }
  }

  if (calcResult.promotionLabel && calcResult.promotionDiscount > 0) {
    lines.push(`\n**프로모션: ${calcResult.promotionLabel}**`)
    lines.push(`- 할인: **-${formatKrw(calcResult.promotionDiscount)}**`)
  }

  if (calcResult.registrationFee && calcResult.registrationFeeKrw > 0) {
    const rf = calcResult.registrationFee
    const rfStr = rf.currency === 'KRW'
      ? `${rf.amount.toLocaleString()}원`
      : `${formatCurrency(rf.amount, rf.currency)} (${formatKrw(calcResult.registrationFeeKrw)} 환산)`
    lines.push(`\n**등록비** (1회)`)
    lines.push(`- **+${rfStr}**${rf.note ? ` *(${rf.note})*` : ''}`)
  }

  lines.push('\n---')
  lines.push(`### 💰 총 견적: **${formatKrw(calcResult.totalKrw)}**`)
  lines.push('*(현지납부비 별도)*')

  if (calcResult.warnings.length > 0) {
    lines.push('\n⚠️ ' + calcResult.warnings.join('\n⚠️ '))
  }
  if (calcResult.notes.length > 0) {
    lines.push('\n' + calcResult.notes.join('\n'))
  }

  return lines.join('\n')
}

function buildEvidenceMessage(
  school: School,
  weeks: number,
  startDate: string,
  calcResult: CalcResult,
  rate: ExchangeRate
): string {
  const lines: string[] = []
  lines.push('**📎 견적 근거 데이터**')
  lines.push(`- 학원: ${school.name} (${school.region})`)
  if (calcResult.courseUsed) {
    const c = calcResult.courseUsed
    lines.push(`- 코스: ${c.name} (대상: ${c.target}) — ${c.pricePerWeek.toLocaleString()}${c.currency}/주`)
  }
  if (calcResult.dormUsed) {
    const d = calcResult.dormUsed
    lines.push(`- 기숙사: ${d.name} (대상: ${d.target}) — ${d.pricePerWeek.toLocaleString()}${d.currency}/주`)
  }
  lines.push(`- 기간: ${weeks}주`)

  if (calcResult.surchargeItems.length > 0) {
    for (const sc of calcResult.surchargeItems) {
      lines.push(`- 서차지 적용: ${sc.weeks}주 해당 (${sc.unitPrice.toLocaleString()}${sc.currency}/주)`)
    }
  }

  if (calcResult.promotionLabel) {
    lines.push(`- 프로모션: ${calcResult.promotionLabel}`)
  }

  if (calcResult.registrationFee) {
    const rf = calcResult.registrationFee
    lines.push(`- 등록비: ${rf.amount.toLocaleString()}${rf.currency}${rf.note ? ` (${rf.note})` : ''}`)
  }
  lines.push(`- 적용 환율: ₱1 = ${rate.phpToKrw}원 / $1 = ${rate.usdToKrw}원`)

  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const { messages, schoolsData, rateData } = await req.json()
    const schools = (schoolsData as School[]) ?? []
    const rate = rateData as ExchangeRate

    const schoolsSummary = schools.map(s => ({
      id: s.id, name: s.name, region: s.region,
      courses:     (s.courses     ?? []).map(c => ({ id: c.id, name: c.name, target: c.target, price: c.pricePerWeek, currency: c.currency })),
      dormitories: (s.dormitories ?? []).map(d => ({ id: d.id, name: d.name, target: d.target, price: d.pricePerWeek, currency: d.currency })),
      surcharges:  (s.surcharges  ?? []).map(sc => ({ label: sc.label, start: sc.startDate, end: sc.endDate, pricePerWeek: sc.pricePerWeek, currency: sc.currency })),
      promotions:  (s.promotions  ?? []).map(p => ({ label: p.label, basisType: p.basisType, start: p.startDate, end: p.endDate, discount: `${p.discountValue}${p.discountType === 'percent' ? '%' : '원'}`, condition: p.condition })),
      minWeeks: s.minWeeks, allowShortTerm: s.allowShortTerm,
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
      return NextResponse.json({ action: 'answer', message: `AI 오류 (${res.status}): ${errText.slice(0, 200)}` }, { status: 500 })
    }

    const aiData = await res.json()
    const rawText = aiData.content?.[0]?.text ?? ''
    console.log('[quote] raw:', rawText.slice(0, 400))

    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    // ── 단일 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'calculate') {
      const school = schools.find(s => s.id === parsed.schoolId)
      if (!school) return NextResponse.json({ action: 'need_info', question: `학원을 찾을 수 없습니다. 아래 학원 중에서 선택해주세요.`, type: 'select', suggestions: schools.map(s => s.name), allowFreeText: false })

      const calcResult = calculateQuote({
        school,
        weeks: Number(parsed.weeks),
        startDate: parsed.startDate as string,
        enrollmentDate: (parsed.enrollmentDate as string) || (parsed.startDate as string),
        courseId: (parsed.courseId as string) || '',
        dormitoryId: (parsed.dormitoryId as string) || '',
      }, rate)

      return NextResponse.json({
        action: 'result',
        message: (parsed.message ? `*${parsed.message}*\n\n` : '') + buildQuoteMessage(school, Number(parsed.weeks), parsed.startDate as string, calcResult),
        evidenceMessage: buildEvidenceMessage(school, Number(parsed.weeks), parsed.startDate as string, calcResult, rate),
        localFees: calcResult.localFees,
        localFeePhp: calcResult.localFeePhp,
        localFeeKrwEstimate: calcResult.localFeeKrwEstimate,
      })
    }

    // ── 복수 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'multi_calculate') {
      type MultiItem = { label: string; schoolId: string; courseId: string; dormitoryId: string; weeks: number; startDate: string; enrollmentDate: string }
      const items = (parsed.items as MultiItem[]) ?? []
      const resultParts: string[] = []
      let combinedLocalFees: LocalFee[] = []
      let totalLocalFeePhp = 0
      let totalLocalFeeKrw = 0
      const evidenceParts: string[] = []

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
        totalLocalFeePhp = Math.max(totalLocalFeePhp, calcResult.localFeePhp)
        totalLocalFeeKrw = Math.max(totalLocalFeeKrw, calcResult.localFeeKrwEstimate)
      }

      return NextResponse.json({
        action: 'result',
        message: resultParts.join('\n\n---\n\n'),
        evidenceMessage: evidenceParts.join('\n\n'),
        localFees: combinedLocalFees,
        localFeePhp: totalLocalFeePhp,
        localFeeKrwEstimate: totalLocalFeeKrw,
      })
    }

    return NextResponse.json(parsed)

  } catch (err) {
    console.error('[quote] error:', err)
    return NextResponse.json({ action: 'answer', message: `오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
