// api/notify-join의 event: 'report'(문제 알리기): 신고자가 비밀값으로 본인임을 증명해야 저장되는지,
// 같은 팟의 참가자끼리·확정된 뒤에만 저장되는지 확인한다. Supabase는 메모리 가짜로 대체한다(실제 DB 없음).
// 푸시 키(VAPID)를 일부러 설정하지 않는다 — 신고 저장은 푸시 설정과 무관하게 동작해야 한다.
const assert = require('node:assert/strict');
const Module = require('node:module');

const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const POD = 'b0000000-0000-4000-8000-000000000001';
const LEADER = U(1), A = U(2), B = U(3), OUTSIDER = U(9);

let db, flags;
const KEYS = { user_reports: ['pod_id', 'reporter_id', 'target_id'] };
class Q {
  constructor(table) { this.table = table; this.filters = []; this.cols = '*'; }
  select(c) { if (c) this.cols = c; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  in(c, arr) { this.filters.push(r => arr.includes(r[c])); return this; }
  insert(row) { this.op = 'insert'; this.row = row; return this; }
  run() {
    const rows = db[this.table];
    if (this.op === 'insert') {
      if (flags.missingReports && this.table === 'user_reports') return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
      const keys = KEYS[this.table] || [];
      if (keys.length && rows.some(r => keys.every(k => r[k] === this.row[k]))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      rows.push({ ...this.row, created_at: new Date().toISOString() });
      return { data: null, error: null };
    }
    const hit = rows.filter(r => this.filters.every(f => f(r)));
    const pick = r => this.cols === '*' ? { ...r } : Object.fromEntries(this.cols.split(',').map(c => c.trim()).filter(c => c in r).map(c => [c, r[c]]));
    return { data: hit.map(pick), error: null };
  }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
  maybeSingle() { return Promise.resolve(this.run()).then(r => ({ data: (r.data && r.data[0]) || null, error: r.error })); }
}
const fakeClient = { from: table => new Q(table) };
const realLoad = Module._load;
// notify-join.js가 파일 맨 위에서 web-push를 불러온다 — 이 시험은 푸시를 쓰지 않으니 빈 가짜로 대체한다.
Module._load = (request, ...rest) => request === '@supabase/supabase-js' ? { createClient: () => fakeClient }
  : request === 'web-push' ? { setVapidDetails() {}, sendNotification: async () => {} } : realLoad(request, ...rest);

process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
const V = require('../api/_email-verify.js');
const handler = require('../api/notify-join.js');

let secrets;
function reset() {
  secrets = { [LEADER]: V.newSecret(), [A]: V.newSecret(), [B]: V.newSecret(), [OUTSIDER]: V.newSecret() };
  db = {
    verified_users: Object.entries(secrets).map(([user_id, s]) => ({ user_id, email_hash: 'h' + user_id, secret_hash: V.hashSecret(s) })),
    pods: [{ id: POD, leader_id: LEADER, status: 'confirmed' }],
    pod_participants: [{ pod_id: POD, user_id: LEADER }, { pod_id: POD, user_id: A }, { pod_id: POD, user_id: B }],
    user_reports: [],
  };
  flags = { missingReports: false };
}
async function call(body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'POST', body }, res);
  return res;
}
const report = (over = {}) => call({ event: 'report', podId: POD, userId: A, secret: secrets[A], targetId: B, reason: 'no_show', ...over });

