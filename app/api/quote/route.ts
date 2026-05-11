import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, CalcResult, CourseItem, DormItem, PackageInput } from '@/lib/calcEngine'
import { formatKrw, formatCurrency } from '@/lib/utils'
import type { School, LocalFee, ExchangeRate } from '@/types'

const EXTRACT_PROMPT = `당신은 필리핀 어학연수 견적 AI입니다. 엠버시유학 내부 전용 시스템입니다.

[절대 규칙]
- 응답은 JSON 객체 딱 하나만. 두 개 이상 절대 금지.
- 첫 글자 반드시 {, 마지막 글자 반드시 }
- 생각 과정, 설명, 코드블록 전부 금지

[필수 확인 항목 — 하나라도 없으면 반드시 되물음]
① 시작일(startDate): 없으면 되물음. "8월 초"→8-04, "8월 중순"→8-11, "8월 말"→8-25 (월요일). 월만 있으면 되물음.
② 코스: 코스/기숙사형 학원에서 코스 미지정 → 반드시 되물음. 학원의 코스 목록 제시.
③ 기숙사: 코스/기숙사형 학원에서 기숙사 미지정 → 반드시 되물음. 기숙사 목록 제시.
④ 주수: 미지정 → 되물음.
※ 자동 선택 절대 금지. 추측 절대 금지.

[패키지형 학원 필수 확인]
- 패키지명(packageId), 주수(weeks), 인원구성(columnLabel) 모두 필요
- 성수기/비수기 판단: 입국일 기준 (7~8월, 1~2월 = 성수기)
- 보호자 수업 포함 여부 → 가격이 다르면 반드시 확인

[유학원 자체 할인]
- 엠버시유학은 학원이 허용하는 한도 내에서 항상 최대 할인 제공
- schoolData의 embassyDiscountKrw 필드에 우리 할인액이 있으면 반드시 적용
- 할인이 적용된 경우 "엠버시유학 자체 할인"으로 표시

[응답 형식]

코스/기숙사 견적:
{"action":"calculate","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD",
 "courses":[{"courseId":"ID","weeks":4}],"dormitories":[{"dormitoryId":"ID","weeks":4}],
 "packages":[],"embassyDiscountKrw":0,"specialNote":"","message":"요약"}

패키지 견적:
{"action":"calculate","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD",
 "courses":[],"dormitories":[],
 "packages":[{"packageId":"패키지ID","weeks":4,"columnLabel":"2인가족"}],
 "embassyDiscountKrw":0,"specialNote":"","message":"요약"}

비교 견적:
{"action":"multi_calculate","items":[...]}

정보 부족:
{"action":"need_info","question":"질문","type":"select","suggestions":["선택지1","선택지2"],"allowFreeText":false}

일반 질문:
{"action":"answer","message":"답변"}

[특이사항 표시]
- specialNote 필드에 특별한 계산 이유 명시
  예: "General Business & BEC 16주: 정가 계산(4주×4=4,400,000)이 아닌 장기할인가 4,000,000 적용"
- 비수기/성수기 전환이 있는 경우 명시
- 서차지가 포함된 경우 기간 명시

[매칭 규칙]
- 학원명: 부분 일치
- courseId/dormitoryId: id 필드 값 우선, 없으면 name으로 매칭
- packageId: 패키지의 id 필드 값
- weeks: 정수`

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

