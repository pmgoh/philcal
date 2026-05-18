import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, CalcResult, CourseItem, DormItem, PackageInput } from '@/lib/calcEngine'
import { formatKrw, formatCurrency } from '@/lib/utils'
import { buildAliasIndex, findSchoolForPromo, type AliasMap } from '@/lib/schoolMatching'
import schoolAliases from '@/data/school-aliases.json'
import type { School, ExchangeRate, Promotion } from '@/types'

const EXTRACT_PROMPT = `엠버시유학 내부 견적 계산 시스템입니다. 사용자는 상담원입니다.

[태도]
- 상담원이 쓰는 내부 도구. 고객 응대 말투 금지.
- "죄송합니다", "담당자 확인 필요" 같은 말 절대 금지.
- 군더더기 없이 바로 계산 결과 또는 필요한 정보 요청.

[계산 규칙]
- 응답은 JSON 하나만. { 로 시작 } 로 끝.
- 코드블록, 설명 텍스트 금지.

[학원 데이터 구조 안내]
- courses: 정규 코스 (price4Weeks). 시스템이 자동 계산.
- dorms: 기숙사 (price4Weeks). 시스템이 자동 계산.
- packages: 가족캠프 등 행렬형 패키지. 시스템이 자동 계산.
- addCharges: 옵션 비용 (시스템 자동 계산 X). 견적 시 별도 안내 필요.
  예: CELLA 익스프레서 (1주/2주 단기 옵션), CIA 추가숙박 (1박당), Booster ESL (1주/2주 단독 코스), 가디언비, CIDEC 한 학년 학비.
  학생이 해당 옵션 신청 시 calculate에 반영 못 함 → message에 옵션 비용을 명시하고 운영자가 수동 추가하도록 안내.

[필수 확인 - 절대 누락 금지]
모든 견적은 ① 시작일 ② 코스 ③ 기숙사 ④ 주수를 모두 확인 후 계산. 하나라도 빠지면 need_info로 되묻기.
견적이 새는 가장 흔한 케이스는 기숙사 누락. 코스만 정해지면 즉시 기숙사 확인.

① 시작일: "8월 초"→8-04, "8월 중순"→8-11, "8월 말"→8-25. 미지정 → need_info.
② 코스: 미지정 → 코스 목록 제시 (need_info)
③ 기숙사 - 절대 누락 금지:
   - 코스 확인 후 기숙사 미지정 → 기숙사 목록 제시 (need_info)
   - 기숙사 목록에 반드시 "워크인(통학, 기숙사 없음)" 옵션을 추가하여 제시. 학원에 워크인 가능 명시가 있거나, 학생이 명시적으로 "통학" 또는 "기숙사 없이" 언급한 경우만 dormitories=[]로 설정.
   - "기숙사 안 함" / "통학" / "워크인" 같은 명시가 없으면 반드시 기숙사 선택 받기.
④ 주수: 미지정 → 되물음 (need_info)

[프로모션 중복 적용]
- 어학원 프로모션은 명시적으로 stackable=false인 경우 외에는 중복 적용 가능.
- 시스템이 자동으로 적용 가능한 프로모션을 모두 적용하고 사용자에게 알림.
- 견적 봇이 별도로 안내할 필요 없음 (시스템 메시지로 표시됨).

[응답 형식]

코스/기숙사 견적:
{"action":"calculate","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD",
 "courses":[{"courseId":"ID","weeks":4}],
 "dormitories":[{"dormitoryId":"ID1","weeks":2}],
 "packages":[],"specialNote":"","message":""}

워크인(통학) 견적 - 기숙사 없음:
{"action":"calculate","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD",
 "courses":[{"courseId":"ID","weeks":4}],
 "dormitories":[],
 "packages":[],"specialNote":"워크인(통학) 견적","message":""}

패키지 견적:
{"action":"calculate","schoolId":"ID","startDate":"YYYY-MM-DD","enrollmentDate":"YYYY-MM-DD",
 "courses":[],"dormitories":[],
 "packages":[{"packageId":"ID","weeks":4,"columnLabel":"보호자1+자녀1"}],
 "specialNote":"","message":""}

비교:
{"action":"multi_calculate","items":[...]}

정보 부족:
{"action":"need_info","question":"","type":"select","suggestions":[],"allowFreeText":false}

답변:
{"action":"answer","message":""}`

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

