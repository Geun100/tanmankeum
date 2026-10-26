-- 알림 구독 표를 "서버만 쓰는" 상태로 만든다 (마이그레이션, 재실행 안전).
-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행한다.
--
-- 앱은 이제 알림 구독을 브라우저에서 DB로 직접 쓰지 않고 api/push-subscription.js(서비스 롤 키)를 거친다.
-- 그러면 브라우저(anon)에 열어둔 추가·수정·삭제 규칙은 쓸모가 없고 오히려 구멍이다 —
-- 팟장의 사용자 번호는 팟 목록에서 보이는데, 이 규칙이 열려 있으면 누구든 브라우저에서 그 번호로
-- 알림 구독을 먼저 등록해 놓을 수 있다(그 사용자의 알림이 공격자에게 가고, 주인은 켜지 못한다).
--
-- 이 SQL을 실행하기 "전에" 새 앱(알림을 서버로 보내는 버전)이 배포돼 있어야 한다. 순서가 반대면 아직 옛 앱을 쓰는
-- 사용자의 알림 켜기가 실패한다. 표의 데이터는 건드리지 않는다.

drop policy if exists push_subscriptions_upsert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;

-- RLS는 켜진 채로 둔다. 정책이 하나도 없으면 anon은 읽기·쓰기 모두 막히고, 서비스 롤 키(서버)만 접근한다.
alter table public.push_subscriptions enable row level security;
