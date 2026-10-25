// 학교 메일 인증 공용 도우미. 파일명이 _로 시작하면 Vercel이 API 경로로 안 열고,
// auth-otp / auth-link / verify-status가 require해서 쓴다.
// 인증번호 발급·유효시간·시도 제한·메일 발송은 Supabase 로그인(메일 OTP)이 맡는다 — 여기엔 없다.
const crypto = require('crypto');

const SCHOOL_DOMAIN = '@handong.ac.kr';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 소문자·앞뒤 공백 제거 후 "아무것@handong.ac.kr" 꼴만 통과. 도메인 검사는 반드시 서버에서 한다.
function normalizeSchoolEmail(raw){
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 120) return null;
  const local = email.slice(0, email.length - SCHOOL_DOMAIN.length);
  if (!email.endsWith(SCHOOL_DOMAIN) || !local || /[\s@]/.test(local)) return null;
  return email;
}

// "한 메일 = 한 계정" 검사용 해시. 우리 테이블(verified_users)에는 메일 원문을 두지 않는다.
function hashEmail(email){
  const s = process.env.EMAIL_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('서버에 EMAIL_HASH_SECRET(또는 SUPABASE_SERVICE_ROLE_KEY)이 없어요');
  return crypto.createHmac('sha256', s).update('email:' + email).digest('hex');
}

module.exports = { SCHOOL_DOMAIN, UUID_RE, normalizeSchoolEmail, hashEmail };
