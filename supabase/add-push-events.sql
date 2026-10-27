-- 푸시 알림 중복·연타 방지 기록 (마이그레이션, 재실행 안전).
-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행한다.
--
-- api/notify-join.js가 "팟 취소 → 참가자에게", "참가자 나감 → 팟장에게" 알림을 보낼 때,
-- 같은 알림이 반복해서 나가지 않게 이 표에 한 줄씩 먼저 남긴다(남기는 데 성공해야 보낸다).
--   cancelled: (pod_id, 'cancelled', 팟장, 0)            → 팟마다 한 번만
--   left     : (pod_id, 'left', 나간 사람, 10분 구간 번호) → 같은 사람이 같은 팟에서 10분에 한 번만
-- 같은 팟에서 10분에 'left' 알림이 3건을 넘으면 서버가 더 보내지 않는다(위조 요청으로 팟장에게 알림을 쏟아내는 걸 막는다).
--
-- RLS만 켜고 정책을 하나도 만들지 않는다 — anon 키(프론트 번들에 박힌 공개값)로는 읽기·쓰기가 전부 막히고,
-- 서버 함수가 서비스 롤 키로만 접근한다(verified_users, push_subscriptions의 select와 같은 이유).
-- 팟이 지워지면(정산 완료 등) 이 기록도 함께 지워진다.

create table if not exists public.push_events (
  pod_id     uuid not null references public.pods(id) on delete cascade,
  kind       text not null check (kind in ('cancelled', 'left')),
  subject    uuid not null,
  bucket     bigint not null,
  created_at timestamptz not null default now(),
  primary key (pod_id, kind, subject, bucket)
);

alter table public.push_events enable row level security;

create index if not exists push_events_pod_kind_idx on public.push_events (pod_id, kind, created_at);
