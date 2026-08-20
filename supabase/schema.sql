-- 탄만큼 DB 스키마 (로그인 없음 — 브라우저 uuid 방식)
-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행한다. 여러 번 실행해도 안전하다.
--
-- 로그인이 없으므로 "이 요청을 진짜 그 사람이 보냈다"를 서버가 검증할 방법이 없다.
-- user_id는 클라이언트가 localStorage에 저장해둔 uuid를 그대로 보내는 값이라,
-- anon 키만 있으면 누구든 다른 사람의 user_id를 흉내 낼 수 있다.
-- 아래 RLS는 그 전제 위에서 "구조적으로 말이 되는 값인지"만 검사한다 — 신원 검증은 못 한다.
-- 테스트 단계에서 감수하기로 한 트레이드오프다. 실사용 단계에서는 인증을 다시 넣어야 한다.

-- ============ 1. 프로필 ============
-- id는 브라우저가 처음 접속할 때 발급해 localStorage에 저장해둔 uuid. 서버가 만들어주지 않는다.
-- 닉네임 중복은 허용한다(unique 제약 없음).
create table if not exists public.profiles (
  id         uuid primary key,
  nickname   text not null,
  gender     text not null check (gender in ('여성', '남성')),
  created_at timestamptz not null default now()
);

-- ============ 2. 팟 ============
-- 좌표를 같이 저장한다. 장소 이름만 저장하면 다른 사용자가 카카오 자동완성으로 고른
-- 장소(고정 테이블에 없는 곳)의 좌표를 복원할 수 없다.
create table if not exists public.pods (
  id              uuid primary key default gen_random_uuid(),
  leader_id       uuid not null references public.profiles(id) on delete cascade,
  origin_name     text not null,
  origin_lat      double precision not null,
  origin_lng      double precision not null,
  leader_dest     text not null,
  leader_dest_lat double precision not null,
  leader_dest_lng double precision not null,
  depart_date     date not null,
  depart_time     time not null,
  desired_size    int  not null check (desired_size between 2 and 4),
  status          text not null default 'open'
                  check (status in ('open', 'confirmed', 'in_progress', 'done', 'dissolved')),
  created_at      timestamptz not null default now()
);

create index if not exists pods_open_idx on public.pods (status, depart_date, depart_time);

