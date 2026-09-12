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

-- select는 anon에게 절대 안 연다 — 다른 테이블들의 "구조적 검사만" 트레이드오프를 여기엔
-- 그대로 못 따른다. anon 키는 프론트 번들에 그대로 박혀있는 공개값이라, select를 열면
-- 누구든 브라우저 콘솔에서 supa.from('push_subscriptions').select('*')로 전체 유저의
-- endpoint/p256dh/auth를 통째로 긁어갈 수 있다 — 그 값만 있으면 Web Push 프로토콜로
-- 그 사람 브라우저에 임의 알림을 직접 쏠 수 있으니(앱 서버를 거치지 않고), pods/profiles와는
-- 위험도가 다르다. 클라이언트는 이 테이블을 읽을 일이 없으니(upsert만 함) 막아도 기능이
-- 안 깨진다. api/notify-*.js는 이제 SUPABASE_SERVICE_ROLE_KEY(RLS 우회)로 읽는다 —
-- 이 값이 아직 없으면 그 함수들은 "조용히 알림을 건너뛴다"로 폴백한다(에러 안 남).
drop policy if exists push_subscriptions_select on public.push_subscriptions;

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to anon using (true);
