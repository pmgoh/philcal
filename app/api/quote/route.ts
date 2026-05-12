import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, CalcResult, CourseItem, DormItem, PackageInput } from '@/lib/calcEngine'
import { formatKrw, formatCurrency } from '@/lib/utils'
import type { School, LocalFee, ExchangeRate } from '@/types'

const EXTRACT_PROMPT = `엠버시유학 내부 견적 계산 시스템입니다. 사용자는 상담원입니다.

[태도]
- 상담원이 쓰는 내부 도구. 고객 응대 말투 금지.
- "죄송합니다", "담당자 확인 필요" 같은 말 절대 금지.
- 군더더기 없이 바로 계산 결과 또는 필요한 정보 요청.
- 상담원은 학원·코스를 잘 알고 있음. 과도한 설명 불필요.

[계산 규칙]
- 응답은 JSON 하나만. { 로 시작 } 로 끝.
- 코드블록, 설명 텍스트 금지.

[필수 확인 — 없으면 짧게 물어볼 것]
① 시작일: "8월 초"→8-04, "8월 중순"→8-11, "8월 말"→8-25. 월만이면 되물음.
② 코스: 미지정 → 코스 목록 제시 (기숙사와 절대 조합 금지)
③ 기숙사: 코스 확인 후 미지정 → 기숙사 목록 제시
④ 주수: 미지정 → 되물음
※ 복합 기숙사(주수별 다른 기숙사) 가능 — 그대로 계산
※ 자동 선택 금지. 추측 금지.

[패키지형]
- packageId + weeks + columnLabel 필요
- 성수기: 7~8월, 1~2월 입국 기준

[비교 요청]
- "비교", "최저가", "어디가 싸" 등 → multi_calculate
- 코스/기숙사 미지정 시 먼저 물어볼 것

[응답 형식]

코스/기숙사 견적:
{"action":"calculate","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD",
 "courses":[{"courseId":"ID","weeks":4}],
 "dormitories":[
   {"dormitoryId":"ID1","weeks":2},
   {"dormitoryId":"ID2","weeks":1},
   {"dormitoryId":"ID3","weeks":1}
 ],
 "packages":[],"specialNote":"복합기숙사 등 특이사항","message":"한줄 요약"}

패키지 견적:
{"action":"calculate","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD",
 "courses":[],"dormitories":[],
 "packages":[{"packageId":"ID","weeks":4,"columnLabel":"보호자1+자녀1"}],
 "specialNote":"","message":""}

비교:
{"action":"multi_calculate","items":[
  {"schoolId":"ID1","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD","courses":[...],"dormitories":[...],"packages":[],"specialNote":"","message":""},
  {"schoolId":"ID2",...}
]}

정보 부족:
{"action":"need_info","question":"코스 선택","type":"select","suggestions":["Regular ESL (90만/4주)"],"allowFreeText":false}

답변:
{"action":"answer","message":"답변"}

[매칭]
- 학원명 부분 일치
- courseId/dormitoryId: id 우선, 없으면 name
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

function buildQuoteMessage(school: School, calcResult: CalcResult, _totalWeeks: number, specialNote = ''): string {
  const lines: string[] = []
  lines.push(`## ${school.name}`)
  lines.push(`**총 ${calcResult.totalWeeks}주**`)
  if (specialNote) lines.push(`\n> ℹ️ ${specialNote}`)
  lines.push('')

  // ── 패키지 ──
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
      if (firstPkg.includes.split('\n').filter(s=>s.trim()).length > 5)
        lines.push(`  - *(외 ${firstPkg.includes.split('\n').filter(s=>s.trim()).length - 5}개)*`)
    }
    if (firstPkg?.excludes) {
      lines.push('\n❌ **불포함**')
      firstPkg.excludes.split('\n').slice(0, 3).forEach(s => { if (s.trim()) lines.push(`  - ${s.trim()}`) })
    }
    if (firstPkg?.note) lines.push(`\n> ${firstPkg.note}`)
  }

  // ── 코스 ──
  const courseTotalKrw = (calcResult.courseItems ?? []).reduce((s, i) => s + i.krwAmount, 0)
  if ((calcResult.courseItems ?? []).length > 0) {
    lines.push('\n**📚 학비 상세**')
    for (const item of calcResult.courseItems) {
      lines.push(`- ${item.label}: ${formatKrw(item.krwAmount)}`)
      if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
    }
    lines.push(`**학비 소계: ${formatKrw(courseTotalKrw)}**`)
  }

  // ── 기숙사 ──
  const dormTotalKrw = (calcResult.dormItems ?? []).reduce((s, i) => s + i.krwAmount, 0)
  if ((calcResult.dormItems ?? []).length > 0) {
    lines.push('\n**🏠 기숙사비 상세**')
    for (const item of calcResult.dormItems) {
      lines.push(`- ${item.label}: ${formatKrw(item.krwAmount)}`)
      if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
    }
    lines.push(`**기숙사 소계: ${formatKrw(dormTotalKrw)}**`)
  }

  // ── 서차지 ──
  if ((calcResult.surchargeItems ?? []).length > 0) {
    lines.push('\n**🔥 성수기 서차지**')
    for (const sc of calcResult.surchargeItems)
      lines.push(`- ${sc.label}: +${formatKrw(sc.krwAmount)}`)
  }

  // ── 할인 블록 (학원 프로모션 + 엠버시 자체) ──
  const totalPromoDiscount = calcResult.promotionDiscount + calcResult.surchargeDiscount
  const agencyDiscount = calcResult.agencyDiscountKrw ?? 0
  const totalAllDiscount = totalPromoDiscount + agencyDiscount

  if (totalAllDiscount > 0) {
    lines.push('\n**🎁 할인 내역**')
    if (calcResult.promotionLabel && totalPromoDiscount > 0) {
      lines.push(`- 학원 프로모션 (${calcResult.promotionLabel}): -${formatKrw(totalPromoDiscount)}`)
    }
    if (agencyDiscount > 0) {
      // 엠버시 할인은 강조 마커로 구분 (UI에서 빨간색으로 렌더링)
      lines.push(`- !!AGENCY_DISCOUNT!!엠버시유학 자체 할인${calcResult.agencyDiscountNote ? ` (${calcResult.agencyDiscountNote})` : ''}: -${formatKrw(agencyDiscount)}`)
    }
    lines.push(`- **총 할인: -${formatKrw(totalAllDiscount)}**`)
  }

  // ── 등록비 ──
  if (calcResult.registrationFee && calcResult.registrationFeeKrw > 0) {
    const rf = calcResult.registrationFee
    lines.push(`\n**📋 등록비 (1회)**: ${rf.currency === 'KRW' ? formatKrw(rf.amount) : formatCurrency(rf.amount, rf.currency)}${rf.note ? ` *(${rf.note})*` : ''}`)
  }

  // ── 비용 요약 + 총합 ──
  lines.push('\n---')
  lines.push('**💰 비용 요약**')
  if (calcResult.registrationFeeKrw > 0) lines.push(`  등록비: ${formatKrw(calcResult.registrationFeeKrw)}`)
  if (courseTotalKrw > 0)  lines.push(`  학비 합계: ${formatKrw(courseTotalKrw)}`)
  if (dormTotalKrw > 0)    lines.push(`  기숙사 합계: ${formatKrw(dormTotalKrw)}`)
  if ((calcResult.packageItems?.length ?? 0) > 0)
    lines.push(`  패키지 합계: ${formatKrw(calcResult.packageItems.reduce((s,p)=>s+p.totalKrw,0))}`)
  if ((calcResult.surchargeItems?.length ?? 0) > 0)
    lines.push(`  서차지: +${formatKrw(calcResult.surchargeKrw)}`)
  if (totalPromoDiscount > 0) lines.push(`  학원 프로모션: -${formatKrw(totalPromoDiscount)}`)
  if (agencyDiscount > 0)     lines.push(`  !!AGENCY_DISCOUNT!!엠버시 할인: -${formatKrw(agencyDiscount)}`)
  lines.push('')
  lines.push(`### 🏆 **연수비용 총합: ${formatKrw(calcResult.totalKrw)}**`)
  if (agencyDiscount > 0)
    lines.push(`> 💡 엠버시유학 할인 **${formatKrw(agencyDiscount)}** 적용된 가격입니다`)
  lines.push('*(현지납부비 별도 — 아래에서 확인)*')

  if (calcResult.warnings.length > 0) lines.push('\n' + calcResult.warnings.join('\n'))
  if (calcResult.notes.length > 0)    lines.push('\n' + calcResult.notes.join('\n'))

  return lines.join('\n')
}

