// 팟에서 일어난 일을 푸시 알림으로 알린다. 클라이언트가 그 동작이 성공한 직후 fire-and-forget으로 호출한다.
//   event: 'join'      (기본) 누가 팟에 참가하면 → 팟장에게 "새 팟원이 들어왔어요"
//          'left'      참가자가 팟에서 나가면      → 팟장에게 "팟원이 나갔어요"
//          'cancelled' 팟장이 팟을 취소하면        → 참가자 전원(팟장 제외)에게 "팟이 취소됐어요"
// 서버 함수 개수 한도(Hobby 12개) 때문에 새 파일을 만들지 않고 이 함수 하나에 모았다.
//
// 로그인 세션을 저장하지 않는 앱이라(app.js의 supaAuth 주석 참고) 서버가 "누가 요청했는지"를 확인할 수 없다.
// 그래서 요청을 믿지 않고, 서버가 DB의 실제 상태를 확인한 뒤에만 보낸다:
//   - cancelled: 팟이 정말 취소(dissolved) 상태인가, 아직 지난 팟이 아닌가, 알릴 참가자가 있는가
//   - left: 그 사람이 지금 정말 참가자가 아닌가, 팟장이 아닌가, 실제 프로필이 있는가
// 거기에 push_events 표로 같은 알림 중복과 연타를 막는다(supabase/add-push-events.sql).
// 한계: 사용자 번호가 공개 조회라, 팟에 없는 사람의 번호로 "나감"을 흉내 내는 요청은 완전히 막지 못한다 —
// 같은 팟에서 10분에 3건까지만 보내서 폭을 줄인다. 근본 해결은 서버가 확인할 수 있는 비밀값에 묶는 것이다.

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const V = require('./_email-verify');

