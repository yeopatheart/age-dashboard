-- 택배 터미널 표시: 택배사 송장을 붙이므로 박스 라벨(바코드)을 출력·스캔하지 않는다. 별도 주문(is_separate) 중에서만 지정한다.
-- 택배 외 별도 주문(직배송 등)은 기본 주문과 같이 박스 할당 → 라벨 출력 → 상차 스캔을 거친다.
alter table terminals add column is_parcel boolean not null default false;

-- 이미 '택배'라는 이름으로 만들어 둔 별도 주문 터미널은 택배로 표시한다(이름이 다르면 터미널 관리에서 직접 켠다).
update terminals set is_parcel = true where name = '택배' and is_separate;
