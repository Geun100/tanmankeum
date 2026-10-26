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
  // 다른 기기에서 계정을 되찾는 건 메일함 주인이라는 증명이다. 그 계정의 옛 알림 구독을 지워서 새 기기에서
  // 알림을 켤 수 있게 하고(한 계정 = 한 기기) 누가 먼저 차지해 둔 구독도 정리한다.
  // 알림은 부가 기능이라 실패해도 계정 복구는 계속 진행한다.
  // 한계: 정리 뒤 빈 자리를 사용자 번호만 아는 사람이 다시 먼저 차지할 수 있다(로그인 없는 신원 모델의 한계).
  // 근본 해결은 알림 구독을 서버가 확인할 수 있는 로그인·비밀값에 묶는 것이다.
  const clearPush = async (uid) => { try { await admin.from('push_subscriptions').delete().eq('user_id', uid); } catch (_) {} };

  try {
    const { data, error } = await admin.auth.getUser(accessToken);
    const user = data && data.user;
    if (error || !user) { res.status(401).json({ error: '인증이 만료됐어요. 인증번호를 다시 받아주세요' }); return; }
    const email = V.normalizeSchoolEmail(user.email);
    if (!email || !(user.email_confirmed_at || user.confirmed_at)) { res.status(403).json({ error: '학교 메일 인증이 확인되지 않았어요' }); return; }
    const emailHash = V.hashEmail(email);

    // 이 메일이 이미 어떤 계정으로 인증돼 있으면, 새 계정을 만들지 않고 그 계정을 이어받게 한다.
    // 인증번호를 맞혔다는 건 이 메일함의 주인이라는 증명이다. 브라우저를 바꾸거나 저장소를 지우면
    // 앱이 새 임의 번호를 만들기 때문에, 이렇게 해야 정상 이용자가 자기 계정(닉네임·팟)을 되찾는다.
    const { data: owner } = await admin.from('verified_users').select('user_id').eq('email_hash', emailHash).maybeSingle();
    if (owner) {
      const recovered = owner.user_id !== userId;
      if (recovered) await clearPush(owner.user_id);
      res.status(200).json({ ok: true, verified: true, userId: owner.user_id, recovered });
      return;
    }

    const { error: insErr } = await admin.from('verified_users').insert({ user_id: userId, email_hash: emailHash });
    if (insErr) {
      if (insErr.code === '23505') {
        // 동시에 같은 메일로 인증이 겹쳤거나, 이 사용자가 이미 (다른 메일로) 인증돼 있는 경우.
        const { data: again } = await admin.from('verified_users').select('user_id').eq('email_hash', emailHash).maybeSingle();
        if (again) {
          const recovered = again.user_id !== userId;
          if (recovered) await clearPush(again.user_id); // 동시 인증이 겹친 경로도 같은 정리를 한다
          res.status(200).json({ ok: true, verified: true, userId: again.user_id, recovered });
          return;
        }
        const { data: me } = await admin.from('verified_users').select('user_id').eq('user_id', userId).maybeSingle();
        if (me) { res.status(200).json({ ok: true, verified: true, userId, recovered: false }); return; }
      }
      throw insErr;
    }
    res.status(200).json({ ok: true, verified: true, userId, recovered: false });
  } catch (e) {
    res.status(500).json({ error: '인증을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요' });
  }
};
