import { NextRequest, NextResponse } from 'next/server'
import type { School } from '@/types'

const EDIT_PROMPT = `당신은 필리핀 어학연수 학원 데이터 수정 AI입니다. 엠버시유학 내부 전용 시스템입니다.

[절대 규칙]
- 응답은 JSON 객체 하나만
- 첫 글자 반드시 {, 마지막 글자 반드시 }
- confirm에 반드시 ops 포함 (저장은 ops로만 이루어짐)

[응답 형식]

① 수정 내용 파악 후 확인 요청:
{"action":"confirm","summary":"변경 요약",
 "changes":[
   {"field":"courses[0].price4Weeks","label":"Intensive Speaking 4주 가격","before":"850,000원","after":"900,000원"}
 ],
 "ops":[
   {"target":"school","path":"courses","index":0,"field":"price4Weeks","value":900000},
   {"target":"promo","promoId":"UUID","promoField":"discountValue","promoValue":100000}
 ]
}

② 정보 부족:
{"action":"ask","message":"질문"}

③ 일반 답변:
{"action":"answer","message":"답변"}

[학원 ops 규칙]
target: "school"
path: "courses"|"dormitories"|"surcharges"|"promotions"|"localFees"|"packages"|"generalNotes"|"refundPolicy"|"dormitoryRules"|"registrationFee"|"isActive"
index: 배열이면 0부터 시작하는 인덱스 (필수)
field: 변경할 필드명
value: 새 값 (숫자/문자열/불리언)

[프로모션 ops 규칙 — promos 컬렉션]
target: "promo"
promoId: 프로모션의 id 값 (UUID)
promoField: "discountValue"|"startDate"|"endDate"|"label"|"condition"|"note"|"active"|"agencyDiscountValue" 등
promoValue: 새 값

[중요]
- 가격은 반드시 숫자 (원화: 1100000 / PHP: 8000)
- 날짜는 YYYY-MM-DD
- 배열 항목은 반드시 index 포함
- registrationFee 수정 시 path="registrationFee", field="amount" (index 없음)`

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

export async function POST(req: NextRequest) {
  try {
    const { messages, school, promos } = await req.json() as {
      messages: { role: string; content: string }[]
      school: School
      promos?: Array<{ id: string; promoName: string; startDate: string; endDate: string; discountValue: number; discountType: string; active: boolean; details: string }>
    }

    if (!process.env.ANTHROPIC_API_KEY)
      return NextResponse.json({ action: 'answer', message: 'API 키 미설정' }, { status: 500 })

    // 학원 현재 데이터 요약
    const schoolContext = `
[현재 학원 데이터]
학원명: ${school.name} (id: ${school.id})
지역: ${school.region}
활성: ${school.isActive}

코스 (${school.courses?.length ?? 0}개):
${(school.courses ?? []).map((c, i) => `  [${i}] ${c.name} / 4주 ${((c as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}원 / ${c.currency}`).join('\n')}

기숙사 (${school.dormitories?.length ?? 0}개):
${(school.dormitories ?? []).map((d, i) => `  [${i}] ${d.name} / 4주 ${((d as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}원 / ${d.currency}`).join('\n')}

서차지 (${school.surcharges?.length ?? 0}개):
${(school.surcharges ?? []).map((s, i) => `  [${i}] ${s.label} / ${s.pricePerWeek?.toLocaleString()}${s.currency}/주 / ${s.startDate}~${s.endDate}`).join('\n')}

프로모션 (${school.promotions?.length ?? 0}개):
${(school.promotions ?? []).map((p, i) => `  [${i}] ${p.label} / ${p.discountValue}${p.discountType === 'percent' ? '%' : (p.currency ?? 'KRW')} / ${p.startDate}~${p.endDate} / 조건: ${p.condition ?? '-'}`).join('\n')}

패키지 (${school.packages?.length ?? 0}개):
${(school.packages ?? []).map((p, i) => `  [${i}] ${p.label} / ${p.season} / 열: ${p.columns?.join(', ')}`).join('\n')}

등록비: ${school.registrationFee ? `${school.registrationFee.amount}${school.registrationFee.currency}` : '없음'}

프로모션 (promos 컬렉션, ${(promos ?? []).length}개):
${(promos ?? []).map((p, i) => `  [${i}] id=${p.id} | ${p.promoName} | 할인: ${p.discountValue}${p.discountType === 'percent' ? '%' : '원'} | ${p.startDate}~${p.endDate} | active:${p.active}`).join('\n')}
`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: EDIT_PROMPT + schoolContext,
        messages,
      }),
    })

    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const rawText = (await res.json()).content?.[0]?.text ?? ''
    const parsed = extractJson(rawText)
    return NextResponse.json(parsed ?? { action: 'answer', message: rawText })

  } catch (err) {
    console.error('[edit-data] error:', err)
    return NextResponse.json({ action: 'answer', message: `오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
