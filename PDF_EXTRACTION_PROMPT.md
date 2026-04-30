# 필리핀 어학원 학비 데이터 추출 프롬프트

아래 내용을 AI에게 그대로 전달하세요.
첨부 파일은 어학원 학비 안내 PDF입니다.

---

## [AI에게 전달할 프롬프트 시작]

당신은 필리핀 어학연수 학비 데이터 추출 전문가입니다.
첨부된 PDF에서 아래 JSON 스키마에 정확히 맞는 데이터를 추출해주세요.

### 추출 규칙

1. **반드시 JSON만 출력**하세요. 설명, 주석, 마크다운 코드블록 없이 순수 JSON만.
2. **id 필드**는 모두 빈 문자열 `""`로 두세요. (시스템에서 자동 생성)
3. **금액은 숫자만** (콤마, 원, ₱, $ 기호 제거). 예: "1,200,000원" → `1200000`
4. **통화 구분**: 원화 → `"KRW"`, 페소 → `"PHP"`, 달러 → `"USD"`
5. **날짜 형식**: `"YYYY-MM-DD"` (예: `"2026-07-05"`)
6. **operationPeriod의 날짜**: `"MM-DD"` 형식 (예: `"07-01"`)
7. 값을 **확인할 수 없는 필드**는 다음 기본값 사용:
   - string → `""`
   - number → `0`
   - boolean → `false`
   - array → `[]`
8. **programTags**는 아래 목록에서만 선택 (복수 가능):
   `"성인일반"`, `"가족연수"`, `"주니어"`, `"IELTS"`, `"TOEIC"`, `"TOEFL"`,
   `"비즈니스"`, `"시니어"`, `"골프"`, `"워킹홀리데이"`, `"공무원연수"`
9. **region**은 반드시 아래 중 하나:
   `"세부"`, `"바기오"`, `"클락"`, `"일로일로"`, `"바콜로드"`, `"마닐라"`, `"기타"`
10. **schoolType**: 스파르타(주중외출X) → `"sparta"`, 일반(주중외출O) → `"general"`, 둘 다 → `"both"`
11. **ShortTermPrice**: courseId, dormitoryId는 courses/dormitories 배열의 name 필드와 동일하게 임시 입력. (예: courseId: "인텐시브")
    → 실제 연결은 시스템에서 처리함
12. **패키지형** (총액 제시 방식, 코스·기숙사 분리 불가)만 packages에 넣고, 나머지는 모두 courses+dormitories로 분리 입력
13. 같은 코스라도 **대상이 다르면 별도 항목**으로 분리 (예: 성인 인텐시브 / 주니어 인텐시브)

---

### 출력할 JSON 구조

