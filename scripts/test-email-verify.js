// api/auth-otp · auth-link · verify-status: 학교 메일 인증이 규칙대로 동작하는지 확인한다.
// Supabase(DB·로그인 둘 다)는 메모리 가짜로 대체한다(실제 DB·메일 발송 없음).
const assert = require('node:assert/strict');
const Module = require('node:module');

const tables = { verified_users: [], push_subscriptions: [] };
const KEYS = { verified_users: ['user_id', 'email_hash'], push_subscriptions: ['user_id'] };
function fakeFrom(name) {
  const rows = tables[name];
  let op = 'select', payload, filters = [], cols = '*';
  const matches = () => rows.filter(r => filters.every(f => f(r)));
  function run(single) {
    if (op === 'delete') { matches().forEach(r => rows.splice(rows.indexOf(r), 1)); return { error: null }; }
    if (op === 'insert') {
      if (rows.some(r => KEYS[name].some(k => payload[k] != null && r[k] === payload[k]))) return { error: { code: '23505' } };
      rows.push({ ...payload });
      return { error: null };
    }
    if (op === 'update') {
      const hit = matches();
      // 같은 메일 해시를 가진 다른 줄이 있으면 실제 DB처럼 unique 위반
      if (payload.email_hash != null && rows.some(r => !hit.includes(r) && r.email_hash === payload.email_hash)) return { error: { code: '23505' } };
      hit.forEach(r => Object.assign(r, payload));
      return { error: null };
    }
    const found = matches();
    // select('a, b')처럼 고른 칸만 돌려준다 — 서버가 고르지 않은 칸(secret_hash 등)에 기대면 시험이 잡아낸다
    const pick = r => cols === '*' ? { ...r } : Object.fromEntries(cols.split(',').map(c => c.trim()).filter(c => c in r).map(c => [c, r[c]]));
    return single ? { data: found[0] ? pick(found[0]) : null, error: null } : { data: found.map(pick), error: null };
  }
  const b = {
    select(c) { if (c) cols = c; return b; },
    eq(k, v) { filters.push(r => r[k] === v); return b; },
    is(k, v) { filters.push(r => (r[k] ?? null) === v); return b; },
    update(p) { op = 'update'; payload = p; return b; },
    insert(p) { op = 'insert'; payload = p; return b; },
    delete() { op = 'delete'; return b; },
    maybeSingle() { return Promise.resolve(run(true)); },
    then(res, rej) { return Promise.resolve(run(false)).then(res, rej); },
  };
  return b;
}

// Supabase 로그인 가짜: 계정 목록, 보낸 인증번호 기록, 액세스 토큰 → 사용자
const auth = { users: new Map(), otpSent: [], tokens: new Map(), otpError: null };
const fakeClient = {
  from: fakeFrom,
  auth: {
    admin: {
      async createUser({ email, email_confirm }) {
        if (auth.users.has(email)) return { error: { code: 'email_exists', message: 'A user with this email address has already been registered' } };
        auth.users.set(email, { email, email_confirmed_at: email_confirm ? new Date().toISOString() : null });
        return { data: { user: auth.users.get(email) }, error: null };
      },
    },
    async signInWithOtp({ email, options }) {
      if (auth.otpError) return { error: auth.otpError };
      if (!auth.users.has(email) && options && options.shouldCreateUser === false) return { error: { message: 'Signups not allowed for otp' } };
      auth.otpSent.push({ email, shouldCreateUser: options && options.shouldCreateUser });
      return { error: null };
    },
    async getUser(token) {
      const u = auth.tokens.get(token);
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } };
    },
  },
};
const realLoad = Module._load;
Module._load = (request, ...rest) => request === '@supabase/supabase-js' ? { createClient: () => fakeClient } : realLoad(request, ...rest);
process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const V = require('../api/_email-verify.js');
const authOtp = require('../api/auth-otp.js');
const authLink = require('../api/auth-link.js');
const verifyStatus = require('../api/verify-status.js');

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
async function call(handler, req) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return res;
}
const otp = (userId, email, secret) => call(authOtp, { method: 'POST', body: { userId, email, secret } });
const link = (userId, accessToken) => call(authLink, { method: 'POST', body: { userId, accessToken } });
const status = userId => call(verifyStatus, { method: 'GET', query: { userId } });
// 브라우저가 verifyOtp를 마쳤을 때 받는 액세스 토큰을 흉내 낸다.
function issueToken(email, confirmed = true) {
  const token = 'tok-' + auth.tokens.size;
  auth.tokens.set(token, { email, email_confirmed_at: confirmed ? new Date().toISOString() : null });
  return token;
}

