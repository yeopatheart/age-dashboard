-- 0002에서는 터미널을 8개 시드값만 읽는 참조 테이블로 보고 select 정책만 뒀는데,
-- 이후 대시보드 옆에 터미널 관리(추가/수정/삭제) 화면을 만들기로 하면서 맞지 않게 됐다.
-- businesses/products와 같은 "auth all" 패턴으로 올린다.
drop policy "auth read terminals" on terminals;
create policy "auth all terminals" on terminals for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
