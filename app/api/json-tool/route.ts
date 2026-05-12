import { NextRequest, NextResponse } from 'next/server'

const SCHEMA_PROMPT = `당신은 필리핀 어학연수 학원 데이터 파서입니다.
업로드된 자료(PDF/이미지)를 분석해서 아래 JSON 스키마로 변환하세요.

[출력 규칙]
- JSON 배열로만 반환 (학원이 1개여도 배열)
- 코드블록, 설명 텍스트 없이 [ 로 시작 ] 로 끝
- 값을 모르면 null 또는 빈값 — 절대 추측 금지
- 금액: 원화는 숫자(예: 1100000), PHP는 숫자(예: 7800)
- 날짜: YYYY-MM-DD

[스키마]
[
  {
    "name": "학원명 (캠퍼스 구분 포함)",
    "region": "세부|바기오|마닐라|클락|기타",
    "schoolType": "general|sparta",
    "programTags": ["성인일반","IELTS","TOEIC","가족연수","주니어","워킹홀리데이","비즈니스"],
    "minWeeks": 4,
    "allowShortTerm": false,
    "registrationFee": { "amount": 100000, "currency": "KRW", "note": "" },
    "courses": [
      {
        "id": "__new__",
        "name": "코스명",
        "target": "성인|주니어|보호자",
        "price4Weeks": 1100000,
        "currency": "KRW",
        "note": ""
      }
    ],
    "dormitories": [
      {
        "id": "__new__",
        "name": "기숙사명 (인실 구분 포함)",
        "target": "전체|성인|주니어",
        "price4Weeks": 1200000,
        "currency": "KRW",
        "note": ""
      }
    ],
    "packages": [
      {
        "id": "__new__",
        "label": "패키지명 (가족구성 포함)",
        "season": "성수기|비수기|연중",
        "currency": "KRW",
        "startDate": "YYYY-MM-DD 또는 null",
        "endDate": "YYYY-MM-DD 또는 null",
        "includesLocalFees": true,
        "columns": ["메인동","아넥스동"],
        "priceMatrix": [
          { "weeks": 4, "prices": [{ "label": "메인동", "amount": 6780000 }] },
          { "weeks": 8, "prices": [{ "label": "메인동", "amount": 13080000 }] }
        ],
        "additionalRules": [],
        "includes": "포함사항",
        "excludes": "불포함사항",
        "note": ""
      }
    ],
    "surcharges": [
      {
        "id": "__new__",
        "label": "서차지명",
        "startDate": "YYYY-MM-DD",
        "endDate": "YYYY-MM-DD",
        "pricePerWeek": 50000,
        "currency": "KRW",
        "discountAllowed": false,
        "note": ""
      }
    ],
    "localFees": [
      {
        "id": "__new__",
        "name": "항목명",
        "amount": 7800,
        "currency": "PHP",
        "trigger": "always|per_week|per_4weeks|over_weeks|optional",
        "triggerWeeks": null,
        "chargeUnit": "per_person|per_trip|flat",
        "note": ""
      }
    ],
    "promotions": [],
    "generalNotes": "",
    "refundPolicy": "",
    "dormitoryRules": "",
    "isActive": true
  }
]

[trigger 기준]
- always: 무조건 발생 (SSP, 보증금 등)
- per_week: 주당 발생 (전기세, 수도세, 관리비)
- over_weeks: N주 초과 시 발생 (비자연장, I-Card)
  → 비자연장 1차(5주~): triggerWeeks=4
  → 비자연장 2차(9주~): triggerWeeks=8
  → I-Card(59일이상): triggerWeeks=8
  → 비자연장 3차(13주~): triggerWeeks=12
- optional: 선택항목 (픽업, 교재비, 사진비 등)

자료에 명시된 값만 넣고, 불분명한 항목은 빈값이나 null로 남기세요.`

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]
    const userNote = (formData.get('note') as string) ?? ''

    if (!files.length)
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
    if (!process.env.ANTHROPIC_API_KEY)
      return NextResponse.json({ error: 'API 키 미설정' }, { status: 500 })

    // 파일을 base64로 변환
    const content: unknown[] = []

    for (const file of files) {
      const buf = await file.arrayBuffer()
      const b64 = Buffer.from(buf).toString('base64')
      const mime = file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'

      if (mime === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } })
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } })
      }
    }

    if (userNote) {
      content.push({ type: 'text', text: `추가 지시사항: ${userNote}` })
    }
    content.push({ type: 'text', text: '위 자료를 분석해서 JSON 스키마대로 변환해주세요.' })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: SCHEMA_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    })

    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''

    // JSON 추출
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return NextResponse.json({ error: '파싱 실패', raw: text }, { status: 422 })

    try {
      const parsed = JSON.parse(match[0])
      return NextResponse.json({ ok: true, result: parsed, raw: match[0] })
    } catch {
      return NextResponse.json({ error: 'JSON 파싱 오류', raw: match[0] }, { status: 422 })
    }

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