-- ============ 3. 참여자 ============
create table if not exists public.pod_participants (
  id             uuid primary key default gen_random_uuid(),
  pod_id         uuid not null references public.pods(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  dest_name      text not null,
  dest_lat       double precision not null,
  dest_lng       double precision not null,
  dropoff_point  text not null,
  walk_dist      int  not null default 0,
  walk_time      int  not null default 0,
  fare           int,
  joined_at      timestamptz not null default now(),
  -- 같은 팟에 같은 사람이 두 번 들어가지 못한다(프론트 분기와 별개로 DB에서 막는다).
  unique (pod_id, user_id)
);

create index if not exists pod_participants_pod_idx on public.pod_participants (pod_id);

-- ============ 4. 채팅 ============
create table if not exists public.pod_messages (
  id         uuid primary key default gen_random_uuid(),
  pod_id     uuid not null references public.pods(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists pod_messages_pod_idx on public.pod_messages (pod_id, created_at);

-- ============ 5. 동시성 제약 ============
-- 정원이 한 자리 남았는데 두 명이 동시에 참가하면 둘 다 통과해버린다.
-- 팟 행을 먼저 잠가서(for update) 같은 팟에 대한 참가를 직렬화한 뒤 정원을 확인한다.
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

  if pod_row.status <> 'open' then
    raise exception '이미 마감된 팟입니다' using errcode = 'P0001';
  end if;

  select count(*) into taken from public.pod_participants where pod_id = new.pod_id;
  if taken >= pod_row.desired_size then
    raise exception '정원이 찼습니다' using errcode = 'P0001';
  end if;

  -- 한 사람은 동시에 한 팟에만 속한다.
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

drop trigger if exists pod_participants_capacity on public.pod_participants;
create trigger pod_participants_capacity
  before insert on public.pod_participants
  for each row execute function public.check_pod_capacity();

-- 팟을 만들면 팟장이 자동으로 첫 참여자가 된다.
create or replace function public.add_leader_as_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pod_participants (pod_id, user_id, dest_name, dest_lat, dest_lng, dropoff_point)
  values (new.id, new.leader_id, new.leader_dest, new.leader_dest_lat, new.leader_dest_lng, new.leader_dest);
  return new;
end;
$$;

drop trigger if exists pods_add_leader on public.pods;
create trigger pods_add_leader
  after insert on public.pods
  for each row execute function public.add_leader_as_participant();

-- ============ 6. RLS ============
-- 로그인이 없어 auth.uid()를 쓸 수 없다. anon 역할에게 구조적 검사만 거는 정도로 열어둔다.
-- (신원 검증이 아니라 "이 값이 말이 되는 모양인가"만 확인 — 예: 메시지는 실제 그 팟 참여자 목록에 있는
--  user_id로만 남길 수 있다. 다만 그 user_id가 진짜 그 사람 브라우저에서 왔는지는 확인 못 한다.)
alter table public.profiles         enable row level security;
alter table public.pods             enable row level security;
alter table public.pod_participants enable row level security;
alter table public.pod_messages     enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to anon using (true);

drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles
  for insert to anon with check (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to anon using (true) with check (true);

-- 테스트 데이터 정리용. 프로필을 지우면 그 사람의 팟·참여기록·메시지가 cascade로 함께 지워진다.
drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to anon using (true);

-- 팟: 해체된 팟도 SELECT 자체는 막지 않는다(목록에서 빼는 건 클라이언트가
-- loadOpenPods()/loadPod()에서 직접 status<>'dissolved'로 거른다).
-- 예전엔 여기서 dissolved 행을 숨겼는데, 그러면 dissolve UPDATE 자체가 내부 RETURNING에서
-- "방금 바뀐 행이 SELECT 정책을 통과 못 함"으로 막혀버리는 부작용이 있었다
-- (팟장이 자기 팟을 취소/해체하는 UPDATE가 이 정책 때문에 항상 42501로 실패했다).
drop policy if exists pods_select on public.pods;
create policy pods_select on public.pods
  for select to anon using (true);

drop policy if exists pods_insert on public.pods;
create policy pods_insert on public.pods
  for insert to anon with check (true);

-- UPDATE의 with check는 "변경된 뒤"의 행을 검사한다. 여기에 status <> 'dissolved' 같은 조건을 걸면
-- 팟을 해체하는 UPDATE가 스스로 막혀버린다(남의 팟에 참가하려면 내 팟을 먼저 해체해야 하는데 그게 불가능해진다).
-- 그래서 두 절 모두 true로 둔다.
drop policy if exists pods_update on public.pods;
create policy pods_update on public.pods
  for update to anon using (true) with check (true);

drop policy if exists pods_delete on public.pods;
create policy pods_delete on public.pods
  for delete to anon using (true);

-- 참여자: 목록은 다 읽힌다(팟 카드에 인원수·하차지점을 띄운다).
drop policy if exists participants_select on public.pod_participants;
create policy participants_select on public.pod_participants
  for select to anon using (true);

drop policy if exists participants_insert on public.pod_participants;
create policy participants_insert on public.pod_participants
  for insert to anon with check (true);

drop policy if exists participants_delete on public.pod_participants;
create policy participants_delete on public.pod_participants
  for delete to anon using (true);

-- 채팅: 구조적으로 "그 팟 참여자 목록에 있는 user_id"만 메시지를 남길 수 있게 한다.
drop policy if exists messages_select on public.pod_messages;
create policy messages_select on public.pod_messages
  for select to anon using (true);

drop policy if exists messages_insert on public.pod_messages;
create policy messages_insert on public.pod_messages
  for insert to anon with check (
    exists (select 1 from public.pod_participants p
             where p.pod_id = pod_messages.pod_id and p.user_id = pod_messages.user_id)
  );

-- ============ 7. 실시간 구독 ============
-- 팟 상세/채팅 화면에서 구독한다. 이미 등록돼 있으면 에러가 나므로 무시하고 넘어간다.
do $$
begin
  alter publication supabase_realtime add table public.pods;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pod_participants;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pod_messages;
exception when duplicate_object then null;
end $$;
