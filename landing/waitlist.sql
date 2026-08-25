-- 랜딩 이메일 수집(수요 파악)용 테이블. SQL Editor에 붙여넣고 실행한다. 재실행 안전.
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  region text,                       -- 관심 지역(선택 입력)
  source text default 'landing',
  created_at timestamptz not null default now()
);

-- 같은 이메일 중복 등록 방지. 대소문자 무시.
create unique index if not exists waitlist_email_key on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

-- 익명 사용자는 넣기만 된다. 읽기 정책이 없으므로 수집된 이메일은 클라이언트에서 조회 불가
-- (목록 확인은 Supabase 대시보드/서비스 키로만). 형식 검사는 DB에서도 한 번 더 한다.
drop policy if exists waitlist_insert on public.waitlist;
create policy waitlist_insert on public.waitlist
  for insert to anon with check (
    email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and length(email) <= 254
    and (region is null or length(region) <= 40)
  );