(async () => {
  // ── 정상: 같은 팟 참가자가, 확정된 뒤, 자기 비밀값으로 ──
  reset();
  let r = await report();
  assert.equal(r.statusCode, 200); assert.equal(r.body.ok, true);
  assert.equal(db.user_reports.length, 1);
  assert.deepEqual({ ...db.user_reports[0], created_at: undefined }, { pod_id: POD, reporter_id: A, target_id: B, reason: 'no_show', detail: null, created_at: undefined });
  assert.ok(!JSON.stringify(r.body).includes('secret'), '응답에 비밀값·지문이 없다');
  r = await report({ userId: LEADER, secret: secrets[LEADER], targetId: A, reason: 'rude' });
  assert.equal(r.statusCode, 200, '팟장도 알릴 수 있다');
  r = await report({ targetId: LEADER, reason: 'other', detail: '  택시에서 내린 뒤 연락이 끊겼어요  ' });
  assert.equal(r.statusCode, 200, '팟장을 알리는 것도 된다');
  assert.equal(db.user_reports[db.user_reports.length - 1].detail, '택시에서 내린 뒤 연락이 끊겼어요', "'기타'의 직접 적은 글은 앞뒤 공백을 지우고 저장한다");

  // ── '기타'로 직접 적는 글 ──
  reset();
  for (const bad of [undefined, '', '   ', 5, null]) {
    r = await report({ reason: 'other', detail: bad });
    assert.equal(r.statusCode, 400, `'기타'인데 글이 비었다: ${JSON.stringify(bad)}`);
  }
  r = await report({ reason: 'other', detail: 'a'.repeat(201) });
  assert.equal(r.statusCode, 400, '201자는 거절');
  assert.equal(db.user_reports.length, 0, '거절된 요청은 저장되지 않는다');
  assert.equal((await report({ reason: 'other', detail: 'a'.repeat(200) })).statusCode, 200, '200자는 통과');
  reset();
  await report({ reason: 'rude', detail: '다른 사유에 딸려온 글' });
  assert.equal(db.user_reports[0].detail, null, "'기타'가 아니면 글은 저장하지 않는다");
  reset(); db.pods[0].status = 'in_progress';
  assert.equal((await report()).statusCode, 200, '정산 중(in_progress)에도 된다');

  // ── 본인 확인: 비밀값이 맞아야 한다 ──
  reset();
  for (const bad of [undefined, '', 'short', 'x'.repeat(43), secrets[B], secrets[OUTSIDER]]) {
    r = await report({ secret: bad });
    assert.equal(r.statusCode, 401, `거절: ${String(bad).slice(0, 12)}`);
    assert.equal(r.body.needsVerify, true);
  }
  assert.equal(db.user_reports.length, 0, '비밀값이 틀리면 아무것도 저장되지 않는다(남의 번호만으로는 위조 불가)');
  // 인증을 아직 안 한 사용자(비밀값 지문이 없음)도 거절
  db.verified_users.find(x => x.user_id === A).secret_hash = null;
  assert.equal((await report({ secret: secrets[A] })).statusCode, 401, '지문이 없는 사용자는 신고할 수 없다');
  db.verified_users = db.verified_users.filter(x => x.user_id !== B);
  assert.equal((await report({ userId: B, secret: secrets[B], targetId: A })).statusCode, 401, '인증 기록이 없는 사용자 거절');
  // 비밀값이 새로 발급되면(다른 기기에서 다시 인증) 이전 값은 무효
  reset();
  const old = secrets[A];
  const fresh = V.newSecret();
  db.verified_users.find(x => x.user_id === A).secret_hash = V.hashSecret(fresh);
  assert.equal((await report({ secret: old })).statusCode, 401, '다시 인증하면 이전 기기의 값은 무효');
  assert.equal((await report({ secret: fresh })).statusCode, 200);

  // ── 같은 팟의 참가자끼리만, 확정된 뒤에만 ──
  reset();
  assert.equal((await report({ userId: OUTSIDER, secret: secrets[OUTSIDER] })).statusCode, 403, '팟 참가자가 아닌 신고자');
  assert.equal((await report({ targetId: OUTSIDER })).statusCode, 403, '팟 참가자가 아닌 대상');
  for (const status of ['open', 'dissolved', 'done']) {
    reset(); db.pods[0].status = status;
    assert.equal((await report()).statusCode, 403, `상태 ${status}에서는 거절`);
  }
  reset(); db.pods = [];
  assert.equal((await report()).statusCode, 403, '없는 팟');
  assert.equal(db.user_reports.length, 0);

  // ── 형식 검사 ──
  reset();
  assert.equal((await report({ targetId: A })).statusCode, 400, '자기 자신은 못 알린다');
  assert.equal((await report({ reason: 'hack' })).statusCode, 400, '정해진 사유만');
  assert.equal((await report({ reason: undefined })).statusCode, 400);
  assert.equal((await report({ podId: 'x' })).statusCode, 400);
  assert.equal((await report({ userId: 'x' })).statusCode, 400);
  assert.equal((await report({ targetId: 'x' })).statusCode, 400);
  assert.equal(db.user_reports.length, 0);

  // ── 같은 팟에서 같은 사람은 한 번만 ──
  reset();
  assert.equal((await report()).body.ok, true);
  r = await report({ reason: 'rude' });
  assert.equal(r.statusCode, 200); assert.equal(r.body.duplicate, true, '두 번째는 중복으로 알린다');
  assert.equal(db.user_reports.length, 1);
  assert.equal(db.user_reports[0].reason, 'no_show', '처음 신고가 그대로 남는다');

  // ── 표가 아직 없으면(SQL 실행 전) 503 ──
  reset(); flags.missingReports = true;
  r = await report();
  assert.equal(r.statusCode, 503);

  // ── 서버 설정이 빠졌으면 조용히 건너뛰지 않고 오류로 알린다(알림과 달리 저장이 목적이라) ──
  reset();
  const keep = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  r = await report();
  assert.equal(r.statusCode, 500);
  process.env.SUPABASE_SERVICE_ROLE_KEY = keep;

  console.log('PASS: 문제 알리기(신고) API — 비밀값으로 본인 확인, 같은 팟·확정 뒤에만 저장');
})().catch(e => { console.error(e); process.exit(1); });
