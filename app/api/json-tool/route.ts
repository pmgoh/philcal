import { NextRequest } from 'next/server'

const SCHOOL_BASE_PROMPT = `당신은 필리핀 어학연수 학원 데이터 파서입니다.
업로드된 자료에서 학원 기본 정보를 추출하세요.

[출력 규칙]
- JSON 배열로만 반환. [ 로 시작 ] 로 끝.
- 코드블록, 설명 텍스트 없이
- 값을 모르면 빈값/null — 절대 추측 금지
- 금액: 원화 숫자(1100000), PHP 숫자(7800)
- 날짜: YYYY-MM-DD

[중요: 가격표 유형 구분]

① 합산 가격표 (등록금+학비+기숙사비+장기할인 포함) 형태:
   → 코스 가격과 기숙사 가격을 반드시 분리해서 각각 저장
   → packages는 빈 배열로
   → 검증: 등록금 + 코스4주 + 기숙사4주 = 표의 4주 셀 값
   예) 4인실+Sparta 4주 = 180만 → 등록금10만 + Sparta학비95만 + 4인실75만 = 180만

② 진짜 패키지 (가족연수, 캠프 등 묶음 판매):
   → packages에 저장 (columns = 인원구성)
   예) "보호자1+자녀1 4주 678만원"

③ 코스만 있는 표:
   → courses에만 저장, dormitories는 별도 표 참조

[추출 대상: 기본 정보 + 코스 + 기숙사 + 현지납부비 + 서차지]
패키지는 이 단계에서 빈 배열로 두세요: "packages": []

[스키마]
[{
  "name": "학원명(캠퍼스 포함)",
  "region": "세부|바기오|마닐라|클락|기타",
  "schoolType": "general|sparta",
  "programTags": ["성인일반","IELTS","TOEIC","가족연수","주니어","워킹홀리데이","비즈니스"],
  "minWeeks": 4, "allowShortTerm": false,
  "registrationFee": {"amount": 100000, "currency": "KRW", "note": "코스별 상이하면 note에 기재"},
  "courses": [{"id":"__new__","name":"코스명","target":"성인|주니어|보호자","price4Weeks":1100000,"currency":"KRW","note":""}],
  "dormitories": [{"id":"__new__","name":"기숙사명(인실 포함)","target":"전체|성인|주니어","price4Weeks":1200000,"currency":"KRW","note":""}],
  "packages": [],
  "surcharges": [{"id":"__new__","label":"서차지명","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","pricePerWeek":50000,"currency":"KRW","discountAllowed":false,"note":""}],
  "localFees": [{"id":"__new__","name":"항목명","amount":7800,"currency":"PHP","trigger":"always|per_week|per_4weeks|over_weeks|optional","triggerWeeks":null,"chargeUnit":"per_person|per_trip|flat","note":""}],
  "promotions": [],
  "generalNotes": "장기할인 등 특이사항 기재", "refundPolicy": "", "dormitoryRules": "", "isActive": true
}]

[trigger 기준]
- always: SSP, 보증금
- per_week: 전기세, 수도세, 관리비 (주당 청구)
- per_4weeks: 관리비, 전기세 (4주당 청구)
- over_weeks: 비자연장(1차:triggerWeeks=4, 2차:8, 3차:12, 4차:16, 5차:20), I-Card:8
- optional: 픽업, 교재비, 사진비`

const SCHOOL_PKG_PROMPT = `당신은 필리핀 어학연수 학원 패키지 데이터 파서입니다.
업로드된 자료에서 패키지 가격표만 추출하세요.

[출력 규칙]
- JSON 배열로만 반환. [ 로 시작 ] 로 끝.
- 코드블록, 설명 없이
- 금액: 원화 숫자. 날짜: YYYY-MM-DD

[추출 대상: 패키지만]
[{
  "schoolName": "학원명(기본정보와 동일하게)",
  "packages": [{
    "id": "__new__",
    "label": "패키지명(기숙사/인원구성 포함)",
    "season": "성수기|비수기|연중",
    "currency": "KRW",
    "startDate": null, "endDate": null,
    "includesLocalFees": false,
    "columns": ["컬럼1","컬럼2"],
    "priceMatrix": [
      {"weeks": 4, "prices": [{"label":"컬럼1","amount":0},{"label":"컬럼2","amount":0}]},
      {"weeks": 8, "prices": [{"label":"컬럼1","amount":0},{"label":"컬럼2","amount":0}]}
    ],
    "additionalRules": [],
    "includes": "포함사항",
    "excludes": "불포함사항",
    "note": ""
  }]
}]`

const PROMO_PROMPT = `당신은 필리핀 어학연수 프로모션 데이터 파서입니다.
업로드된 자료에서 프로모션 정보를 추출하세요.

[출력 규칙]
- JSON 배열로만 반환. [ 로 시작 ] 로 끝.
- 코드블록, 설명 없이
- 금액: 원화 숫자. 날짜: YYYY-MM-DD

[스키마]
[{
  "schoolName": "학원명",
  "promoName": "프로모션명",
  "region": "세부|바기오|마닐라|기타",
  "basisType": "enrollment_date|start_date",
  "alwaysApply": false,
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "discountType": "amount|percent",
  "discountValue": 50000,
  "applyToCourses": true,
  "applyToDorms": true,
  "applyToSurcharge": false,
  "condition": "",
  "applicableItems": [],
  "details": "상담원용 상세 설명",
  "note": "",
  "active": true,
  "agencyDiscountType": null,
  "agencyDiscountValue": null,
  "agencyDiscountApplyTo": "all",
  "agencyDiscountRegFee": null,
  "agencyDiscountNote": ""
}]`

