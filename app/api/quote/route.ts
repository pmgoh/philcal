import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, CalcResult, CourseItem, DormItem } from '@/lib/calcEngine'
import { formatKrw, formatCurrency } from '@/lib/utils'
import type { School, LocalFee, ExchangeRate } from '@/types'

const EXTRACT_PROMPT = `당신은 필리핀 어학연수 견적 AI입니다. 엠버시유학 내부 전용 시스템입니다.

[절대 규칙]
- 응답은 JSON 객체 딱 하나만. 두 개 이상 절대 금지.
- 첫 글자 반드시 {, 마지막 글자 반드시 }
- 생각 과정, 설명, 코드블록 전부 금지

[핵심 원칙]
- 코스와 기숙사 모두 확정되어야 견적 계산 가능
- 코스 미지정 → 반드시 되물음 (자동 선택 절대 금지)
- 기숙사 미지정 → 반드시 되물음 (자동 선택 절대 금지)

[코스/기숙사 독립 구조]
- 코스와 기숙사는 완전히 독립 계산
- 주수가 달라도 됨 (코스 총 9주, 기숙사 총 8주 가능)
- 등록비는 한 번만
- 단기가 판단: max(코스주수합, 기숙사주수합) 기준

[단기가 원칙]
- 단기가는 총 연수기간(totalWeeks)이 4주 미만일 때만
- 개별 항목 주수가 아닌 전체 합산 기준

[응답 형식]

단일 or 복수 코스/기숙사 견적:
{"action":"calculate","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD",
 "courses":[{"courseId":"ID","weeks":4},{"courseId":"ID","weeks":8}],
 "dormitories":[{"dormitoryId":"ID","weeks":6},{"dormitoryId":"ID","weeks":6}],
 "message":"요약"}

비교 견적 (1인실 vs 2인실 등 옵션 비교):
{"action":"multi_calculate","items":[
  {"label":"1인실","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD","courses":[{"courseId":"ID","weeks":8}],"dormitories":[{"dormitoryId":"ID","weeks":8}]},
  {"label":"2인실","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD","courses":[{"courseId":"ID","weeks":8}],"dormitories":[{"dormitoryId":"ID","weeks":8}]}
]}

정보 부족:
{"action":"need_info","question":"질문","type":"select","suggestions":["선택지1","선택지2"],"allowFreeText":false}

일반 질문:
{"action":"answer","message":"답변"}

[매칭 규칙]
- 학원명: 부분 일치
- 날짜 없으면 오늘+30일
- weeks는 반드시 정수`

function extractJson(text: string): Record<string, unknown> | null {
  const stripped = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()
  try { return JSON.parse(stripped) } catch {}
  let depth = 0, start = -1
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') { if (depth === 0) start = i; depth++ }
    else if (stripped[i] === '}') {
      depth--
      if (depth === 0 && start !== -1) {
        try { return JSON.parse(stripped.slice(start, i + 1)) } catch { start = -1 }
      }
    }
  }
  return null
}

async function callClaude(system: string, messages: unknown[], maxTokens = 1000): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  return (await res.json()).content?.[0]?.text ?? ''
}

async function checkRegulations(school: School, scenario: string): Promise<string> {
  if (!school.refundPolicy && !school.dormitoryRules && !school.generalNotes) return ''
  const prompt = `연수 시나리오를 검토하고 상담원이 반드시 안내해야 할 사항만 간결하게 정리해줘.

[시나리오]\n${scenario}

[${school.name} 규정]
${school.refundPolicy   ? `환불규정:\n${school.refundPolicy}\n`   : ''}${school.dormitoryRules ? `기숙사규정:\n${school.dormitoryRules}\n` : ''}${school.generalNotes   ? `유의사항:\n${school.generalNotes}\n`   : ''}

문제없으면 "규정상 특이사항 없습니다." 한 줄만. 주의사항 있으면 3줄 이내.`
  try {
    const r = (await callClaude(prompt, [{ role: 'user', content: '검토해줘.' }], 300)).trim()
    return r === '규정상 특이사항 없습니다.' ? '' : r
  } catch { return '' }
}

