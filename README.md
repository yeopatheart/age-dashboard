# age-dashboard

통영아재수산 주문 관리 시스템 — 카카오톡 주문을 대시보드로 옮기고, 박스 할당·송장 라벨·상차 스캔까지 이어지는 B2B 수산물 주문·포장 대시보드.

도메인 용어, 명령, 코드 규칙은 [AGENTS.md](AGENTS.md), 결정 기록은 `docs/decisions/`, 제품 요구사항은 `docs/prd/`에 있다.

## 시작하기

```bash
cp .env.example .env   # Supabase 키 등을 채운다 (키 이름만 .env.example에 있다)
npm install
npm run dev            # http://localhost:3000
```

스키마는 `supabase/migrations/`의 SQL을 번호 순서대로 Supabase SQL Editor에서 실행해 만든다. `main`에 merge되면 Vercel이 자동 배포한다.