async function callClaude(systemPrompt: string, content: unknown[], apiKey: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return { text: data.content?.[0]?.text ?? '', stopReason: data.stop_reason as string }
}

function extractJson(text: string, stopReason: string): unknown[] {
  // 첫 번째 [ 찾기
  const start = text.indexOf('[')
  if (start === -1) throw new Error('JSON 배열을 찾을 수 없습니다')

  // 괄호 균형 맞춰서 끝 위치 찾기
  let depth = 0
  let end = -1
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }

  let raw: string
  if (end === -1) {
    // 잘린 경우 — 마지막 완전한 객체까지 복구
    raw = text.slice(start)
    const lastBrace = raw.lastIndexOf('}')
    if (lastBrace > 0) {
      raw = raw.slice(0, lastBrace + 1)
      const opens  = (raw.match(/\[/g) ?? []).length
      const closes = (raw.match(/\]/g) ?? []).length
      raw += ']'.repeat(Math.max(0, opens - closes))
    }
  } else {
    raw = text.slice(start, end + 1)
  }

  if (stopReason === 'max_tokens' && end === -1) {
    // 이미 위에서 처리됨
  }

  return JSON.parse(raw)
}

function makeFilesContent(files: File[]): Promise<unknown[]> {
  return Promise.all(files.map(async file => {
    const buf = await file.arrayBuffer()
    const b64 = Buffer.from(buf).toString('base64')
    const mime = file.type as string
    if (mime === 'application/pdf') {
      return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    }
    return { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } }
  }))
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API 키 미설정' }), { status: 500 })
  }

  const formData = await req.formData()
  const files = formData.getAll('files') as File[]
  const userNote = (formData.get('note') as string) ?? ''
  const mode = (formData.get('mode') as string) ?? 'school'

  if (!files.length) {
    return new Response(JSON.stringify({ error: '파일이 없습니다.' }), { status: 400 })
  }

  // SSE 스트림
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const fileContent = await makeFilesContent(files)
        const userNoteContent = userNote
          ? [{ type: 'text', text: `추가 지시사항: ${userNote}` }]
          : []
        const baseContent = [...fileContent, ...userNoteContent]

        if (mode === 'promotion') {
          send({ step: 1, total: 1, label: '프로모션 데이터 파싱 중...' })
          const content = [...baseContent, { type: 'text', text: '위 자료에서 프로모션 정보를 추출해주세요.' }]
          const { text, stopReason } = await callClaude(PROMO_PROMPT, content, apiKey)
          const result = extractJson(text, stopReason)
          send({ done: true, result, raw: JSON.stringify(result, null, 2), warning: stopReason === 'max_tokens' ? '⚠️ 토큰 초과로 일부만 파싱됐습니다.' : undefined })

        } else {
          // 학원 데이터: 2단계
          // 1단계: 기본 정보
          send({ step: 1, total: 2, label: '1/2 기본 정보 파싱 중 (코스·기숙사·현지납부비)...' })
          const baseMsg = [...baseContent, { type: 'text', text: '코스, 기숙사, 현지납부비, 서차지 등 기본 정보를 추출해주세요. 패키지는 빈 배열로 두세요.' }]
          const { text: baseText, stopReason: baseStop } = await callClaude(SCHOOL_BASE_PROMPT, baseMsg, apiKey)
          const baseResult = extractJson(baseText, baseStop) as Record<string, unknown>[]

          // 2단계: 패키지
          send({ step: 2, total: 2, label: '2/2 패키지 가격표 파싱 중...' })
          const pkgMsg = [...baseContent, { type: 'text', text: '패키지 가격표만 추출해주세요.' }]
          const { text: pkgText, stopReason: pkgStop } = await callClaude(SCHOOL_PKG_PROMPT, pkgMsg, apiKey)
          let pkgResult: Array<{ schoolName: string; packages: unknown[] }> = []
          try {
            pkgResult = extractJson(pkgText, pkgStop) as typeof pkgResult
          } catch {
            // 패키지 없는 학원일 수 있음 — 무시
          }

          // 병합: schoolName 기준으로 packages 주입
          const pkgMap: Record<string, unknown[]> = {}
          for (const p of pkgResult) {
            if (p.schoolName && Array.isArray(p.packages)) {
              pkgMap[p.schoolName] = p.packages
            }
          }
          const merged = baseResult.map(s => ({
            ...s,
            packages: pkgMap[s.name as string] ?? []
          }))

          const warning = (baseStop === 'max_tokens' || pkgStop === 'max_tokens')
            ? '⚠️ 일부 데이터가 잘렸을 수 있습니다. 결과를 검토해주세요.'
            : undefined
          send({ done: true, result: merged, raw: JSON.stringify(merged, null, 2), warning })
        }

      } catch (err) {
        send({ error: String(err) })
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}
