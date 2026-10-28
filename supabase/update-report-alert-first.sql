-- 운영자 알림 규칙만 바꾸는 작은 파일: 신고가 1명에게서 처음 들어와도 디스코드로 알린다.
-- add-user-reports.sql을 이미 실행한 DB에서 이 파일만 실행하면 된다(함수만 교체, 표·트리거·웹훅 주소는 그대로).
-- 내용은 add-user-reports.sql의 notify_report_alert()와 같다 — 둘이 어긋나지 않게 한쪽을 고치면 다른 쪽도 고친다.

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
      case when n = 1 then 'people1' end,
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
        when 'people1' then '신고 1명 접수 — 내용을 확인해 주세요'
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
