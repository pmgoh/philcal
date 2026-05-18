import { NextRequest, NextResponse } from 'next/server'
import type { School, ExchangeRate, Promotion } from '@/types'
import type { CalcResult } from '@/lib/calcEngine'

// ─── 검증 봇 시스템 프롬프트 ──────────────────────────────────────────────────
// 컨셉: 다 의심스럽게 보는 시선.
// 견적 봇 결과를 그대로 믿지 말고, 학원 원본 데이터와 시스템 로직에 맞게 정확한지
// 하나하나 따져본다. 통과는 짧게, 의심/오류는 길게.
const VERIFY_PROMPT = `너는 견적 검증 전문가다. 평소 견적 봇이 낸 결과를 다 의심하는 시선으로 본다.
"맞겠지" 라는 가정 금지. 모든 숫자, 적용 항목, 안내 문구를 학원 원본 데이터와 대조해서 직접 확인.

[기본 태도]
- 견적 봇이 실수했을 거라고 가정하고 시작
- "이건 맞을 것 같다" 같은 추측 금지 - 데이터로 확인되는 것만 통과
- 의심 가는 부분은 구체적으로 짚어주기 (어떤 숫자가 어떻게 이상한지)
- 학원 원본 데이터를 못 봤거나 빈 칸이면 "확인 불가 - 데이터 부족" 명시

[검증 항목]

1. 가격 정합성
   - 코스 단가: school.courses의 price4Weeks × 주수 = courseItems의 krwAmount 인지
   - 기숙사 단가: school.dormitories의 price4Weeks × 주수 = dormItems의 krwAmount 인지
   - 단기 등록(1-3주):
     * school.courseShortTermRates / dormShortTermRates 확인
     * mode='percent'면 price4Weeks × week_N / 100 (예: week1=40이면 40%)
     * mode='fixed'면 직접 금액
     * rates 자체가 없으면 price4Weeks / 4 × 주수 (단순 비례)
   - 4주 이상: price4Weeks / 4 × 주수

2. 프로모션 적용 (calcResult.promotionLabel, promotionDiscount 확인)
   - 적용된 프로모션이 있다면 school.promotions에서 찾아 매칭
   - basisType이 enrollment_date면 enrollmentDate가, start_date면 startDate가 startDate~endDate 사이인지
   - alwaysApply=true면 날짜 무관 OK
   - applyToCourses=false인데 코스에 할인 적용됐으면 오류
   - applyToDorms=false인데 기숙사에 할인 적용됐으면 오류
   - stackable=false 프로모션이 다른 프로모션과 동시 적용됐으면 오류

3. 유학원 할인 (agencyDiscount)
   - agencyDiscount.status === 'disabled' → agencyDiscountKrw 반드시 0, 안내 문구 "유학원 할인 불가"
   - agencyDiscount.status === 'unconfirmed' → agencyDiscountKrw 반드시 0, 안내 문구 "본사 확인 필요"
   - agencyDiscount.status === 'enabled':
     * type='percent': value%를 (학비+기숙사비)에 적용 (applyTo에 따라)
     * type='amount_per_week': value × 주수
     * type='amount_per_4weeks': value × Math.floor(주수/4) [비례 아님!]
     * type='amount_flat': value 1회
     * type='reg_fee_only': regFeeDiscount만 등록비에서 차감
     * scope='per_person'/'per_family' 적용 인원 확인
     * minWeeks 미만이면 적용 X

4. 현지비 (localFees) 안내 정합성
   - trigger='always' → 항상 표시
   - trigger='per_week' → 1주당, 주수 곱하기
   - trigger='per_4weeks' → 4주당, Math.ceil 또는 floor 확인
   - trigger='over_weeks' → totalWeeks > triggerWeeks일 때만 표시
   - trigger='optional' → 견적서엔 옵션 표시
   - chargeUnit='per_person' / 'per_room' / 'per_trip' / 'per_night' / 'flat' 단위 맞춰 합산
   - chargeUnit이 잘못 입력된 항목 (예: 자료에 "1인당"인데 chargeUnit='flat') 의심

5. 시간 의존 표현 (절대 금지)
   - 견적서나 데이터 어디에도 "n일 남음", "종료 임박", "곧 종료" 같은 동적 표현이 있으면 오류
   - 학원 데이터에 박혀있어도 견적 시점엔 잘못된 정보일 수 있음

6. additionalCharges (옵션 비용) 안내 누락
   - school.additionalCharges가 있는데 견적서에 옵션 안내가 없으면 경고
   - 예: 익스프레서/Booster ESL 같은 단기 옵션, 추가 숙박, 가디언비 등을 학생이 신청한다면 별도 안내 필요

7. 패키지 검증
   - packageItems의 baseAmount가 priceMatrix에서 columnLabel + weeks로 찾은 값과 일치하는지
   - additionalRules 적용 시 addAmount 합산 정확한지
   - includesLocalFees=true면 견적서에 "현지비 포함" 표시되어야

8. registrationFee (등록비)
   - registrationFeeKrw가 school.registrationFee.amount와 일치하는지
   - 학원의 등록비 안내가 견적서에 빠졌는지

9. 학원/프로모션 매칭
   - school.promotions === null이면 견적서에 "프로모션 미확인" 안내 필수
   - school.promotions === [] (빈 배열)이면 "프로모션 없음" 명시

[출력 형식 - Markdown]
## 🔍 검증 결과

**총평**: ✅ 통과 / ⚠️ 경고 N건 / ❌ 오류 N건

### ❌ 오류 (있을 때만)
- [항목] 무엇이 어떻게 잘못됐는지. 기대값 vs 실제값.

### ⚠️ 경고 (있을 때만)
- [항목] 의심 가는 부분. 어디를 더 확인해봐야 하는지.

### ✅ 통과
- 가격 / 프로모션 / 유학원 할인 / 현지비 / ... 등 통과한 항목 한 줄씩

[중요]
- 통과 항목은 한 줄로 짧게. 오류/경고는 구체적으로.
- 사실만 말하기. "X일 수도 있다" 같은 추측 금지.
- 데이터 부족으로 검증 불가능한 것은 "데이터 부족"으로 표시 (오류 아님).`

