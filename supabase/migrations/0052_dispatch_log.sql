-- 보내기 기록. "보내기" 화면에서 기사 글·영수증을 공유/복사한 순간을 남겨, 새로고침해도 어디까지 보냈는지 알 수 있게 한다.
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 보냄 기록 코드를 배포한다.
--  - kind: 'driver'(기사 글, key=터미널 이름) | 'receipt'(영수증 카드, key=영수증 id:쪽 번호).
--  - method: 'share'(공유 시트가 성공으로 끝남) | 'copy'(클립보드 복사 성공). 공유 시트를 닫았거나 복사에 실패했거나 파일로 저장만 한 것은 기록하지 않는다.
--  - content_hash: 보낸 글의 해시. 보낸 뒤 글이 달라졌는지 비교하는 데 쓴다(기사 글만. 영수증은 발행 뒤 바뀌지 않으므로 null).
--  - 같은 항목을 여러 번 보낼 수 있어 unique 제약은 두지 않는다. 화면은 항목마다 가장 최근 기록만 쓴다.
-- 권한은 새로 만들지 않고 기존 보기 권한을 따른다: 기사=scan:view, 영수증=receipts:view(0049). 수정·삭제 정책은 없다(기록은 바꾸지 않는다).
create table if not exists public.dispatch_log (
  id uuid primary key default gen_random_uuid(),
  order_date date not null,
  kind text not null check (kind in ('driver', 'receipt')),
  key text not null check (char_length(key) between 1 and 100),
  method text not null check (method in ('share', 'copy')),
  content_hash text check (content_hash is null or char_length(content_hash) <= 64),
  sent_by uuid default auth.uid(),
  sent_at timestamptz not null default now()
);

create index if not exists dispatch_log_date_idx on public.dispatch_log (order_date, kind);

alter table public.dispatch_log enable row level security;

drop policy if exists "dispatch_log select" on public.dispatch_log;
drop policy if exists "dispatch_log insert" on public.dispatch_log;
create policy "dispatch_log select" on public.dispatch_log for select using (
  (select (kind = 'driver' and public.has_perm('scan:view')) or (kind = 'receipt' and public.has_perm('receipts:view')))
);
create policy "dispatch_log insert" on public.dispatch_log for insert with check (
  sent_by = (select auth.uid())
  and (select (kind = 'driver' and public.has_perm('scan:view')) or (kind = 'receipt' and public.has_perm('receipts:view')))
);

-- 되돌리기(필요할 때만):
-- drop table public.dispatch_log;