function buildQuoteMessage(school: School, calcResult: CalcResult): string {
  const lines: string[] = []
  lines.push(`## ${school.name}`)
  const weeksDesc = calcResult.courseTotalWeeks === calcResult.dormTotalWeeks
    ? `총 ${calcResult.totalWeeks}주`
    : `코스 ${calcResult.courseTotalWeeks}주 / 기숙사 ${calcResult.dormTotalWeeks}주`
  lines.push(`**${weeksDesc}**`)
  lines.push('')

  if (calcResult.courseItems.length > 0) {
    lines.push('**학비**')
    for (const item of calcResult.courseItems) {
      lines.push(`- ${item.label}: **${formatKrw(item.krwAmount)}**`)
      if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
    }
  }

  if (calcResult.dormItems.length > 0) {
    lines.push('\n**기숙사**')
    for (const item of calcResult.dormItems) {
      lines.push(`- ${item.label}: **${formatKrw(item.krwAmount)}**`)
      if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
    }
  }

  if (calcResult.surchargeItems.length > 0) {
    lines.push('\n**성수기 서차지**')
    for (const sc of calcResult.surchargeItems)
      lines.push(`- ${sc.label}: **+${formatKrw(sc.krwAmount)}**`)
  }

  const totalDiscount = calcResult.promotionDiscount + calcResult.surchargeDiscount
  if (calcResult.promotionLabel && totalDiscount > 0) {
    lines.push(`\n**유학원 할인: ${calcResult.promotionLabel}**`)
    if (calcResult.promotionDiscount > 0) lines.push(`- 학비+기숙사: **-${formatKrw(calcResult.promotionDiscount)}**`)
    if (calcResult.surchargeDiscount > 0) lines.push(`- 서차지: **-${formatKrw(calcResult.surchargeDiscount)}**`)
  }

  if (calcResult.registrationFee && calcResult.registrationFeeKrw > 0) {
    const rf = calcResult.registrationFee
    lines.push(`\n**등록비 (1회)**: ${rf.currency === 'KRW' ? formatKrw(rf.amount) : formatCurrency(rf.amount, rf.currency)}${rf.note ? ` *(${rf.note})*` : ''}`)
  }

  lines.push('\n---')
  lines.push(`### 💰 총 견적: **${formatKrw(calcResult.totalKrw)}**`)
  lines.push('*(현지납부비 별도 — 아래 버튼에서 확인)*')

  if (calcResult.warnings.length > 0) lines.push('\n' + calcResult.warnings.join('\n'))
  if (calcResult.notes.length > 0)   lines.push('\n' + calcResult.notes.join('\n'))

  return lines.join('\n')
}

function buildEvidenceMessage(school: School, calcResult: CalcResult, rate: ExchangeRate): string {
  const lines: string[] = ['**📎 계산 근거**']
  for (const item of calcResult.courseItems) {
    lines.push(`- ${item.label} = ${formatKrw(item.krwAmount)}`)
  }
  for (const item of calcResult.dormItems) {
    lines.push(`- ${item.label} = ${formatKrw(item.krwAmount)}`)
  }
  lines.push(`- 총 ${calcResult.totalWeeks}주 기준 (단기가 ${calcResult.totalWeeks < 4 && school.allowShortTerm ? '적용' : '미적용'})`)
  for (const sc of calcResult.surchargeItems) lines.push(`- ${sc.label}`)
  if (calcResult.promotionLabel) {
    lines.push(`- 프로모션: ${calcResult.promotionLabel}`)
    if (calcResult.promotionDiscount > 0) lines.push(`  학비+기숙사: -${formatKrw(calcResult.promotionDiscount)}`)
    if (calcResult.surchargeDiscount > 0) lines.push(`  서차지: -${formatKrw(calcResult.surchargeDiscount)}`)
  }
  if (calcResult.registrationFee) lines.push(`- 등록비: ${(calcResult.registrationFee.amount??0).toLocaleString()}${calcResult.registrationFee.currency} (1회)`)
  lines.push(`- 환율: ₱1=${rate.phpToKrw}원 / $1=${rate.usdToKrw}원`)
  return lines.join('\n')
}

type CalcInputItem = {
  label?: string
  schoolId: string
  startDate: string
  enrollmentDate?: string
  courses: CourseItem[]
  dormitories: DormItem[]
}

function runCalc(school: School, item: CalcInputItem, rate: ExchangeRate): CalcResult {
  return calculateQuote({
    school,
    startDate: item.startDate,
    enrollmentDate: item.enrollmentDate || item.startDate,
    courses: (item.courses ?? []).map(c => ({ courseId: c.courseId, weeks: Number(c.weeks) })),
    dormitories: (item.dormitories ?? []).map(d => ({ dormitoryId: d.dormitoryId, weeks: Number(d.weeks) })),
  }, rate)
}

