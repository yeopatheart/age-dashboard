<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# age-dashboard

경남 통영 수산물 B2B 사업의 주문 수집 자동화 + 포장(박스) 추천 대시보드. 카카오톡으로 전달되는 주문을 대시보드로 옮기고, 실측 중량/사이즈를 반영해 박스 포장 추천까지 자동화한다 (docs/prd/order-dashboard.md 참고).

<!-- 이 파일이 코딩 규칙의 원본이다.
     Claude Code 는 CLAUDE.md 의 @AGENTS.md import 로 같은 내용을 본다.
     규칙을 두 벌 관리하지 않는다. -->

## 명령 (직접 실행해서 동작 확인한 것만 적는다)
- 개발: `npm run dev`
- 테스트: `npm test` (순수 로직 단위 테스트: 카카오 파서·금액·날짜 규칙·합포장·박스 추천 모델·정산 매입. Node 내장 러너라 별도 라이브러리 없음. 화면·서버 액션은 수동 브라우저 테스트로 검증)
- 박스 추천 백테스트: `npm run packing:backtest` (`.local-data/packing_export.csv` 필요 — 업체명이 들어 있어 커밋하지 않는다. 내보내는 쿼리는 docs/decisions/2026-10-24-box-recommendation-v1.md 참고)
- 린트: `npm run lint` (현재 오류·경고 0건)
- 타입 체크: `npx tsc --noEmit`
- 빌드: `npm run build`

## 스택
Next.js (App Router) + TypeScript · Tailwind · Supabase (Postgres + Auth + Storage, Prisma 없음) · Anthropic API(카카오 주문 문장 보정) · Vercel

Prisma를 의도적으로 뺀다: 인증(Auth)이 어차피 Supabase Auth 몫이고, age-seafood에서 이미 검증한 패턴(Prisma 없이 Supabase 클라이언트 + `supabase/migrations/` SQL)을 재사용한다 (docs/decisions/2026-09-29-order-dashboard-architecture.md). age-seafood와는 **별도의 Supabase 프로젝트**를 쓴다 — 스키마·마이그레이션·인증을 완전히 분리해 서로 영향이 없게 한다.

## 도메인 용어
- **업체번호-상품순서 코드**: 주문 한 줄(업체×상품 조합)마다 매기는 고유 식별자(예: "12-2" = 12번 업체의 2번째 상품 줄). 카카오 메시지 자체에는 번호가 없어 시스템이 내부적으로 append-only로 생성한다. 삭제돼도 번호를 재사용하지 않는다.
- **신규/업데이트 구분**: 붙여넣은 카카오 메시지의 각 줄을 오늘자 기존 주문의 업체명과 자동 대조해서 신규/업데이트를 제안하고, 사람이 확인 화면에서 줄 단위로 확정한다. 메시지 텍스트 자체에 의존하지 않는다.
- **아크릴 카드**: 작업자가 실측 중량/사이즈를 적어두는 재사용 가능한 write-erase 카드. "업체번호-상품순서 코드 + 실측값"만 적는다. TV 화면에는 붙이지 않고 별도 트레이에 모아 일괄 촬영 → OCR로 반영하려던 계획이었으나 구현하지 않았고, 관련 테이블·컬럼은 마이그레이션 0034에서 정리했다.
- **송장 라벨 · 상차 스캔**: 박스마다 숫자 12자리 번호(`YYMMDD+업체번호3+순번2+확인1`)를 발급해 QR 코드로 뚜껑 모서리에 감아 붙이는 한 장짜리 라벨(상단 면+측면)을 출력하고(라벨 설정에서 디자인 편집), 상차 때 `/scan`에서 QR을 스캔하면 상차 완료가 된다. 결정·프린터 추천은 docs/decisions/2026-10-28-box-labels-and-scan.md.
- **대시보드(현황) · 주문 목록**: 메뉴 "대시보드"(`/overview`)는 하루 주문이 포장 → 박스 → 라벨 → 상차 어디까지 왔는지 보는 읽기 전용 화면이고, 예전 대시보드는 "주문 목록"(`/dashboard`)이다. 단계(박스 할당 중 → 라벨 출력 중 → 포장 중 → 포장 완료 → 상차 중 → 출고 완료) 정의는 `src/lib/overview.ts`, 결정은 docs/decisions/2026-10-29-overview-dashboard.md.
- **합포장**: 포장이 끝난 뒤 한 고객 카드의 박스 여러 개를 함께 테이핑해 내보내는 것. `daily_businesses.merge_groups`로 박스 번호 묶음을 저장하고, 라벨에 "합포장 1·2"를 찍으며, 묶음 중 하나를 스캔하면 모두 상차 처리된다. 결정은 docs/decisions/2026-10-30-box-merge.md.
- **물봉 · 기포기**: 물봉은 물봉 안에 상품을 담는 것, 기포기는 물봉에 기포기를 부착해서 내보내는 것(`order_items.is_mulbong`, `has_aerator`; 기포기면 둘 다 true). 같은 상품도 준비 방식이 다르면 별개 줄·합계다. 결정은 docs/decisions/2026-10-30-mulbong-aerator.md.
- **섀도우 모드**: 1차 버전을 실제 운영 전환 전에 어머니의 기존 화이트보드/형의 엑셀 기록과 병행 운영하며 정확도를 측정하는 기간. 형이 기존에 정리해온 엑셀 기록을 그대로 비교 기준(ground truth)으로 쓴다.
- **박스 포장 추천**(화면 이름: 박스 할당, 경로 `/packing-log`): 박스 기록(`packing_records`)을 집계한 규칙+사례 모델(`src/lib/packing/model.ts`, v1). 1박스 기록은 상품 배치까지 정확해 학습에 쓰고, 2박스 이상 기록은 박스 종류·개수만 믿는다. 그날 첫 접속 시 자동 재학습하고, 추천은 shadow test로 현장 결과와 비교한다. 설계·정확도는 docs/decisions/2026-10-24-box-recommendation-v1.md.

