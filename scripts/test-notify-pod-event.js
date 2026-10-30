// api/notify-join: 참가(join)·나감(left)·팟 취소(cancelled)·팟 종료(finished)·채팅(chat) 알림이 알맞은 사람에게만, 한 번만 가는지 확인한다.
// 가짜 Supabase(메모리 표)와 가짜 web-push를 쓰므로 실제 DB도 실제 알림도 건드리지 않는다.
const assert = require('node:assert/strict');
const Module = require('node:module');

const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const POD = 'b0000000-0000-4000-8000-000000000001';
const LEADER = U(1), A = U(2), B = U(3), C = U(4), D = U(5), E = U(6), STRANGER = U(9);
const day = offset => { const d = new Date(Date.now() + offset * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

let db, flags, sent;
function reset() {
  db = {
    pods: [{ id: POD, leader_id: LEADER, status: 'open', origin_name: '한동대학교', leader_dest: '포항역', depart_date: day(1), depart_time: '18:00:00', desired_size: 4 }],
    pod_participants: [{ pod_id: POD, user_id: LEADER }, { pod_id: POD, user_id: A }, { pod_id: POD, user_id: B }],
    profiles: [LEADER, A, B, C, D, E].map((id, i) => ({ id, nickname: ['팟장', '가나', '다라', '마바', '사아', '자차'][i] })),
    push_subscriptions: [LEADER, A, B, C].map(id => ({ user_id: id, endpoint: 'ep-' + id, p256dh: 'k', auth: 'a' })),
    push_events: [],
    pod_messages: [],
  };
  flags = { missingEvents: false, pushFail: false };
  sent = [];
}

// 동시 요청 시험: flags.holdCounts가 N이면, N개의 요청이 모두 "횟수 세기" 단계에 도착할 때까지 붙잡았다가 한꺼번에 푼다.
// 그러면 요청들이 같은 순간에 센다 — 센 다음에 기록을 남기는 구현이면 전부 "아직 한도 아래"로 보고 통과한다.
// 일부가 거절돼 도착하지 않는 구현도 멈추지 않게 300ms 뒤에는 그냥 푼다.
let held = [];
async function barrier() {
  if (!flags.holdCounts) return;
  await new Promise(resolve => {
    held.push(resolve);
    if (held.length >= flags.holdCounts) { held.splice(0).forEach(f => f()); return; }
    setTimeout(() => { const i = held.indexOf(resolve); if (i >= 0) { held.splice(i, 1); resolve(); } }, 300);
  });
}

class Q {
  constructor(table) { this.table = table; this.filters = []; this.cols = '*'; this.opts = {}; this.op = 'select'; }
  select(cols, opts) { this.cols = cols || '*'; this.opts = opts || {}; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
  in(c, arr) { this.filters.push(r => arr.includes(r[c])); return this; }
  insert(row) { this.op = 'insert'; this.row = row; return this; }
  delete() { this.op = 'delete'; return this; }
  async run() {
    const rows = db[this.table];
    if (this.op === 'insert') {
      if (this.table === 'push_events' && flags.missingEvents) return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
      const dup = rows.some(r => ['pod_id', 'kind', 'subject', 'bucket'].every(k => r[k] === this.row[k]));
      if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      rows.push({ ...this.row, created_at: new Date().toISOString() });
      return { data: null, error: null };
    }
    if (this.table === 'push_events' && this.opts.head) await barrier(); // 횟수 세기 단계(동시 요청 시험용)
    const hit = rows.filter(r => this.filters.every(f => f(r)));
    if (this.op === 'delete') { db[this.table] = rows.filter(r => !hit.includes(r)); return { data: null, error: null }; }
    if (this.table === 'push_events' && flags.missingEvents) return { data: null, count: null, error: { code: '42P01', message: 'relation does not exist' } };
    if (this.opts.head) return { data: null, count: hit.length, error: null };
    const out = hit.map(r => {
      const copy = { ...r };
      if (this.table === 'pod_participants' && String(this.cols).includes('profiles(')) copy.profiles = db.profiles.find(p => p.id === r.user_id) || null;
      return copy;
    });
    return { data: out, error: null };
  }
  then(res, rej) { return this.run().then(res, rej); }
  maybeSingle() { return this.run().then(r => ({ data: (r.data && r.data[0]) || null, error: r.error })); }
  single() { return this.run().then(r => (r.data && r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: 'not found' } })); }
}
const fakeClient = { from: table => new Q(table) };
const fakePush = {
  setVapidDetails() {},
  sendNotification: async (sub, payload) => {
    if (flags.pushFail) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  },
};
const realLoad = Module._load;
Module._load = (request, ...rest) => request === '@supabase/supabase-js' ? { createClient: () => fakeClient }
  : request === 'web-push' ? fakePush : realLoad(request, ...rest);

process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv'; process.env.VAPID_SUBJECT = 'mailto:t@t.t';
const handler = require('../api/notify-join.js');

async function call(body, method = 'POST') {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method, body }, res);
  return res;
}
const removeParticipant = id => { db.pod_participants = db.pod_participants.filter(r => r.user_id !== id); };
const sentTo = () => sent.map(s => s.endpoint).sort();

