-- 고객사 정보: 사업자등록번호(숫자 10자리, 화면에서는 000-00-00000 형식으로 저장)와 대표자명. 둘 다 선택 입력.
alter table businesses
  add column business_registration_no text,
  add column representative_name text;
