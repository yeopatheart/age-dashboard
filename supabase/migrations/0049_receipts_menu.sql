-- 영수증을 정산에서 떼어 "영수증" 메뉴로 분리한다. 새 권한: receipts:view(메뉴 열기·보기·공유), receipts:delete(영수증 삭제).
-- 영수증 만들기는 그대로 정산(settlement:edit)이다. 여러 번 실행해도 같은 결과다.
-- 적용 순서: 이 SQL을 먼저 적용한 뒤 영수증 메뉴 코드를 배포한다(반대로 하면 새 메뉴가 권한 없이 열린다).

-- 1) 기존 사용자에게 같은 범위의 권한을 옮겨 준다: 정산을 볼 수 있던 사용자 → 영수증 보기, 정산 입력 권한이 있던 사용자 → 영수증 삭제(master는 원래 전부 가진다).
--    새 메뉴를 못 보게 하려면 사용자 및 권한 화면에서 끄면 된다.
update public.user_permissions
set permissions = array_append(permissions, 'receipts:view'), updated_at = now()
where 'settlement:view' = any(permissions) and not ('receipts:view' = any(permissions));

update public.user_permissions
set permissions = array_append(permissions, 'receipts:delete'), updated_at = now()
where 'settlement:edit' = any(permissions) and not ('receipts:delete' = any(permissions));

-- 2) 영수증 이력: 정산 화면(발행 여부 확인)과 영수증 메뉴가 같이 읽으므로 둘 중 하나의 보기 권한이면 읽는다. 삭제는 영수증 삭제 권한이다.
--    발행(insert)은 그대로 settlement:edit이고, 수정 정책은 없다.
drop policy if exists "settlement_receipts select" on public.settlement_receipts;
drop policy if exists "settlement_receipts delete" on public.settlement_receipts;
create policy "settlement_receipts select" on public.settlement_receipts for select using ((select public.has_perm('receipts:view') or public.has_perm('settlement:view')));
create policy "settlement_receipts delete" on public.settlement_receipts for delete using ((select public.has_perm('receipts:delete')));

-- 3) 영수증을 다시 열 때 읽는 사업자 직인(seller_businesses): 영수증 보기 권한으로도 읽을 수 있게 한다(나머지 정책은 0045 그대로).
drop policy if exists "seller_businesses select" on public.seller_businesses;
create policy "seller_businesses select" on public.seller_businesses for select using ((select public.has_perm('sellers:view') or public.has_perm('settlement:view') or public.has_perm('receipts:view')));

-- 되돌리기(필요할 때만 직접 실행):
-- drop policy "settlement_receipts select" on public.settlement_receipts; drop policy "settlement_receipts delete" on public.settlement_receipts;
-- create policy "settlement_receipts select" on public.settlement_receipts for select using ((select public.has_perm('settlement:view')));
-- create policy "settlement_receipts delete" on public.settlement_receipts for delete using ((select public.has_perm('settlement:edit')));
-- drop policy "seller_businesses select" on public.seller_businesses;
-- create policy "seller_businesses select" on public.seller_businesses for select using ((select public.has_perm('sellers:view') or public.has_perm('settlement:view')));