function buildDiscountEvidence(school: School, calc: CalcResult): string {
  const lines: string[] = ['**📎 할인 근거**']

  const promoDiscount = calc.promotionDiscount + calc.surchargeDiscount
  const agencyDiscount = calc.agencyDiscountKrw ?? 0

  if (!promoDiscount && !agencyDiscount) {
    lines.push('- 적용된 할인 없음')
    return lines.join('\n')
  }

  if (calc.promotionLabel && promoDiscount > 0) {
    const matchedPromo = (school.promotions ?? []).find(p => p.label === calc.promotionLabel)
    lines.push(`**학원 프로모션: ${calc.promotionLabel}**`)
    if (matchedPromo) {
      lines.push(`- 기준: ${matchedPromo.basisType === 'enrollment_date' ? '등록일' : '연수 시작일'}`)
      if (!matchedPromo.alwaysApply) lines.push(`- 기간: ${matchedPromo.startDate} ~ ${matchedPromo.endDate}`)
      lines.push(`- 방식: ${matchedPromo.discountType === 'percent' ? `${matchedPromo.discountValue}%` : formatKrw(matchedPromo.discountValue)}`)
      if (matchedPromo.condition) lines.push(`- 조건: ${matchedPromo.condition}`)
      if (matchedPromo.note) lines.push(`- 비고: ${matchedPromo.note}`)
    }
    lines.push(`- 프로모션 할인: **-${formatKrw(promoDiscount)}**`)
  }

  if (agencyDiscount > 0) {
    lines.push(`**엠버시유학 자체 할인**`)
    if (calc.agencyDiscountNote) lines.push(`- 근거: ${calc.agencyDiscountNote}`)
    lines.push(`- 엠버시 할인: **-${formatKrw(agencyDiscount)}**`)
  }

  lines.push(`총 할인: **-${formatKrw(promoDiscount + agencyDiscount)}**`)
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
  schoolId: string
  schoolName?: string
  startDate: string
  enrollmentDate?: string
  courses: CourseItem[]
  dormitories: DormItem[]
  packages?: PackageInput[]
  specialNote?: string
  message?: string
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

    // ── 대화 컨텍스트로 학원 필터링 ─────────────────────────────────────────
    const allText = (messages as {role:string; content:string}[])
      .map(m => m.content).join(' ').toLowerCase()

    // 1단계: 프로그램 유형 감지
    const isCamp    = /캠프|주니어캠프|여름캠프|겨울캠프|camp/.test(allText)
    const isFamily  = /가족연수|가족|주니어|아이|어머니|부모|아들|딸|자녀|family/.test(allText) && !isCamp
    const isAdult   = /성인|일반연수|어학연수|혼자|성인연수|adult|solo/.test(allText) ||
                      (!isCamp && !isFamily)

    // 2단계: 지역 감지
    const isCebu    = /세부|cebu/.test(allText)
    const isBaguio  = /바기오|baguio/.test(allText)
    const isOther   = /마닐라|클락|보라카이|일로일로|기타|manila|clark|boracay|iloilo/.test(allText)
    const noRegion  = !isCebu && !isBaguio && !isOther

    // 3단계: 필터 적용
    let filtered = schools.filter(s => {
      const tags = (s.programTags ?? []).join(' ').toLowerCase()
      const name = s.name.toLowerCase()

      // 프로그램 유형 필터
      if (isCamp && !isFamily && !isAdult) {
        if (!/캠프|camp|주니어|junior/.test(tags + name)) return false
      } else if (isFamily && !isCamp) {
        if (!/가족|family|주니어|junior/.test(tags + name)) return false
      } else if (isAdult && !isFamily && !isCamp) {
        // 성인 전용 → 가족/캠프 전용 학원 제외 (단, 성인+가족 둘 다 있는 학원은 포함)
        const isOnlyFamilyCamp = /가족연수|주니어캠프/.test(tags) && !/성인일반|어학연수/.test(tags)
        if (isOnlyFamilyCamp) return false
      }

      // 지역 필터
      if (!noRegion) {
        if (isCebu   && s.region !== '세부')   return false
        if (isBaguio && s.region !== '바기오') return false
        if (isOther  && (s.region === '세부' || s.region === '바기오')) return false
      }

      return true
    })

    // 필터 후 0개면 전체 사용
    if (filtered.length === 0) filtered = schools

    // 디버그 로그
    console.log(`[filter] 전체:${schools.length} → 필터후:${filtered.length} | camp:${isCamp} family:${isFamily} adult:${isAdult} | cebu:${isCebu} baguio:${isBaguio} noRegion:${noRegion}`)

    // ── 학원 데이터 요약 (필터된 학원만 풀데이터) ──────────────────────────
    const schoolsSummary = filtered.map(s => {
      // 코스: 전체 (가격순 정렬)
      const courses = (s.courses ?? [])
        .filter(c => (c as unknown as Record<string,number>).price4Weeks > 0)
        .sort((a,b) => ((a as unknown as Record<string,number>).price4Weeks||0) - ((b as unknown as Record<string,number>).price4Weeks||0))
        .map(c => ({ id: c.id, name: c.name, target: c.target,
          p: (c as unknown as Record<string,number>).price4Weeks, cur: c.currency }))

      // 기숙사: 전체 (가격순 정렬)
      const dorms = (s.dormitories ?? [])
        .filter(d => (d as unknown as Record<string,number>).price4Weeks > 0)
        .sort((a,b) => ((a as unknown as Record<string,number>).price4Weeks||0) - ((b as unknown as Record<string,number>).price4Weeks||0))
        .map(d => ({ id: d.id, name: d.name,
          p: (d as unknown as Record<string,number>).price4Weeks, cur: d.currency }))

      // 패키지: label + availableWeeks + 첫 번째 주수 가격만
      const packages = (s.packages ?? []).map(p => ({
        id: p.id, label: p.label, season: p.season ?? '',
        cols: p.columns ?? [],
        weeks: (p.priceMatrix ?? []).map(r => r.weeks),
        prices: (p.priceMatrix ?? []).slice(0, 3).map(r =>
          `${r.weeks}주:${(r.prices ?? []).map(c => `${c.label} ${Math.round(c.amount/10000)}만`).join('/')}`
        ),
      }))

      // 프로모션: 라벨+할인요약만
      const promos = (s.promotions ?? []).map(p => ({
        label: p.label,
        always: p.alwaysApply,
        start: p.startDate,
        end: p.endDate,
        disc: `${p.discountValue}${p.discountType==='percent'?'%':'원'}`,
        ad: p.agencyDiscount ? `유학원:${p.agencyDiscount.type}${p.agencyDiscount.type==='percent'?p.agencyDiscount.value+'%':p.agencyDiscount.type==='reg_fee_only'?'등록비'+((p.agencyDiscount as unknown as Record<string,number>).regFeeDiscount??0)/10000+'만':''}` : (p.agencyDiscount===null?'유학원X':''),
      }))

      return {
        id: s.id, name: s.name, region: s.region,
        tags: s.programTags ?? [],
        minW: s.minWeeks,
        short: s.allowShortTerm,
        courses, dorms, packages,
        surcharges: (s.surcharges ?? []).map(sc => ({ label: sc.label, start: sc.startDate, end: sc.endDate, pw: sc.pricePerWeek })),
        promos,
      }
    })

    const rawText = await callClaude(
      EXTRACT_PROMPT + `\n\n[학원 데이터]\n${JSON.stringify(schoolsSummary)}\n\n[오늘]\n${new Date().toISOString().split('T')[0]}`,
      messages, 1500
    )
    console.log('[quote] raw:', rawText.slice(0, 300))

    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    // need_info 후처리: 코스/기숙사/패키지 질문은 무조건 버튼으로 강제
    if (parsed.action === 'need_info') {
      const q = (parsed.question as string ?? '').toLowerCase()
      const isCourseQ = q.includes('코스') || q.includes('수업') || q.includes('과정')
      const isDormQ   = q.includes('기숙사') || q.includes('숙소') || q.includes('룸') || q.includes('room')
      const isPkgQ    = q.includes('패키지') || q.includes('인원') || q.includes('가족') || q.includes('시즌') || q.includes('성수기') || q.includes('비수기')

      // 학원이 특정된 경우 실제 목록 주입
      const schoolId  = parsed.schoolId as string | undefined
      const targetSchool = schoolId ? schools.find(s => s.id === schoolId) : undefined

      // 코스+기숙사 조합 선택지 감지 → 코스만 먼저 물어보도록 강제
      const sugg = parsed.suggestions as string[] | undefined
      const hasCombined = sugg?.some(s => s.includes('+')) ?? false

      if (hasCombined && targetSchool) {
        // 조합 선택지가 있으면 코스 목록만으로 교체
        parsed.question = '코스를 먼저 선택해 주세요.'
        parsed.suggestions = targetSchool.courses.map(c =>
          `${c.name} (${((c as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}원/4주)`
        )
        parsed.allowFreeText = false
        parsed.type = 'select'
      } else if (isCourseQ && targetSchool && (targetSchool.courses ?? []).length > 0) {
        parsed.suggestions = targetSchool.courses.map(c =>
          `${c.name} (${((c as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}원/4주)`
        )
        parsed.allowFreeText = false
        parsed.type = 'select'
      } else if (isDormQ && targetSchool && (targetSchool.dormitories ?? []).length > 0) {
        parsed.suggestions = targetSchool.dormitories.map(d =>
          `${d.name} (${((d as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}원/4주)`
        )
        parsed.allowFreeText = false
        parsed.type = 'select'
      } else if (isPkgQ && targetSchool && (targetSchool.packages ?? []).length > 0) {
        if (!sugg || sugg.length === 0) {
          parsed.suggestions = targetSchool.packages.map(p => p.label)
        }
        parsed.allowFreeText = false
        parsed.type = 'select'
      } else if ((isCourseQ || isDormQ || isPkgQ) && sugg?.length) {
        parsed.allowFreeText = false
      }
    }

    // ── 단일 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'calculate') {
      const school = schools.find(s => s.id === parsed.schoolId)
      if (!school) return NextResponse.json({ action: 'need_info', question: '학원을 찾을 수 없습니다.', type: 'select', suggestions: schools.map(s => s.name), allowFreeText: false })

      const specialNote = (parsed.specialNote as string) ?? ''

      const calcResult = runCalc(school, {
        schoolId: parsed.schoolId as string,
        startDate: parsed.startDate as string,
        enrollmentDate: parsed.enrollmentDate as string,
        courses: (parsed.courses as CourseItem[]) ?? [],
        dormitories: (parsed.dormitories as DormItem[]) ?? [],
        packages: (parsed.packages as PackageInput[]) ?? [],
      }, rate)

      // 현지납부비 필터링: 주수 조건 적용 + optional 제외
      const filteredLocalFees = (calcResult.localFees ?? []).filter(lf => {
        const t = lf.trigger ?? 'always'
        if (t === 'optional') return false   // 선택항목 제외
        if (t === 'always') return true
        if (t === 'per_week' || t === 'per_4weeks') return true
        if (t === 'over_weeks') return calcResult.totalWeeks > (lf.triggerWeeks ?? 4)
        return true
      })

      const courseSummary = calcResult.courseItems.map(i => i.label).join(', ')
      const dormSummary   = calcResult.dormItems.map(i => i.label).join(', ')
      const scenario = `${school.name} / 총 ${calcResult.totalWeeks}주 / 입국: ${parsed.startDate}\n코스: ${courseSummary || '패키지'}\n기숙사: ${dormSummary || '-'}`

      const regWarning = await checkRegulations(school, scenario)

      return NextResponse.json({
        action: 'result',
        message: (parsed.message ? `*${parsed.message}*\n\n` : '') +
          buildQuoteMessage(school, calcResult, calcResult.totalWeeks, specialNote),
        regulationWarning: regWarning,
        evidenceMessage: buildEvidenceMessage(school, calcResult, rate),
        discountEvidence: buildDiscountEvidence(school, calcResult),
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
        specialNote,
      })
    }

    // ── 비교 견적 ──────────────────────────────────────────────────────────
    if (parsed.action === 'multi_calculate') {
      const items = (parsed.items as CalcInputItem[]) ?? []
      const results: object[] = []

      for (const item of items) {
        const school = schools.find(s => s.id === item.schoolId)
        if (!school) {
          results.push({ schoolName: item.schoolName ?? item.schoolId, error: '학원을 찾을 수 없습니다.' })
          continue
        }
        const calcResult = runCalc(school, item, rate)
        const filteredLocalFees = (calcResult.localFees ?? []).filter(lf => {
          const t = lf.trigger ?? 'always'
          if (t === 'optional' || t === 'always' || t === 'per_week' || t === 'per_4weeks') return true
          if (t === 'over_weeks') return calcResult.totalWeeks > (lf.triggerWeeks ?? 4)
          return true
        })

        results.push({
          schoolName: school.name,
          schoolId: school.id,
          message: (item.message ? `*${item.message}*\n\n` : '') +
            buildQuoteMessage(school, calcResult, calcResult.totalWeeks, item.specialNote ?? ''),
          evidenceMessage: buildEvidenceMessage(school, calcResult, rate),
          discountEvidence: buildDiscountEvidence(school, calcResult),
          localFees: filteredLocalFees,
          localFeePhp: calcResult.localFeePhp,
          localFeeKrwEstimate: calcResult.localFeeKrwEstimate,
          totalWeeks: calcResult.totalWeeks,
          totalKrw: calcResult.totalKrw,
          calcResult,
          schoolData: school,
        })
      }

      return NextResponse.json({ action: 'multi_result', results })
    }

    return NextResponse.json(parsed)

  } catch (err) {
    console.error('[quote] error:', err)
    return NextResponse.json({ action: 'answer', message: `오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
