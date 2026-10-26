// api/push-subscription: 알림 구독을 서버가 저장·삭제하고, 이상한 입력은 거절하는지 확인한다(Supabase는 가짜).
const assert = require('node:assert/strict');
const Module = require('node:module');

const rows = new Map(); // user_id -> row
let forceError = null;
const fakeClient = {
  from: (table) => {
    assert.equal(table, 'push_subscriptions');
    return {
      upsert: async (row, opts) => {
        if (forceError) return { error: forceError };
        assert.equal(opts && opts.onConflict, 'user_id', 'user_id 기준으로 갱신한다');
        rows.set(row.user_id, { ...row });
        return { error: null };
      },
      delete: () => ({ eq: async (col, val) => { assert.equal(col, 'user_id'); rows.delete(val); return { error: null }; } }),
    };
  },
};
const realLoad = Module._load;
Module._load = (request, ...rest) => request === '@supabase/supabase-js' ? { createClient: () => fakeClient } : realLoad(request, ...rest);
process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
const handler = require('../api/push-subscription.js');

const U1 = '11111111-1111-4111-8111-111111111111';
async function call(body, method = 'POST') {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method, body }, res);
  return res;
}
const sub = (over = {}) => ({ action: 'subscribe', userId: U1, endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'P', auth: 'A', ...over });

(async () => {
  assert.equal((await call(sub(), 'GET')).statusCode, 405, 'POST만 받는다');
  assert.equal((await call(sub({ userId: 'bad' }))).statusCode, 400, 'uuid 아닌 사용자 거절');
  assert.equal((await call(sub({ endpoint: 'http://evil.example/x' }))).statusCode, 400, 'https가 아닌 주소 거절');
  assert.equal((await call(sub({ endpoint: 'https://x/' + 'a'.repeat(1100) }))).statusCode, 400, '너무 긴 주소 거절');
  assert.equal((await call(sub({ p256dh: '' }))).statusCode, 400, '빈 키 거절');
  assert.equal((await call({ action: 'nope', userId: U1 })).statusCode, 400, '모르는 동작 거절');
  assert.equal(rows.size, 0, '거절된 요청은 아무것도 저장하지 않는다');

  // 끄고 다시 켜는 흐름: 켜기 → 끄기 → 다시 켜기가 모두 성공해야 한다(예전엔 마지막이 42501로 실패)
  assert.equal((await call(sub())).statusCode, 200);
  assert.equal(rows.get(U1).endpoint, 'https://fcm.googleapis.com/fcm/send/abc');
  assert.equal((await call({ action: 'unsubscribe', userId: U1 })).statusCode, 200);
  assert.equal(rows.size, 0, '끄면 구독이 실제로 지워진다');
  assert.equal((await call(sub({ endpoint: 'https://fcm.googleapis.com/fcm/send/new' }))).statusCode, 200);
  assert.equal(rows.get(U1).endpoint, 'https://fcm.googleapis.com/fcm/send/new', '다시 켜면 새 구독이 저장된다');
  assert.equal((await call(sub({ endpoint: 'https://fcm.googleapis.com/fcm/send/again' }))).statusCode, 200);
  assert.equal(rows.size, 1, '같은 사용자는 한 줄만 유지');

  forceError = { code: '42501', message: 'x' };
  const r = await call(sub());
  assert.equal(r.statusCode, 500);
  assert.ok(!JSON.stringify(r.body).includes('42501'), '내부 오류 내용은 응답에 새지 않는다');

  console.log('PASS: 알림 구독 저장·삭제 API');
})().catch(e => { console.error(e); process.exit(1); });