function buildQuoteMessage(school: School, calcResult: CalcResult, totalWeeks: number, embassyDiscount = 0, specialNote = ''): string {
  const lines: string[] = []
  lines.push(`## ${school.name}`)
  lines.push(`**총 ${calcResult.totalWeeks}주**`)
  if (specialNote) lines.push(`\n> ℹ️ ${specialNote}`)
  lines.push('')

  // ── 패키지 ────────────────────────────────────────────────────────────────
  if ((calcResult.packageItems ?? []).length > 0) {
    const pkgTotal = calcResult.packageItems.reduce((s, p) => s + p.totalKrw, 0)
    lines.push('**📦 패키지 구성**')
    for (const pi of calcResult.packageItems) {
      lines.push(`- ${pi.pkg.label} / ${pi.columnLabel} / ${pi.weeks}주: **${formatKrw(pi.baseAmount)}**`)
      for (const r of pi.appliedRules) lines.push(`  *(추가: ${r})*`)
      if (pi.additionalAmount > 0) lines.push(`  추가: +${formatKrw(pi.additionalAmount)}`)
    }
    lines.push(`**패키지 소계: ${formatKrw(pkgTotal)}**`)

    const firstPkg = calcResult.packageItems[0]?.pkg
    if (firstPkg?.includes) {
      lines.push('\n✅ **포함**')
      firstPkg.includes.split('\n').slice(0, 5).forEach(s => { if (s.trim()) lines.push(`  - ${s.trim()}`) })
      if (firstPkg.includes.split('\n').filter(s=>s.trim()).length > 5) lines.push(`  - *(외 ${firstPkg.includes.split('\n').filter(s=>s.trim()).length - 5}개)*`)
    }
    if (firstPkg?.excludes) {
      lines.push('\n❌ **불포함**')
      firstPkg.excludes.split('\n').slice(0, 3).forEach(s => { if (s.trim()) lines.push(`  - ${s.trim()}`) })
    }
    if (firstPkg?.note) lines.push(`\n> ${firstPkg.note}`)
  }

  // ── 코스(학비) ────────────────────────────────────────────────────────────
  const courseTotalKrw = (calcResult.courseItems ?? []).reduce((s, i) => s + i.krwAmount, 0)
  if ((calcResult.courseItems ?? []).length > 0) {
    lines.push('\n**📚 학비 상세**')
    for (const item of calcResult.courseItems) {
      lines.push(`- ${item.label}: ${formatKrw(item.krwAmount)}`)
      if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
    }
    lines.push(`**학비 소계: ${formatKrw(courseTotalKrw)}**`)
  }

  // ── 기숙사 ───────────────────────────────────────────────────────────────
  const dormTotalKrw = (calcResult.dormItems ?? []).reduce((s, i) => s + i.krwAmount, 0)
  if ((calcResult.dormItems ?? []).length > 0) {
    lines.push('\n**🏠 기숙사비 상세**')
    for (const item of calcResult.dormItems) {
      lines.push(`- ${item.label}: ${formatKrw(item.krwAmount)}`)
      if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
    }
    lines.push(`**기숙사 소계: ${formatKrw(dormTotalKrw)}**`)
  }

  // ── 서차지 ────────────────────────────────────────────────────────────────
  if ((calcResult.surchargeItems ?? []).length > 0) {
    lines.push('\n**🔥 성수기 서차지**')
    for (const sc of calcResult.surchargeItems)
      lines.push(`- ${sc.label}: +${formatKrw(sc.krwAmount)}`)
  }

  // ── 할인 ─────────────────────────────────────────────────────────────────
  const totalPromoDiscount = calcResult.promotionDiscount + calcResult.surchargeDiscount
  if (calcResult.promotionLabel && totalPromoDiscount > 0) {
    lines.push(`\n**🎁 학원 프로모션: ${calcResult.promotionLabel}**`)
    if (calcResult.promotionDiscount > 0) lines.push(`- 할인: -${formatKrw(calcResult.promotionDiscount)}`)
    if (calcResult.surchargeDiscount > 0) lines.push(`- 서차지 할인: -${formatKrw(calcResult.surchargeDiscount)}`)
  }

  // 유학원 자체 할인
  if (embassyDiscount > 0) {
    lines.push(`\n**✂️ 엠버시유학 자체 할인: -${formatKrw(embassyDiscount)}**`)
  }

  // ── 등록비 ───────────────────────────────────────────────────────────────
  if (calcResult.registrationFee && calcResult.registrationFeeKrw > 0) {
    const rf = calcResult.registrationFee
    lines.push(`\n**📋 등록비 (1회)**: ${rf.currency === 'KRW' ? formatKrw(rf.amount) : formatCurrency(rf.amount, rf.currency)}${rf.note ? ` *(${rf.note})*` : ''}`)
  }

  // ── 총합 ─────────────────────────────────────────────────────────────────
  const finalTotal = calcResult.totalKrw - embassyDiscount
  lines.push('\n---')
  if (embassyDiscount > 0 || calcResult.registrationFeeKrw > 0 ||
      (calcResult.courseItems?.length && calcResult.dormItems?.length)) {
    lines.push('**💰 비용 요약**')
    if (calcResult.registrationFeeKrw > 0) lines.push(`  등록비: ${formatKrw(calcResult.registrationFeeKrw)}`)
    if (courseTotalKrw > 0) lines.push(`  학비 합계: ${formatKrw(courseTotalKrw)}`)
    if (dormTotalKrw > 0)   lines.push(`  기숙사 합계: ${formatKrw(dormTotalKrw)}`)
    if ((calcResult.packageItems?.length ?? 0) > 0) {
      const pt = calcResult.packageItems.reduce((s,p) => s+p.totalKrw, 0)
      lines.push(`  패키지 합계: ${formatKrw(pt)}`)
    }
    if ((calcResult.surchargeItems?.length ?? 0) > 0) {
      lines.push(`  서차지: +${formatKrw(calcResult.surchargeKrw)}`)
    }
    if (totalPromoDiscount > 0) lines.push(`  프로모션 할인: -${formatKrw(totalPromoDiscount)}`)
    if (embassyDiscount > 0) lines.push(`  엠버시 할인: -${formatKrw(embassyDiscount)}`)
    lines.push('')
  }
  lines.push(`### 🏆 **연수비용 총합: ${formatKrw(finalTotal)}**`)
  lines.push('*(현지납부비 별도 — 아래에서 확인)*')

  if (calcResult.warnings.length > 0) lines.push('\n' + calcResult.warnings.join('\n'))
  if (calcResult.notes.length > 0)   lines.push('\n' + calcResult.notes.join('\n'))

  return lines.join('\n')
}