const EVENTS = ['join', 'left', 'cancelled'];
const WINDOW_MS = 10 * 60 * 1000;      // 'left' 중복 방지 구간
const MAX_LEFT_PER_WINDOW = 3;         // 같은 팟에서 한 구간에 보낼 수 있는 'left' 알림 수
const CANCEL_MAX_AGE_MS = 60 * 60 * 1000; // 출발 시각이 이만큼 넘게 지난 팟의 취소는 알리지 않는다
const ACTIVE = ['open', 'confirmed', 'in_progress'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!SUPABASE_URL) { res.status(500).json({ error: '서버에 SUPABASE_URL이 없어요' }); return; }
  // push_subscriptions는 RLS가 anon select를 막아둔다(supabase/push-subscriptions.sql 주석 참고) —
  // endpoint/p256dh/auth가 새면 그 값만으로 남의 브라우저에 임의 알림을 쏠 수 있어서다.
  // 그래서 이 함수만은 서비스 롤 키(RLS 우회)로 접근한다. 키가 아직 없으면 에러 대신 조용히 건너뛴다 —
  // 알림은 있으면 좋은 부가 기능이지, 없다고 참가·취소 자체가 실패하면 안 된다.
  if (!SUPABASE_SERVICE_ROLE_KEY) { res.status(200).json({ notified: false, skipped: 'SUPABASE_SERVICE_ROLE_KEY 없음' }); return; }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) { res.status(200).json({ notified: false, skipped: 'VAPID 키 없음' }); return; }

  const body = req.body || {};
  const event = body.event === undefined ? 'join' : body.event;
  const podId = body.podId;
  if (!EVENTS.includes(event)) { res.status(400).json({ error: '알 수 없는 event예요' }); return; }
  if (!podId) { res.status(400).json({ error: 'podId 필요해요' }); return; }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 알림 하나를 보낸다. 구독이 만료됐으면(404/410) 그 구독을 지운다. 보냈으면 true.
  async function send(sub, payload) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
      return true;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await supa.from('push_subscriptions').delete().eq('user_id', sub.user_id);
      }
      return false;
    }
  }
  // push_events에 먼저 한 줄 남긴다. 'ok'면 보내도 된다, 'dup'이면 이미 보낸 알림이다.
  // 표가 없거나 다른 오류면 'error' — 중복을 막을 수 없으니 보내지 않는다(위조 연타를 막는 쪽이 우선).
  async function claim(kind, subject, bucket) {
    const { error } = await supa.from('push_events').insert({ pod_id: podId, kind, subject, bucket });
    if (!error) return 'ok';
    return error.code === '23505' ? 'dup' : 'error';
  }

  try {
    const { data: pod, error: podErr } = await supa
      .from('pods')
      .select('leader_id, status, origin_name, leader_dest, depart_date, depart_time, desired_size')
      .eq('id', podId)
      .single();
    if (podErr || !pod) { res.status(404).json({ error: '팟을 못 찾았어요' }); return; }

    if (event === 'join') {
      const joinerNickname = typeof body.joinerNickname === 'string' ? body.joinerNickname.slice(0, 40) : '누군가';
      // 로그인이 없어 podId만으로 아무나 "누가 들어왔다" 알림을 팟장에게 스팸으로 보낼 수 있다.
      // 완전히 막을 순 없지만(진짜 인증이 없으니), 최소한 그 닉네임이 실제로 이 팟 참가자
      // 목록에 있을 때만 보낸다 — 완전히 무관한 podId/닉네임 조합으로 찌르는 건 막는다.
      const { data: participants } = await supa.from('pod_participants').select('profiles(nickname)').eq('pod_id', podId);
      const isRealParticipant = (participants || []).some(p => p.profiles && p.profiles.nickname === joinerNickname);
      if (!isRealParticipant) { res.status(200).json({ notified: false, reason: '참가자 목록에 없는 닉네임' }); return; }

      const { data: sub } = await supa.from('push_subscriptions').select('*').eq('user_id', pod.leader_id).maybeSingle();
      if (!sub) { res.status(200).json({ notified: false, reason: '팟장이 알림을 안 켜뒀어요' }); return; }

      const ok = await send(sub, {
        title: '내 팟에 새 팟원이 들어왔어요',
        body: `${joinerNickname}님이 참가했어요 · ${pod.origin_name} → ${pod.leader_dest}`,
        url: `/?pod=${podId}`,
      });
      res.status(200).json({ notified: ok });
      return;
    }

    if (event === 'cancelled') {
      if (pod.status !== 'dissolved') { res.status(200).json({ notified: 0, reason: '아직 취소된 팟이 아니에요' }); return; }
      const departAt = new Date(`${pod.depart_date}T${pod.depart_time}`).getTime();
      if (!Number.isFinite(departAt) || Date.now() - departAt > CANCEL_MAX_AGE_MS) { res.status(200).json({ notified: 0, reason: '이미 지난 팟이에요' }); return; }

      // 팟을 취소해도 참가자 기록은 남아 있다(상태만 바뀐다). 팟장은 알릴 대상이 아니다.
      const { data: rows } = await supa.from('pod_participants').select('user_id').eq('pod_id', podId);
      const targets = (rows || []).map(r => r.user_id).filter(id => id !== pod.leader_id);
      if (!targets.length) { res.status(200).json({ notified: 0, reason: '알릴 참가자가 없어요' }); return; }

      const claimed = await claim('cancelled', pod.leader_id, 0);
      if (claimed === 'dup') { res.status(200).json({ notified: 0, reason: '이미 알렸어요' }); return; }
      if (claimed === 'error') { res.status(200).json({ notified: 0, skipped: 'push_events 표를 쓸 수 없어요' }); return; }

      const { data: subs } = await supa.from('push_subscriptions').select('*').in('user_id', targets);
      const payload = {
        title: '팟이 취소됐어요',
        body: `${pod.origin_name} → ${pod.leader_dest} · ${String(pod.depart_time).slice(0, 5)} 출발 팟을 팟장이 취소했어요`,
        url: '/',
      };
      const results = await Promise.all((subs || []).map(s => send(s, payload)));
      res.status(200).json({ notified: results.filter(Boolean).length });
      return;
    }

    // event === 'left'
    const userId = body.userId;
    if (typeof userId !== 'string' || !V.UUID_RE.test(userId)) { res.status(400).json({ error: 'userId가 올바르지 않아요' }); return; }
    if (!ACTIVE.includes(pod.status)) { res.status(200).json({ notified: false, reason: '이미 끝난 팟이에요' }); return; }
    if (userId === pod.leader_id) { res.status(200).json({ notified: false, reason: '팟장은 나가는 게 아니라 팟 취소예요' }); return; }

    // 정말 팟에서 빠졌는지 확인한다. 아직 참가 중이면 "나갔어요"를 보낼 수 없다.
    const { data: still } = await supa.from('pod_participants').select('user_id').eq('pod_id', podId).eq('user_id', userId).maybeSingle();
    if (still) { res.status(200).json({ notified: false, reason: '아직 참가 중이에요' }); return; }
    const { data: profile } = await supa.from('profiles').select('nickname').eq('id', userId).maybeSingle();
    if (!profile) { res.status(200).json({ notified: false, reason: '없는 사용자예요' }); return; }

    // 같은 팟에서 10분에 3건까지만 — 흉내 내는 요청이 팟장에게 알림을 쏟아내는 걸 막는다.
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count, error: cntErr } = await supa
      .from('push_events').select('pod_id', { count: 'exact', head: true })
      .eq('pod_id', podId).eq('kind', 'left').gte('created_at', since);
    if (cntErr) { res.status(200).json({ notified: false, skipped: 'push_events 표를 쓸 수 없어요' }); return; }
    if ((count || 0) >= MAX_LEFT_PER_WINDOW) { res.status(200).json({ notified: false, reason: '잠시 뒤에 다시 알릴 수 있어요' }); return; }

    const claimed = await claim('left', userId, Math.floor(Date.now() / WINDOW_MS));
    if (claimed === 'dup') { res.status(200).json({ notified: false, reason: '이미 알렸어요' }); return; }
    if (claimed === 'error') { res.status(200).json({ notified: false, skipped: 'push_events 표를 쓸 수 없어요' }); return; }

    const { data: sub } = await supa.from('push_subscriptions').select('*').eq('user_id', pod.leader_id).maybeSingle();
    if (!sub) { res.status(200).json({ notified: false, reason: '팟장이 알림을 안 켜뒀어요' }); return; }

    const { count: nowCount } = await supa.from('pod_participants').select('user_id', { count: 'exact', head: true }).eq('pod_id', podId);
    const ok = await send(sub, {
      title: '팟원이 나갔어요',
      body: `${String(profile.nickname).slice(0, 40)}님이 팟에서 나갔어요 · ${pod.origin_name} → ${pod.leader_dest} (현재 ${nowCount || 0}/${pod.desired_size}명)`,
      url: `/?pod=${podId}`,
    });
    res.status(200).json({ notified: ok });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
