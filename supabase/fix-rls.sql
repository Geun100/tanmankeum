-- 지금 DB에 걸린 잘못된 정책만 고치는 패치. SQL Editor에 붙여넣고 실행한다.
-- (schema.sql 전체를 다시 실행해도 같은 결과가 된다 — 이 파일은 데이터를 건드리지 않는 최소 패치다.)
--
-- 진짜 원인: pods_select 정책이 dissolved 행을 숨겨서, 팟을 dissolved로 바꾸는 UPDATE 자체가
-- PostgREST 내부 RETURNING에서 "방금 바뀐 행이 SELECT 정책을 통과 못 함"으로 막혔다
-- (참가 시 "내 팟 먼저 해체"가 항상 42501로 실패한 진짜 원인 — pods_update의 with_check는
-- 처음부터 문제 없었다). 목록에서 dissolved 팟을 빼는 건 클라이언트가 이미
-- loadOpenPods()/loadPod()에서 status<>'dissolved'로 직접 거르므로, DB에서 더 안 숨겨도 된다.
drop policy if exists pods_select on public.pods;
create policy pods_select on public.pods
  for select to anon using (true);

-- 고치는 것 2: profiles DELETE 정책이 없어서 테스트 데이터를 지울 수 없었다.
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to anon using (true);

-- 확인용: 아래를 실행하면 현재 걸린 정책을 눈으로 볼 수 있다.
-- select tablename, policyname, cmd, qual, with_check
--   from pg_policies where schemaname = 'public' order by tablename, policyname;