function buildEvidenceMessage(school: School, calcResult: CalcResult, rate: ExchangeRate): string {
  const lines: string[] = ['**📎 계산 근거**']
  for (const pi of (calcResult.packageItems ?? [])) {
    lines.push(`- 패키지: ${pi.pkg.label} / ${pi.columnLabel} / ${pi.weeks}주 = ${formatKrw(pi.baseAmount)}`)
    if (pi.additionalAmount > 0) lines.push(`  추가규정: +${formatKrw(pi.additionalAmount)}`)
  }
  for (const item of (calcResult.courseItems ?? [])) lines.push(`- ${item.label} = ${formatKrw(item.krwAmount)}`)
  for (const item of (calcResult.dormItems ?? []))   lines.push(`- ${item.label} = ${formatKrw(item.krwAmount)}`)
  lines.push(`- 총 ${calcResult.totalWeeks}주 기준`)
  for (const sc of (calcResult.surchargeItems ?? [])) lines.push(`- ${sc.label}`)
  if (calcResult.promotionLabel) {
    lines.push(`- 프로모션: ${calcResult.promotionLabel}`)
    if (calcResult.promotionDiscount > 0) lines.push(`  할인: -${formatKrw(calcResult.promotionDiscount)}`)
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
  packages?: PackageInput[]
}

function runCalc(school: School, item: CalcInputItem, rate: ExchangeRate): CalcResult {
  return calculateQuote({
    school,
    startDate: item.startDate,
    enrollmentDate: item.enrollmentDate || item.startDate,
    courses: (item.courses ?? []).map(c => ({ courseId: c.courseId, weeks: Number(c.weeks) })),
    dormitories: (item.dormitories ?? []).map(d => ({ dormitoryId: d.dormitoryId, weeks: Number(d.weeks) })),
    packages: (item.packages ?? []).map(p => ({
      packageId: p.packageId, weeks: Number(p.weeks),
      columnLabel: p.columnLabel, additionalRuleIds: p.additionalRuleIds,
    })),
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
      hasPackages: (s.packages ?? []).length > 0,
      courses: (s.courses ?? []).map(c => ({
        id: c.id, name: c.name, target: c.target,
        price4Weeks: (c as unknown as Record<string,number>).price4Weeks ?? 0,
        currency: c.currency,
      })),
      dormitories: (s.dormitories ?? []).map(d => ({
        id: d.id, name: d.name, target: d.target,
        price4Weeks: (d as unknown as Record<string,number>).price4Weeks ?? 0,
        currency: d.currency,
      })),
      packages: (s.packages ?? []).map(p => ({
        id: p.id,
        label: p.label,
        season: p.season ?? '',
        currency: p.currency,
        columns: p.columns ?? [],
        availableWeeks: (p.priceMatrix ?? []).map(r => r.weeks),
        samplePrices: (p.priceMatrix ?? []).slice(0, 2).map(r =>
          `${r.weeks}주: ${(r.prices ?? []).map(c => `${c.label} ${(c.amount/10000).toFixed(0)}만원`).join(', ')}`
        ).join(' / '),
        additionalRules: (p.additionalRules ?? []).map(r => ({
          id: r.id, condition: r.condition, addAmount: r.addAmount, currency: r.currency,
        })),
      })),
      surcharges: (s.surcharges ?? []).map(sc => ({ label: sc.label, start: sc.startDate, end: sc.endDate, pricePerWeek: sc.pricePerWeek, currency: sc.currency })),
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

      const embassyDiscount = Number(parsed.embassyDiscountKrw ?? 0)
      const specialNote = (parsed.specialNote as string) ?? ''

      const calcResult = runCalc(school, {
        schoolId: parsed.schoolId as string,
        startDate: parsed.startDate as string,
        enrollmentDate: parsed.enrollmentDate as string,
        courses: (parsed.courses as CourseItem[]) ?? [],
        dormitories: (parsed.dormitories as DormItem[]) ?? [],
        packages: (parsed.packages as PackageInput[]) ?? [],
      }, rate)

      // 현지납부비 필터링: 총 주수 기준으로 실제 발생하는 항목만
      const filteredLocalFees = (calcResult.localFees ?? []).filter(lf => {
        const t = lf.trigger ?? 'always'
        if (t === 'optional') return true // 선택 항목은 항상 표시
        if (t === 'always') return true
        if (t === 'per_week' || t === 'per_4weeks') return true
        if (t === 'over_weeks') {
          return calcResult.totalWeeks > (lf.triggerWeeks ?? 4)
        }
        return true
      })

      const courseSummary = calcResult.courseItems.map(i => i.label).join(', ')
      const dormSummary   = calcResult.dormItems.map(i => i.label).join(', ')
      const scenario = `${school.name} / 총 ${calcResult.totalWeeks}주 / 입국: ${parsed.startDate}\n코스: ${courseSummary || '패키지'}\n기숙사: ${dormSummary || '-'}`

      const regWarning = await checkRegulations(school, scenario)

      return NextResponse.json({
        action: 'result',
        message: (parsed.message ? `*${parsed.message}*\n\n` : '') +
          buildQuoteMessage(school, calcResult, calcResult.totalWeeks, embassyDiscount, specialNote),
        regulationWarning: regWarning,
        evidenceMessage: buildEvidenceMessage(school, calcResult, rate),
        localFees: filteredLocalFees,
        localFeePhp: calcResult.localFeePhp,
        localFeeKrwEstimate: calcResult.localFeeKrwEstimate,
        weeksForFees: calcResult.totalWeeks,
        startDate: parsed.startDate,
        totalWeeks: calcResult.totalWeeks,
        surchargeItems: calcResult.surchargeItems.map(s => ({ label: s.label, weeks: s.weeks })),
        calcResult,
        schoolData: school,
        schoolId: school.id,
        embassyDiscount,
        specialNote,
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
        resultParts.push(`### ${item.label}\n` + buildQuoteMessage(school, calcResult, calcResult.totalWeeks))
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
