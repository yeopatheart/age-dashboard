-- 보안 강화 (감사 2026-11-06).
--  1) 메뉴 권한을 DB(RLS)에서도 강제한다: 정산·매입처·사업자·카톡 원문·시스템 설정.
--     지금까지는 "로그인한 사용자 전체 허용"이라, 화면에서 메뉴를 숨겨도 anon key로 REST API를 직접 부르면 읽고 쓸 수 있었다.
--  2) anon이 호출할 수 있던 함수(SECURITY DEFINER 포함)의 실행 권한을 회수하고 search_path를 고정한다.
--  3) access_log를 "내 로그인 기록 추가"만 가능하게 바꾼다(삭제·수정 불가).
--
-- 적용 순서: 이 SQL을 먼저 적용한 뒤 코드를 배포한다(상품명 변경이 새 함수 rename_purchase_product를 호출한다).
-- 여러 번 실행해도 같은 결과다. 되돌리는 SQL은 파일 맨 아래 주석에 있다.
-- 범위 밖(의도적): 주문·박스·라벨 등 현장 운영 테이블은 여전히 로그인 사용자 전체 허용이다. businesses의 사업자번호·대표자명 컬럼도
-- 같은 테이블을 여러 메뉴가 읽어서 행 단위로 나눌 수 없다.

-- ───────────────────────────────────────────────────────────────────────────────
-- 1. 권한 헬퍼. SECURITY INVOKER라 호출한 사용자의 RLS가 그대로 적용된다(user_permissions는 "본인 행 읽기"가 허용돼 있다).
--    master 판단은 앱(src/lib/permissions/access.ts)과 같은 이메일 규칙이다.
-- ───────────────────────────────────────────────────────────────────────────────
create or replace function public.is_master()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'master@ageseafood.com'
$$;

