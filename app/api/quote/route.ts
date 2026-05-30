import { NextRequest, NextResponse } from 'next/server'
import { calculateQuote, CalcResult, CourseItem, DormItem, PackageInput } from '@/lib/calcEngine'
import { formatKrw, formatCurrency } from '@/lib/utils'
import { buildAliasIndex, findSchoolForPromo, type AliasMap } from '@/lib/schoolMatching'
import schoolAliases from '@/data/school-aliases.json'
import type { School, ExchangeRate, Promotion } from '@/types'
import { parseQuoteIntent, logUnresolved } from '@/lib/parseQuoteIntent'

// [코드 버전] 패치마다 증가. 응답에 표시되어 어느 버전 빌드가 돌고 있는지 즉시 확인 가능.
// v1: 초기 / v2: 단기 계산 수정 / v3: 단계 분리·날짜 미정 모드
// v4: 코드 주도 챗봇 (롤백됨 — 대화 부자연스러움)
// v5: LLM 주도 대화 + 사용자 확인 카드 + regulationWarning 제거
// v6: UI/UX 개선 (시작일 달력, 견적 결과 표, 선택지 그리드, 넓은 레이아웃)
// v7: 현지비 택일그룹(픽업 등 < > 선택) + per_4weeks 4주미만 추정경고 + 선택지 폭 확대
const CODE_VERSION = 'v8-2026.05.30'

// [LLM 역할 = 자연어 대화 주도]
// LLM이 사용자와 자연어로 대화하며 견적에 필요한 정보를 모은다.
// 다 모이면 confirm 액션으로 코드에 인계 → 사용자 확인 카드 표시 → 사용자 승인 → calculate.
// 행동 규칙(긍정문)으로 LLM을 규율한다. 부정문보다 LLM이 잘 따른다.
const EXTRACT_PROMPT = `엠버시유학 견적 시스템. 사용자는 상담원이다.

[역할]
사용자와 자연어로 대화하며 견적에 필요한 정보를 모은다.
다 모이면 "confirm" 액션으로 코드에 인계한다. 그 외엔 "need_info"로 다음 필요 정보를 묻는다.

[현재 모드는 시스템 프롬프트 아래에 표시된다]
- 일반 연수 모드: 코스 + 기숙사 + 주수 + 시작일을 모은다. 학원 데이터에 packages가 있어도 무시한다.
- 캠프·가족·주니어 모드: 패키지 + 주수 + 구성(2인가족/주니어 1인 등 columnLabel) + 시작일을 모은다. 코스·기숙사는 묻지 않는다(패키지에 포함됨).

[행동 규칙 - 반드시 지킨다]
1. 사용자가 답하지 않은 값은 빈 값으로 둔다. 임의로 채우지 않는다.
2. 사용자가 코스나 패키지를 안 골랐으면 기본값을 넣지 않는다. need_info로 묻는다.
3. 시작일은 선택사항이다. 사용자가 "미정/무관/상관없음/아무때나"라고 답하면 startDate는 빈 문자열로 두고 즉시 confirm 단계로 간다.
4. 시작일이 미정일 때 임시 날짜(오늘 날짜 등)를 넣지 않는다. 빈 문자열을 그대로 보낸다.
5. 시작일을 한 번 물어보고 사용자가 미정이라 답하면, 다시 묻지 않는다.
6. 학원 ID, 코스 ID, 기숙사 ID, 패키지 ID는 [학원 데이터]에 실제 존재하는 ID만 사용한다.
7. 패키지에 columns(['2인가족','3인가족','주니어 1인' 등])가 있으면 columnLabel을 반드시 받는다.
8. 사용자가 현재 모드와 안 맞는 학원(예: 일반 연수 모드에서 "CIA 캠프")을 찾으면, "그 학원은 캠프·가족·주니어 모드에 있습니다. 화면 위의 모드 토글로 전환해주세요"라고 안내한다(need_info에 question으로).
9. [캠퍼스] 한 학원에 여러 캠퍼스가 있을 수 있다(코스·기숙사의 campus 필드로 구분, 예: BECI = EOP/스파르타/시티). 사용자가 "베시 시티", "EV 라메르"처럼 캠퍼스를 말하면 그 campus의 코스·기숙사만 후보로 삼는다. 캠퍼스를 말하지 않았는데 학원에 여러 campus가 있으면, 어느 캠퍼스인지 need_info로 반드시 묻는다(임의로 정하지 않는다). 코스와 기숙사는 같은 campus끼리만 묶는다(다른 캠퍼스 조합 금지).

[출력 형식 - JSON 하나만]
정보 부족 시:
{"action":"need_info","question":"...","type":"select|text","suggestions":[...],"allowFreeText":true|false}

정보 다 모임 — 일반 연수 모드(코스/기숙사/주수 확인됨):
{"action":"confirm","schoolId":"...","totalWeeks":N,"courses":[{"courseId":"...","weeks":N}],"dormitories":[{"dormitoryId":"...","weeks":N}],"startDate":"YYYY-MM-DD 또는 빈문자열","enrollmentDate":"YYYY-MM-DD 또는 빈문자열"}

정보 다 모임 — 캠프·가족·주니어 모드(패키지/주수/구성 확인됨):
{"action":"confirm","schoolId":"...","totalWeeks":N,"packages":[{"packageId":"...","weeks":N,"columnLabel":"..."}],"startDate":"YYYY-MM-DD 또는 빈문자열","enrollmentDate":"YYYY-MM-DD 또는 빈문자열"}

사용자가 확인 카드를 승인:
{"action":"calculate", ... confirm과 동일한 필드들}

[학원 데이터 사용]
- courses, dormitories, packages는 ID로 매칭. 사용자가 이름으로 말하면 가장 가까운 것 선택.
- 사용자가 모호하게 말하면 need_info로 명확히 묻는다.
- "CIA 캠프 3주" 같은 짧은 입력: 캠프 모드면 그 학원의 패키지 중 3주짜리를 찾거나, 없으면 가까운 주수의 패키지를 제안한다.

JSON 외 텍스트 금지. 코드블록 금지.`


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

