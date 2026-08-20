-- 지금 DB에 걸린 잘못된 정책만 고치는 패치. SQL Editor에 붙여넣고 실행한다.
-- (schema.sql 전체를 다시 실행해도 같은 결과가 된다 — 이 파일은 데이터를 건드리지 않는 최소 패치다.)
--
-- 고치는 것 1: pods UPDATE
--   현재 DB 정책의 with check가 status <> 'dissolved' 를 요구해서, 팟을 해체하는 UPDATE가
--   스스로 막혀 있었다. 남의 팟에 참가하려면 내 팟을 먼저 해체해야 하는데(DB 트리거가
--   "한 사람은 한 팟에만"을 강제) 그 해체가 불가능해서 참가가 항상 실패했다.
drop policy if exists pods_update on public.pods;
create policy pods_update on public.pods
  for update to anon using (true) with check (true);

-- 고치는 것 2: profiles DELETE 정책이 없어서 테스트 데이터를 지울 수 없었다.
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to anon using (true);

-- 확인용: 아래를 실행하면 현재 걸린 정책을 눈으로 볼 수 있다.
-- select tablename, policyname, cmd, qual, with_check
--   from pg_policies where schemaname = 'public' order by tablename, policyname;