create or replace function public.has_perm(p_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.is_master()
    or exists (
      select 1 from public.user_permissions up
      where up.user_id = (select auth.uid()) and p_key = any (up.permissions)
    )
$$;

-- ───────────────────────────────────────────────────────────────────────────────
-- 2. 함수 실행 권한. public 스키마의 모든 함수에서 anon(로그인 전)·public의 실행을 회수하고 로그인 사용자·서버에만 준다.
--    이후 새로 만드는 함수도 기본으로 anon이 못 부르게 한다.
-- ───────────────────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') -- 확장 프로그램이 만든 함수는 건드리지 않는다
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

alter default privileges in schema public revoke execute on functions from public, anon;
-- 함수 EXECUTE의 PUBLIC 기본 권한은 전역 기본값이라 위의 스키마 한정 REVOKE로는 지워지지 않는다. 마이그레이션을 실행하는 postgres 역할이 만드는 함수에 대해 전역으로도 회수한다.
-- (로그인 사용자·서버 역할은 Supabase의 기본 권한 설정으로 계속 실행할 수 있다.)
alter default privileges for role postgres revoke execute on functions from public;

-- 트리거 전용 함수는 호출자가 직접 실행할 일이 없다.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- SECURITY DEFINER 함수의 search_path를 고정한다(함수 본문의 이름 해석을 다른 스키마가 가로채지 못하게). 본문은 그대로다.
alter function public.assign_business_number(date) set search_path = public, pg_temp;
alter function public.assign_product_sequence(uuid) set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;

-- 상품명을 바꿀 때 정산 매입내역의 이전 이름 행을 함께 바꾼다. 상품 관리 권한만 있는 사용자는 정산 테이블을 직접 못 쓰므로
-- (아래 RLS) 이 함수로만 처리한다. 권한은 함수 안에서 확인한다.
create or replace function public.rename_purchase_product(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_perm('products:edit') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  update public.settlement_purchases set product_name = p_new where product_name = p_old;
end;
$$;
revoke execute on function public.rename_purchase_product(text, text) from public, anon;
grant execute on function public.rename_purchase_product(text, text) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────────
-- 3. 테이블 정책. 호출 비용을 줄이려고 헬퍼는 (select ...)로 감싼다(행마다 다시 계산하지 않는다).
-- ───────────────────────────────────────────────────────────────────────────────

-- 정산 판매내역: 보기=settlement:view, 쓰기=settlement:edit
drop policy if exists "auth all settlement_sales" on public.settlement_sales;
drop policy if exists "settlement_sales select" on public.settlement_sales;
drop policy if exists "settlement_sales insert" on public.settlement_sales;
drop policy if exists "settlement_sales update" on public.settlement_sales;
drop policy if exists "settlement_sales delete" on public.settlement_sales;
create policy "settlement_sales select" on public.settlement_sales for select using ((select public.has_perm('settlement:view')));
create policy "settlement_sales insert" on public.settlement_sales for insert with check ((select public.has_perm('settlement:edit')));
create policy "settlement_sales update" on public.settlement_sales for update using ((select public.has_perm('settlement:edit'))) with check ((select public.has_perm('settlement:edit')));
create policy "settlement_sales delete" on public.settlement_sales for delete using ((select public.has_perm('settlement:edit')));

-- 정산 매입내역: 같은 규칙
drop policy if exists "auth all settlement_purchases" on public.settlement_purchases;
drop policy if exists "settlement_purchases select" on public.settlement_purchases;
drop policy if exists "settlement_purchases insert" on public.settlement_purchases;
drop policy if exists "settlement_purchases update" on public.settlement_purchases;
drop policy if exists "settlement_purchases delete" on public.settlement_purchases;
create policy "settlement_purchases select" on public.settlement_purchases for select using ((select public.has_perm('settlement:view')));
create policy "settlement_purchases insert" on public.settlement_purchases for insert with check ((select public.has_perm('settlement:edit')));
create policy "settlement_purchases update" on public.settlement_purchases for update using ((select public.has_perm('settlement:edit'))) with check ((select public.has_perm('settlement:edit')));
create policy "settlement_purchases delete" on public.settlement_purchases for delete using ((select public.has_perm('settlement:edit')));

-- 사업자(판매 사업자): 보기=sellers:view 또는 settlement:view(정산 화면이 읽는다), 쓰기=sellers:edit, 삭제=sellers:delete
drop policy if exists "auth all seller_businesses" on public.seller_businesses;
drop policy if exists "seller_businesses select" on public.seller_businesses;
drop policy if exists "seller_businesses insert" on public.seller_businesses;
drop policy if exists "seller_businesses update" on public.seller_businesses;
drop policy if exists "seller_businesses delete" on public.seller_businesses;
create policy "seller_businesses select" on public.seller_businesses for select using ((select public.has_perm('sellers:view') or public.has_perm('settlement:view')));
create policy "seller_businesses insert" on public.seller_businesses for insert with check ((select public.has_perm('sellers:edit')));
create policy "seller_businesses update" on public.seller_businesses for update using ((select public.has_perm('sellers:edit'))) with check ((select public.has_perm('sellers:edit')));
create policy "seller_businesses delete" on public.seller_businesses for delete using ((select public.has_perm('sellers:delete')));

-- 매입처: 보기=products:view 또는 settlement:view, 쓰기=products:edit, 삭제=products:delete
drop policy if exists "auth all suppliers" on public.suppliers;
drop policy if exists "suppliers select" on public.suppliers;
drop policy if exists "suppliers insert" on public.suppliers;
drop policy if exists "suppliers update" on public.suppliers;
drop policy if exists "suppliers delete" on public.suppliers;
create policy "suppliers select" on public.suppliers for select using ((select public.has_perm('products:view') or public.has_perm('settlement:view')));
create policy "suppliers insert" on public.suppliers for insert with check ((select public.has_perm('products:edit')));
create policy "suppliers update" on public.suppliers for update using ((select public.has_perm('products:edit'))) with check ((select public.has_perm('products:edit')));
create policy "suppliers delete" on public.suppliers for delete using ((select public.has_perm('products:delete')));

-- 상품-매입처 연결: 보기는 매입처와 같고, 쓰기·삭제는 products:edit (연결 해제도 편집이다)
drop policy if exists "auth all product_suppliers" on public.product_suppliers;
drop policy if exists "product_suppliers select" on public.product_suppliers;
drop policy if exists "product_suppliers insert" on public.product_suppliers;
drop policy if exists "product_suppliers update" on public.product_suppliers;
drop policy if exists "product_suppliers delete" on public.product_suppliers;
create policy "product_suppliers select" on public.product_suppliers for select using ((select public.has_perm('products:view') or public.has_perm('settlement:view')));
create policy "product_suppliers insert" on public.product_suppliers for insert with check ((select public.has_perm('products:edit')));
create policy "product_suppliers update" on public.product_suppliers for update using ((select public.has_perm('products:edit'))) with check ((select public.has_perm('products:edit')));
create policy "product_suppliers delete" on public.product_suppliers for delete using ((select public.has_perm('products:edit')));

-- 카카오 메시지 원문: 보기=orders:view, 추가=orders:edit. 수정·삭제 정책은 두지 않는다(원문 기록은 바꿀 수 없다).
drop policy if exists "auth all kakao_message_log" on public.kakao_message_log;
drop policy if exists "kakao_message_log select" on public.kakao_message_log;
drop policy if exists "kakao_message_log insert" on public.kakao_message_log;
create policy "kakao_message_log select" on public.kakao_message_log for select using ((select public.has_perm('orders:view')));
create policy "kakao_message_log insert" on public.kakao_message_log for insert with check ((select public.has_perm('orders:edit')));

-- 시스템 설정·라벨 설정: 읽기는 모든 로그인 사용자(여러 화면이 설정을 읽는다), 쓰기는 settings:edit 또는 labels:edit
drop policy if exists "auth all app_settings" on public.app_settings;
drop policy if exists "app_settings select" on public.app_settings;
drop policy if exists "app_settings insert" on public.app_settings;
drop policy if exists "app_settings update" on public.app_settings;
drop policy if exists "app_settings delete" on public.app_settings;
create policy "app_settings select" on public.app_settings for select using ((select auth.role()) = 'authenticated');
create policy "app_settings insert" on public.app_settings for insert with check ((select public.has_perm('settings:edit') or public.has_perm('labels:edit')));
create policy "app_settings update" on public.app_settings for update using ((select public.has_perm('settings:edit') or public.has_perm('labels:edit'))) with check ((select public.has_perm('settings:edit') or public.has_perm('labels:edit')));
create policy "app_settings delete" on public.app_settings for delete using ((select public.has_perm('settings:edit') or public.has_perm('labels:edit')));

-- 접근 기록: 내 로그인 기록만 추가할 수 있고, 읽기는 master만, 수정·삭제는 아무도 못 한다(내부자 오용 추적용이라 변조되면 안 된다).
drop policy if exists "auth all access_log" on public.access_log;
drop policy if exists "access_log insert own" on public.access_log;
drop policy if exists "access_log select master" on public.access_log;
create policy "access_log insert own" on public.access_log for insert with check (user_id = (select auth.uid()));
create policy "access_log select master" on public.access_log for select using ((select public.is_master()));

-- ───────────────────────────────────────────────────────────────────────────────
-- 되돌리기(문제가 생겼을 때만). 함수 실행 권한은 `grant execute on all functions in schema public to anon;`으로 되돌린다.
-- 아래는 위 정책을 모두 "로그인 사용자 전체 허용"으로 복구):
--
-- do $$ declare t text; begin
--   foreach t in array array['settlement_sales','settlement_purchases','seller_businesses','suppliers','product_suppliers','kakao_message_log','app_settings','access_log'] loop
--     execute (select string_agg(format('drop policy if exists %I on public.%I', policyname, t), '; ') from pg_policies where schemaname = 'public' and tablename = t);
--     execute format('create policy %I on public.%I for all using ((select auth.role()) = ''authenticated'') with check ((select auth.role()) = ''authenticated'')', 'auth all ' || t, t);
--   end loop;
-- end $$;
-- ───────────────────────────────────────────────────────────────────────────────