문제없으면 "규정상 특이사항 없습니다." 한 줄만.`
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

  if (school.promotions === null) {
    lines.push(`\n> ⚠️ **프로모션 정보 미확인** — 이 학원은 프로모션 데이터가 아직 입력되지 않았습니다.`)
  }
  lines.push('')

  if ((calcResult.packageItems ?? []).length > 0) {
    const pkgTotal = calcResult.packageItems.reduce((s, p) => s + p.totalKrw, 0)
    lines.push('**📦 패키지 구성**')
    for (const pi of calcResult.packageItems) {
      lines.push(`- ${pi.pkg.label} / ${pi.columnLabel} / ${pi.weeks}주: **${formatKrw(pi.baseAmount)}**`)
      if (pi.additionalAmount > 0) lines.push(`  추가: +${formatKrw(pi.additionalAmount)}`)
    }
    lines.push(`**패키지 소계: ${formatKrw(pkgTotal)}**`)
  }

  const courseTotalKrw = (calcResult.courseItems ?? []).reduce((s, i) => s + i.krwAmount, 0)
  if ((calcResult.courseItems ?? []).length > 0) {
    lines.push('\n**📚 학비 상세**')
    for (const item of calcResult.courseItems) {
      lines.push(`- ${item.label}: ${formatKrw(item.krwAmount)}`)
      if (item.currency !== 'KRW') lines.push(`  *(${formatCurrency(item.unitPrice * item.weeks, item.currency)} 기준)*`)
    }
    lines.push(`**학비 소계: ${formatKrw(courseTotalKrw)}**`)
  }

  const dormTotalKrw = (calcResult.dormItems ?? []).reduce((s, i) => s + i.krwAmount, 0)
  if ((calcResult.dormItems ?? []).length > 0) {
    lines.push('\n**🏠 기숙사비 상세**')
    for (const item of calcResult.dormItems) {
      lines.push(`- ${item.label}: ${formatKrw(item.krwAmount)}`)
    }
    lines.push(`**기숙사 소계: ${formatKrw(dormTotalKrw)}**`)
  }

  if ((calcResult.surchargeItems ?? []).length > 0) {
    lines.push('\n**🔥 성수기 서차지**')
    for (const sc of calcResult.surchargeItems)
      lines.push(`- ${sc.label}: +${formatKrw(sc.krwAmount)}`)
  }

  const totalPromoDiscount = calcResult.promotionDiscount + calcResult.surchargeDiscount
  const agencyDiscount = calcResult.agencyDiscountKrw ?? 0
  const totalAllDiscount = totalPromoDiscount + agencyDiscount

  if (totalAllDiscount > 0) {
    lines.push('\n**🎁 할인 내역**')
    if (calcResult.promotionLabel && totalPromoDiscount > 0) {
      lines.push(`- 학원 프로모션 (${calcResult.promotionLabel}): -${formatKrw(totalPromoDiscount)}`)
    }
    if (agencyDiscount > 0) {
      lines.push(`- !!AGENCY_DISCOUNT!!엠버시유학 자체 할인${calcResult.agencyDiscountNote ? ` (${calcResult.agencyDiscountNote})` : ''}: -${formatKrw(agencyDiscount)}`)
    }
    lines.push(`- **총 할인: -${formatKrw(totalAllDiscount)}**`)
  }

  if (calcResult.registrationFee && calcResult.registrationFeeKrw > 0) {
    const rf = calcResult.registrationFee
    lines.push(`\n**📋 등록비 (1회)**: ${rf.currency === 'KRW' ? formatKrw(rf.amount) : formatCurrency(rf.amount, rf.currency)}${rf.note ? ` *(${rf.note})*` : ''}`)
  }

  lines.push('\n---')
  lines.push(`### 🏆 **연수비용 총합: ${formatKrw(calcResult.totalKrw)}**`)
  if (agencyDiscount > 0)
    lines.push(`> 💡 엠버시유학 할인 **${formatKrw(agencyDiscount)}** 적용된 가격입니다`)
  lines.push('*(현지납부비 별도)*')

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
      if (!matchedPromo.alwaysApply) lines.push(`- 기간: ${matchedPromo.startDate} ~ ${matchedPromo.endDate}`)
      lines.push(`- 방식: ${matchedPromo.discountType === 'percent' ? `${matchedPromo.discountValue}%` : formatKrw(matchedPromo.discountValue)}`)
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
  }
  for (const item of (calcResult.courseItems ?? [])) lines.push(`- ${item.label} = ${formatKrw(item.krwAmount)}`)
  for (const item of (calcResult.dormItems ?? []))   lines.push(`- ${item.label} = ${formatKrw(item.krwAmount)}`)
  lines.push(`- 총 ${calcResult.totalWeeks}주 기준`)
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
    const { messages, schoolsData, rateData, promotionsData } = await req.json()
    const schools = (schoolsData as School[]) ?? []
    const promoEntries = (promotionsData as Array<Record<string, unknown>>) ?? []

    type PromoLike = Record<string, unknown>
    function entryToPromotion(p: PromoLike) {
      const agType = p.agencyDiscountType as string | undefined
      const agStatus = p.agencyDiscountStatus as string | undefined
      let agencyDiscount = undefined as unknown
      if (agStatus === 'disabled' || agType === 'none') {
        agencyDiscount = null
      } else if (agType) {
        agencyDiscount = {
          status: agStatus ?? 'enabled',
          type: agType,
          value: p.agencyDiscountValue ?? 0,
          maxAmount: p.agencyDiscountMaxAmount,
          applyTo: p.agencyDiscountApplyTo ?? 'all',
          scope: p.agencyDiscountScope,
          minWeeks: p.agencyDiscountMinWeeks,
          weekTiers: p.agencyDiscountWeekTiers,
          regFeeDiscount: p.agencyDiscountRegFee,
          rawText: p.agencyDiscountRawText,
          note: p.agencyDiscountNote ?? '',
        }
      }
      return {
        id: p.id,
        label: p.promoName,
        basisType: p.basisType ?? 'enrollment_date',
        alwaysApply: p.alwaysApply ?? false,
        stackable: p.stackable ?? false,
        startDate: p.startDate,
        endDate: p.endDate,
        discountType: p.discountType ?? 'amount',
        discountValue: p.discountValue ?? 0,
        currency: 'KRW',
        applyToCourses: p.applyToCourses ?? true,
        applyToDorms: p.applyToDorms ?? true,
        applyToSurcharge: p.applyToSurcharge ?? false,
        condition: p.condition,
        note: p.note,
        applicableItems: p.applicableItems,
        agencyDiscount,
      }
    }

    // ── 학원 매칭 - schoolCode + schoolName 별칭 (v3 호환) ─────────────────
    const aliasIdx = buildAliasIndex(schoolAliases as unknown as AliasMap)

    const promosBySchoolId: Record<string, Promotion[]> = {}
    const orphanPromos: Array<{ schoolName?: string; promoName?: string }> = []
    for (const p of promoEntries) {
      if (!p.active) continue
      const matched = findSchoolForPromo(
        {
          schoolId: p.schoolId as string | undefined,
          schoolCode: p.schoolCode as string | undefined,
          schoolName: p.schoolName as string | undefined,
          region: p.region as string | undefined,
        },
        schools,
        aliasIdx
      )
      if (!matched) {
        orphanPromos.push({ schoolName: p.schoolName as string, promoName: p.promoName as string })
        continue
      }
      if (!promosBySchoolId[matched.id]) promosBySchoolId[matched.id] = []
      promosBySchoolId[matched.id].push(entryToPromotion(p) as unknown as Promotion)
    }
    if (orphanPromos.length > 0) {
      console.log(`[quote] orphan promos: ${orphanPromos.length}`)
    }

    const schoolsWithPromos = schools.map(s => {
      const external = promosBySchoolId[s.id]
      if (external && external.length > 0) {
        return { ...s, promotions: external as unknown as School['promotions'] }
      }
      return s
    })
    const rate = rateData as ExchangeRate

    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ action: 'answer', message: 'API 키 미설정' }, { status: 500 })

    const allText = (messages as {role:string; content:string}[])
      .map(m => m.content).join(' ').toLowerCase()

    const isCamp    = /캠프|주니어캠프|여름캠프|겨울캠프|camp/.test(allText)
    const isFamily  = /가족연수|가족|주니어|아이|어머니|부모|아들|딸|자녀|family/.test(allText) && !isCamp
    const isAdult   = /성인|일반연수|어학연수|혼자|adult|solo/.test(allText) ||
                      (!isCamp && !isFamily)
    const isCebu    = /세부|cebu/.test(allText)
    const isBaguio  = /바기오|baguio/.test(allText)
    const isOther   = /마닐라|클락|보라카이|일로일로|기타|manila|clark|boracay|iloilo/.test(allText)
    const noRegion  = !isCebu && !isBaguio && !isOther

    let filtered = schoolsWithPromos.filter(s => {
      const tags = (s.programTags ?? []).join(' ').toLowerCase()
      const name = s.name.toLowerCase()
      if (isCamp && !isFamily && !isAdult) {
        if (!/캠프|camp|주니어|junior/.test(tags + name)) return false
      } else if (isFamily && !isCamp) {
        if (!/가족|family|주니어|junior/.test(tags + name)) return false
      } else if (isAdult && !isFamily && !isCamp) {
        const isOnlyFamilyCamp = /가족연수|주니어캠프/.test(tags) && !/성인일반|어학연수/.test(tags)
        if (isOnlyFamilyCamp) return false
      }
      if (!noRegion) {
        if (isCebu   && s.region !== '세부')   return false
        if (isBaguio && s.region !== '바기오') return false
        if (isOther  && (s.region === '세부' || s.region === '바기오')) return false
      }
      return true
    })

    if (filtered.length === 0) filtered = schoolsWithPromos

    const schoolsSummary = filtered.map(s => {
      const courses = (s.courses ?? [])
        .filter(c => (c as unknown as Record<string,number>).price4Weeks > 0)
        .sort((a,b) => ((a as unknown as Record<string,number>).price4Weeks||0) - ((b as unknown as Record<string,number>).price4Weeks||0))
        .map(c => ({ id: c.id, name: c.name, target: c.target,
          p: (c as unknown as Record<string,number>).price4Weeks, cur: c.currency }))

      const dorms = (s.dormitories ?? [])
        .filter(d => (d as unknown as Record<string,number>).price4Weeks > 0)
        .sort((a,b) => ((a as unknown as Record<string,number>).price4Weeks||0) - ((b as unknown as Record<string,number>).price4Weeks||0))
        .map(d => ({ id: d.id, name: d.name,
          p: (d as unknown as Record<string,number>).price4Weeks, cur: d.currency }))

      const packages = (s.packages ?? []).map(p => ({
        id: p.id, label: p.label, season: p.season ?? '',
        cols: p.columns ?? [],
        weeks: (p.priceMatrix ?? []).map(r => r.weeks),
      }))

      const additionalCharges = ((s as unknown as { additionalCharges?: Array<Record<string,unknown>> }).additionalCharges ?? [])
        .map(ac => ({
          label: ac.label as string,
          amount: ac.amount as number,
          unit: ac.unit as string,
          cur: ac.currency as string,
          cat: ac.category as string | undefined,
          note: ac.note as string | undefined,
        }))

      const promoStatus: 'unknown' | 'none' | 'has' =
        s.promotions === null ? 'unknown'
        : (s.promotions ?? []).length === 0 ? 'none'
        : 'has'
      const promos = (s.promotions ?? []).map(p => ({
        label: p.label,
        always: p.alwaysApply,
        start: p.startDate,
        end: p.endDate,
        disc: `${p.discountValue}${p.discountType==='percent'?'%':'원'}`,
      }))

      return {
        id: s.id, name: s.name, region: s.region,
        tags: s.programTags ?? [],
        minW: s.minWeeks,
        short: s.allowShortTerm,
        courses, dorms, packages,
        addCharges: additionalCharges,
        promos,
        promoStatus,
      }
    })

    const rawText = await callClaude(
      EXTRACT_PROMPT + `\n\n[학원 데이터]\n${JSON.stringify(schoolsSummary)}\n\n[오늘]\n${new Date().toISOString().split('T')[0]}`,
      messages, 1500
    )

    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    if (parsed.action === 'need_info') {
      const q = (parsed.question as string ?? '').toLowerCase()
      const isCourseQ = q.includes('코스') || q.includes('수업') || q.includes('과정')
      const isDormQ   = q.includes('기숙사') || q.includes('숙소') || q.includes('룸')
      const isPkgQ    = q.includes('패키지') || q.includes('인원') || q.includes('가족') || q.includes('성수기') || q.includes('비수기')

      const schoolId  = parsed.schoolId as string | undefined
      const targetSchool = schoolId ? schoolsWithPromos.find(s => s.id === schoolId) : undefined
      const sugg = parsed.suggestions as string[] | undefined

      if (isCourseQ && targetSchool && (targetSchool.courses ?? []).length > 0) {
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
      }
    }

    if (parsed.action === 'calculate') {
      const school = schoolsWithPromos.find(s => s.id === parsed.schoolId)
      if (!school) return NextResponse.json({ action: 'need_info', question: '학원을 찾을 수 없습니다.', type: 'select', suggestions: schoolsWithPromos.map(s => s.name), allowFreeText: false })

      const specialNote = (parsed.specialNote as string) ?? ''

      const calcResult = runCalc(school, {
        schoolId: parsed.schoolId as string,
        startDate: parsed.startDate as string,
        enrollmentDate: parsed.enrollmentDate as string,
        courses: (parsed.courses as CourseItem[]) ?? [],
        dormitories: (parsed.dormitories as DormItem[]) ?? [],
        packages: (parsed.packages as PackageInput[]) ?? [],
      }, rate)

      const filteredLocalFees = (calcResult.localFees ?? []).filter(lf => {
        const t = lf.trigger ?? 'always'
        if (t === 'optional') return false
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
        enrollmentDate: parsed.enrollmentDate ?? parsed.startDate,
        totalWeeks: calcResult.totalWeeks,
        surchargeItems: calcResult.surchargeItems.map(s => ({ label: s.label, weeks: s.weeks })),
        calcResult,
        schoolData: school,
        schoolId: school.id,
        specialNote,
      })
    }

    if (parsed.action === 'multi_calculate') {
      const items = (parsed.items as CalcInputItem[]) ?? []
      const results: object[] = []

      for (const item of items) {
        const school = schoolsWithPromos.find(s => s.id === item.schoolId)
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