[작성 규칙]
- 안내사항이 많아도 잘리지 않게 핵심만 5개 이내로 간결하게.
- 각 항목은 2-3줄로 짧게. 긴 설명 X.
- 시나리오와 직접 관련 있는 것만. 일반론 X.
- 문제없으면 "규정상 특이사항 없습니다." 한 줄만.`
  try {
    const r = (await callClaude(prompt, [{ role: 'user', content: '검토해줘.' }], 1500)).trim()
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
    const appliedSchoolLines = (calcResult.promotionLines ?? []).filter(l => l.kind === 'school' && l.status === 'applied')
    const appliedAgencyLines = (calcResult.promotionLines ?? []).filter(l => l.kind === 'agency' && l.status === 'applied')
    if (appliedSchoolLines.length > 0 || appliedAgencyLines.length > 0) {
      for (const l of appliedSchoolLines) lines.push(`- ${l.label} *(${l.basis})*: -${formatKrw(l.discountKrw)}`)
      for (const l of appliedAgencyLines) lines.push(`- 유학원 할인 · ${l.label.replace(' (유학원 할인)','')}: -${formatKrw(l.discountKrw)}`)
    } else {
      if (calcResult.promotionLabel && totalPromoDiscount > 0) {
        lines.push(`- 학원 프로모션 (${calcResult.promotionLabel}): -${formatKrw(totalPromoDiscount)}`)
      }
      if (agencyDiscount > 0) {
        lines.push(`- 엠버시유학 자체 할인: -${formatKrw(agencyDiscount)}`)
      }
    }
    lines.push(`- **총 할인: -${formatKrw(totalAllDiscount)}**`)
  }

  // 조건 미충족 프로모션 안내 (적용 안 됐지만 존재 — 조건 보완 시 가능)
  const unmetLines = (calcResult.promotionLines ?? []).filter(l => l.status === 'unmet')
  if (unmetLines.length > 0) {
    lines.push('\n**🔸 조건 충족 시 적용 가능**')
    for (const l of unmetLines) lines.push(`- ${l.label} *(${l.unmetReason})*`)
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

  // 날짜 미정 보류 항목 (성수기 추가비·기간 한정 프로모션)
  const pendingLines = (calcResult.promotionLines ?? []).filter(l => l.status === 'pending')
  if (pendingLines.length > 0) {
    lines.push('\n**📅 입국일을 정하면 반영될 항목**')
    for (const pl of pendingLines) {
      lines.push(`- ${pl.label} *(${pl.periodNote ?? pl.basis})*`)
    }
    lines.push('> 위 견적은 입국일 미정 기준 기본 견적입니다. 날짜를 알려주시면 성수기 추가비·기간 한정 프로모션을 반영해 드립니다.')
  }

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

// 프론트가 확인 카드 확정값을 그대로 보내는 LLM-우회 계산 payload
type DirectCalcPayload = {
  schoolId: string
  startDate?: string
  enrollmentDate?: string
  courses?: CourseItem[]
  dormitories?: DormItem[]
  packages?: PackageInput[]
  specialNote?: string
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

// 계산 결과 → result 응답 빌드 (LLM 경로의 calculate 분기와 LLM-우회 directCalc가 공유).
// 순수 계산/포맷만 수행하며 LLM을 전혀 호출하지 않는다.
function buildCalcResponse(school: School, calcResult: CalcResult, rate: ExchangeRate, startDate: string, enrollmentDate: string, specialNote = '') {
  const filteredLocalFees = (calcResult.localFees ?? []).filter(lf => {
    const t = lf.trigger ?? 'always'
    if (t === 'optional') return false
    if (t === 'always') return true
    if (t === 'per_week' || t === 'per_4weeks') return true
    if (t === 'over_weeks') return calcResult.totalWeeks > (lf.triggerWeeks ?? 4)
    return true
  })
  return {
    action: 'result' as const,
    message: buildQuoteMessage(school, calcResult, calcResult.totalWeeks, specialNote) + `\n\n_ver: ${CODE_VERSION}_`,
    evidenceMessage: buildEvidenceMessage(school, calcResult, rate),
    discountEvidence: buildDiscountEvidence(school, calcResult),
    localFees: filteredLocalFees,
    localFeePhp: calcResult.localFeePhp,
    localFeeKrwEstimate: calcResult.localFeeKrwEstimate,
    weeksForFees: calcResult.totalWeeks,
    startDate,
    enrollmentDate: enrollmentDate || startDate,
    totalWeeks: calcResult.totalWeeks,
    surchargeItems: calcResult.surchargeItems.map(s => ({ label: s.label, weeks: s.weeks })),
    calcResult,
    schoolData: school,
    schoolId: school.id,
    specialNote,
    _version: CODE_VERSION,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { messages, schoolsData, rateData, promotionsData, mode, directCalc, aliasData } = await req.json()
    const schools = (schoolsData as School[]) ?? []
    const promoEntries = (promotionsData as Array<Record<string, unknown>>) ?? []
    // mode: 'regular'(일반 연수) | 'camp_family'(캠프·가족·주니어) — 챗봇 토글로 결정.
    // schoolsData는 이 모드로 이미 필터링돼서 옴. 여기선 LLM에 모드를 알려줘서 흐름을 명확히 한다.
    const chatMode = (mode === 'camp_family' ? 'camp_family' : 'regular') as 'regular' | 'camp_family'

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
          base: p.agencyDiscountBase ?? 'after_discount',
          rawText: p.agencyDiscountRawText,
          note: p.agencyDiscountNote ?? '',
        }
      }
      return {
        id: p.id,
        label: p.promoName,
        target: p.target,
        basisType: p.basisType ?? 'enrollment_date',
        alwaysApply: p.alwaysApply ?? false,
        // stackable 기본 true (중복 적용 가능). 명시적 false 시에만 단독.
        stackable: p.stackable !== false,
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
        weekTiers: p.weekTiers,
        excludeCourses: p.excludeCourses,
        // 허용조건·계산방식 (자료 근거)
        minWeeks: p.minWeeks,
        blockMethod: p.blockMethod,
        methodConfirmed: p.methodConfirmed,
        // 호환 관계 (ID 기반)
        stackWith: p.stackWith,
        exclusiveWith: p.exclusiveWith,
        relationConfirmed: p.relationConfirmed,
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

    // ── [LLM 우회] 계산 직행 ───────────────────────────────────────────────
    // 사용자가 확인 카드에서 학원·코스·기숙·주수·시작일을 모두 확정하고 [계산하기]를 누르면,
    // 프론트가 그 확정값을 directCalc로 보낸다. 이 경우 자연어 해석이 필요 없으므로
    // LLM(callClaude)과 전체 학원요약(schoolsSummary) 구성을 전부 건너뛰고 calcEngine만 돌린다.
    // → 계산 단계 LLM 토큰 = 0 (rate limit 방지), 계산값이 LLM 손을 타지 않음.
    const dc = directCalc as DirectCalcPayload | undefined
    if (dc && dc.schoolId) {
      const school = schoolsWithPromos.find(s => s.id === dc.schoolId)
      if (!school) {
        return NextResponse.json({
          action: 'need_info', type: 'select',
          question: '학원을 찾을 수 없습니다. 다시 선택해주세요.',
          suggestions: schoolsWithPromos.map(s => s.name),
          allowFreeText: false, _version: CODE_VERSION,
        })
      }
      const startDate = dc.startDate ?? ''
      const enrollmentDate = dc.enrollmentDate ?? startDate
      const calcResult = runCalc(school, {
        schoolId: dc.schoolId,
        startDate, enrollmentDate,
        courses: dc.courses ?? [],
        dormitories: dc.dormitories ?? [],
        packages: dc.packages ?? [],
      }, rate)
      return NextResponse.json(buildCalcResponse(school, calcResult, rate, startDate, enrollmentDate, dc.specialNote ?? ''))
    }
    // ───────────────────────────────────────────────────────────────────────

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
          campus: (c as unknown as { campus?: string }).campus,
          p: (c as unknown as Record<string,number>).price4Weeks, cur: c.currency }))

      const dorms = (s.dormitories ?? [])
        .filter(d => (d as unknown as Record<string,number>).price4Weeks > 0)
        .sort((a,b) => ((a as unknown as Record<string,number>).price4Weeks||0) - ((b as unknown as Record<string,number>).price4Weeks||0))
        .map(d => ({ id: d.id, name: d.name,
          campus: (d as unknown as { campus?: string }).campus,
          p: (d as unknown as Record<string,number>).price4Weeks, cur: d.currency }))

      const packages = (s.packages ?? []).map(p => {
        // priceMatrix는 배열형 [{weeks, prices}] 또는 객체형 {columns, rows} 두 가지가 섞여 있음.
        // 객체형이면 columns(주차)에서 weeks를 추출, 배열형이면 기존대로 r.weeks 사용.
        const pm = (p as { priceMatrix?: unknown }).priceMatrix
        let weeks: number[] = []
        let cols = (p.columns ?? []) as string[]
        if (Array.isArray(pm)) {
          weeks = pm.map(r => (r as { weeks: number }).weeks)
        } else if (pm && typeof pm === 'object') {
          const obj = pm as { columns?: string[]; rows?: Array<{ label?: string }> }
          const colList = obj.columns ?? []
          const weekCols = colList.map(c => {
            const m = String(c).match(/(\d+)\s*(?:w|W|주)/)
            return m ? parseInt(m[1], 10) : null
          })
          if (weekCols.length > 0 && weekCols.every(w => w !== null)) {
            weeks = weekCols as number[]
            cols = (obj.rows ?? []).map(r => r.label ?? '기본')
          } else {
            cols = colList
          }
        }
        return { id: p.id, label: p.label, season: p.season ?? '', cols, weeks }
      })

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
        shortStatus: s.shortTermDataStatus ?? 'confirmed',   // 'confirmed' | 'unconfirmed' — 단기 가격 자료 명시 여부
        hasDorms: (s.dormitories?.length ?? 0) > 0,           // 기숙사 운영 여부 (false면 외부 거주 전제 학원)
        courses, dorms, packages,
        addCharges: additionalCharges,
        promos,
        promoStatus,
      }
    })

    // 모드 안내 — 챗봇 토글로 결정된 모드를 LLM에 명시. 학원 목록은 이 모드로 이미 필터링돼 있음.
    const modeNote = chatMode === 'camp_family'
      ? `[현재 모드: 캠프·가족·주니어] 정액 패키지로 운영되는 학원만 보입니다. 사용자 질문은 packages 흐름으로 처리하세요. courses/dormitories는 묻지 않습니다.`
      : `[현재 모드: 일반 연수] 일반 ESL/IELTS 등 코스 학원만 보입니다. courses + dormitories + 주수 + 시작일 흐름으로 처리하세요.`

    // ── [코드 우선 파서] LLM 호출 전에 코드로 먼저 시도 ─────────────────────────
    // 파서가 학원·코스·기숙·주수를 자신 있게 잡으면 confirm을 바로 만들어 LLM을 건너뛴다.
    // 일부만 잡히면 코드가 선택지(need_info)를 띄운다. 못 잡으면 아래 기존 LLM 흐름으로 폴백.
    // 계산(calcEngine)·확인카드 구조는 기존 그대로 재사용한다.
    const lastUserMsg = [...(messages as Array<{ role: string; content: string }>)]
      .reverse().find(m => m.role === 'user')?.content ?? ''
    if (chatMode === 'regular' && lastUserMsg.trim()) {
      const p = parseQuoteIntent(lastUserMsg, schoolsWithPromos as School[], aliasData as Record<string, string[]> | undefined)
      // 학원이 auto로 확정된 경우만 코드가 주도(choices/none이면 아래에서 분기)
      if (p.school.kind === 'auto') {
        const sid = p.school.pick.id
        const courseAuto = p.course?.kind === 'auto' ? p.course.pick : null
        const dormAuto = p.dorm?.kind === 'auto' ? p.dorm.pick : null

        // (a) 코스·기숙·주수 모두 확정 → confirm 카드 직행 (LLM 0)
        if (courseAuto && dormAuto && p.weeks) {
          return NextResponse.json({
            action: 'confirm',
            message: '아래 내용으로 계산할게요. 맞으면 [계산하기]를 누르고, 수정할 게 있으면 알려주세요.',
            confirmCard: {
              schoolId: sid,
              schoolName: p.school.pick.name,
              totalWeeks: p.weeks,
              courses: [{ courseId: courseAuto.id, weeks: p.weeks }],
              courseLabels: [`${courseAuto.name} (${p.weeks}주)`],
              dormitories: [{ dormitoryId: dormAuto.id, weeks: p.weeks }],
              dormLabels: [`${dormAuto.name} (${p.weeks}주)`],
              packages: [],
              packageLabels: [],
              startDate: p.startDate,
              startDateLabel: p.startDate ? p.startDate : '미정 (날짜 없이 기본 견적)',
              enrollmentDate: p.startDate,
            },
            _via: 'parser',
          })
        }

        // (b) 코스가 여러 후보 또는 못 찾음 → 코드가 그 학원 코스 목록을 선택지로 (LLM 0)
        const targetSchool = schoolsWithPromos.find(s => s.id === sid)
        if (p.course?.kind === 'choices') {
          return NextResponse.json({
            action: 'need_info', type: 'select', schoolId: sid,
            question: `${p.school.pick.name} — 어느 코스인가요?`,
            suggestions: p.course.options.map(o => o.name),
            allowFreeText: true, _via: 'parser',
          })
        }
        if (p.course?.kind === 'none' && targetSchool && (targetSchool.courses?.length ?? 0) > 0) {
          // 코드가 코스를 못 집음 → 그 학원 전체 코스 목록을 보여주고 고르게 (LLM보다 정확)
          return NextResponse.json({
            action: 'need_info', type: 'select', schoolId: sid,
            question: `${p.school.pick.name} — 어느 코스인가요?`,
            suggestions: (targetSchool.courses ?? []).map(c =>
              `${c.name} (${((c as unknown as Record<string, number>).price4Weeks ?? 0).toLocaleString()}원/4주)`),
            allowFreeText: true, _via: 'parser',
          })
        }
        // (c) 코스는 정해졌는데 기숙 후보 여럿/못찾음 → 기숙 선택지
        if (courseAuto && p.dorm?.kind === 'choices') {
          return NextResponse.json({
            action: 'need_info', type: 'select', schoolId: sid,
            question: `${p.school.pick.name} — 어느 기숙사인가요?`,
            suggestions: p.dorm.options.map(o => o.name),
            allowFreeText: true, _via: 'parser',
          })
        }
        if (courseAuto && p.dorm?.kind === 'none' && targetSchool && (targetSchool.dormitories?.length ?? 0) > 0) {
          return NextResponse.json({
            action: 'need_info', type: 'select', schoolId: sid,
            question: `${p.school.pick.name} — 어느 기숙사인가요?`,
            suggestions: (targetSchool.dormitories ?? []).map(d =>
              `${d.name} (${((d as unknown as Record<string, number>).price4Weeks ?? 0).toLocaleString()}원/4주)`),
            allowFreeText: true, _via: 'parser',
          })
        }
        // (d) 코스·기숙 정해졌는데 주수만 없음 → 주수 되묻기
        if (courseAuto && dormAuto && !p.weeks) {
          return NextResponse.json({
            action: 'need_info', type: 'text', schoolId: sid,
            question: '몇 주 과정으로 알아볼까요? (예: 4주, 8주)',
            allowFreeText: true, _via: 'parser',
          })
        }
        // 여기까지 안 걸리면(학원만 잡고 나머지 불명확) LLM 폴백으로 내려감
      } else if (p.school.kind === 'choices') {
        // 학원이 여러 후보(캠퍼스 등) → 코드가 학원 선택지 (LLM 0)
        return NextResponse.json({
          action: 'need_info', type: 'select',
          question: '어느 학원/캠퍼스인가요?',
          suggestions: p.school.options.map(o => o.name),
          allowFreeText: true, _via: 'parser',
        })
      } else {
        // 학원조차 코드가 못 잡음 → 수집 후 LLM 폴백
        logUnresolved(lastUserMsg, 'school_not_found')
      }
    }

    const rawText = await callClaude(
      EXTRACT_PROMPT + `\n\n${modeNote}\n\n[학원 데이터]\n${JSON.stringify(schoolsSummary)}\n\n[오늘]\n${new Date().toISOString().split('T')[0]}`,
      messages, 1500
    )

    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    // [LLM 주도 흐름] LLM이 대화 주도, 코드는 보조.
    // need_info일 때 코드가 selectable 후보(코스/기숙사/시작일 등)를 보강한다.
    if (parsed.action === 'need_info') {
      const q = (parsed.question as string ?? '').toLowerCase()
      const isCourseQ = q.includes('코스') || q.includes('수업') || q.includes('과정')
      const isDormQ   = q.includes('기숙사') || q.includes('숙소') || q.includes('룸')
      const isPkgQ    = q.includes('패키지') || q.includes('인원') || q.includes('가족') || q.includes('성수기') || q.includes('비수기')
      const isDateQ   = (q.includes('시작일') || q.includes('입국') || q.includes('날짜') || q.includes('언제') || q.includes('일정'))
                        && !isCourseQ && !isDormQ

      const schoolId = parsed.schoolId as string | undefined
      const targetSchool = schoolId ? schoolsWithPromos.find(s => s.id === schoolId) : undefined
      const sugg = parsed.suggestions as string[] | undefined

      if (isDateQ) {
        // 시작일 미정 선택지 자동 추가. 미정 선택해도 빈 값으로 진행되게.
        parsed.suggestions = ['미정 (날짜 없이 기본 견적)', ...(sugg ?? [])]
        parsed.allowFreeText = true
        parsed.type = 'select'
        parsed.isDateQuestion = true   // UI가 달력(데이트피커)을 띄우게 하는 플래그
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
      }
    }

    // [확인 카드] LLM이 confirm 액션을 보내면 코드가 즉시 calculate로 가지 않고
    // "이 값으로 계산할게요. 맞나요?" 사용자 확인 카드를 띄운다. 사용자가 검토/수정 후
    // 승인 버튼을 누르면 그때 calculate. LLM 5% 실패(임의값, 임시 날짜 등)가 자동 통과
    // 되지 않게 사용자에게 즉시 노출하는 방어선.
    if (parsed.action === 'confirm') {
      const school = schoolsWithPromos.find(s => s.id === parsed.schoolId)
      if (!school) {
        return NextResponse.json({
          action: 'need_info', type: 'select',
          question: '학원을 다시 확인해주세요.',
          suggestions: schoolsWithPromos.map(s => s.name),
          allowFreeText: false,
          _version: CODE_VERSION,
        })
      }
      const courses = (parsed.courses as { courseId: string; weeks: number }[] | undefined) ?? []
      const dorms   = (parsed.dormitories as { dormitoryId: string; weeks: number }[] | undefined) ?? []
      const packages = (parsed.packages as { packageId: string; weeks: number; columnLabel: string }[] | undefined) ?? []
      const courseLabels = courses.map(c => {
        const cobj = (school.courses ?? []).find(x => x.id === c.courseId)
        return cobj ? `${cobj.name} (${c.weeks}주)` : `${c.courseId} (${c.weeks}주)`
      })
      const dormLabels = dorms.map(d => {
        const dobj = (school.dormitories ?? []).find(x => x.id === d.dormitoryId)
        return dobj ? `${dobj.name} (${d.weeks}주)` : `${d.dormitoryId} (${d.weeks}주)`
      })
      const packageLabels = packages.map(p => {
        const pobj = (school.packages ?? []).find(x => x.id === p.packageId)
        const base = pobj ? pobj.label : p.packageId
        return `${base} — ${p.columnLabel} (${p.weeks}주)`
      })
      const sd = (parsed.startDate as string) ?? ''
      return NextResponse.json({
        action: 'confirm',
        message: '아래 내용으로 계산할게요. 맞으면 [계산하기]를 누르고, 수정할 게 있으면 알려주세요.',
        confirmCard: {
          schoolId: parsed.schoolId,
          schoolName: school.name,
          totalWeeks: parsed.totalWeeks,
          courses: courses,
          courseLabels,
          dormitories: dorms,
          dormLabels,
          packages,
          packageLabels,
          startDate: sd,
          startDateLabel: sd ? sd : '미정 (날짜 없이 기본 견적)',
          enrollmentDate: (parsed.enrollmentDate as string) ?? sd,
        },
        _version: CODE_VERSION,
      })
    }

    if (parsed.action === 'calculate') {
      const school = schoolsWithPromos.find(s => s.id === parsed.schoolId)
      if (!school) return NextResponse.json({ action: 'need_info', question: '학원을 찾을 수 없습니다.', type: 'select', suggestions: schoolsWithPromos.map(s => s.name), allowFreeText: false })

      const specialNote = (parsed.specialNote as string) ?? ''

      const calcResult = runCalc(school, {
        schoolId: parsed.schoolId as string,
        startDate: (parsed.startDate as string) ?? '',
        enrollmentDate: (parsed.enrollmentDate as string) ?? (parsed.startDate as string) ?? '',
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

      // [v5] regulationWarning 제거 — LLM이 만드는 규정 검토는 정확도 검증 안 됨.
      // 상담사가 검산해야 하는 산출물을 줄이는 게 본질이므로 빼버린다.

      return NextResponse.json({
        action: 'result',
        // [v4] LLM이 임의로 끼운 message는 무시. 코드가 만든 buildQuoteMessage만 사용.
        // 이전 버전에서 LLM이 "promoStatus: none" 같은 내부 필드명을 응답에 노출하던 문제 차단.
        message: buildQuoteMessage(school, calcResult, calcResult.totalWeeks, specialNote)
          + `\n\n_ver: ${CODE_VERSION}_`,
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
        _version: CODE_VERSION,
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
