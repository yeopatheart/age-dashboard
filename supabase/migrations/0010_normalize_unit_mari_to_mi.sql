-- "마리" 단위 표기를 "미"로 통일한다 (kakao-parser.ts의 normalizeUnit 변경과 맞춘다).
-- 이미 저장된 기존 행에도 소급 적용해서 화면 표기가 일관되게 한다.
update order_items set unit = '미' where unit = '마리';
