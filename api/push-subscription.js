// 알림 구독(push_subscriptions)을 저장하고 지운다. 브라우저에서 anon 키로 직접 하면 안 되는 이유:
// 이 표는 구독 주소가 새면 남에게 알림을 쏠 수 있어서 anon의 "읽기"를 막아뒀다(supabase/push-subscriptions.sql).
// 그런데 조건이 붙은 삭제와 "있으면 갱신"(upsert)은 대상 줄을 읽을 수 있어야 해서, 읽기가 막힌 anon으로는
// 삭제가 오류 없이 0줄만 지우고 갱신은 42501(보안 규칙 위반)로 실패한다. 서버(서비스 롤 키)가 대신 처리한다.
//
// 로그인이 없어 userId(브라우저 uuid)만으로는 "내 구독이 맞다"를 증명할 수 없다. uuid는 팟 목록(팟장 번호)에서
// 남도 알 수 있어서, userId만 믿으면 남의 구독을 덮어쓰거나 지울 수 있다. 그래서 구독의 endpoint(그 브라우저와
// 푸시 서비스만 아는 비밀 URL)를 소유 증명으로 쓴다.
//  - 끄기: 지금 내 구독의 endpoint를 같이 보내야 하고, user_id와 endpoint가 둘 다 맞는 줄만 지운다.
//  - 켜기: 줄이 없으면 만들고, 있으면 같은 endpoint이거나 직전에 저장한 endpoint(previousEndpoint)를 대야 바꾼다.
const { createClient } = require('@supabase/supabase-js');
const { UUID_RE } = require('./_email-verify');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error: '서버 설정이 아직 안 됐어요' }); return; }

  const b = req.body || {};
  if (typeof b.userId !== 'string' || !UUID_RE.test(b.userId)) { res.status(400).json({ error: '잘못된 요청이에요' }); return; }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    if (b.action === 'unsubscribe') {
      if (typeof b.endpoint !== 'string' || !b.endpoint || b.endpoint.length > 1000) { res.status(400).json({ error: '잘못된 요청이에요' }); return; }
      const { error } = await admin.from('push_subscriptions').delete().eq('user_id', b.userId).eq('endpoint', b.endpoint);
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }
    if (b.action === 'subscribe') {
      const { endpoint, p256dh, auth } = b;
      const okStr = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
      if (!okStr(endpoint, 1000) || !/^https:\/\//.test(endpoint) || !okStr(p256dh, 200) || !okStr(auth, 100)) {
        res.status(400).json({ error: '알림 구독 정보가 올바르지 않아요' });
        return;
      }
      const { data: existing } = await admin.from('push_subscriptions').select('endpoint').eq('user_id', b.userId).maybeSingle();
      if (existing && existing.endpoint !== endpoint && existing.endpoint !== b.previousEndpoint) {
        // 이 계정에는 다른 기기의 구독이 있고, 그 구독을 안다는 증명이 없다 — 덮어쓰지 않는다.
        res.status(409).json({ error: '이 계정에는 다른 기기의 알림이 켜져 있어요. 그 기기에서 끄고 다시 켜 주세요' });
        return;
      }
      const { error } = await admin.from('push_subscriptions').upsert({ user_id: b.userId, endpoint, p256dh, auth }, { onConflict: 'user_id' });
      if (error) throw error;
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: '잘못된 요청이에요' });
  } catch (e) {
    res.status(500).json({ error: '알림 설정을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요' });
  }
};
