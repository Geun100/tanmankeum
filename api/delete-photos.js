// 채팅/정산 사진 삭제. 브라우저(anon 키)에 Storage 삭제 권한을 주면 공개 키만으로 버킷 전체를
// 지울 수 있어서, 삭제는 이 함수(서비스 롤 키)만 한다. 로그인이 없으므로 "요청한 userId가 그 팟의
// 참가자인가"까지만 확인한다 — 완전한 인증은 아니지만 무관한 팟의 사진을 지우는 건 막는다.
//   body: { podId, userId, paths? }  paths가 있으면 그 파일만(업로드 보상), 없으면 팟 폴더 전체(팟 종료).

const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'settlement-photos';
const UUID = /^[0-9a-f-]{36}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 지원해요' }); return; }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  // 키가 없으면 에러 대신 건너뛴다고 알린다 — 사진 정리가 팟 종료 자체를 막으면 안 된다.
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(200).json({ deleted: 0, skipped: 'not_configured' }); return; }

  const { podId, userId, paths } = req.body || {};
  if (!UUID.test(podId || '') || !UUID.test(userId || '')) { res.status(400).json({ error: 'podId, userId가 올바르지 않아요' }); return; }
  if (paths !== undefined && (!Array.isArray(paths) || paths.length > 100)) { res.status(400).json({ error: 'paths가 올바르지 않아요' }); return; }

  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: member, error: memberErr } = await supa.from('pod_participants')
      .select('user_id').eq('pod_id', podId).eq('user_id', userId).maybeSingle();
    if (memberErr) throw memberErr;
    if (!member) { res.status(403).json({ error: '이 팟의 참가자가 아니에요' }); return; }

    let targets;
    if (paths) {
      // 업로드 경로는 항상 `${podId}/${파일명}` 한 단계다. 다른 팟 폴더나 상위 경로는 거절한다.
      targets = paths.filter(p => typeof p === 'string' && p.startsWith(podId + '/') && !p.slice(podId.length + 1).includes('/') && !p.includes('..'));
      if (targets.length !== paths.length) { res.status(400).json({ error: '이 팟 밖의 경로가 있어요' }); return; }
    } else {
      targets = [];
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await supa.storage.from(BUCKET).list(podId, { limit: 100, offset });
        if (error) throw error;
        (data || []).filter(item => item.id).forEach(item => targets.push(`${podId}/${item.name}`));
        if (!data || data.length < 100) break;
      }
    }

    for (let i = 0; i < targets.length; i += 100) {
      const { error } = await supa.storage.from(BUCKET).remove(targets.slice(i, i + 100));
      if (error) throw error;
    }
    res.status(200).json({ deleted: targets.length });
  } catch (e) {
    console.error('delete-photos failed', e && e.message ? e.message : String(e));
    res.status(500).json({ error: '사진을 지우지 못했어요' });
  }
};
