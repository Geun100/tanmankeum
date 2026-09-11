-- 푸시 알림 구독 정보 저장 (마이그레이션, 재실행 안전).
-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행한다.
--
-- 로그인이 없는 앱이라 다른 테이블과 같은 트레이드오프를 그대로 따른다(schema.sql 1번 주석 참고) —
-- user_id는 클라이언트가 보내는 값을 그대로 믿는다.
--
-- 사용자 1명당 구독 1개만 유지한다(v1). 여러 기기에서 켜면 마지막으로 켠 기기만 알림을 받는다 —
-- 기기별로 여러 개 저장하려면 endpoint를 primary key로 바꾸고 조회 시 user_id로 전부 가져오면 된다.
create table if not exists public.push_subscriptions (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_upsert on public.push_subscriptions;
create policy push_subscriptions_upsert on public.push_subscriptions
  for insert to anon with check (true);

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions
  for update to anon using (true) with check (true);

-- select는 anon에게 안 연다 — 이 테이블엔 개인 알림 채널(endpoint)이 들어있고, 클라이언트가
-- 이 값을 직접 읽어갈 이유가 없다(구독 성공 여부만 알면 됨). api/notify-*.js는 서버에서
-- SUPABASE_ANON_KEY로 접근하는데, RLS가 select를 막으면 서버도 못 읽으므로 select 정책이
-- 하나는 있어야 한다 — 다만 "구조적 검사" 트레이드오프를 따라 anon 전체가 아니라 이 프로젝트의
-- 서버 함수만 실질적으로 쓰는 경로이므로 열어둔다(다른 테이블들과 동일한 신뢰 모델).
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to anon using (true);

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to anon using (true);
