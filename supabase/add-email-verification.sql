-- 한동대 학교 메일 인증 (마이그레이션, 재실행 안전).
-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 실행한다.
--
-- 인증번호 발급·확인·메일 발송은 Supabase 로그인(메일 OTP)이 맡는다. 이 테이블은 "이 앱 사용자(UUID)가
-- 학교 인증을 마쳤는지"만 기록한다.
--
-- RLS만 켜고 정책을 하나도 안 만든다 — anon 키(프론트 번들에 박힌 공개값)로는 읽기·쓰기 전부 막힌다.
-- 클라이언트가 직접 쓸 수 있으면 "인증됨"을 누구나 위조할 수 있어서, api/auth-otp·auth-link·verify-status가
-- 서비스 롤 키로만 접근한다.
--
-- email_hash는 서버 비밀값으로 만든 HMAC이라 이 테이블만으로는 메일 주소를 되돌릴 수 없다.
-- (단, Supabase 로그인 쪽 auth.users에는 인증에 쓴 메일 원문이 남는다.)

-- 인증 끝난 사용자. email_hash가 null이면 이 기능이 생기기 전부터 쓰던 기존 사용자(면제).
-- email_hash는 unique — 한 메일로 계정 하나만 인증된다(null은 여러 개 허용).
create table if not exists public.verified_users (
  user_id     uuid primary key,
  email_hash  text unique,
  verified_at timestamptz not null default now()
);

alter table public.verified_users enable row level security;

-- 기존 사용자 면제: 지금 프로필이 있는 모두를 인증된 것으로 넣는다.
-- 이 SQL을 실행한 시점 이후에 가입하는 사람부터 메일 인증을 거친다.
insert into public.verified_users (user_id)
select id from public.profiles
on conflict (user_id) do nothing;
