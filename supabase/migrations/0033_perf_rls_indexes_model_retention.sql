-- 성능 정리 (2단계). 동작은 바뀌지 않는다.
--
-- 1) RLS 정책의 auth.role() / auth.uid()를 (select ...)로 감싼다.
--    감싸지 않으면 행마다 함수가 다시 계산되고, 감싸면 쿼리당 한 번만 계산된다(Supabase 권장 패턴).
--    public 스키마의 정책 중 아직 감싸지 않은 것만 같은 조건 그대로 다시 정의하며, 한 번에(all or nothing) 적용된다.
do $$
declare
  pol record;
  new_qual text;
  new_check text;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ 'auth\.(role|uid)\(\)' or coalesce(with_check, '') ~ 'auth\.(role|uid)\(\)')
      and coalesce(qual, '') !~* 'select auth\.' and coalesce(with_check, '') !~* 'select auth\.'
  loop
    new_qual := replace(replace(pol.qual, 'auth.role()', '(select auth.role())'), 'auth.uid()', '(select auth.uid())');
    new_check := replace(replace(pol.with_check, 'auth.role()', '(select auth.role())'), 'auth.uid()', '(select auth.uid())');
    execute format(
      'alter policy %I on %I.%I%s%s',
      pol.policyname, pol.schemaname, pol.tablename,
      case when pol.qual is not null then format(' using (%s)', new_qual) else '' end,
      case when pol.with_check is not null then format(' with check (%s)', new_check) else '' end
    );
    raise notice 'policy rewritten: %.%', pol.tablename, pol.policyname;
  end loop;
end $$;

-- 2) 외래키·필터에 쓰이지만 인덱스가 없던 열. 상품·주문·업체를 지울 때 표 전체를 훑던 것을 막는다.
create index if not exists packing_box_items_order_item_idx on packing_box_items(order_item_id);
create index if not exists packing_records_recommendation_idx on packing_records(recommendation_id);
create index if not exists packing_boxes_box_idx on packing_boxes(box_id);
create index if not exists kakao_message_log_order_date_idx on kakao_message_log(order_date);

-- 3) 박스 추천 모델 보관. model은 이력에 비례해 커지는 JSON인데 매일 새 행으로 쌓인다.
--    model을 비워도 되게 하고(앱이 오늘 학습 직후 14일 지난 버전의 model을 비운다), 지금 쌓여 있는 오래된 것도 한 번 비운다.
--    버전 이름·학습 시각·기록 건수는 남기므로 packing_recommendations의 model_version 참조와 정확도 화면은 그대로다.
alter table packing_model_versions alter column model drop not null;
update packing_model_versions set model = null where trained_at < now() - interval '14 days' and model is not null;
