import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, CalcResult } from '@/lib/calcEngine'
import { formatKrw, formatCurrency } from '@/lib/utils'
import type { School, LocalFee, ExchangeRate } from '@/types'

// ── 1차: 파라미터 추출 프롬프트 (규정 제외, 가벼움) ─────────────────────────
const EXTRACT_PROMPT = `당신은 필리핀 어학연수 견적 AI입니다. 엠버시유학 내부 전용 시스템입니다.

[절대 규칙]
- 응답은 JSON 객체 딱 하나만. 두 개 이상 절대 금지.
- 첫 글자 반드시 {, 마지막 글자 반드시 }
- 생각 과정, 설명, 코드블록 전부 금지

[핵심 원칙]
- 코스와 기숙사가 모두 확정되어야만 견적 계산 가능
- 코스 미지정 → 반드시 되물음 (자동 선택 절대 금지)
- 기숙사 미지정 → 반드시 되물음 (자동 선택 절대 금지)
- 학원명이 여러 캠퍼스에 해당될 경우 → 되물음

[가격 구조]
- price4Weeks: 4주 기준 총액
- N주 계산: price4Weeks / 4 × N
- 서차지: 주당 금액 × 해당 주수
- allowShortTerm: true → 1~3주 단기 등록 가능 (effectiveMinWeeks=1), minWeeks와 무관
- allowShortTerm: false → minWeeks 미만 등록 불가

[응답 형식]

단일 견적:
{"action":"calculate","schoolId":"ID","courseId":"코스ID또는이름","dormitoryId":"기숙사ID또는이름","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD","message":"요약"}

복수 견적 (1인실+2인실 등):
{"action":"multi_calculate","items":[{"label":"1인실","schoolId":"ID","courseId":"ID","dormitoryId":"ID","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD"},{"label":"2인실","schoolId":"ID","courseId":"ID","dormitoryId":"ID","weeks":8,"startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD"}]}

정보 부족:
{"action":"need_info","question":"질문","type":"select","suggestions":["선택지1","선택지2"],"allowFreeText":false}

일반 질문 (규정 관련 포함):
{"action":"answer","message":"답변"}

[매칭 규칙]
- 학원명: 부분 일치 (CIA→Cebu CIA, JIC→BAGUIO JIC)
- 날짜 없으면 오늘+30일
- weeks는 반드시 정수`

// ── 2차: 규정 검토 프롬프트 (해당 학원만, 집중적) ───────────────────────────
function buildRegCheckPrompt(school: School, scenario: string): string {
  const hasPolicy = school.refundPolicy || school.dormitoryRules || school.generalNotes
  if (!hasPolicy) return ''

  return `다음 연수 시나리오에 대해 아래 학원 규정을 검토하고, 상담원이 고객에게 반드시 안내해야 할 사항만 간결하게 정리해줘.

[시나리오]
${scenario}

[${school.name} 규정]
${school.refundPolicy ? `환불규정:\n${school.refundPolicy}\n` : ''}
${school.dormitoryRules ? `기숙사규정:\n${school.dormitoryRules}\n` : ''}
${school.generalNotes ? `유의사항:\n${school.generalNotes}\n` : ''}

[응답 형식] — JSON 없이 순수 텍스트로
- 규정상 문제없으면: "규정상 특이사항 없습니다."
- 주의/제한사항 있으면: 항목별로 간결하게
  예: "⚠️ 최소 8주 의무수강 → 6주 견적은 불가합니다."
  예: "ℹ️ 성수기 서차지 기간 환불 시 위약금 규정 별도 적용됩니다."
- 3줄 이내로 핵심만`
}

function extractJson(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()

  // 순수 JSON이면 바로 파싱
  try { return JSON.parse(stripped) } catch {}

  // 첫 번째 완성된 JSON 객체만 추출 (중첩 브라켓 추적)
  let depth = 0
  let start = -1
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      if (depth === 0) start = i
      depth++
    } else if (stripped[i] === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        try {
          return JSON.parse(stripped.slice(start, i + 1))
        } catch { start = -1 }
      }
    }
  }
  return null
}

async function callClaude(system: string, messages: unknown[], maxTokens = 1000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const d = await res.json()
  return d.content?.[0]?.text ?? ''
}

