// 누가 팟에 참가하면(joinPod 성공 직후 클라이언트가 fire-and-forget으로 호출) 그 팟장에게
// 푸시 알림을 보낸다. 참가는 즉시 성립(팟장 승인 없음) — 이건 그냥 "누가 들어왔어요" 알림이다.

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!SUPABASE_URL) { res.status(500).json({ error: '서버에 SUPABASE_URL이 없어요' }); return; }
  // push_subscriptions는 RLS가 anon select를 막아둔다(supabase/push-subscriptions.sql 주석 참고) —
  // endpoint/p256dh/auth가 새면 그 값만으로 남의 브라우저에 임의 알림을 쏠 수 있어서다.
  // 그래서 이 함수만은 서비스 롤 키(RLS 우회)로 접근한다. 키가 아직 없으면 에러 대신 조용히 건너뛴다 —
  // 알림은 있으면 좋은 부가 기능이지, 없다고 참가 자체가 실패하면 안 된다.
  if (!SUPABASE_SERVICE_ROLE_KEY) { res.status(200).json({ notified: false, skipped: 'SUPABASE_SERVICE_ROLE_KEY 없음' }); return; }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) { res.status(200).json({ notified: false, skipped: 'VAPID 키 없음' }); return; }

  const podId = req.body && req.body.podId;
  const joinerNickname = req.body && typeof req.body.joinerNickname === 'string' ? req.body.joinerNickname.slice(0, 40) : '누군가';
  if (!podId) { res.status(400).json({ error: 'podId 필요해요' }); return; }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: pod, error: podErr } = await supa.from('pods').select('leader_id, origin_name, leader_dest').eq('id', podId).single();
    if (podErr || !pod) { res.status(404).json({ error: '팟을 못 찾았어요' }); return; }

    // 로그인이 없어 podId만으로 아무나 "누가 들어왔다" 알림을 팟장에게 스팸으로 보낼 수 있다.
    // 완전히 막을 순 없지만(진짜 인증이 없으니), 최소한 그 닉네임이 실제로 이 팟 참가자
    // 목록에 있을 때만 보낸다 — 완전히 무관한 podId/닉네임 조합으로 찌르는 건 막는다.
    const { data: participants } = await supa.from('pod_participants').select('profiles(nickname)').eq('pod_id', podId);
    const isRealParticipant = (participants || []).some(p => p.profiles && p.profiles.nickname === joinerNickname);
    if (!isRealParticipant) { res.status(200).json({ notified: false, reason: '참가자 목록에 없는 닉네임' }); return; }

    const { data: sub } = await supa.from('push_subscriptions').select('*').eq('user_id', pod.leader_id).maybeSingle();
    if (!sub) { res.status(200).json({ notified: false, reason: '팟장이 알림을 안 켜뒀어요' }); return; }

    const payload = JSON.stringify({
      title: '내 팟에 새 팟원이 들어왔어요',
      body: `${joinerNickname}님이 참가했어요 · ${pod.origin_name} → ${pod.leader_dest}`,
      url: `/?pod=${podId}`,
    });

    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      res.status(200).json({ notified: true });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await supa.from('push_subscriptions').delete().eq('user_id', pod.leader_id);
      }
      res.status(200).json({ notified: false });
    }
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
