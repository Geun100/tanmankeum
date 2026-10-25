// 브라우저가 Supabase 로그인으로 인증번호 확인을 마치면, 그 결과(액세스 토큰)를 받아 이 사용자(UUID)를
// "학교 인증됨"으로 기록한다. 메일 주소는 토큰에서 서버가 직접 꺼낸다 — 클라이언트가 보낸 값을 믿지 않는다.
const { createClient } = require('@supabase/supabase-js');
const V = require('./_email-verify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error: '서버 설정이 아직 안 됐어요' }); return; }

  const userId = req.body && req.body.userId;
  const accessToken = req.body && req.body.accessToken;
  if (typeof userId !== 'string' || !V.UUID_RE.test(userId) || typeof accessToken !== 'string' || !accessToken) {
    res.status(400).json({ error: '잘못된 요청이에요' });
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data, error } = await admin.auth.getUser(accessToken);
    const user = data && data.user;
    if (error || !user) { res.status(401).json({ error: '인증이 만료됐어요. 인증번호를 다시 받아주세요' }); return; }
    const email = V.normalizeSchoolEmail(user.email);
    if (!email || !(user.email_confirmed_at || user.confirmed_at)) { res.status(403).json({ error: '학교 메일 인증이 확인되지 않았어요' }); return; }
    const emailHash = V.hashEmail(email);

    const { error: insErr } = await admin.from('verified_users').insert({ user_id: userId, email_hash: emailHash });
    if (insErr) {
      if (insErr.code === '23505') {
        // 같은 사용자가 이미 인증돼 있으면 성공으로 본다. 아니면 그 메일은 다른 계정이 먼저 인증한 것이다.
        const { data: me } = await admin.from('verified_users').select('user_id').eq('user_id', userId).maybeSingle();
        if (me) { res.status(200).json({ ok: true, verified: true }); return; }
        res.status(409).json({ error: '이미 다른 계정으로 인증된 메일이에요' });
        return;
      }
      throw insErr;
    }
    res.status(200).json({ ok: true, verified: true });
  } catch (e) {
    res.status(500).json({ error: '인증을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요' });
  }
};
