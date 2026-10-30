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

  // 운영자·시연용 비밀 입구: 메일 없이 접속 코드로 이 사용자(UUID)를 "인증됨"으로 등록한다. 코드는 서버 환경변수에만 있다.
  // 메일 해시 자리에 'demo:<사용자번호>'를 넣어서, 진짜 메일 해시와 겹치지 않고(메일 해시는 64자리 16진수),
  // 빈 해시를 가로채는 ALLOW_LEGACY_CLAIM 경로에도 걸리지 않고, `email_hash like 'demo:%'`로 한 번에 지울 수 있다.
  if (req.body && typeof req.body.accessCode === 'string') {
    if (!V.accessCodeMatches(req.body.accessCode)) {
      await new Promise(r => setTimeout(r, 1000)); // 무작위 대입을 늦춘다(서버리스라 시도 횟수는 저장하지 못한다 — 코드를 길게 잡는 이유)
      res.status(403).json({ error: '코드가 맞지 않아요' });
      return;
    }
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      // 사용자 번호는 공개라서, 이미 있는 줄은 건드리지 않는다(남의 비밀값을 덮어쓰면 계정을 가로챌 수 있다).
      const { data: row } = await db.from('verified_users').select('user_id, secret_hash').eq('user_id', userId).maybeSingle();
      if (row) {
        if (V.secretMatches(row.secret_hash, req.body.secret)) { res.status(200).json({ ok: true, alreadyVerified: true }); return; }
        res.status(409).json({ error: '이미 등록된 기기예요' });
        return;
      }
      const secret = V.newSecret();
      const { error: insErr } = await db.from('verified_users').insert({ user_id: userId, email_hash: 'demo:' + userId, secret_hash: V.hashSecret(secret) });
      if (insErr) { res.status(insErr.code === '23505' ? 409 : 500).json({ error: '입장하지 못했어요. 잠시 뒤 다시 시도해 주세요' }); return; }
      res.status(200).json({ ok: true, verified: true, secret });
    } catch (e) {
      res.status(500).json({ error: '입장하지 못했어요. 잠시 뒤 다시 시도해 주세요' });
    }
    return;
  }

  if (!email) { res.status(400).json({ error: `학교 메일(${V.SCHOOL_DOMAIN})만 쓸 수 있어요` }); return; }

  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, opts);
  try {
    // 인증번호 없이 통과시키는 지름길은 이 기기가 그 사용자의 비밀값을 갖고 있을 때만 연다. 사용자 번호는 공개라서
    // 번호만으로 "이미 인증된 사람"이 될 수 있으면, 비밀값이 없는 쪽이 비밀값을 받을 길이 없어진다(인증번호를 다시 받아야 한다).
    const { data: already } = await admin.from('verified_users').select('user_id, secret_hash').eq('user_id', userId).maybeSingle();
    if (already && V.secretMatches(already.secret_hash, req.body && req.body.secret)) { res.status(200).json({ ok: true, alreadyVerified: true }); return; }

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