async function callClaude(system: string, messages: unknown[], maxTokens = 2000): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  return (await res.json()).content?.[0]?.text ?? ''
}

interface VerifyRequest {
  school: School
  calcResult: CalcResult
  startDate?: string
  enrollmentDate?: string
  rate?: ExchangeRate
  appliedPromotions?: Promotion[]    // 적용된 프로모션 (옵션)
  message?: string                   // 견적 봇이 출력한 견적서 본문
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ ok: false, error: 'API 키 미설정' }, { status: 500 })
    }

    const body = (await req.json()) as VerifyRequest
    const { school, calcResult, startDate, enrollmentDate, rate, message } = body

    if (!school || !calcResult) {
      return NextResponse.json({ ok: false, error: 'school 또는 calcResult 누락' }, { status: 400 })
    }

    // 검증에 필요한 학원 데이터만 추출 (토큰 절약 + 검증 봇이 봐야 할 것만)
    const schoolContext = {
      id: school.id,
      name: school.name,
      schoolCode: school.schoolCode,
      region: school.region,
      schoolType: school.schoolType,
      minWeeks: school.minWeeks,
      allowShortTerm: school.allowShortTerm,
      courseShortTermRates: school.courseShortTermRates,
      dormShortTermRates: school.dormShortTermRates,
      registrationFee: school.registrationFee,
      courses: (school.courses ?? []).map(c => ({
        id: c.id, name: c.name, target: c.target, price4Weeks: (c as unknown as Record<string,number>).price4Weeks, currency: c.currency, note: c.note,
      })),
      dormitories: (school.dormitories ?? []).map(d => ({
        id: d.id, name: d.name, target: d.target, price4Weeks: (d as unknown as Record<string,number>).price4Weeks, currency: d.currency, note: d.note,
      })),
      surcharges: school.surcharges,
      packages: (school.packages ?? []).map(p => ({
        id: p.id, label: p.label, season: p.season, columns: p.columns,
        priceMatrix: p.priceMatrix, additionalRules: p.additionalRules,
        includesLocalFees: p.includesLocalFees, schedules: p.schedules,
      })),
      localFees: school.localFees,
      additionalCharges: (school as unknown as Record<string, unknown>).additionalCharges,
      promotions: school.promotions,    // null 이면 그대로 null (검증 봇이 인지)
    }

    const calcContext = {
      courseItems: calcResult.courseItems,
      dormItems: calcResult.dormItems,
      packageItems: calcResult.packageItems,
      surchargeItems: calcResult.surchargeItems,
      promotionLabel: calcResult.promotionLabel,
      promotionDiscount: calcResult.promotionDiscount,
      surchargeDiscount: calcResult.surchargeDiscount,
      baseKrw: calcResult.baseKrw,
      surchargeKrw: calcResult.surchargeKrw,
      subtotal: calcResult.subtotal,
      registrationFee: calcResult.registrationFee,
      registrationFeeKrw: calcResult.registrationFeeKrw,
      agencyDiscountKrw: calcResult.agencyDiscountKrw,
      agencyDiscountNote: calcResult.agencyDiscountNote,
      totalKrw: calcResult.totalKrw,
      totalWeeks: calcResult.totalWeeks,
      courseTotalWeeks: calcResult.courseTotalWeeks,
      dormTotalWeeks: calcResult.dormTotalWeeks,
      localFees: calcResult.localFees,
      localFeePhp: calcResult.localFeePhp,
      localFeeKrwEstimate: calcResult.localFeeKrwEstimate,
      warnings: calcResult.warnings,
      notes: calcResult.notes,
    }

    const userMessage = `[검증 요청]

연수 정보:
- 입국일: ${startDate ?? '미지정'}
- 등록일: ${enrollmentDate ?? '미지정'}
- 환율: ₱1=${rate?.phpToKrw ?? '?'}원 / $1=${rate?.usdToKrw ?? '?'}원

[학원 원본 데이터]
${JSON.stringify(schoolContext, null, 2)}

[견적 봇 계산 결과]
${JSON.stringify(calcContext, null, 2)}

[견적 봇이 사용자에게 표시한 견적서 본문]
${message ?? '(없음)'}

위 견적이 학원 원본 데이터와 시스템 로직대로 정확한지 검증해라.
하나하나 따져보고, 의심 가는 부분은 구체적으로 짚어줘.`

    const verificationResult = await callClaude(VERIFY_PROMPT, [
      { role: 'user', content: userMessage }
    ], 2500)

    return NextResponse.json({
      ok: true,
      verification: verificationResult,
    })
  } catch (err) {
    console.error('[verify] error:', err)
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }, { status: 500 })
  }
}
