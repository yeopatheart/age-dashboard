-- 아크릴 카드 트레이 촬영 사진 저장용 비공개 버킷
insert into storage.buckets (id, name, public) values ('card-photos', 'card-photos', false);

create policy "auth read card photos" on storage.objects for select
  using (bucket_id = 'card-photos' and auth.role() = 'authenticated');
create policy "auth upload card photos" on storage.objects for insert
  with check (bucket_id = 'card-photos' and auth.role() = 'authenticated');
create policy "auth delete card photos" on storage.objects for delete
  using (bucket_id = 'card-photos' and auth.role() = 'authenticated');