## 코드 규칙
- `any` 금지. 모르면 `unknown` 후 좁힌다.
- 주변 코드의 스타일·네이밍·주석 밀도를 따른다. 혼자 다른 컨벤션을 도입하지 않는다.
- 요청하지 않은 리팩토링을 끼워넣지 않는다. 발견한 문제는 말로 먼저 알린다.
- 라이브러리를 추가하기 전에 `package.json`에 이미 있는지 확인한다.
- 파일명 `lowercase-kebab-case`. 단 프레임워크 관례가 있으면 그쪽 (`PascalCase.tsx`, `page.tsx`, `[id]`).

## 시크릿
- `.env*`, 키 파일, 토큰은 커밋하지 않는다. 예시는 `.env.example`에 키 이름만.
- Supabase `anon key`(클라이언트 노출 가능)와 `service_role key`(서버 전용)를 혼동하지 않는다. `SUPABASE_SERVICE_ROLE_KEY`는 `src/lib/supabase/admin.ts`(사용자 및 권한 메뉴)에서만 쓴다.
- `NEXT_PUBLIC_` 접두사가 붙은 값은 브라우저에 그대로 노출된다.
- git remote URL에 토큰을 넣지 않는다(SSH 키 또는 credential helper 사용). `https://ghp_xxx@github.com/...` 형태를 발견하면 즉시 알린다.

## 건드리면 안 되는 것
- `supabase/migrations/` — 적용된 마이그레이션 파일은 손으로 고치지 않는다. 스키마 변경은 새 마이그레이션 파일로 추가한다
- `.env`, `.env.local` — 실제 키 값. 커밋 금지

