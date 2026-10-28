-- "함께 탄 분과 문제가 있었나요?" (신고) 기록 (마이그레이션, 재실행 안전).
-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행한다.
--
-- 채팅방의 작은 링크로 참가자가 같은 팟의 다른 참가자에 대한 문제를 알린다. 이 표에 한 줄씩 쌓이고,
-- 앱 화면에서는 누구도 읽을 수 없다(SELECT 정책이 없다) — 운영자가 Supabase 대시보드에서만 본다.
--
-- 일부러 하지 않은 것
--  - pod_id, reporter_id, target_id에 외래키를 걸지 않았다. 정산이 끝나 팟이 지워져도 기록은 남아야 하고,
--    (profiles 삭제 정책이 열려 있어) 문제를 일으킨 사람이 자기 프로필을 지워서 신고 기록까지 지우면 안 된다.
--
-- 저장은 서버(api/_report.js)만 한다. 앱(anon)은 이 표에 직접 저장도 읽기도 못 한다 — 정책을 하나도 만들지 않는다.
-- 서버가 확인하는 것:
--  1) 신고자가 자기 비밀값을 보여줬다(supabase/add-user-secret.sql — 사용자 번호는 공개라서 번호만으로는 본인 증명이 안 된다)
--  2) 신고자와 대상이 둘 다 그 팟의 참가자이고, 서로 다른 사람일 것
--  3) 팟이 확정된 뒤(confirmed, in_progress)일 것 — 확정 전엔 그냥 나가면 된다
--  4) 같은 팟에서 같은 사람을 한 번만(unique)
-- 이 파일보다 add-user-secret.sql을 먼저 실행해야 한다(비밀값 지문 칸이 거기서 생긴다).

create table if not exists public.user_reports (
  id          uuid primary key default gen_random_uuid(),
  pod_id      uuid not null,
  reporter_id uuid not null,
  target_id   uuid not null,
  reason      text not null check (reason in ('no_show', 'unpaid', 'not_confirmed', 'rude', 'gender', 'other')),
  -- 사유가 '기타'일 때 신고자가 직접 적은 내용(200자 이하). 운영자만 본다 — 앱·대상자·Discord 알림에는 나가지 않는다.
  detail      text check (detail is null or char_length(detail) <= 200),
  created_at  timestamptz not null default now(),
  dismissed_at timestamptz,
  check (reporter_id <> target_id),
  unique (pod_id, reporter_id, target_id)
);

create index if not exists user_reports_target_idx on public.user_reports (target_id, created_at);

alter table public.user_reports enable row level security;

-- 앱이 직접 저장하는 길을 닫는다. 예전 버전의 이 파일을 이미 실행했다면 그때 만든 저장 정책이 남아 있으니 지운다.
-- 정책이 없고 권한도 없으면 anon 키(프론트에 박힌 공개값)로는 이 표를 읽지도 쓰지도 못한다. 서버는 서비스 키로만 저장한다.
drop policy if exists user_reports_insert on public.user_reports;
revoke all on public.user_reports from anon, authenticated;

-- ============ 신고가 쌓이면 생기는 일 ============
-- 서로 다른 사람 수로 센다(같은 사람이 여러 번 알려도 1명). 최근 90일 안의, 해제되지 않은 기록만 센다.
--   1명        : 아무 일 없음. 운영자만 user_reports_review에서 본다.
--   2명(level 1): 운영자에게 디스코드 알림이 간다("확인해 주세요"). 팟장 화면에서 그 사람 옆에 "주의" 배지가 뜨고, 본인에게 한 번 안내가 간다.
--   3명 이상(level 2): 새 팟 만들기와 참가가 자동으로 막히고, 본인에게 이용 제한 안내가 간다. 운영자에게 다시 알림이 간다.
-- 운영자는 3명이 된 시점에 신고 내용을 확인하고 제한을 "유지"할지 "해제"할지 정한다.
--   유지: 아무것도 하지 않는다. 제한은 90일 동안 집계에 든 신고가 3명 이상인 동안 계속된다.
--   해제(소명을 받아들였거나 오신고인 경우): 그 사람에 대한 기록을 집계에서 뺀다. 기록은 지우지 않는다.
--     그러면 제한과 "주의" 배지가 함께 풀린다. 필요한 만큼만 빼려면 where에 reporter_id나 id를 더한다:
--       update public.user_reports set dismissed_at = now() where target_id = '<그 사람의 uuid>' and dismissed_at is null;
-- 한계: 신고자를 증명할 수 없는 지금 구조에서는 위조 신고 3건으로 남을 자동 제한시킬 수 있다.
--       운영자의 확인과 해제가 그 안전장치다(신고자 확인 장치가 생기기 전까지 알림을 놓치지 말 것).

