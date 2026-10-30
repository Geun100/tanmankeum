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

// ----- 사용자별 비밀값 -----
// 메일 인증을 마친 순간 서버가 만들어 브라우저에 한 번만 건넨다. 서버에는 지문(해시)만 저장한다.
// 비밀값은 256비트 난수라 무차별 대입이 불가능하다 — 해시에 서버 비밀값을 섞는 건 DB만 새는 경우에 대한 추가 방어다.
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
function newSecret() { return crypto.randomBytes(32).toString('base64url'); }
function hashSecret(secret) {
  const s = process.env.EMAIL_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('서버에 EMAIL_HASH_SECRET(또는 SUPABASE_SERVICE_ROLE_KEY)이 없어요');
  return crypto.createHmac('sha256', s).update('secret:' + secret).digest('hex');
}
// 저장된 지문(stored)과 브라우저가 보낸 비밀값(provided)이 맞는지. 형식이 틀리거나 저장된 지문이 없으면 항상 false.
function secretMatches(stored, provided) {
  if (typeof stored !== 'string' || !stored || typeof provided !== 'string' || !SECRET_RE.test(provided)) return false;
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(hashSecret(provided), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 접속 코드(운영자·시연용 비밀 입구): 환경변수 DEMO_ACCESS_CODES(쉼표로 구분)에 있는 코드와 같은지 본다.
// 비어 있으면 입구는 닫힌 것이다. 12자 미만 코드는 추측하기 쉬워 아예 쓰지 않는다. 해시끼리 시간이 일정하게 비교한다.
function accessCodeMatches(provided) {
  if (typeof provided !== 'string' || !provided || provided.length > 100) return false;
  const codes = (process.env.DEMO_ACCESS_CODES || '').split(',').map(s => s.trim()).filter(c => c.length >= 12);
  const digest = s => crypto.createHash('sha256').update(s).digest();
  const p = digest(provided.trim());
  let ok = false;
  for (const c of codes) if (crypto.timingSafeEqual(p, digest(c))) ok = true; // 일부러 중간에 멈추지 않는다
  return ok;
}

module.exports = { SCHOOL_DOMAIN, UUID_RE, SECRET_RE, normalizeSchoolEmail, hashEmail, newSecret, hashSecret, secretMatches, accessCodeMatches };