## 모바일 UI 규칙
휴대폰(768px 이하) 화면은 `src/app/globals.css`의 "휴대폰 UI 규칙" 토큰을 쓴다: 컨트롤 높이 `--ctl-h`(36px), 칩 `--chip-h`(32px), 주 동작 `--cta-h`(48px), html 글자 14px, 입력창 `--input-fs`(16px — 이보다 작으면 iOS가 입력할 때 화면을 확대한다. viewport maximum-scale 제한은 두지 않는다), 메뉴 설명 숨김. 새 화면·컴포넌트는 개별 크기를 새로 정하지 말고 이 토큰을 쓴다. 화면 안의 제목 줄(`.page-header`: 아이콘 + 제목 + 설명)은 모바일에서 숨긴다 — 상단 바가 이미 메뉴 이름을 보여 주기 때문이다. 상단 바와 다른 제목을 가진 하위 화면(예: 박스 추천 정확도)만 `page-header-keep`을 붙여 남긴다. 새 화면은 `AdminHeader`/`.page-header`를 쓰면 이 규칙이 자동으로 적용된다. 날짜·기간 선택은 `src/components/date-nav.tsx`의 `DateNav`(하루)·`PeriodNav`(일/주/월), 구분 선택(일/주/월, 전체/기본/별도, 보기 전환 등)은 `src/components/segmented.tsx`의 `Segmented` 하나만 쓴다 — 화면마다 따로 만들지 않는다(2026-11-07에 5가지로 갈라져 있던 것을 합쳤다. 모양은 globals.css의 `.dn-*`·`.sg-*` 한 곳). 휴대폰 여부는 `src/lib/use-is-mobile.ts`. 근거는 docs/decisions/2026-10-29-mobile-ui.md.

## 디자인 기준 (2026-11-07, 전체 화면 점검 후 확정)
컨트롤 글자는 자리마다 하나다: 도구줄(`.ak-toolbar`) 안 = `--fs-sm`, 표 안(입력·선택·본문) = `--fs-md`. 휴대폰 입력 글자는 `--input-fs`가 정하고(globals.css) 자리에서 덮어쓴다 — iOS 자동 확대는 viewport `maximum-scale=1`로 막는다(layout.tsx). 개발 서버가 옛 CSS를 내보내면 `.next`를 지우고 다시 띄운다.
글자·간격·모서리는 화면마다 정하지 않고 `src/app/globals.css`의 "디자인 기준" 토큰만 쓴다. 글자: `--fs-xs`(보조·표 머리·배지) · `--fs-sm`(버튼·칩·보조 문장) · `--fs-md`(본문·표 본문) · `--fs-lg`(카드·구역 제목) · `--fs-xl`(페이지 제목) · `--fs-num`(큰 숫자). 간격: `--space-block`(카드·도구줄 사이) · `--space-card`(카드 안쪽 여백) · `--space-inner`(카드 안 요소 사이). 카드 = 흰 배경 + 1px 테두리 + `--radius-lg` + `--shadow-sm`(카드 안의 항목은 테두리만), 버튼·선택칸은 알약(999px), 글자 입력칸은 `--radius-input`. 새 화면에서 `font-size: 0.9375rem`·`gap: 0.9rem`·`border-radius: 14px` 같은 값을 직접 쓰지 않는다 — 점검 때 페이지 제목 20/22px, 블록 간격 14/16/20/28px, 카드 모서리 8/10/12/14/16px, 카드 안쪽 여백 7가지, 표 본문 13/14px로 갈라져 있었다. 근거는 docs/decisions/2026-11-07-design-tokens.md.

## 알려진 이슈
- 권한: master 이메일 하나(`src/lib/permissions/catalog.ts`)와 `user_permissions` 표로 메뉴·기능 접근을 나눈다. 모든 `page.tsx`는 `requireMenu`, 모든 server action은 `requirePermission`으로 서버에서 확인한다(새 페이지·액션을 만들면 반드시 넣는다). DB 규칙(RLS): 정산·매입처·사업자·카톡 원문·시스템 설정·접근 기록 테이블은 마이그레이션 0045부터 `has_perm('메뉴:동작')`으로 DB에서도 메뉴 권한을 확인한다(새 민감 테이블을 만들면 같은 방식으로 정책을 쓴다). 주문·박스·라벨 등 현장 운영 테이블과 `businesses`(사업자번호 포함)는 여전히 로그인 사용자 전체 허용이다(여러 메뉴가 같이 읽어서 나눌 수 없다).
- 저장 뒤 화면 갱신: server action이 `revalidatePath`를 부르면 같은 응답에 새 화면이 실려 오므로 클라이언트에서 `router.refresh()`를 또 부르지 않는다(이중 렌더).

## 작업 방식
- 파일을 고치기 전에 읽는다. 추측으로 수정하지 않는다.
- 변경 후 타입 체크·빌드·테스트 중 가능한 것을 돌려 확인한다. 실패하면 실패했다고 말한다.
- 되돌리기 어려운 작업(파일 삭제, force push, 마이그레이션 실행, 배포)은 먼저 확인받는다.
