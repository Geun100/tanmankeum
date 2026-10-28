// 문제 알리기(신고) 저장. api/notify-join.js가 event === 'report'일 때 여기로 넘긴다.
// 서버 함수 개수 한도(Hobby 12개) 때문에 새 API 파일을 못 만든다 — 파일명이 _로 시작하면 함수로 세지 않는다.
//
// 사용자 번호(uuid)는 팟 참가자 목록에 공개돼 있어서, 번호만으로는 "이 신고를 그 사람이 보냈다"를 믿을 수 없다.
// 그래서 학교 메일 인증을 마칠 때 서버가 건넨 비밀값(api/auth-link)을 같이 받아 지문과 맞는지 확인한다.
// 앱이 DB에 직접 저장하는 길은 supabase/add-user-reports.sql에서 닫아뒀다 — 저장은 오직 이 함수를 거친다.
//
// 저장을 허용하는 경우(전부 서버가 확인한다)
//  1) 신고자가 자기 비밀값을 보여줬다
//  2) 신고자와 대상이 둘 다 그 팟의 참가자이고, 서로 다른 사람이다
//  3) 팟이 확정된 뒤(confirmed, in_progress)다 — 확정 전엔 그냥 나가면 된다
//  4) 같은 팟에서 같은 사람은 한 번만(DB unique) — 두 번째는 오류가 아니라 duplicate로 알린다
// 알림(notify-join의 다른 이벤트)과 달리 저장이 목적이라, 서버 설정이 없으면 조용히 건너뛰지 않고 오류로 알린다.

const { createClient } = require('@supabase/supabase-js');
const V = require('./_email-verify');

const REASONS = ['no_show', 'unpaid', 'not_confirmed', 'rude', 'gender', 'other'];
const REPORTABLE = ['confirmed', 'in_progress'];
const DETAIL_MAX = 200;  // '기타'로 직접 적는 글자 수 한도(DB check와 같은 값)

async function handleReport(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error: '서버 설정이 아직 안 됐어요' }); return; }

  const { podId, userId, targetId, secret, reason, detail } = req.body || {};
  const isId = id => typeof id === 'string' && V.UUID_RE.test(id);
  if (!isId(podId) || !isId(userId) || !isId(targetId) || !REASONS.includes(reason)) { res.status(400).json({ error: '잘못된 요청이에요' }); return; }
  if (userId === targetId) { res.status(400).json({ error: '자기 자신은 알릴 수 없어요' }); return; }
  // 직접 적는 내용은 '기타'일 때만 받고 꼭 있어야 한다(사유만 '기타'면 운영자가 판단할 근거가 없다). 다른 사유에 딸려온 글은 버린다.
  const text = reason === 'other' && typeof detail === 'string' ? detail.trim() : '';
  if (reason === 'other' && !text) { res.status(400).json({ error: '어떤 일이었는지 적어주세요' }); return; }
  if (text.length > DETAIL_MAX) { res.status(400).json({ error: `${DETAIL_MAX}자 이하로 적어주세요` }); return; }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    // 1) 본인 확인 — 지문이 없는 사용자(비밀값을 받은 적 없음)도 여기서 걸러진다.
    const { data: me } = await supa.from('verified_users').select('secret_hash').eq('user_id', userId).maybeSingle();
    if (!me || !V.secretMatches(me.secret_hash, secret)) {
      res.status(401).json({ error: '본인 확인이 필요해요', needsVerify: true });
      return;
    }

    // 3) 팟 상태
    const { data: pod } = await supa.from('pods').select('status').eq('id', podId).maybeSingle();
    if (!pod || !REPORTABLE.includes(pod.status)) {
      res.status(403).json({ error: '지금은 알릴 수 없어요. 팟이 확정된 뒤에 알릴 수 있어요' });
      return;
    }

    // 2) 둘 다 이 팟의 참가자인지
    const { data: rows } = await supa.from('pod_participants').select('user_id').eq('pod_id', podId).in('user_id', [userId, targetId]);
    const ids = (rows || []).map(r => r.user_id);
    if (!ids.includes(userId) || !ids.includes(targetId)) {
      res.status(403).json({ error: '같은 팟에 있던 분께만 알릴 수 있어요' });
      return;
    }

    // 4) 저장
    const { error } = await supa.from('user_reports').insert({ pod_id: podId, reporter_id: userId, target_id: targetId, reason, detail: text || null });
    if (error) {
      if (error.code === '23505') { res.status(200).json({ ok: true, duplicate: true }); return; }
      if (error.code === '42P01' || error.code === 'PGRST205') { res.status(503).json({ error: '이 기능을 아직 준비하고 있어요' }); return; }
      throw error;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '알리지 못했어요. 잠시 뒤 다시 시도해 주세요' });
  }
}

module.exports = { handleReport };
