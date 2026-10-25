// api/auth-otp · auth-link · verify-status: 학교 메일 인증이 규칙대로 동작하는지 확인한다.
// Supabase(DB·로그인 둘 다)는 메모리 가짜로 대체한다(실제 DB·메일 발송 없음).
const assert = require('node:assert/strict');
const Module = require('node:module');

const tables = { verified_users: [] };
const KEYS = { verified_users: ['user_id', 'email_hash'] };
function fakeFrom(name) {
  const rows = tables[name];
  let op = 'select', payload, filters = [];
  const matches = () => rows.filter(r => filters.every(f => f(r)));
  function run(single) {
    if (op === 'insert') {
      if (rows.some(r => KEYS[name].some(k => payload[k] != null && r[k] === payload[k]))) return { error: { code: '23505' } };
      rows.push({ ...payload });
      return { error: null };
    }
    const found = matches();
    return single ? { data: found[0] ? { ...found[0] } : null, error: null } : { data: found, error: null };
  }
  const b = {
    select() { return b; },
    eq(k, v) { filters.push(r => r[k] === v); return b; },
    insert(p) { op = 'insert'; payload = p; return b; },
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
const otp = (userId, email) => call(authOtp, { method: 'POST', body: { userId, email } });
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
  assert.ok(!JSON.stringify(tables.verified_users).includes('@'), '우리 테이블엔 메일 원문이 없다');
  assert.equal((await link(U1, good)).statusCode, 200, '같은 사용자가 다시 연결해도 성공');

  // ----- 한 메일 = 한 계정 -----
  const sentBefore = auth.otpSent.length;
  assert.equal((await otp(U2, '2020001@handong.ac.kr')).statusCode, 409, '이미 인증된 메일은 다른 계정에 번호 안 보냄');
  assert.equal(auth.otpSent.length, sentBefore);
  assert.equal((await link(U2, issueToken('2020001@handong.ac.kr'))).statusCode, 409, '다른 계정의 연결 시도도 거절');
  assert.equal((await otp(U1, '2020001@handong.ac.kr')).body.alreadyVerified, true, '이미 인증된 사용자는 바로 통과');
  assert.equal(auth.otpSent.length, sentBefore, '이미 인증된 사용자에겐 번호를 안 보낸다');

  // ----- 기존 사용자 면제(email_hash null)도 인증된 것으로 본다 -----
  tables.verified_users.push({ user_id: U2, email_hash: null });
  assert.equal((await status(U2)).body.verified, true);
  assert.equal((await status('bad')).statusCode, 400);

  console.log('PASS: 학교 메일 인증 API');
})().catch(e => { console.error(e); process.exit(1); });
