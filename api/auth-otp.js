// 학교 메일로 인증번호를 보내 달라고 Supabase 로그인에 요청한다(메일 발송·번호 관리는 Supabase 몫).
// 브라우저가 Supabase에 직접 요청하게 두지 않고 서버를 거치는 이유: 학교 메일이 아닌 주소로
// 인증 메일이 나가는 걸(우리 서비스가 스팸 발송기가 되는 걸) 서버에서 막기 위해서다.
// 대시보드에서 "새 사용자 가입 허용"을 꺼두면, 이 서버가 만든 학교 메일 계정에만 번호가 나간다.
const { createClient } = require('@supabase/supabase-js');
const V = require('./_email-verify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error: '서버 설정이 아직 안 됐어요' }); return; }

  const userId = req.body && req.body.userId;
  const email = V.normalizeSchoolEmail(req.body && req.body.email);
  if (typeof userId !== 'string' || !V.UUID_RE.test(userId)) { res.status(400).json({ error: '잘못된 요청이에요' }); return; }
  if (!email) { res.status(400).json({ error: `학교 메일(${V.SCHOOL_DOMAIN})만 쓸 수 있어요` }); return; }

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, opts);
  try {
    const { data: already } = await admin.from('verified_users').select('user_id').eq('user_id', userId).maybeSingle();
    if (already) { res.status(200).json({ ok: true, alreadyVerified: true }); return; }

    // 이미 다른 계정으로 인증된 메일이어도 번호는 보낸다. 번호를 맞히면 그 메일함의 주인이라는 뜻이라,
    // auth-link가 "원래 계정"으로 되돌려준다(브라우저를 바꾸거나 저장소를 지운 사람이 계정을 되찾는 길).
    // 한 메일 = 한 계정 규칙은 그대로다 — 새 계정이 생기는 대신 기존 계정을 이어받는다.

    // 학교 메일 계정이 없으면 만든다(이미 있으면 "이미 등록됨" 오류가 나는데, 그건 정상이라 넘어간다).
    const { error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (createErr && !/already|exists|registered/i.test(`${createErr.code || ''} ${createErr.message || ''}`)) throw createErr;

    // 가입은 끄고(shouldCreateUser:false) 방금 만든 계정에 번호만 보낸다. 재발송 간격 등 한도는 Supabase가 관리한다.
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, opts);
    const { error: otpErr } = await anon.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (otpErr) {
      if (otpErr.status === 429 || /rate|too many|seconds/i.test(otpErr.message || '')) {
        res.status(429).json({ error: '잠시 뒤에 다시 받을 수 있어요', retryAfter: 60 });
        return;
      }
      throw otpErr;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '인증번호를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요' });
  }
};
