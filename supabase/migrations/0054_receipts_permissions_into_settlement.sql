-- 영수증 메뉴를 없애고(영수증은 보내기 화면의 고객사 탭에서 본다) 영수증 권한을 정산 권한에 합친다.
--   영수증 보기(receipts:view)   → 정산 보기(settlement:view)
--   영수증 삭제(receipts:delete) → 정산 편집(settlement:edit)
-- 여러 번 실행해도 같은 결과다. 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다.
--
-- 주의: 0049가 정산 보기·편집 사용자에게 영수증 권한을 자동으로 줬으므로, 정산 권한이 있던 사용자는 접근이 그대로다.
--       영수증 권한만 따로 받은(정산 권한은 없는) 사용자는 접근을 잃는다. 정산은 매입가·수익이 보이는 화면이라 자동으로 정산 권한을 주지 않는다.
--       적용 전에 아래 조회로 그런 사용자가 있는지 확인한다(없으면 영향 없음):
--         select user_id, permissions from public.user_permissions
--         where ('receipts:view' = any(permissions) and not ('settlement:view' = any(permissions)))
--            or ('receipts:delete' = any(permissions) and not ('settlement:edit' = any(permissions)));

-- 1) 영수증 이력: 보기=정산 보기, 삭제=정산 편집(0047의 원래 규칙). 만들기(insert)는 0047 그대로 정산 편집이다.
drop policy if exists "settlement_receipts select" on public.settlement_receipts;
drop policy if exists "settlement_receipts delete" on public.settlement_receipts;
create policy "settlement_receipts select" on public.settlement_receipts for select using ((select public.has_perm('settlement:view')));
create policy "settlement_receipts delete" on public.settlement_receipts for delete using ((select public.has_perm('settlement:edit')));

-- 2) 사업자(직인): 영수증 보기 권한 대신 정산 보기가 이미 읽을 수 있으므로 receipts:view만 뺀다.
drop policy if exists "seller_businesses select" on public.seller_businesses;
create policy "seller_businesses select" on public.seller_businesses for select using ((select public.has_perm('sellers:view') or public.has_perm('settlement:view')));

-- 3) 보내기 기록: 영수증 기록도 정산 보기를 따른다(고객사 메시지와 같다). 기사 글은 상차 스캔 보기 그대로다.
drop policy if exists "dispatch_log select" on public.dispatch_log;
drop policy if exists "dispatch_log insert" on public.dispatch_log;
create policy "dispatch_log select" on public.dispatch_log for select using (
  (select (kind = 'driver' and public.has_perm('scan:view'))
       or (kind in ('receipt', 'customer') and public.has_perm('settlement:view')))
);
create policy "dispatch_log insert" on public.dispatch_log for insert with check (
  sent_by = (select auth.uid())
  and (select (kind = 'driver' and public.has_perm('scan:view'))
           or (kind in ('receipt', 'customer') and public.has_perm('settlement:view')))
);

-- 4) 사용자 권한 표에서 더 이상 없는 키를 지운다(메뉴가 없어졌으므로 권한 화면에 나오지 않는다).
update public.user_permissions
set permissions = array_remove(array_remove(permissions, 'receipts:view'), 'receipts:delete'), updated_at = now()
where permissions && array['receipts:view', 'receipts:delete'];

-- 되돌리기(필요할 때만): 0049의 정책·권한 부여와 0053의 dispatch_log 정책을 다시 실행한다.
--   (user_permissions의 receipts:* 키는 0049의 두 update를 다시 실행하면 정산 권한자에게 다시 붙는다)