alter table public.user_reports add column if not exists dismissed_at timestamptz;

-- 앱이 부르는 함수. 사유·신고자는 알려주지 않고 "누가 몇 단계인지"만 돌려준다.
-- 사용자 번호를 아는 사람은 누구나 그 사람의 단계를 물을 수 있다 — 팟 참가자 목록에서 번호가 이미 공개라서 새로 드러나는 건 "주의 이상인가"뿐이다.
create or replace function public.user_report_levels(ids uuid[])
returns table (user_id uuid, level int)
language sql
stable
security definer
set search_path = public
as $$
  select r.target_id,
         case when count(distinct r.reporter_id) >= 3 then 2 else 1 end
    from public.user_reports r
   where r.target_id = any(ids)
     and r.dismissed_at is null
     and r.created_at > now() - interval '90 days'
   group by r.target_id
  having count(distinct r.reporter_id) >= 2;
$$;

revoke all on function public.user_report_levels(uuid[]) from public;
grant execute on function public.user_report_levels(uuid[]) to anon, authenticated;

-- 이용 제한: 팟 참가(그리고 새 팟 만들기 — 팟장은 자동으로 첫 참가자로 들어간다)를 DB가 직접 막는다.
-- schema.sql의 같은 이름 함수에 "제한된 계정 검사"만 더한 버전이다. 이 파일이 schema.sql 쪽을 덮어쓰므로,
-- schema.sql을 처음부터 다시 실행하면 이 검사가 빠진다 — 그럴 땐 이 파일을 한 번 더 실행한다.
create or replace function public.check_pod_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pod_row   public.pods%rowtype;
  taken     int;
  other_pod int;
begin
  select * into pod_row from public.pods where id = new.pod_id for update;

  if pod_row.id is null then
    raise exception '없는 팟입니다' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.user_report_levels(array[new.user_id]) l where l.level >= 2) then
    raise exception '이용이 제한된 계정입니다' using errcode = 'P0001';
  end if;

  if pod_row.status <> 'open' then
    raise exception '이미 마감된 팟입니다' using errcode = 'P0001';
  end if;

  select count(*) into taken from public.pod_participants where pod_id = new.pod_id;
  if taken >= pod_row.desired_size then
    raise exception '정원이 찼습니다' using errcode = 'P0001';
  end if;

  select count(*) into other_pod
    from public.pod_participants p
    join public.pods d on d.id = p.pod_id
   where p.user_id = new.user_id
     and p.pod_id <> new.pod_id
     and d.status in ('open', 'confirmed', 'in_progress');
  if other_pod > 0 then
    raise exception '이미 참여 중인 팟이 있습니다' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- 운영자용 보기: Supabase 대시보드 > Table Editor 또는 SQL Editor에서 연다. 앱(anon)은 읽을 수 없다.
-- 성별 신고가 있는 사람이 맨 위에 온다 — 1건만 있어도 운영자가 먼저 확인한다(같은 성별끼리만 매칭한다는 서비스 전제가 걸린 안전 문제).
--   select * from public.user_reports_review;
create or replace view public.user_reports_review
with (security_invoker = true) as
select r.target_id,
       p.nickname,
       count(distinct r.reporter_id) filter (where r.dismissed_at is null and r.created_at > now() - interval '90 days') as people,
       coalesce(bool_or(r.reason = 'gender') filter (where r.dismissed_at is null), false) as has_gender,
       array_agg(distinct r.reason) filter (where r.dismissed_at is null) as reasons,
       -- '기타'로 직접 적은 내용. 운영자가 판단할 때만 쓴다.
       array_agg(r.detail) filter (where r.dismissed_at is null and r.detail is not null) as details,
       max(r.created_at) as latest,
       -- 참이면 지금 앱에서 이용이 제한된 사람이다(신고자 3명 이상). 확인 뒤 유지하거나 위의 방법으로 해제한다.
       coalesce(count(distinct r.reporter_id) filter (where r.dismissed_at is null and r.created_at > now() - interval '90 days') >= 3, false) as restricted
  from public.user_reports r
  left join public.profiles p on p.id = r.target_id
 group by r.target_id, p.nickname
 order by restricted desc, has_gender desc, people desc, latest desc;

revoke all on public.user_reports_review from anon, authenticated;

-- 보관 기간: 개인정보 처리방침에 "문제 알림 기록은 1년 보관한 뒤 삭제"라고 적었다.
-- 자동으로 지우는 장치는 없다 — 운영자가 한 달에 한 번쯤 SQL Editor에서 아래를 실행한다(약속이라 잊으면 안 된다).
--   delete from public.user_reports where created_at < now() - interval '1 year';

