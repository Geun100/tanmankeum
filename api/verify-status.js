// 이 사용자가 학교 인증을 마쳤는지(기존 사용자 면제 포함) 알려준다. 앱을 열 때마다 부른다.
const { createClient } = require('@supabase/supabase-js');
const { UUID_RE } = require('./_email-verify');

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET만 지원해요' }); return; }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error: '서버 설정이 아직 안 됐어요' }); return; }

  const userId = req.query && req.query.userId;
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) { res.status(400).json({ error: '잘못된 요청이에요' }); return; }

  try {
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await supa.from('verified_users').select('user_id').eq('user_id', userId).maybeSingle();
    res.status(200).json({ verified: !!data });
  } catch (e) {
    res.status(500).json({ error: '인증 상태를 확인하지 못했어요' });
  }
};