// 규정 검토 2차 호출
async function checkRegulations(school: School, scenario: string): Promise<string> {
  const prompt = buildRegCheckPrompt(school, scenario)
  if (!prompt) return ''
  try {
    const result = await callClaude(prompt, [{ role: 'user', content: '규정을 검토해줘.' }], 400)
    const trimmed = result.trim()
    if (trimmed === '규정상 특이사항 없습니다.' || !trimmed) return ''
    return trimmed
  } catch { return '' }
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
    if (calcResult.promotionDiscount > 0) lines.push(`- 학비+기숙사: **-${formatKrw(calcResult.promotionDiscount)}**`)
    if (calcResult.surchargeDiscount > 0) lines.push(`- 서차지: **-${formatKrw(calcResult.surchargeDiscount)}**`)
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

function buildEvidenceMessage(school: School, weeks: number, calcResult: CalcResult, rate: ExchangeRate): string {
  const lines: string[] = ['**📎 계산 근거**']
  if (calcResult.courseUsed) {
    const c = calcResult.courseUsed
    const p4w = (c as unknown as Record<string,number>).price4Weeks ?? (c as unknown as Record<string,number>).pricePerWeek ?? 0
    const krw = calcResult.items.find(i => i.label.includes('코스'))?.krwAmount ?? 0
    lines.push(`- 코스: ${c.name} — 4주 ${p4w.toLocaleString()}${c.currency} → ${weeks}주 = ${formatKrw(krw)}`)
  }
  if (calcResult.dormUsed) {
    const d = calcResult.dormUsed
    const p4w = (d as unknown as Record<string,number>).price4Weeks ?? (d as unknown as Record<string,number>).pricePerWeek ?? 0
    const krw = calcResult.items.find(i => i.label.includes('기숙사'))?.krwAmount ?? 0
    lines.push(`- 기숙사: ${d.name} — 4주 ${p4w.toLocaleString()}${d.currency} → ${weeks}주 = ${formatKrw(krw)}`)
  }
  for (const sc of calcResult.surchargeItems) lines.push(`- ${sc.label}`)
  if (calcResult.promotionLabel) {
    lines.push(`- 프로모션: ${calcResult.promotionLabel}`)
    if (calcResult.promotionDiscount > 0) lines.push(`  학비+기숙사: -${formatKrw(calcResult.promotionDiscount)}`)
    if (calcResult.surchargeDiscount > 0) lines.push(`  서차지: -${formatKrw(calcResult.surchargeDiscount)}`)
  }
  if (calcResult.registrationFee) {
    const rf = calcResult.registrationFee
    lines.push(`- 등록비: ${(rf.amount ?? 0).toLocaleString()}${rf.currency}`)
  }
  lines.push(`- 환율: ₱1=${rate.phpToKrw}원 / $1=${rate.usdToKrw}원`)
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const { messages, schoolsData, rateData } = await req.json()
    const schools = (schoolsData as School[]) ?? []
    const rate = rateData as ExchangeRate

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ action: 'answer', message: 'API 키 미설정' }, { status: 500 })

    // 1차: 파라미터 추출 (규정 미포함)
    const schoolsSummary = schools.map(s => ({
      id: s.id, name: s.name, region: s.region,
      minWeeks: s.minWeeks,
      allowShortTerm: s.allowShortTerm,   // true이면 1~3주 단기 등록 가능 (minWeeks 무관)
      effectiveMinWeeks: s.allowShortTerm ? 1 : s.minWeeks,  // 실제 최소 주수
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
    }))

    const rawText = await callClaude(
      EXTRACT_PROMPT + `\n\n[학원 데이터]\n${JSON.stringify(schoolsSummary)}\n\n[오늘]\n${new Date().toISOString().split('T')[0]}`,
      messages,
      1200
    )
    console.log('[quote] raw:', rawText.slice(0, 300))

    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    // ── 단일 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'calculate') {
      const school = schools.find(s => s.id === parsed.schoolId)
      if (!school) return NextResponse.json({
        action: 'need_info', question: '학원을 찾을 수 없습니다. 다시 선택해주세요.',
        type: 'select', suggestions: schools.map(s => s.name), allowFreeText: false
      })

      const calcResult = calculateQuote({
        school, weeks: Number(parsed.weeks),
        startDate: parsed.startDate as string,
        enrollmentDate: (parsed.enrollmentDate as string) || (parsed.startDate as string),
        courseId: (parsed.courseId as string) || '',
        dormitoryId: (parsed.dormitoryId as string) || '',
      }, rate)

      const scenario = `학원: ${school.name} / 기간: ${parsed.weeks}주 / 입국: ${parsed.startDate} / 코스: ${calcResult.courseUsed?.name ?? '미정'} / 기숙사: ${calcResult.dormUsed?.name ?? '미정'}`

      // 2차: 규정 검토 (병렬 실행)
      const [quoteMsg, regWarning] = await Promise.all([
        Promise.resolve(buildQuoteMessage(school, Number(parsed.weeks), parsed.startDate as string, calcResult)),
        checkRegulations(school, scenario),
      ])

      return NextResponse.json({
        action: 'result',
        message: (parsed.message ? `*${parsed.message}*\n\n` : '') + quoteMsg,
        regulationWarning: regWarning,  // 별도 표시
        evidenceMessage: buildEvidenceMessage(school, Number(parsed.weeks), calcResult, rate),
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
      let maxLocalFeePhp = 0, maxLocalFeeKrw = 0
      const regWarnings: string[] = []

      await Promise.all(items.map(async (item) => {
        const school = schools.find(s => s.id === item.schoolId)
        if (!school) { resultParts.push(`**${item.label}**: 학원을 찾을 수 없습니다.`); return }
        const calcResult = calculateQuote({
          school, weeks: Number(item.weeks),
          startDate: item.startDate, enrollmentDate: item.enrollmentDate || item.startDate,
          courseId: item.courseId || '', dormitoryId: item.dormitoryId || '',
        }, rate)
        const scenario = `${school.name} / ${item.weeks}주 / 입국: ${item.startDate} / 코스: ${calcResult.courseUsed?.name ?? '미정'} / 기숙사: ${calcResult.dormUsed?.name ?? '미정'} (${item.label})`
        const [qMsg, regWarn] = await Promise.all([
          Promise.resolve(buildQuoteMessage(school, Number(item.weeks), item.startDate, calcResult, item.label)),
          checkRegulations(school, scenario),
        ])
        resultParts.push(qMsg)
        evidenceParts.push(buildEvidenceMessage(school, Number(item.weeks), calcResult, rate))
        if (regWarn) regWarnings.push(regWarn)
        if (combinedLocalFees.length === 0) combinedLocalFees = calcResult.localFees
        maxLocalFeePhp = Math.max(maxLocalFeePhp, calcResult.localFeePhp)
        maxLocalFeeKrw = Math.max(maxLocalFeeKrw, calcResult.localFeeKrwEstimate)
      }))

      return NextResponse.json({
        action: 'result',
        message: resultParts.join('\n\n---\n\n'),
        regulationWarning: regWarnings.join('\n\n'),
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
