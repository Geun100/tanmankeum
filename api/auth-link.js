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

    // 인증을 마친 사람에게 그 사람만 아는 비밀값을 만들어 건넨다. 서버에는 지문만 저장한다(supabase/add-user-secret.sql).
    // 아래 어느 경로든 "이 메일함의 주인임을 이 계정에 대한 증명으로 쓸 수 있을 때"만 발급한다. 이미 다른 메일로 인증된
    // 계정의 번호를 안다는 것만으로는(번호는 공개돼 있다) 비밀값을 받을 수 없다.
    const issueSecret = async (uid) => {
      const secret = V.newSecret();
      const { error: upErr } = await admin.from('verified_users').update({ secret_hash: V.hashSecret(secret) }).eq('user_id', uid);
      if (upErr) throw upErr; // 저장하지 못한 비밀값을 건네면 쓸 수 없는 값을 쥐게 된다 — 실패로 알리고 다시 시도하게 한다
      return secret;
    };

    // 이 메일이 이미 어떤 계정으로 인증돼 있으면, 새 계정을 만들지 않고 그 계정을 이어받게 한다.
    // 인증번호를 맞혔다는 건 이 메일함의 주인이라는 증명이다. 브라우저를 바꾸거나 저장소를 지우면
    // 앱이 새 임의 번호를 만들기 때문에, 이렇게 해야 정상 이용자가 자기 계정(닉네임·팟)을 되찾는다.
    const { data: owner } = await admin.from('verified_users').select('user_id').eq('email_hash', emailHash).maybeSingle();
    if (owner) {
      const recovered = owner.user_id !== userId;
      if (recovered) await clearPush(owner.user_id);
      // 메일함 주인이라는 증명이니 그 계정의 새 비밀값을 건넨다(다른 기기에서 복구하는 경우도 포함 — 이전 기기의 값은 무효가 된다).
      const secret = await issueSecret(owner.user_id);
      res.status(200).json({ ok: true, verified: true, userId: owner.user_id, recovered, secret });
      return;
    }

    const newSecret = V.newSecret();
    const { error: insErr } = await admin.from('verified_users').insert({ user_id: userId, email_hash: emailHash, secret_hash: V.hashSecret(newSecret) });
    if (insErr) {
      if (insErr.code === '23505') {
        // 동시에 같은 메일로 인증이 겹쳤거나, 이 사용자가 이미 (다른 메일로) 인증돼 있는 경우.
        const { data: again } = await admin.from('verified_users').select('user_id').eq('email_hash', emailHash).maybeSingle();
        if (again) {
          const recovered = again.user_id !== userId;
          if (recovered) await clearPush(again.user_id); // 동시 인증이 겹친 경로도 같은 정리를 한다
          const secret = await issueSecret(again.user_id);
          res.status(200).json({ ok: true, verified: true, userId: again.user_id, recovered, secret });
          return;
        }
        const { data: me } = await admin.from('verified_users').select('user_id, email_hash').eq('user_id', userId).maybeSingle();
        if (me) {
          if (me.email_hash == null && process.env.ALLOW_LEGACY_CLAIM === '1') {
            // 기존 사용자 면제 줄(메일 해시가 비어 있음): 이 메일로 인증을 마쳤으니 그 줄에 메일 해시와 비밀값을 채운다.
            // 번호는 공개라서 이 줄은 "먼저 인증한 메일함 주인"이 차지한다 — 번호만 알면 남의 줄을 가로챌 수 있다.
            // 그래서 기본은 꺼져 있고, 운영자가 진짜 기존 사용자를 옮기는 동안에만 Vercel 환경변수 ALLOW_LEGACY_CLAIM=1로
            // 잠깐 켠다(끝나면 끈다). 꺼져 있으면 면제 사용자는 예전처럼 "인증됨"으로만 끝나고 비밀값은 받지 못한다.
            const claimSecret = V.newSecret();
            const { error: claimErr } = await admin.from('verified_users')
              .update({ email_hash: emailHash, secret_hash: V.hashSecret(claimSecret) }).eq('user_id', userId).is('email_hash', null);
            if (claimErr) throw claimErr;
            // 동시에 다른 요청이 먼저 채웠을 수 있다 — 지금 줄이 내 메일·내 비밀값일 때만 비밀값을 건넨다.
            const { data: after } = await admin.from('verified_users').select('email_hash, secret_hash').eq('user_id', userId).maybeSingle();
            if (after && after.email_hash === emailHash && V.secretMatches(after.secret_hash, claimSecret)) {
              res.status(200).json({ ok: true, verified: true, userId, recovered: false, secret: claimSecret });
              return;
            }
          }
          // 이미 다른 메일로 인증된 계정이다. 이 메일함 주인이라는 사실은 그 계정의 주인이라는 증명이 아니므로 비밀값은 주지 않는다.
          res.status(200).json({ ok: true, verified: true, userId, recovered: false });
          return;
        }
      }
      throw insErr;
    }
    res.status(200).json({ ok: true, verified: true, userId, recovered: false, secret: newSecret });
  } catch (e) {
    res.status(500).json({ error: '인증을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요' });
  }
};
