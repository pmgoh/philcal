# 엠버시 견적 시스템

필리핀 어학연수 학비 견적 챗봇 시스템

## 기술 스택
- Next.js 14 (App Router)
- Firebase (Firestore + Authentication)
- Tailwind CSS
- Claude API (견적 계산 AI)

## 로컬 개발 환경 세팅

### 1. Firebase 프로젝트 생성
1. [Firebase Console](https://console.firebase.google.com) 접속
2. 새 프로젝트 생성
3. Authentication → 이메일/비밀번호 로그인 활성화
4. Firestore Database 생성 (production 모드)
5. 프로젝트 설정 → 웹앱 추가 → 설정값 복사

### 2. Firebase 첫 계정 생성
Firebase Console → Authentication → Users → Add User로 직원 계정 추가

### 3. 환경변수 설정
```bash
cp .env.local.example .env.local
# .env.local 파일에 Firebase 설정값 입력
```

### 4. 설치 및 실행
```bash
npm install
npm run dev
```

## Vercel 배포

1. GitHub에 코드 푸시
2. Vercel 프로젝트 생성 후 연결
3. Environment Variables에 .env.local 내용 입력
4. 자동 배포 완료

## Firestore 보안 규칙

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## 데이터 구조
- `schools/{id}` — 학원 정보 (코스/기숙사/서차지/프로모션 등 포함)
- `settings/exchangeRate` — 기준 환율
