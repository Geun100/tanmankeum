// 이 사용자가 학교 인증을 마쳤는지(기존 사용자 면제 포함) 알려준다. 앱을 열 때마다 부른다.
const { createClient } = require('@supabase/supabase-js');
const V = require('./_email-verify');
const { UUID_RE } = V;

module.exports = async (req, res) => {
  // POST: 로그아웃 때 복원 쿠키를 지운다(안 지우면 로그아웃해도 다음 접속에 계정이 되살아난다).
  if (req.method === 'POST') {
    if (res.setHeader) res.setHeader('Set-Cookie', V.clearSessionCookieHeader());
    res.status(200).json({ ok: true });
    return;
  }
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET·POST만 지원해요' }); return; }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error: '서버 설정이 아직 안 됐어요' }); return; }

  const userId = req.query && req.query.userId;
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) { res.status(400).json({ error: '잘못된 요청이에요' }); return; }

  try {
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // 이 브라우저가 저장소를 잃어 새 번호를 만들었어도, 복원 쿠키가 있고 서버의 비밀값 지문과 맞으면 원래 계정을 돌려준다.
    const saved = V.readSessionCookie(req);
    if (saved && saved.userId !== userId) {
      const { data: row } = await supa.from('verified_users').select('user_id, secret_hash').eq('user_id', saved.userId).maybeSingle();
      if (row && V.secretMatches(row.secret_hash, saved.secret)) {
        res.status(200).json({ verified: true, hasSecret: true, restore: { userId: saved.userId, secret: saved.secret } });
        return;
      }
      if (res.setHeader) res.setHeader('Set-Cookie', V.clearSessionCookieHeader()); // 비밀값이 바뀌었거나 줄이 사라졌다 — 쓸모없는 쿠키는 치운다
    }
    const { data } = await supa.from('verified_users').select('user_id, secret_hash').eq('user_id', userId).maybeSingle();
    // hasSecret: 이 사용자가 서버에서 비밀값을 받은 적이 있는지(지문이 있는지)만 알려준다. 지문 자체는 내보내지 않는다.
    res.status(200).json({ verified: !!data, hasSecret: !!(data && data.secret_hash) });
  } catch (e) {
    res.status(500).json({ error: '인증 상태를 확인하지 못했어요' });
  }
};
