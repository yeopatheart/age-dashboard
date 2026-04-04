# FishBoard 프로젝트 준비 사항 체크리스트

**작성일**: 2026-04-04  
**프로젝트**: B2B 수산물 유통 자동화 시스템 (FishBoard)

---

## 전체 개발 로드맵

```
1. PRD 작성          ✅ 완료 (v1.3)
2. UI 디자인         🔄 진행중 (Figma Make)
3. 디자인-PRD 대조   ⏳ Figma 완성 후
4. 개발 계획서 작성  ⏳ PRD 최종 확정 후
5. 웹앱 개발         ⏳
6. GitHub + 배포     ⏳
7. 테스트            ⏳
```

---

## Phase 1: 개발 착수 전 준비 (지금 바로 가능)

### 1-1. 계정 및 서비스 가입

| 서비스 | 용도 | 무료 여부 | 링크 |
|--------|------|----------|------|
| **GitHub** | 코드 저장소, 버전 관리 | 무료 | https://github.com |
| **Vercel** | 프론트엔드 + API 배포 | 무료 (Hobby) | https://vercel.com |
| **Supabase** | PostgreSQL DB + 실시간 동기화 | 무료 (500MB) | https://supabase.com |

> ⚠️ 세 서비스 모두 GitHub 계정으로 연동하면 편합니다. GitHub 먼저 가입하세요.

### 1-2. 로컬 개발 환경

| 항목 | 상태 | 비고 |
|------|------|------|
| Node.js v24 | ✅ 설치 완료 | nvm으로 설치됨 |
| Git | ❓ 확인 필요 | `git --version`으로 확인 |
| VS Code | ❓ 확인 필요 | 권장 에디터 |
| VS Code 확장 | ⏳ | Prettier, ESLint, Prisma, Tailwind CSS IntelliSense |

### 1-3. 도메인 결정 (선택)

- 초기에는 Vercel 제공 무료 도메인 사용 가능 (`fishboard.vercel.app`)
- 실제 운영 시 커스텀 도메인 구매 권장 (예: `fishboard.co.kr`, 연 1-2만원)

---

## Phase 2: Figma 디자인 완성 후 (Step 3)

### 2-1. Figma MCP 연동 체크리스트

| 항목 | 상태 |
|------|------|
| Node.js 설치 | ✅ 완료 |
| figma-developer-mcp 설정 | ✅ 완료 |
| Figma API Key 등록 | ✅ 완료 |
| Antigravity 재시작 후 MCP 활성화 | ⏳ |
| Figma 파일 URL 공유 | ⏳ Figma Make 완성 후 |

### 2-2. PRD ↔ 디자인 크로스체크 항목

Figma 디자인 완성 후 아래 항목들을 PRD와 대조합니다:

- [ ] 모니터 1: 상단 상품 요약 영역 (25~30%) + 하단 주문 목록 레이아웃
- [ ] 모니터 2: 전체 주문 목록 레이아웃
- [ ] 주문 변경 하이라이트 컬러 (신규/수정/취소)
- [ ] 물봉 배지 디자인
- [ ] 포장 완료 상태 표시
- [ ] 중량 입력 인터랙션
- [ ] 로그인 화면
- [ ] 설정 화면 (업체/박스/상품/터미널 관리)
- [ ] 모바일 영업 담당자 뷰

---

## Phase 3: 개발 착수 전 (Step 4)

### 3-1. 개발 계획서에 포함될 내용

개발 계획서는 PRD를 기반으로 아래를 구체화합니다:

```
1. 시스템 아키텍처 다이어그램
2. 데이터베이스 ERD (상세 스키마)
3. API 엔드포인트 설계 (REST)
4. 페이지 및 컴포넌트 구조도
5. 마일스톤별 상세 작업 분해 (WBS)
6. 테스트 전략 (단위/통합/E2E)
7. 브랜치 전략 (Git Flow)
8. 배포 파이프라인 (CI/CD)
```

### 3-2. 현장 담당자에게 확인해야 할 사항

개발 시작 전 또는 초기 운영 시 수집:

- [ ] **박스 규격**: 현장 사용 박스 종류별 내부 치수 (가로×세로×높이 cm)
- [ ] **물봉박스 규격**: 물봉 전용 박스 치수
- [ ] **주요 취급 상품 크기**: 활전갱이, 참돔, 전복, 광어 등 평균 크기
- [ ] **포장재 두께**: 스티로폼, 에어캡 두께 (박스 배분 계산용)
- [ ] **얼음/아이스팩 평균 사용량**: 박스 크기별 사용 중량