(async () => {
  // ── join(기본): 기존 동작이 그대로다 ──
  reset();
  let r = await call({ podId: POD, joinerNickname: '가나' });
  assert.equal(r.body.notified, true, 'event를 안 보내면 지금처럼 참가 알림이 팟장에게 간다');
  assert.deepEqual(sentTo(), ['ep-' + LEADER]);
  assert.equal(sent[0].payload.title, '가나님이 참가했어요');
  reset();
  r = await call({ event: 'join', podId: POD, joinerNickname: '없는사람' });
  assert.equal(r.body.notified, false); assert.equal(sent.length, 0, '참가자 목록에 없는 닉네임은 거절');

  // ── chat: 누가 채팅을 치면 같은 팟의 나머지 사람들에게(보낸 사람 제외) 내용과 함께, 메시지마다 한 번만 ──
  const MSG = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const addMsg = (id, over = {}) => db.pod_messages.push({ id, pod_id: POD, user_id: A, text: '안녕하세요', image_url: null, created_at: new Date().toISOString(), ...over });
  reset(); addMsg(MSG(1), { text: '정문 앞에서 만나요' });
  r = await call({ event: 'chat', podId: POD, messageId: MSG(1) });
  assert.equal(r.body.notified, 2, '보낸 사람(가나)을 뺀 팟장과 다라에게 간다');
  assert.deepEqual(sentTo(), ['ep-' + LEADER, 'ep-' + B], '보낸 사람과 팟 밖의 구독자(마바)에게는 안 간다');
  assert.equal(sent[0].payload.title, '가나');
  assert.equal(sent[0].payload.body, '정문 앞에서 만나요', '알림에 메시지 내용이 그대로 들어간다');
  assert.equal(sent[0].payload.url, `/?pod=${POD}`);
  assert.equal(sent[0].payload.tag, `chat-${POD}`, '같은 팟 알림은 서로 덮어써서 알림창이 쌓이지 않는다');
  const chatSent = sent.length;
  r = await call({ event: 'chat', podId: POD, messageId: MSG(1) });
  assert.equal(r.body.reason, '이미 알렸어요'); assert.equal(sent.length, chatSent, '같은 메시지는 한 번만 알린다(같은 요청 반복 방어)');

  reset(); addMsg(MSG(2), { text: '진짜 내용' });
  r = await call({ event: 'chat', podId: POD, messageId: MSG(2), text: '위조한 내용', userId: B });
  assert.equal(sent[0].payload.body, '진짜 내용', '내용과 보낸 사람은 요청이 아니라 DB의 메시지에서 가져온다');
  assert.equal(sent[0].payload.title, '가나');

  reset(); addMsg(MSG(3), { text: '사진', image_url: 'https://x/y.jpg' });
  await call({ event: 'chat', podId: POD, messageId: MSG(3) });
  assert.equal(sent[0].payload.body, '사진을 보냈어요', '사진은 내용 대신 문구');
  reset(); addMsg(MSG(4), { text: '줄1\n줄2 ' + 'ㅋ'.repeat(200) });
  await call({ event: 'chat', podId: POD, messageId: MSG(4) });
  assert.ok(!sent[0].payload.body.includes('\n'), '줄바꿈은 공백으로'); assert.ok(sent[0].payload.body.length <= 101 && sent[0].payload.body.endsWith('…'), '긴 글은 100자에서 줄인다');

  reset(); // 위조·오래된·엉뚱한 요청
  r = await call({ event: 'chat', podId: POD, messageId: MSG(5) });
  assert.equal(sent.length, 0, 'DB에 없는 메시지는 안 보낸다');
  addMsg(MSG(6), { pod_id: 'b0000000-0000-4000-8000-0000000000ff' });
  r = await call({ event: 'chat', podId: POD, messageId: MSG(6) });
  assert.equal(sent.length, 0, '다른 팟의 메시지는 이 팟에 알리지 않는다');
  addMsg(MSG(7), { created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() });
  r = await call({ event: 'chat', podId: POD, messageId: MSG(7) });
  assert.equal(sent.length, 0, '오래된 메시지는 다시 알리지 않는다');
  r = await call({ event: 'chat', podId: POD, messageId: 'not-a-uuid' });
  assert.equal(r.statusCode, 400); assert.equal(sent.length, 0);
  reset(); addMsg(MSG(8)); db.pods[0].status = 'dissolved';
  r = await call({ event: 'chat', podId: POD, messageId: MSG(8) });
  assert.equal(sent.length, 0, '취소된 팟에는 안 보낸다');
  reset(); addMsg(MSG(9)); flags.missingEvents = true;
  r = await call({ event: 'chat', podId: POD, messageId: MSG(9) });
  assert.equal(sent.length, 0, 'push_events 표를 못 쓰면 중복을 막을 수 없으니 보내지 않는다');
  reset(); addMsg(MSG(10)); db.push_subscriptions = [];
  r = await call({ event: 'chat', podId: POD, messageId: MSG(10) });
  assert.equal(r.statusCode, 200); assert.equal(sent.length, 0, '알림을 켠 사람이 없으면 조용히 끝난다');

  // ── confirmed: 팟장이 팟을 확정하면 팟원들에게(팟장 제외) 한 번만 알린다 ──
  reset(); db.pods[0].status = 'confirmed';
  r = await call({ event: 'confirmed', podId: POD });
  assert.equal(r.body.notified, 2, '팟원 두 명에게 간다');
  assert.deepEqual(sentTo(), ['ep-' + A, 'ep-' + B], '팟장에게는 안 간다');
  assert.equal(sent[0].payload.title, '팟이 확정됐어요');
  assert.equal(sent[0].payload.body, '한동대학교 → 포항역 · 18:00 출발 팟이 확정됐어요. 팟장이 정산 안내를 보내면 입금해주세요');
  assert.equal(sent[0].payload.url, `/?pod=${POD}`);
  const confirmedSent = sent.length;
  r = await call({ event: 'confirmed', podId: POD });
  assert.equal(r.body.reason, '이미 알렸어요'); assert.equal(sent.length, confirmedSent, '같은 팟의 확정 알림은 한 번만');
  reset(); // 아직 모집 중인 팟에 확정 요청(위조)
  r = await call({ event: 'confirmed', podId: POD });
  assert.equal(r.body.notified, 0); assert.equal(sent.length, 0, '확정 상태가 아니면 안 보낸다');
  reset(); db.pods[0].status = 'confirmed'; db.pod_participants = [{ pod_id: POD, user_id: LEADER }];
  r = await call({ event: 'confirmed', podId: POD });
  assert.equal(sent.length, 0, '팟장 혼자면 알릴 사람이 없다');
  reset(); db.pods[0].status = 'confirmed'; flags.missingEvents = true;
  r = await call({ event: 'confirmed', podId: POD });
  assert.equal(sent.length, 0, 'push_events 표를 못 쓰면 보내지 않는다');

  // ── cancelled ──
  reset(); db.pods[0].status = 'dissolved';
  r = await call({ event: 'cancelled', podId: POD });
  assert.equal(r.body.notified, 2, '참가자 두 명에게 간다');
  assert.deepEqual(sentTo(), ['ep-' + A, 'ep-' + B], '팟장에게는 안 간다');
  assert.equal(sent[0].payload.title, '팟이 취소됐어요');
  assert.equal(sent[0].payload.body, '한동대학교 → 포항역 · 18:00 출발 팟을 팟장이 취소했어요');
  assert.equal(sent[0].payload.url, '/');
  const before = sent.length;
  r = await call({ event: 'cancelled', podId: POD });
  assert.equal(r.body.notified, 0); assert.equal(r.body.reason, '이미 알렸어요'); assert.equal(sent.length, before, '같은 취소는 한 번만 알린다');

  reset(); // 아직 취소되지 않은 팟
  r = await call({ event: 'cancelled', podId: POD });
  assert.equal(r.body.notified, 0); assert.equal(sent.length, 0, '취소 상태가 아니면 안 보낸다(위조 요청 방어)');

  reset(); db.pods[0].status = 'dissolved'; db.pod_participants = [{ pod_id: POD, user_id: LEADER }];
  r = await call({ event: 'cancelled', podId: POD });
  assert.equal(r.body.notified, 0); assert.equal(sent.length, 0, '혼자였던 팟은 알릴 사람이 없다');

  reset(); db.pods[0].status = 'dissolved'; db.pods[0].depart_date = day(-3);
  r = await call({ event: 'cancelled', podId: POD });
  assert.equal(r.body.notified, 0); assert.equal(sent.length, 0, '오래전에 지난 팟의 취소는 알리지 않는다');

  reset(); db.pods[0].status = 'dissolved'; db.push_subscriptions = db.push_subscriptions.filter(s => s.user_id !== A);
  r = await call({ event: 'cancelled', podId: POD });
  assert.deepEqual(sentTo(), ['ep-' + B], '알림을 안 켠 참가자는 건너뛴다');

  reset(); db.pods[0].status = 'dissolved'; flags.pushFail = true;
  r = await call({ event: 'cancelled', podId: POD });
  assert.equal(r.body.notified, 0);
  assert.equal(db.push_subscriptions.some(s => s.user_id === A || s.user_id === B), false, '만료된 구독(410)은 지운다');

  // ── finished ──
  reset(); db.pods[0].status = 'in_progress';
  r = await call({ event: 'finished', podId: POD });
  assert.equal(r.body.notified, 2, '참가자 두 명에게 간다');
  assert.deepEqual(sentTo(), ['ep-' + A, 'ep-' + B], '팟장에게는 안 간다');
  assert.equal(sent[0].payload.title, '팟이 종료됐어요');
  assert.equal(sent[0].payload.url, '/');
  const beforeFin = sent.length;
  r = await call({ event: 'finished', podId: POD });
  assert.equal(r.body.notified, 0); assert.equal(sent.length, beforeFin, '같은 종료는 한 번만 알린다');

  reset(); // 아직 정산 중이 아닌 팟(open)
  r = await call({ event: 'finished', podId: POD });
  assert.equal(r.body.notified, 0); assert.equal(sent.length, 0, '정산 중이 아니면 안 보낸다(위조 요청 방어)');

  reset(); db.pods[0].status = 'in_progress'; db.pod_participants = [{ pod_id: POD, user_id: LEADER }];
  r = await call({ event: 'finished', podId: POD });
  assert.equal(sent.length, 0, '혼자였던 팟은 알릴 사람이 없다');

  // ── left ──
  reset(); removeParticipant(B);
  r = await call({ event: 'left', podId: POD, userId: B });
  assert.equal(r.body.notified, true);
  assert.deepEqual(sentTo(), ['ep-' + LEADER], '팟장에게만 간다');
  assert.equal(sent[0].payload.title, '다라님이 나갔어요');
  assert.equal(sent[0].payload.body, '한동대학교 → 포항역 · 현재 2/4명');
  assert.equal(sent[0].payload.url, `/?pod=${POD}`);

  reset(); // 아직 참가 중인 사람의 "나감"은 위조다
  r = await call({ event: 'left', podId: POD, userId: A });
  assert.equal(r.body.notified, false); assert.equal(r.body.reason, '아직 참가 중이에요'); assert.equal(sent.length, 0);
  r = await call({ event: 'left', podId: POD, userId: LEADER });
  assert.equal(sent.length, 0, '팟장은 나가는 게 아니라 취소다');
  r = await call({ event: 'left', podId: POD, userId: STRANGER });
  assert.equal(r.body.reason, '없는 사용자예요'); assert.equal(sent.length, 0, '프로필이 없는 번호는 거절');
  r = await call({ event: 'left', podId: POD, userId: 'not-a-uuid' });
  assert.equal(r.statusCode, 400);
  r = await call({ event: 'left', podId: POD });
  assert.equal(r.statusCode, 400, 'userId가 없으면 거절');

  reset(); db.pods[0].status = 'done'; removeParticipant(B);
  r = await call({ event: 'left', podId: POD, userId: B });
  assert.equal(r.body.notified, false); assert.equal(sent.length, 0, '이미 끝난 팟은 알리지 않는다');
  reset(); db.pods[0].status = 'confirmed'; removeParticipant(B);
  r = await call({ event: 'left', podId: POD, userId: B });
  assert.equal(r.body.notified, true, '확정된 팟에서 나가도 팟장에게 알린다');

  reset(); removeParticipant(B);
  await call({ event: 'left', podId: POD, userId: B });
  r = await call({ event: 'left', podId: POD, userId: B });
  assert.equal(r.body.reason, '이미 알렸어요'); assert.equal(sent.length, 1, '같은 사람의 같은 나감은 10분에 한 번만');

  reset(); [A, B].forEach(removeParticipant);
  const sends = [];
  for (const id of [A, B, C, D, E]) { const x = await call({ event: 'left', podId: POD, userId: id }); sends.push(x.body.notified); }
  assert.deepEqual(sends, [true, true, true, false, false], '같은 팟에서 10분에 3건까지만 보낸다');

  reset(); removeParticipant(B); db.push_subscriptions = db.push_subscriptions.filter(s => s.user_id !== LEADER);
  r = await call({ event: 'left', podId: POD, userId: B });
  assert.equal(r.body.notified, false); assert.equal(sent.length, 0, '팟장이 알림을 안 켰으면 조용히 건너뛴다');

  // 동시에 몰려도 한도(3건)를 넘지 않는다. 기록을 먼저 남기고 세기 때문이다(세고 나서 남기면 모두 통과한다).
  reset(); [A, B].forEach(removeParticipant);
  flags.holdCounts = 5; // 5건이 모두 같은 순간에 횟수를 세게 한다
  const burst = await Promise.all([A, B, C, D, E].map(id => call({ event: 'left', podId: POD, userId: id })));
  flags.holdCounts = 0;
  assert.ok(sent.length <= 3, `동시에 5건이 와도 3건을 넘게 보내면 안 된다(실제 ${sent.length}건)`);
  assert.ok(burst.every(x => x.statusCode === 200));
  assert.ok(db.push_events.filter(e => e.kind === 'left').length <= 3, '한도를 넘은 요청의 기록은 물러서 표에 3건 넘게 남지 않는다');

  // ── 공통 ──
  reset(); flags.missingEvents = true; db.pods[0].status = 'dissolved';
  r = await call({ event: 'cancelled', podId: POD });
  assert.equal(sent.length, 0); assert.ok(r.body.skipped, 'push_events 표가 없으면(SQL 전) 보내지 않고 건너뛴다');
  reset(); flags.missingEvents = true; removeParticipant(B);
  r = await call({ event: 'left', podId: POD, userId: B });
  assert.equal(sent.length, 0); assert.ok(r.body.skipped);

  reset();
  r = await call({ event: 'bogus', podId: POD }); assert.equal(r.statusCode, 400);
  r = await call({ event: 'cancelled' }); assert.equal(r.statusCode, 400);
  r = await call({ event: 'cancelled', podId: '00000000-0000-4000-8000-00000000dead' }); assert.equal(r.statusCode, 404);
  r = await call({}, 'GET'); assert.equal(r.statusCode, 405);

  console.log('PASS: 알림 API — 참가·나감·팟 취소·팟 종료가 알맞은 사람에게 한 번만 간다');
})().catch(e => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
