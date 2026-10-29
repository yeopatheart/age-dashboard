-- 합포장: 포장이 끝난 뒤 한 고객 카드의 박스 여러 개를 함께 테이핑해 내보낸다. 박스마다 라벨은 붙이되 라벨에 "합포장 1·2"가 찍히고,
-- 합친 뒤에는 위에 올라온 라벨 하나만 스캔한다(묶인 박스 모두 상차 처리).
-- 라벨(box_labels)처럼 그날 업체 카드와 박스 순번에 붙여서, 박스를 다시 제출해도 합포장 지정이 유지된다.
-- 값: 박스 순번 묶음의 배열. 예) [[1,2],[4,5,6]]
alter table daily_businesses add column merge_groups jsonb not null default '[]'::jsonb;
