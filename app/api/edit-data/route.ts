import { NextRequest, NextResponse } from 'next/server'
import type { School } from '@/types'

const EDIT_PROMPT = `당신은 필리핀 어학연수 학원 데이터 수정 AI입니다. 엠버시유학 내부 전용 시스템입니다.

[역할]
관리자가 자연어로 학원 데이터(비용, 규정, 프로모션 등)를 수정하도록 돕습니다.
수정 내용을 파악한 후, 반드시 변경사항을 요약하고 확인을 받은 뒤 patch 명령을 내립니다.

[절대 규칙]
- 응답은 JSON 객체 하나만
- 확인 없이 patch 절대 금지
- 첫 글자 반드시 {, 마지막 글자 반드시 }

[응답 형식]

① 수정 내용 파악 후 확인 요청:
{"action":"confirm","summary":"변경사항 요약","changes":[
  {"field":"courses[0].price4Weeks","label":"Power ESL 4주 가격","before":"1,050,000원","after":"1,100,000원"},
  {"field":"promotions[0].endDate","label":"비수기 프로모션 종료일","before":"2026-05-31","after":"2026-06-30"}
]}

② 확인 후 실제 패치 (사용자가 "맞아", "네", "확인", "저장" 등으로 승인 시):
{"action":"patch","schoolId":"ID","ops":[
  {"path":"courses","index":0,"field":"price4Weeks","value":1100000},
  {"path":"promotions","index":0,"field":"endDate","value":"2026-06-30"}
]}

③ 정보 부족 / 추가 질문:
{"action":"ask","message":"질문 내용"}

④ 일반 답변:
{"action":"answer","message":"답변"}

[패치 경로 규칙]
- path: "courses" | "dormitories" | "surcharges" | "promotions" | "localFees" | "packages" | "generalNotes" | "refundPolicy" | "dormitoryRules" | "registrationFee" | "isActive"
- index: 배열인 경우 인덱스 (0부터)
- field: 바꿀 필드명
- value: 새 값

[수정 가능 항목 예시]
- 코스 가격: courses[N].price4Weeks
- 기숙사 가격: dormitories[N].price4Weeks
- 프로모션 날짜: promotions[N].startDate / endDate
- 프로모션 할인: promotions[N].discountValue
- 서차지 가격: surcharges[N].pricePerWeek
- 등록비: registrationFee.amount
- 일반 메모: generalNotes (전체 텍스트)
- 환불 규정: refundPolicy
- 학원 활성: isActive

[주의]
- 여러 항목 동시 수정 가능
- 배열 내 특정 항목은 name/label로 찾아서 index 결정
- 가격은 항상 숫자(원 또는 PHP), 날짜는 YYYY-MM-DD`

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
    const { messages, school } = await req.json() as {
      messages: { role: string; content: string }[]
      school: School
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
