import { NextRequest, NextResponse } from 'next/server'
import type { School } from '@/types'
import type { PromoEntry } from '@/lib/db'

const EDIT_PROMPT = `당신은 필리핀 어학연수 학원 데이터 수정 AI입니다. 엠버시유학 내부 전용 시스템입니다.

[절대 규칙]
- 응답은 JSON 객체 하나만
- 첫 글자 반드시 {, 마지막 글자 반드시 }

[응답 형식]

① 수정 내용 파악 후 확인:
{"action":"confirm","summary":"변경 요약",
 "changes":[
   {"label":"Intensive Speaking 4주 가격","before":"850,000원","after":"900,000원"}
 ],
 "schoolPatch": {"courses": [/* 전체 courses 배열 - 수정된 값 반영 */]},
 "promoPatches": [{"id":"UUID","discountValue":100000}]
}

② 정보 부족:
{"action":"ask","message":"질문"}

③ 일반 답변:
{"action":"answer","message":"답변"}

[schoolPatch 규칙]
- 변경된 최상위 필드만 포함 (courses 수정이면 courses 배열 전체)
- 배열은 반드시 전체 배열을 포함 (인덱스 방식 금지)
- 등록비 수정: {"registrationFee": {"amount":100000,"currency":"KRW","note":"..."}}
- 단순 필드: {"generalNotes": "새 내용"}, {"isActive": true}

[promoPatches 규칙]
- 변경할 프로모션만 포함
- id는 반드시 프로모션 UUID 그대로
- 변경할 필드만 포함: {"id":"UUID","discountValue":50000,"endDate":"2026-12-31"}

[주의]
- 가격은 숫자 (원화: 1100000)
- 날짜는 YYYY-MM-DD`

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
      promos?: PromoEntry[]
    }

    if (!process.env.ANTHROPIC_API_KEY)
      return NextResponse.json({ action: 'answer', message: 'API 키 미설정' }, { status: 500 })

    const schoolContext = `
[현재 학원 데이터]
학원명: ${school.name} (id: ${school.id})
지역: ${school.region} / 활성: ${school.isActive}

코스 (${school.courses?.length ?? 0}개):
${(school.courses ?? []).map((c, i) => `  [${i}] ${c.name} / 4주 ${((c as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}원 / ${c.currency}`).join('\n')}

기숙사 (${school.dormitories?.length ?? 0}개):
${(school.dormitories ?? []).map((d, i) => `  [${i}] ${d.name} / 4주 ${((d as unknown as Record<string,number>).price4Weeks ?? 0).toLocaleString()}원`).join('\n')}

서차지 (${school.surcharges?.length ?? 0}개):
${(school.surcharges ?? []).map((s, i) => `  [${i}] ${s.label} / ${s.pricePerWeek?.toLocaleString()}${s.currency}/주 / ${s.startDate}~${s.endDate}`).join('\n')}

등록비: ${school.registrationFee ? `${school.registrationFee.amount.toLocaleString()}${school.registrationFee.currency}` : '없음'}

프로모션 (${(promos ?? []).length}개):
${(promos ?? []).map((p, i) => `  [${i}] id=${p.id} | ${p.promoName} | 할인:${(p as unknown as Record<string,unknown>).discountValue ?? p.agencyDiscountValue ?? '?'} | ${p.startDate}~${p.endDate} | active:${p.active}`).join('\n')}
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
        max_tokens: 2000,
        system: EDIT_PROMPT + schoolContext,
        messages,
      }),
    })

    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    const rawText = (await res.json()).content?.[0]?.text ?? ''
    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    // confirm 응답이면 서버에서 schoolPatch 적용해서 updatedSchool 계산
    if (parsed.action === 'confirm') {
      const schoolPatch = (parsed.schoolPatch ?? {}) as Record<string, unknown>
      const promoPatches = (parsed.promoPatches ?? []) as Array<Record<string, unknown>>

      // school 병합
      const updatedSchool = { ...school, ...schoolPatch }

      // promo 병합
      const updatedPromos = (promos ?? []).map(p => {
        const patch = promoPatches.find(pp => pp.id === p.id)
        return patch ? { ...p, ...patch } : p
      })

      return NextResponse.json({
        action: 'confirm',
        summary: parsed.summary,
        changes: parsed.changes ?? [],
        updatedSchool,
        updatedPromos: promoPatches.length > 0 ? updatedPromos : null,
        changedPromoIds: promoPatches.map(p => p.id as string),
      })
    }

    return NextResponse.json(parsed ?? { action: 'answer', message: rawText })

  } catch (err) {
    console.error('[edit-data] error:', err)
    return NextResponse.json({ action: 'answer', message: `오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
