<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# age-dashboard

경남 통영 수산물 B2B 사업의 주문 수집 자동화 + 포장(박스) 추천 대시보드. 카카오톡으로 전달되는 주문을 대시보드로 옮기고, 실측 중량/사이즈를 반영해 박스 포장 추천까지 자동화한다 (docs/prd/order-dashboard.md 참고).

<!-- 이 파일이 코딩 규칙의 원본이다.
     Claude Code 는 CLAUDE.md 의 @AGENTS.md import 로 같은 내용을 본다.
     규칙을 두 벌 관리하지 않는다. -->

## 명령 (직접 실행해서 동작 확인한 것만 적는다)
- 개발: `npm run dev`
- 테스트: (v1은 자동 테스트 없음 — 수동 브라우저 테스트로 검증)
- 린트: `npm run lint` (기존 스캐폴드에 이미 있던 이슈 2건은 별도 — 아래 "알려진 이슈" 참고)
- 타입 체크: `npx tsc --noEmit`
- 빌드: `npm run build`

## 스택
Next.js (App Router) + TypeScript · Tailwind · Supabase (Postgres + Auth + Storage, Prisma 없음) · Anthropic API(비전, 아크릴 카드 OCR) · Vercel

Prisma를 의도적으로 뺀다: 인증(Auth)이 어차피 Supabase Auth 몫이고, age-seafood에서 이미 검증한 패턴(Prisma 없이 Supabase 클라이언트 + `supabase/migrations/` SQL)을 재사용한다 (docs/decisions/2026-09-29-order-dashboard-architecture.md). age-seafood와는 **별도의 Supabase 프로젝트**를 쓴다 — 스키마·마이그레이션·인증을 완전히 분리해 서로 영향이 없게 한다.

## 도메인 용어
- **업체번호-상품순서 코드**: 주문 한 줄(업체×상품 조합)마다 매기는 고유 식별자(예: "12-2" = 12번 업체의 2번째 상품 줄). 카카오 메시지 자체에는 번호가 없어 시스템이 내부적으로 append-only로 생성한다. 삭제돼도 번호를 재사용하지 않는다.
- **신규/업데이트 구분**: 붙여넣은 카카오 메시지의 각 줄을 오늘자 기존 주문의 업체명과 자동 대조해서 신규/업데이트를 제안하고, 사람이 확인 화면에서 줄 단위로 확정한다. 메시지 텍스트 자체에 의존하지 않는다.
- **아크릴 카드**: 작업자가 실측 중량/사이즈를 적어두는 재사용 가능한 write-erase 카드. "업체번호-상품순서 코드 + 실측값"만 적는다. TV 화면에는 붙이지 않고 별도 트레이에 모아 일괄 촬영 → OCR로 반영.
- **섀도우 모드**: 1차 버전을 실제 운영 전환 전에 어머니의 기존 화이트보드/형의 엑셀 기록과 병행 운영하며 정확도를 측정하는 기간. 형이 기존에 정리해온 엑셀 기록을 그대로 비교 기준(ground truth)으로 쓴다.
- **박스 포장 추천**: 기존 엑셀/장부·화이트보드 사진 기반 학습 데이터 + 어머니 인터뷰로 뽑은 판단 규칙을 병행 반영. 구체 알고리즘은 실제 엑셀 데이터 확인 후 설계(아직 미정 — 지어내지 않는다).

## 코드 규칙
- `any` 금지. 모르면 `unknown` 후 좁힌다.
- 주변 코드의 스타일·네이밍·주석 밀도를 따른다. 혼자 다른 컨벤션을 도입하지 않는다.
- 요청하지 않은 리팩토링을 끼워넣지 않는다. 발견한 문제는 말로 먼저 알린다.
- 라이브러리를 추가하기 전에 `package.json`에 이미 있는지 확인한다.
- 파일명 `lowercase-kebab-case`. 단 프레임워크 관례가 있으면 그쪽 (`PascalCase.tsx`, `page.tsx`, `[id]`).

## 시크릿
- `.env*`, 키 파일, 토큰은 커밋하지 않는다. 예시는 `.env.example`에 키 이름만.
- Supabase `anon key`(클라이언트 노출 가능)와 `service_role key`(서버 전용)를 혼동하지 않는다.
- `NEXT_PUBLIC_` 접두사가 붙은 값은 브라우저에 그대로 노출된다.
- git remote URL에 토큰을 넣지 않는다(SSH 키 또는 credential helper 사용). `https://ghp_xxx@github.com/...` 형태를 발견하면 즉시 알린다.

## 건드리면 안 되는 것
- `supabase/migrations/` — 적용된 마이그레이션 파일은 손으로 고치지 않는다. 스키마 변경은 새 마이그레이션 파일로 추가한다
- `.env`, `.env.local` — 실제 키 값. 커밋 금지

## 알려진 이슈
- `src/app/(dashboard)/dashboard/dashboard-client.tsx`의 실시간 시계, `src/app/(dashboard)/dashboard-shell.tsx`의 사이드바 접힘 상태(localStorage 복원) — 둘 다 이펙트 안에서 setState 동기 호출 (React Compiler 경고, 빌드는 통과함). 서버 렌더 시 존재하지 않는 값(시간, localStorage)을 다루는 곳이라, 일부러 기본값으로 먼저 그리고 마운트 후 채우는 패턴이다. lazy initializer로 "고치면" 서버/클라이언트 렌더 결과가 달라져 진짜 하이드레이션 불일치 경고가 생기므로 그대로 둔다.

## 작업 방식
- 파일을 고치기 전에 읽는다. 추측으로 수정하지 않는다.
- 변경 후 타입 체크·빌드·테스트 중 가능한 것을 돌려 확인한다. 실패하면 실패했다고 말한다.
- 되돌리기 어려운 작업(파일 삭제, force push, 마이그레이션 실행, 배포)은 먼저 확인받는다.