-- ============ 운영자 알림 (디스코드 웹훅) ============
-- 신고가 저장되는 순간 DB가 디스코드 채널로 한 줄을 보낸다. 앱 코드나 서버 함수는 건드리지 않는다.
--   - 서로 다른 신고자가 2명이 된 순간 : "신고 2명 — 주의 단계, 내용을 확인해 주세요"
--   - 3명이 된 순간                    : "신고 3명 이상 — 이용이 자동 제한됐어요. 확인 후 유지/해제를 정해 주세요"
--   - 성별 신고가 들어온 순간          : "성별 관련 신고 접수 — 먼저 확인해 주세요" (1건이어도)
-- 보내는 내용은 닉네임과 위 한 줄뿐이다. 사유 상세, 신고자, 이동 정보는 채널에 올리지 않는다.
-- 같은 사람·같은 종류는 하루에 한 번만 보낸다(위조 신고로 알림이 쏟아지는 걸 막는다).
-- 알림이 실패해도(주소 없음, pg_net 꺼짐 등) 신고 저장 자체는 절대 막지 않는다.
--
-- 준비(한 번만)
--  1) Supabase 대시보드 > Database > Extensions에서 pg_net을 켠다.
--  2) 디스코드 채널 설정 > 연동 > 웹후크 > 새 웹후크 > 웹후크 URL 복사.
--  3) 아래를 SQL Editor에서 실행한다(주소는 비밀이다 — 코드나 git에 넣지 말 것):
--       insert into public.report_alert_config (id, webhook_url) values (true, '여기에_웹훅_주소')
--         on conflict (id) do update set webhook_url = excluded.webhook_url;
-- 시험(알림이 오는지): 아래를 실행하면 "성별 관련 신고 접수" 알림이 한 번 와야 한다. 끝나면 지운다.
--       insert into public.user_reports (pod_id, reporter_id, target_id, reason)
--         values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000aa', gen_random_uuid(), 'gender');
--       delete from public.user_reports where reporter_id = '00000000-0000-0000-0000-0000000000aa';  -- 시험 기록만 지운다(표식 번호)
-- 끄려면: update public.report_alert_config set webhook_url = null;

create extension if not exists pg_net;

create table if not exists public.report_alert_config (
  id          boolean primary key default true check (id),
  webhook_url text
);

create table if not exists public.report_alert_log (
  target_id uuid not null,
  kind      text not null,
  day       date not null,
  primary key (target_id, kind, day)
);

-- 웹훅 주소는 비밀이다 — 앱(anon)은 두 표를 읽지도 쓰지도 못한다(RLS만 켜고 정책을 만들지 않는다).
alter table public.report_alert_config enable row level security;
alter table public.report_alert_log enable row level security;
revoke all on public.report_alert_config from anon, authenticated;
revoke all on public.report_alert_log from anon, authenticated;

create or replace function public.notify_report_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hook   text;
  nick   text;
  n      int;
  k      text;
  line   text;
  added  int;
begin
  select c.webhook_url into hook from public.report_alert_config c where c.id;
  if hook is null or hook = '' then return new; end if;

  select count(distinct r.reporter_id) into n
    from public.user_reports r
   where r.target_id = new.target_id
     and r.dismissed_at is null
     and r.created_at > now() - interval '90 days';
  select p.nickname into nick from public.profiles p where p.id = new.target_id;

  for k in
    select x from unnest(array[
      case when n = 2 then 'people2' end,
      case when n = 3 then 'people3' end,
      case when new.reason = 'gender' then 'gender' end
    ]) as x where x is not null
  loop
    insert into public.report_alert_log (target_id, kind, day) values (new.target_id, k, current_date)
      on conflict do nothing;
    get diagnostics added = row_count;
    if added = 1 then
      line := case k
        when 'people2' then '신고 2명 — 주의 단계, 내용을 확인해 주세요'
        when 'people3' then '신고 3명 이상 — 이용이 자동 제한됐어요. 확인 후 유지/해제를 정해 주세요'
        else '성별 관련 신고 접수 — 먼저 확인해 주세요'
      end;
      -- allowed_mentions를 비워서 닉네임에 @everyone 같은 말이 들어 있어도 채널 전체에 알림이 가지 않게 한다.
      perform net.http_post(
        url := hook,
        body := jsonb_build_object(
          'content', '[탄만큼] ' || coalesce(nick, '(닉네임 없음)') || ' — ' || line,
          'allowed_mentions', jsonb_build_object('parse', jsonb_build_array())
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    end if;
  end loop;

  return new;
exception when others then
  return new; -- 알림이 실패해도 신고 저장은 그대로 성공시킨다
end;
$$;

drop trigger if exists user_reports_alert on public.user_reports;
create trigger user_reports_alert
  after insert on public.user_reports
  for each row execute function public.notify_report_alert();
