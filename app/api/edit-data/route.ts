import { NextRequest, NextResponse } from 'next/server'
import type { School } from '@/types'
import type { PromoEntry } from '@/lib/db'

const EDIT_PROMPT = `당신은 필리핀 어학연수 학원 데이터 수정 AI입니다. 엠버시유학 내부 전용.

[절대 규칙]
- JSON 객체 하나만 반환
- 배열 전체를 반환하는 schoolPatch 금지 — 반드시 ops 방식 사용

[응답 형식]

① 수정 확인:
{"action":"confirm","summary":"요약",
 "changes":[{"label":"항목명","before":"기존값","after":"새값"}],
 "ops":[
   {"path":"courses","index":0,"field":"price4Weeks","value":900000},
   {"path":"registrationFee","field":"amount","value":100000}
 ],
 "promoOps":[
   {"id":"UUID","field":"discountValue","value":50000},
   {"id":"UUID","field":"endDate","value":"2026-12-31"}
 ]
}

② 정보 부족:
{"action":"ask","message":"질문"}

③ 일반 답변:
{"action":"answer","message":"답변"}

[ops 규칙 — 배열/중첩 필드]
path: "courses"|"dormitories"|"surcharges"|"promotions"|"localFees"|"packages"|"generalNotes"|"refundPolicy"|"dormitoryRules"|"registrationFee"|"isActive"
index: 배열이면 0부터 시작 (필수)
field: 변경할 정확한 필드명
value: 새 값 (숫자/문자열/불리언)

예시:
- 코스 가격: {"path":"courses","index":0,"field":"price4Weeks","value":900000}
- 기숙사 가격: {"path":"dormitories","index":2,"field":"price4Weeks","value":800000}
- 서차지 금액: {"path":"surcharges","index":0,"field":"pricePerWeek","value":50000}
- 등록비: {"path":"registrationFee","field":"amount","value":100000}  ← index 없음
- 메모: {"path":"generalNotes","value":"새 내용"}  ← field/index 없음

[promoOps 규칙]
id: 프로모션 UUID (반드시 정확히)
field: "startDate"|"endDate"|"discountValue"|"label"|"condition"|"note"|"active" 등
value: 새 값`

function applyOps(school: School, ops: Array<{path:string; index?:number; field?:string; value:unknown}>): School {
  const s = JSON.parse(JSON.stringify(school)) as Record<string, unknown>
  for (const op of ops) {
    const { path, index, field, value } = op
    if (!path) continue

    if (index !== undefined) {
      // 배열 항목
      const arr = s[path] as Record<string, unknown>[]
      if (!Array.isArray(arr)) { console.error(`[applyOps] ${path} is not array`); continue }
      if (!arr[index]) { console.error(`[applyOps] ${path}[${index}] not found`); continue }
      if (field) {
        arr[index][field] = value
      } else {
        s[path] = [...arr.slice(0, index), value, ...arr.slice(index + 1)]
      }
    } else if (field) {
      // 중첩 객체 필드
      if (!s[path] || typeof s[path] !== 'object') s[path] = {}
      ;(s[path] as Record<string, unknown>)[field] = value
    } else {
      // 최상위 필드
      s[path] = value
    }
  }
  return s as unknown as School
}

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

코스 (index: 0부터):
${(school.courses ?? []).map((c, i) => {
  const p = (c as unknown as Record<string,number>).price4Weeks ?? 0
  return `  [${i}] ${c.name} / price4Weeks:${p.toLocaleString()}원 / currency:${c.currency}`
}).join('\n')}

기숙사 (index: 0부터):
${(school.dormitories ?? []).map((d, i) => {
  const p = (d as unknown as Record<string,number>).price4Weeks ?? 0
  return `  [${i}] ${d.name} / price4Weeks:${p.toLocaleString()}원`
}).join('\n')}

서차지 (index: 0부터):
${(school.surcharges ?? []).map((s, i) => `  [${i}] ${s.label} / pricePerWeek:${s.pricePerWeek?.toLocaleString()} / ${s.startDate}~${s.endDate}`).join('\n') || '  없음'}

등록비: amount:${school.registrationFee?.amount ?? 0} / currency:${school.registrationFee?.currency ?? 'KRW'}

프로모션 (${(promos ?? []).length}개):
${(promos ?? []).map((p, i) => {
  const pAny = p as unknown as Record<string, unknown>
  return `  [${i}] id:${p.id} | ${p.promoName} | discountValue:${pAny.discountValue ?? '-'} | ${p.startDate}~${p.endDate} | active:${p.active}`
}).join('\n') || '  없음'}
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
    console.log('[edit-data] raw:', rawText.slice(0, 400))

    const parsed = extractJson(rawText)
    if (!parsed) return NextResponse.json({ action: 'answer', message: rawText })

    if (parsed.action === 'confirm') {
      const ops = (parsed.ops ?? []) as Array<{path:string; index?:number; field?:string; value:unknown}>
      const promoOps = (parsed.promoOps ?? []) as Array<{id:string; field:string; value:unknown}>

      // 서버에서 ops 적용
      const updatedSchool = ops.length > 0 ? applyOps(school, ops) : school

      // 프로모션 적용
      let updatedPromos: PromoEntry[] | null = null
      const changedPromoIds: string[] = []
      if (promoOps.length > 0 && promos) {
        updatedPromos = JSON.parse(JSON.stringify(promos)) as PromoEntry[]
        for (const op of promoOps) {
          const idx = updatedPromos.findIndex(p => p.id === op.id)
          if (idx >= 0) {
            ;(updatedPromos[idx] as unknown as Record<string, unknown>)[op.field] = op.value
            changedPromoIds.push(op.id)
          } else {
            console.warn('[edit-data] promo not found:', op.id)
          }
        }
      }

      return NextResponse.json({
        action: 'confirm',
        summary: parsed.summary,
        changes: parsed.changes ?? [],
        updatedSchool,
        updatedPromos,
        changedPromoIds,
      })
    }

    return NextResponse.json(parsed)

  } catch (err) {
    console.error('[edit-data] error:', err)
    return NextResponse.json({ action: 'answer', message: `오류: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
