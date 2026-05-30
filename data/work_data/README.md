# 작업 데이터 (2026-05-30 기준, EQ2 라이브 전 검증본)

## schools/ — 학원 JSON 78개
- 펠라 1캠/2캠 분리본 포함 (school_english_fella_1.json, _2.json)
- Firestore의 schools 컬렉션에 업로드할 소스

## promotions_2026-05-30.json — 프로모션 228건
- 비세부 등록금 상시할인, 비수기 하반기 구간 추가 반영
- Firestore의 promotions 컬렉션에 업로드할 소스

## 이번 세션 반영된 검증 (회귀 정답지 31건 중 ✅20)
- campus 필터, target 필터(캠프/주니어 오매칭 차단)
- week_tiers 버그수정(상시 유학원할인 보존)
- 유학원할인 amount/reg_fee 타입 + 등록비성 중복방지
- 서차지 겹침 floor + 토일월 입국 그룹 정규화
- 펠라 1/2캠 분리, 비세부 등록금/비수기 보완
