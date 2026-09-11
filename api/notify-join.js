// 누가 팟에 참가하면(joinPod 성공 직후 클라이언트가 fire-and-forget으로 호출) 그 팟장에게
// 푸시 알림을 보낸다. 참가는 즉시 성립(팟장 승인 없음) — 이건 그냥 "누가 들어왔어요" 알림이다.

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }

  const { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { res.status(500).json({ error: '서버에 SUPABASE_URL/SUPABASE_ANON_KEY가 없어요' }); return; }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) { res.status(200).json({ notified: false, skipped: 'VAPID 키 없음' }); return; }

  const podId = req.body && req.body.podId;
  const joinerNickname = req.body && typeof req.body.joinerNickname === 'string' ? req.body.joinerNickname.slice(0, 40) : '누군가';
  if (!podId) { res.status(400).json({ error: 'podId 필요해요' }); return; }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    const { data: pod, error: podErr } = await supa.from('pods').select('leader_id, origin_name, leader_dest').eq('id', podId).single();
    if (podErr || !pod) { res.status(404).json({ error: '팟을 못 찾았어요' }); return; }

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
