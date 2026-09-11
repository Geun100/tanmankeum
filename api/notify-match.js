// 새 팟이 생기면(createOwnPod 성공 직후 클라이언트가 fire-and-forget으로 호출) 조건이 맞는
// "대기 중인 다른 사용자"(자기 팟을 아직 못 채운 리더들)를 찾아 푸시 알림을 보낸다.
//
// 여기서 쓰는 매칭 조건은 client의 calcMatchScore(index.html)보다 훨씬 거칠다 — 실제 도로 경로
// (카카오 길찾기)를 안 쓰고 직선거리/방위각만 본다. 이건 의도한 절충이다: 알림은 "한 번 열어볼
// 가치가 있는지"만 판단하면 되고, 실제 참가 가능 여부(도보 10분 캡 등)는 사용자가 앱을 열었을 때
// previewJoin()이 정밀하게 다시 검증한다. 여기서 매칭 엔진 전체를 서버에 복제하지 않는다.

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const ORIGIN_MATCH_M = 500;
const ANGLE_THRESHOLD_DEG = 25;
const TIME_WINDOW_MIN = 90;

function toRad(d) { return (d * Math.PI) / 180; }
function dist(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}
function angleDiff(b1, b2) { const d = Math.abs(b1 - b2) % 360; return d > 180 ? 360 - d : d; }
function timeToMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }

  const { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { res.status(500).json({ error: '서버에 SUPABASE_URL/SUPABASE_ANON_KEY가 없어요' }); return; }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) { res.status(200).json({ notified: 0, skipped: 'VAPID 키 없음' }); return; }

  const podId = req.body && req.body.podId;
  if (!podId) { res.status(400).json({ error: 'podId 필요해요' }); return; }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  try {
    const { data: pod, error: podErr } = await supa.from('pods').select('*, profiles!leader_id(gender)').eq('id', podId).single();
    if (podErr || !pod) { res.status(404).json({ error: '팟을 못 찾았어요' }); return; }

    const { data: candidates, error: candErr } = await supa
      .from('pods')
      .select('id, leader_id, origin_name, origin_lat, origin_lng, leader_dest, leader_dest_lat, leader_dest_lng, depart_date, depart_time, profiles!leader_id(gender)')
      .eq('status', 'open')
      .eq('depart_date', pod.depart_date)
      .neq('id', podId);
    if (candErr) throw candErr;

    const podOrigin = { lat: pod.origin_lat, lng: pod.origin_lng };
    const podDest = { lat: pod.leader_dest_lat, lng: pod.leader_dest_lng };
    const podBearing = bearing(podOrigin, podDest);
    const podGender = pod.profiles && pod.profiles.gender;

    const matched = (candidates || []).filter((c) => {
      if (c.leader_id === pod.leader_id) return false;
      const cGender = c.profiles && c.profiles.gender;
      if (podGender && cGender && podGender !== cGender) return false;
      const cOrigin = { lat: c.origin_lat, lng: c.origin_lng };
      if (dist(podOrigin, cOrigin) > ORIGIN_MATCH_M) return false;
      const cDest = { lat: c.leader_dest_lat, lng: c.leader_dest_lng };
      if (angleDiff(podBearing, bearing(podOrigin, cDest)) > ANGLE_THRESHOLD_DEG) return false;
      if (Math.abs(timeToMin(pod.depart_time) - timeToMin(c.depart_time)) > TIME_WINDOW_MIN) return false;
      return true;
    });

    if (!matched.length) { res.status(200).json({ notified: 0 }); return; }

    const { data: subs } = await supa
      .from('push_subscriptions')
      .select('*')
      .in('user_id', matched.map((c) => c.leader_id));

    const payload = JSON.stringify({
      title: '나에게 맞는 팟이 있어요',
      body: `${pod.origin_name} → ${pod.leader_dest} · ${pod.depart_time} 출발`,
      url: `/?pod=${podId}`,
    });

    let notified = 0;
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        notified++;
      } catch (e) {
        // 구독이 만료/취소됐으면(410 Gone 등) 알림만 조용히 실패시키고, 죽은 구독은 지운다.
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await supa.from('push_subscriptions').delete().eq('user_id', s.user_id);
        }
      }
    }));

    res.status(200).json({ notified });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
