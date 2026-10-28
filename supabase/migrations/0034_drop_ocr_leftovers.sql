-- 아크릴 카드 OCR(카드 사진 → 실측값 반영)은 구현하지 않기로 해서, 그때 만든 테이블과 컬럼을 정리한다.
-- 코드가 읽거나 쓰는 곳이 없다. 삭제는 되돌릴 수 없으므로 데이터가 남아 있으면 아무것도 지우지 않고 멈춘다.
do $$
declare
  n bigint;
begin
  if to_regclass('public.card_photos') is not null then
    execute 'select count(*) from card_photos' into n;
    if n > 0 then
      raise exception 'card_photos에 데이터가 있어 삭제를 중단합니다. 내용을 확인한 뒤 다시 실행하세요.';
    end if;
  end if;
  if to_regclass('public.card_readings') is not null then
    execute 'select count(*) from card_readings' into n;
    if n > 0 then
      raise exception 'card_readings에 데이터가 있어 삭제를 중단합니다. 내용을 확인한 뒤 다시 실행하세요.';
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'order_items' and column_name in ('measured_value', 'box_result')) then
    execute 'select count(*) from order_items where measured_value is not null or box_result is not null' into n;
    if n > 0 then
      raise exception 'order_items.measured_value / box_result에 값이 있어 삭제를 중단합니다. 내용을 확인한 뒤 다시 실행하세요.';
    end if;
  end if;
end $$;

-- 사진 비공개 버킷(card-photos)의 접근 정책. 버킷 자체는 Supabase가 SQL 삭제를 막아서 Storage API로 지운다.
drop policy if exists "auth read card photos" on storage.objects;
drop policy if exists "auth upload card photos" on storage.objects;
drop policy if exists "auth delete card photos" on storage.objects;

drop table if exists card_readings;
drop table if exists card_photos;

alter table order_items drop column if exists measured_value;
alter table order_items drop column if exists box_result;
