-- 보내기 기록(0052)에 "고객사 메시지"를 더한다. 보내기 화면 고객사 탭에서 업체에 정산 메시지를 공유/복사한 순간을 남긴다.
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 고객사 탭 코드를 배포한다(전에는 고객사 메시지의 보냄 기록만 실패한다).
--  - kind='customer': 고객사 메시지(key=고객명, content_hash=보낸 글의 해시). 보기·기록 권한은 정산 보기(settlement:view)를 따른다.
--  - 기사(driver)·영수증(receipt)의 권한은 0052 그대로다.
alter table public.dispatch_log drop constraint if exists dispatch_log_kind_check;
alter table public.dispatch_log add constraint dispatch_log_kind_check check (kind in ('driver', 'receipt', 'customer'));

drop policy if exists "dispatch_log select" on public.dispatch_log;
drop policy if exists "dispatch_log insert" on public.dispatch_log;
create policy "dispatch_log select" on public.dispatch_log for select using (
  (select (kind = 'driver' and public.has_perm('scan:view'))
       or (kind = 'receipt' and public.has_perm('receipts:view'))
       or (kind = 'customer' and public.has_perm('settlement:view')))
);
create policy "dispatch_log insert" on public.dispatch_log for insert with check (
  sent_by = (select auth.uid())
  and (select (kind = 'driver' and public.has_perm('scan:view'))
           or (kind = 'receipt' and public.has_perm('receipts:view'))
           or (kind = 'customer' and public.has_perm('settlement:view')))
);

-- 되돌리기(필요할 때만; 'customer' 행을 먼저 지워야 한다):
-- delete from public.dispatch_log where kind = 'customer';
-- alter table public.dispatch_log drop constraint dispatch_log_kind_check;
-- alter table public.dispatch_log add constraint dispatch_log_kind_check check (kind in ('driver', 'receipt'));
-- (정책은 0052의 두 create policy를 다시 실행한다)