export async function POST(req: NextRequest) {
  try {
    const { messages, schoolsData, rateData } = await req.json()
    const schools = (schoolsData as School[]) ?? []
    const rate = rateData as ExchangeRate

    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ action: 'answer', message: 'API 키 미설정' }, { status: 500 })

    const schoolsSummary = schools.map(s => ({
      id: s.id, name: s.name, region: s.region,
      minWeeks: s.minWeeks, allowShortTerm: s.allowShortTerm,
      effectiveMinWeeks: s.allowShortTerm ? 1 : s.minWeeks,
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
      surcharges: (s.surcharges ?? []).map(sc => ({ label: sc.label, start: sc.startDate, end: sc.endDate, pricePerWeek: sc.pricePerWeek, currency: sc.currency, discountAllowed: sc.discountAllowed })),
      promotions: (s.promotions ?? []).map(p => ({ label: p.label, basisType: p.basisType, start: p.startDate, end: p.endDate, discount: `${p.discountValue}${p.discountType==='percent'?'%':p.currency??'KRW'}`, condition: p.condition })),
    }))

    const rawText = await callClaude(
      EXTRACT_PROMPT + `\n\n[학원 데이터]\n${JSON.stringify(schoolsSummary)}\n\n[오늘]\n${new Date().toISOString().split('T')[0]}`,
      messages, 1500
    )
    console.log('[quote] raw:', rawText.slice(0, 300))

    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    // ── 단일 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'calculate') {
      const school = schools.find(s => s.id === parsed.schoolId)
      if (!school) return NextResponse.json({ action: 'need_info', question: '학원을 찾을 수 없습니다.', type: 'select', suggestions: schools.map(s => s.name), allowFreeText: false })

      const calcResult = runCalc(school, {
        schoolId: parsed.schoolId as string,
        startDate: parsed.startDate as string,
        enrollmentDate: parsed.enrollmentDate as string,
        courses: parsed.courses as CourseItem[],
        dormitories: parsed.dormitories as DormItem[],
      }, rate)

      const courseSummary = calcResult.courseItems.map(i => i.label).join(', ')
      const dormSummary   = calcResult.dormItems.map(i => i.label).join(', ')
      const scenario = `${school.name} / 총 ${calcResult.totalWeeks}주 / 입국: ${parsed.startDate}\n코스: ${courseSummary}\n기숙사: ${dormSummary}`

      const regWarning = await checkRegulations(school, scenario)

      return NextResponse.json({
        action: 'result',
        message: (parsed.message ? `*${parsed.message}*\n\n` : '') + buildQuoteMessage(school, calcResult),
        regulationWarning: regWarning,
        evidenceMessage: buildEvidenceMessage(school, calcResult, rate),
        localFees: calcResult.localFees,
        localFeePhp: calcResult.localFeePhp,
        localFeeKrwEstimate: calcResult.localFeeKrwEstimate,
        weeksForFees: calcResult.totalWeeks,
        startDate: parsed.startDate,
        totalWeeks: calcResult.totalWeeks,
        surchargeItems: calcResult.surchargeItems.map(s => ({ label: s.label, weeks: s.weeks })),
      })
    }

    // ── 비교 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'multi_calculate') {
      const items = (parsed.items as CalcInputItem[]) ?? []
      const resultParts: string[] = []
      const evidenceParts: string[] = []
      let combinedLocalFees: LocalFee[] = []
      let maxPhp = 0, maxKrw = 0

      await Promise.all(items.map(async (item) => {
        const school = schools.find(s => s.id === item.schoolId)
        if (!school) { resultParts.push(`**${item.label}**: 학원을 찾을 수 없습니다.`); return }
        const calcResult = runCalc(school, item, rate)
        resultParts.push(`### ${item.label}\n` + buildQuoteMessage(school, calcResult))
        evidenceParts.push(buildEvidenceMessage(school, calcResult, rate))
        if (!combinedLocalFees.length) combinedLocalFees = calcResult.localFees
        maxPhp = Math.max(maxPhp, calcResult.localFeePhp)
        maxKrw = Math.max(maxKrw, calcResult.localFeeKrwEstimate)
      }))

      return NextResponse.json({
        action: 'result',
        message: resultParts.join('\n\n---\n\n'),
        evidenceMessage: evidenceParts.join('\n\n'),
        localFees: combinedLocalFees,
        localFeePhp: maxPhp,
        localFeeKrwEstimate: maxKrw,
      })
    }

    return NextResponse.json(parsed)

  } catch (err) {
    console.error('[quote] error:', err)
    return NextResponse.json({ action: 'answer', message: `오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
