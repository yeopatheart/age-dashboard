-- 박스 포장 추천은 아직 설계하지 않는다 — 형의 엑셀 기록과 어머니 인터뷰 결과가 와야
-- 실제 박스 치수·계수를 알 수 있다 (docs/prd/order-dashboard.md 미결 질문 2, 5).
-- 지금은 사람이 손으로 기록할 빈 참조 테이블만 만든다. order_items.box_result(0003)는
-- 이미 자유텍스트라 섀도우 모드에서 바로 손으로 기록할 수 있다.
create table boxes (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table boxes enable row level security;
create policy "auth all boxes" on boxes for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