(async () => {
  // ----- 인증번호 요청: 도메인은 서버가 막는다 -----
  for (const bad of ['a@gmail.com', 'a@handong.ac.kr.evil.com', 'a@evilhandong.ac.kr', 'x@y@handong.ac.kr', '@handong.ac.kr', '', 123]) {
    assert.equal((await otp(U1, bad)).statusCode, 400, `거절: ${bad}`);
  }
  assert.equal((await otp('not-a-uuid', 'a@handong.ac.kr')).statusCode, 400, 'uuid 아닌 사용자 거절');
  assert.equal(auth.otpSent.length, 0, '거절된 요청엔 메일이 안 나간다');
  assert.equal(auth.users.size, 0, '거절된 요청엔 계정도 안 만든다');

  // 대소문자·공백이 섞여도 학교 메일이면 통과. 계정을 만들고, 가입은 끄고 번호를 보낸다
  let r = await otp(U1, '  2020001@HANDONG.AC.KR ');
  assert.equal(r.statusCode, 200);
  assert.ok(!('testCode' in r.body) && !('code' in r.body), '응답에 인증번호가 없다');
  assert.deepEqual(auth.otpSent, [{ email: '2020001@handong.ac.kr', shouldCreateUser: false }]);
  assert.equal(auth.users.size, 1);
  // 다시 요청해도 계정은 하나, 번호만 다시 나간다
  await otp(U1, '2020001@handong.ac.kr');
  assert.equal(auth.users.size, 1);
  assert.equal(auth.otpSent.length, 2);

  // Supabase가 재발송 한도에 걸리면 429로 돌려준다
  auth.otpError = { status: 429, message: 'For security purposes, you can only request this after 60 seconds.' };
  r = await otp(U1, '2020001@handong.ac.kr');
  assert.equal(r.statusCode, 429);
  assert.equal(r.body.retryAfter, 60);
  auth.otpError = null;

  // ----- 인증 연결: 토큰은 서버가 확인한다 -----
  assert.equal((await link(U1, 'nope')).statusCode, 401, '모르는 토큰 거절');
  assert.equal((await link(U1, '')).statusCode, 400);
  assert.equal((await link('bad', 'x')).statusCode, 400);
  assert.equal((await link(U1, issueToken('someone@gmail.com'))).statusCode, 403, '학교 메일이 아닌 계정은 인증으로 안 쳐준다');
  assert.equal((await link(U1, issueToken('2020001@handong.ac.kr', false))).statusCode, 403, '메일 확인이 안 끝난 계정 거절');
  assert.equal((await status(U1)).body.verified, false, '거절된 요청으로는 인증 안 됨');

  const good = issueToken('2020001@handong.ac.kr');
  r = await link(U1, good);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.verified, true);
  assert.equal((await status(U1)).body.verified, true, '연결 후 상태 true');
  assert.equal(tables.verified_users.length, 1);
  assert.equal((await status(U1)).body.hasSecret, true, '비밀값을 받은 사용자는 hasSecret true');
  assert.ok(!('secret_hash' in (await status(U1)).body), '상태 응답에 지문 칸은 없다');
  assert.ok(!JSON.stringify(tables.verified_users).includes('@'), '우리 테이블엔 메일 원문이 없다');
  // 인증을 마치면 서버가 그 사람만 아는 비밀값을 한 번 건네고, 서버에는 지문만 남긴다
  const sec1 = r.body.secret;
  assert.match(sec1, /^[A-Za-z0-9_-]{43}$/, '비밀값을 받는다');
  assert.equal(tables.verified_users[0].secret_hash, V.hashSecret(sec1), '서버에는 지문만 저장된다');
  assert.ok(!JSON.stringify(tables).includes(sec1), '비밀값 원문은 DB에 없다');
  assert.ok(!('secret_hash' in r.body), '응답에 지문 칸은 없다');
  r = await link(U1, good);
  assert.equal(r.statusCode, 200, '같은 사용자가 다시 연결해도 성공');
  const sec1b = r.body.secret;
  assert.notEqual(sec1b, sec1, '다시 인증하면 새 비밀값이 나온다');
  assert.equal(V.secretMatches(tables.verified_users[0].secret_hash, sec1), false, '이전 비밀값은 더 못 쓴다');
  assert.equal(V.secretMatches(tables.verified_users[0].secret_hash, sec1b), true);

  // ----- 한 메일 = 한 계정: 막지 않고 원래 계정을 이어받게 한다 -----
  // 브라우저를 바꾸거나 저장소를 지우면 앱이 새 임의 번호(U2)를 만든다. 같은 메일함의 주인이면 번호를 받을 수 있고,
  // 인증을 마치면 서버가 원래 계정(U1)을 돌려준다. 새 계정(U2)은 인증된 걸로 기록되지 않는다.
  tables.push_subscriptions.push({ user_id: U1, endpoint: 'https://fcm.googleapis.com/fcm/send/old' }); // 먼저 차지돼 있던(또는 옛 기기의) 구독
  const sentBefore = auth.otpSent.length;
  assert.equal((await otp(U2, '2020001@handong.ac.kr')).statusCode, 200, '이미 인증된 메일도 번호를 보낸다(계정 복구)');
  assert.equal(auth.otpSent.length, sentBefore + 1);
  r = await link(U2, issueToken('2020001@handong.ac.kr'));
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.recovered, true, '다른 기기의 같은 메일은 복구로 처리');
  assert.equal(r.body.userId, U1, '원래 계정 번호를 돌려준다');
  assert.equal(tables.push_subscriptions.length, 0, '복구하면 그 계정의 옛 알림 구독이 지워진다');
  assert.equal(tables.verified_users.length, 1, '새 계정이 인증 기록에 늘어나지 않는다');
  assert.equal((await status(U2)).body.verified, false, '임시 번호(U2) 자체는 인증된 게 아니다');
  // 복구한 사람(메일함 주인)은 원래 계정의 새 비밀값을 받는다. 이전 기기의 값은 무효가 된다
  assert.match(r.body.secret, /^[A-Za-z0-9_-]{43}$/, '복구해도 비밀값을 받는다');
  const sec2 = r.body.secret;
  assert.equal(tables.verified_users[0].user_id, U1);
  assert.equal(V.secretMatches(tables.verified_users[0].secret_hash, sec2), true, '새 값이 원래 계정(U1)에 묶인다');
  assert.equal(V.secretMatches(tables.verified_users[0].secret_hash, sec1b), false, '복구하면 이전 기기의 값은 무효');
  r = await link(U1, issueToken('2020001@handong.ac.kr'));
  assert.equal(r.body.recovered, false, '같은 계정이 다시 인증하면 복구가 아니다');
  const sec3 = r.body.secret;
  // 이미 인증된 사용자도 "자기 비밀값"을 보여줘야 인증번호 없이 통과한다. 없거나 틀리면 인증번호를 다시 받는다
  assert.equal((await otp(U1, '2020001@handong.ac.kr', sec3)).body.alreadyVerified, true, '맞는 비밀값이면 바로 통과');
  const sentNow = auth.otpSent.length;
  for (const bad of [undefined, '', sec2, 'x'.repeat(43), 'short']) {
    r = await otp(U1, '2020001@handong.ac.kr', bad);
    assert.equal(r.statusCode, 200);
    assert.ok(!r.body.alreadyVerified, `비밀값이 없거나 틀리면 지름길 없음: ${String(bad).slice(0, 12)}`);
  }
  assert.equal(auth.otpSent.length, sentNow + 5, '그 경우엔 인증번호 메일이 나간다');

  // ----- 기존 사용자 면제(email_hash null)도 인증된 것으로 본다 -----
  tables.verified_users.push({ user_id: U2, email_hash: null });
  assert.equal((await status(U2)).body.verified, true);
  assert.equal((await status(U2)).body.hasSecret, false, '면제 사용자는 아직 비밀값이 없다');
  assert.equal((await status('bad')).statusCode, 400);
  // 면제 사용자는 비밀값이 없어서 지름길 대신 인증번호를 받는다. 인증을 마치면 그 줄에 메일 해시와 비밀값이 채워진다
  const mailsBefore = auth.otpSent.length;
  r = await otp(U2, '2020002@handong.ac.kr');
  assert.equal(r.statusCode, 200); assert.ok(!r.body.alreadyVerified, '면제 사용자는 지름길이 없다');
  assert.equal(auth.otpSent.length, mailsBefore + 1);
  // 기본(스위치 꺼짐): 번호는 공개라서 번호만 아는 사람이 면제 줄을 차지할 수 있다 — 비밀값을 주지 않고 줄도 그대로 둔다
  delete process.env.ALLOW_LEGACY_CLAIM;
  r = await link(U2, issueToken('2020002@handong.ac.kr'));
  assert.equal(r.statusCode, 200); assert.equal(r.body.verified, true);
  assert.ok(!('secret' in r.body), '스위치가 꺼져 있으면 면제 줄을 차지할 수 없다');
  assert.equal(tables.verified_users.find(x => x.user_id === U2).email_hash, null, '면제 줄은 그대로다');
  assert.equal((await status(U2)).body.hasSecret, false);
  // 운영자가 옮기는 기간(ALLOW_LEGACY_CLAIM=1)에만 줄이 채워진다
  process.env.ALLOW_LEGACY_CLAIM = '1';
  r = await link(U2, issueToken('2020002@handong.ac.kr'));
  assert.equal(r.statusCode, 200); assert.equal(r.body.verified, true); assert.equal(r.body.recovered, false);
  const secU2 = r.body.secret;
  delete process.env.ALLOW_LEGACY_CLAIM; // 이후 시험은 스위치가 꺼진 기본 상태로 이어간다
  assert.match(secU2, /^[A-Za-z0-9_-]{43}$/, '면제 사용자도 인증하면 비밀값을 받는다');
  const rowU2 = tables.verified_users.find(x => x.user_id === U2);
  assert.equal(rowU2.email_hash, V.hashEmail('2020002@handong.ac.kr'), '빈 메일 해시가 채워진다');
  assert.equal(V.secretMatches(rowU2.secret_hash, secU2), true);
  assert.equal(tables.verified_users.length, 2, '새 줄이 생기지 않고 기존 줄이 채워진다');
  assert.equal((await status(U2)).body.hasSecret, true, '인증을 마치면 hasSecret true');
  // 이미 다른 메일로 인증된 번호를 "다른 메일"로 다시 인증해도 비밀값을 주지 않는다 — 남의 번호를 가로채는 길이 된다
  const hashU1 = tables.verified_users.find(x => x.user_id === U1).secret_hash;
  r = await link(U1, issueToken('2020009@handong.ac.kr'));
  assert.equal(r.statusCode, 200);
  assert.ok(!('secret' in r.body), '다른 메일로는 남의 계정의 비밀값을 못 받는다');
  assert.equal(tables.verified_users.find(x => x.user_id === U1).secret_hash, hashU1, '기존 지문은 그대로');
  assert.equal(tables.verified_users.find(x => x.user_id === U1).email_hash, V.hashEmail('2020001@handong.ac.kr'), '묶인 메일도 그대로');
  r = await link(U2, issueToken('2020003@handong.ac.kr'));
  assert.ok(!('secret' in r.body), '면제에서 채워진 뒤에도 같은 규칙');
  assert.equal(V.secretMatches(tables.verified_users.find(x => x.user_id === U2).secret_hash, secU2), true, '기존 비밀값은 그대로 유효');

  console.log('PASS: 학교 메일 인증 API');
})().catch(e => { console.error(e); process.exit(1); });