```
{
  "name": "학원 정식 명칭 (캠퍼스 포함)",
  "region": "세부 | 바기오 | 클락 | 일로일로 | 바콜로드 | 마닐라 | 기타",
  "schoolType": "sparta | general | both",
  "programTags": [],
  "minWeeks": 4,
  "allowShortTerm": false,

  "courses": [
    {
      "id": "",
      "name": "코스명 (예: 인텐시브, 일반영어, IELTS준비반)",
      "target": "대상 (예: 성인, 주니어, 부모, 시니어)",
      "pricePerWeek": 0,
      "currency": "KRW",
      "note": "특이사항 (없으면 빈 문자열)"
    }
  ],

  "dormitories": [
    {
      "id": "",
      "name": "기숙사명 (예: 1인실, 2인실, 스위트룸, 가족룸)",
      "target": "대상 (예: 성인, 주니어, 가족)",
      "pricePerWeek": 0,
      "currency": "KRW",
      "operationPeriod": null,
      "note": ""
    }
  ],

  "shortTermPrices": [
    {
      "id": "",
      "weeks": 1,
      "courseId": "코스명 (courses의 name과 동일하게)",
      "dormitoryId": "기숙사명 (dormitories의 name과 동일하게)",
      "coursePrice": 0,
      "dormitoryPrice": 0,
      "currency": "KRW"
    }
  ],

  "surcharges": [
    {
      "id": "",
      "label": "서차지 구분명 (예: 2026 여름 성수기 서차지)",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "pricePerWeek": 0,
      "currency": "KRW",
      "discountAllowed": true,
      "note": ""
    }
  ],

  "promotions": [
    {
      "id": "",
      "label": "프로모션명 (예: 비수기 할인, 장기연수 특가)",
      "basisType": "start_date | enrollment_date",
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "discountType": "percent | amount",
      "discountValue": 0,
      "currency": "KRW",
      "condition": "조건 텍스트 (예: 12주 이상, 없으면 빈 문자열)",
      "surchargeCompatible": false,
      "note": ""
    }
  ],

  "localFees": [
    {
      "id": "",
      "name": "항목명 (예: SSP, I-CARD, 비자연장비, 교재비, 관리비)",
      "amount": 0,
      "note": ""
    }
  ],

  "packages": [
    {
      "id": "",
      "label": "패키지명 (예: 가족연수 여름 패키지)",
      "condition": "적용 조건 (예: 부모 1인 + 자녀 1인, 4주)",
      "totalPrice": 0,
      "currency": "KRW",
      "includes": "포함 내역 텍스트",
      "startDate": "YYYY-MM-DD 또는 null",
      "endDate": "YYYY-MM-DD 또는 null",
      "note": ""
    }
  ],

  "refundPolicy": "환불 규정 전문을 그대로 입력 (없으면 빈 문자열)",
  "dormitoryRules": "기숙사 규정 전문 (없으면 빈 문자열)",
  "generalNotes": "기타 유의사항 전문 (없으면 빈 문자열)",
  "isActive": true
}
```

---

### 판단이 애매한 경우 기준

| 상황 | 처리 방법 |
|------|----------|
| 식사 포함 여부 불명확 | note 필드에 "식사 포함/불포함 여부 확인 필요" 기재 |
| 코스 가격이 기간별로 다름 | 가장 기본 단위(1주)를 pricePerWeek로, 나머지는 note에 기재 |
| 서차지 기간에 프로모션 적용 여부 불명확 | surchargeCompatible: false로 처리 후 note에 표시 |
| 통화 불명확 | 학원 소재 국가 기준 (필리핀 = PHP, 한국 납부 = KRW) |
| 4주 미만 가격이 명시적으로 있음 | allowShortTerm: true, shortTermPrices에 입력 |
| 4주 미만 언급 없음 | allowShortTerm: false |

---

### 추출 후 검토 체크리스트

추출 완료 후 아래 항목을 스스로 확인하고 문제 있으면 수정 후 출력하세요.

- [ ] courses 배열이 비어있지 않은가
- [ ] dormitories 배열이 비어있지 않은가
- [ ] 모든 금액 필드가 숫자인가 (문자열 아님)
- [ ] 날짜 형식이 YYYY-MM-DD인가
- [ ] shortTermPrices의 courseId/dormitoryId가 courses/dormitories의 name과 일치하는가
- [ ] programTags가 허용된 목록 안에 있는가
- [ ] region이 허용된 목록 안에 있는가

## [AI에게 전달할 프롬프트 끝]

---

## 사용 방법

1. 위 프롬프트를 복사해서 AI 대화창에 붙여넣기
2. PDF 파일 첨부
3. AI가 출력한 JSON을 복사
4. 엠버시 견적 시스템 → 학원 추가 → JSON 직접 붙여넣기 (추후 Import 기능 추가 예정)

## 주의사항

- 한 PDF에 여러 캠퍼스가 있으면 **캠퍼스마다 별도 추출** 요청
  예: "BECI EOP캠퍼스만 추출해줘", "BECI 스파르타캠퍼스만 추출해줘"
- 추출된 JSON은 반드시 **사람이 한 번 검토 후** 시스템에 입력
- 금액이 이상하거나 필드가 비어있으면 원본 PDF와 대조 확인