> 💡 운영 초기에는 박스 자동 배분 기능을 OFF로 두고, 현장 수동 처리 → 데이터 쌓인 후 활성화 가능

---

## Phase 4: 개발 중 (Step 5)

### 4-1. 개발 순서 권장

```
Week 1-2: 인프라 & 인증
  - Next.js 프로젝트 셋업
  - Supabase DB 연결 + Prisma 스키마
  - NextAuth.js 로그인 구현
  - Vercel CI/CD 파이프라인

Week 3-4: 핵심 파싱 & 데이터
  - 카카오톡 메세지 파서 구현
  - 주문 CRUD API
  - 실시간 동기화 (SSE/Supabase Realtime)

Week 5-6: UI 구현
  - 모니터 1 뷰 (상품 요약 + 주문 목록)
  - 모니터 2 뷰 (전체 주문 목록)
  - 주문 입력 화면

Week 7-8: 설정 관리
  - 업체/터미널/상품/박스 CRUD UI
  - 계정 관리 UI

Week 9-10: 고급 기능
  - 주문 변경 하이라이트
  - 포장 완료 처리
  - 중량 입력
  - 이력 조회

Week 11-12: 박스 배분 알고리즘 (데이터 확보 후)
  - BFD 알고리즘 구현
  - 물봉박스 분리 로직

Week 13-14: 테스트 & 폴리싱
  - 단위 테스트 커버리지
  - E2E 테스트
  - 성능 최적화
  - 현장 UAT
```

### 4-2. 테스트 전략

| 테스트 종류 | 대상 | 도구 |
|------------|------|------|
| **단위 테스트** | 파서 로직, 박스 배분 알고리즘, 유틸 함수 | Vitest |
| **통합 테스트** | API 엔드포인트, DB 쿼리 | Vitest + Supertest |
| **E2E 테스트** | 주문 입력 → 대시보드 반영 전체 플로우 | Playwright |
| **현장 UAT** | 실제 현장 담당자/작업자 테스트 | 직접 |

---

## Phase 5: 배포 (Step 6)

### 5-1. GitHub 설정

```bash
# 저장소 생성 후
git init
git remote add origin https://github.com/[username]/fishboard.git

# 브랜치 전략
main        ← 프로덕션 배포용
develop     ← 개발 통합용
feature/*   ← 기능 개발용
hotfix/*    ← 긴급 수정용
```

### 5-2. Vercel 배포 설정

- GitHub 저장소 연결 → `main` 브랜치 push 시 자동 배포
- `develop` 브랜치 → 스테이징 환경 자동 배포
- 환경 변수 (.env) Vercel 대시보드에 등록

### 5-3. 필요한 환경 변수 목록

```env
# Database
DATABASE_URL=postgresql://...

# Auth
NEXTAUTH_URL=https://fishboard.vercel.app
NEXTAUTH_SECRET=[랜덤 32자 문자열]

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Phase 6: 테스트 (Step 7)

### 6-1. 현장 테스트 체크리스트

- [ ] 실제 카카오톡 메세지 40건 입력 → 파싱 정확도 검증
- [ ] 모니터 2대에서 동시 접속 → 실시간 동기화 확인
- [ ] 영업 담당자 원격(스마트폰)에서 주문 입력 → 현장 반영 확인
- [ ] 주문 수정 시 변경 하이라이트 표시 확인
- [ ] 물봉 상품 포장 완료 처리 확인
- [ ] 중량 입력 확인

---

## 현재 상태 요약

```
✅ 완료
  - PRD v1.3 작성
  - 카카오톡 메세지 포맷 확정 및 가이드 작성
  - Node.js + Figma MCP 설정
  - docs/ 폴더 문서 정리
  - GitHub 저장소 생성 및 초기 커밋 업로드
  - Vercel / Supabase 플랫폼 계정 가입 완료

🔄 진행중
  - Figma Make로 UI 디자인 (완성 후 PRD와 크로스체크 예정)

⏳ 대기중
  - Figma 디자인 완성 시 MCP 연동하여 교차 검증
  - 개발 계획서 작성 및 프로젝트 구조화
  - Vercel, Supabase 프로젝트 생성, DB 스키마 작업 등

📋 현장 담당자 확인 필요
  - 박스 규격 (초기 배포 후 설정 UI로 직접 입력 가능)
  - 주요 상품별 평균 크기
```
