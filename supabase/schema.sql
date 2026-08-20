-- 탄만큼 DB 스키마
-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행한다. 여러 번 실행해도 안전하다.

-- ============ 1. 프로필 ============
-- auth.users는 카카오 로그인이 만들어준다. 여기엔 서비스에서 쓰는 값만 둔다.
-- 닉네임 중복은 허용한다(unique 제약 없음).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
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
-- anon 키는 공개되는 키다. 실제 접근 제어는 전부 아래 정책이 한다.
alter table public.profiles         enable row level security;
alter table public.pods             enable row level security;
alter table public.pod_participants enable row level security;
alter table public.pod_messages     enable row level security;

-- 프로필: 로그인한 사람은 다 읽을 수 있다(참여자 목록에 닉네임을 띄워야 한다). 쓰기는 본인만.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_upsert on public.profiles;
create policy profiles_upsert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 팟: 해체된 팟은 안 보인다. 만들기는 본인이 팟장일 때만, 고치기·지우기는 팟장만.
drop policy if exists pods_select on public.pods;
create policy pods_select on public.pods
  for select to authenticated using (status <> 'dissolved');

drop policy if exists pods_insert on public.pods;
create policy pods_insert on public.pods
  for insert to authenticated with check (leader_id = auth.uid());

drop policy if exists pods_update on public.pods;
create policy pods_update on public.pods
  for update to authenticated using (leader_id = auth.uid()) with check (leader_id = auth.uid());

drop policy if exists pods_delete on public.pods;
create policy pods_delete on public.pods
  for delete to authenticated using (leader_id = auth.uid());

-- 참여자: 목록은 다 읽힌다(팟 카드에 인원수·하차지점을 띄운다). 넣고 빼는 건 본인 행만.
drop policy if exists participants_select on public.pod_participants;
create policy participants_select on public.pod_participants
  for select to authenticated using (true);

drop policy if exists participants_insert on public.pod_participants;
create policy participants_insert on public.pod_participants
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists participants_delete on public.pod_participants;
create policy participants_delete on public.pod_participants
  for delete to authenticated using (user_id = auth.uid());

-- 채팅: 그 팟에 속한 사람만 읽고 쓴다.
drop policy if exists messages_select on public.pod_messages;
create policy messages_select on public.pod_messages
  for select to authenticated using (
    exists (select 1 from public.pod_participants p
             where p.pod_id = pod_messages.pod_id and p.user_id = auth.uid())
  );

drop policy if exists messages_insert on public.pod_messages;
create policy messages_insert on public.pod_messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.pod_participants p
                 where p.pod_id = pod_messages.pod_id and p.user_id = auth.uid())
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
