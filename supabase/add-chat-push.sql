-- 채팅 푸시 알림용 마이그레이션(재실행 안전). Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행한다.
--
-- 누가 채팅을 보내면 같은 팟의 나머지 사람들에게 푸시를 보낸다(api/notify-join.js의 event: 'chat').
-- 같은 메시지로 알림이 두 번 가지 않게 push_events에 (팟, 'chat', 메시지 번호)를 한 줄씩 먼저 남기는데,
-- 그 표의 kind 제한에 'chat'을 더한다. (제한 이름이 환경마다 다를 수 있어 찾아서 지운 뒤 다시 만든다.)
-- 'finished'(팟 종료 알림)·'confirmed'(팟 확정 알림, 같은 표를 쓰는데 제한 목록에 빠져 있었다)와 'claimed'도 목록에 넣어 둔다 —
-- 이미 실행했어도 다시 실행하면 목록만 새로 만든다(재실행 안전). 'confirmed'를 쓰려면 다시 한 번 실행해야 한다.
--
-- add-payment-claim.sql이 나중에 실행돼도 같은 제한을 다시 만들 뿐 서로 지우지 않는다.
-- 이 파일을 실행하기 전에 코드가 먼저 배포돼도 안전하다: 표에 쓸 수 없으면 서버가 알림을 보내지 않고 넘어간다.

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.push_events'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.push_events drop constraint %I', c);
  end loop;
  alter table public.push_events
    add constraint push_events_kind_check check (kind in ('cancelled', 'left', 'claimed', 'finished', 'confirmed', 'chat'));
end $$;
