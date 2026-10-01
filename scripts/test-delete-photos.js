// api/delete-photos.js: 참가자만, 그 팟 폴더 안 경로만 지울 수 있는지 확인한다(Supabase는 가짜로 대체).
const assert = require('node:assert/strict');
const POD = '11111111-1111-1111-1111-111111111111';
const OTHER_POD = '33333333-3333-3333-3333-333333333333';
const ME = '22222222-2222-2222-2222-222222222222';

const removed = [];
let isMember = true;
const Module = require('node:module');
const fakeClient = {
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: isMember ? { user_id: ME } : null }) }) }) }) }),
  storage: { from: () => ({
    list: async () => ({ data: [{ id: 'a', name: 'a.jpg' }, { id: 'b', name: 'b.jpg' }, { name: 'folder' }] }),
    remove: async paths => { removed.push(...paths); return { error: null }; },
  }) },
};
const realLoad = Module._load;
Module._load = (request, ...rest) => request === '@supabase/supabase-js' ? { createClient: () => fakeClient } : realLoad(request, ...rest);
process.env.SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
const handler = require('../api/delete-photos.js');

async function call(body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'POST', body }, res);
  return res;
}

(async () => {
  assert.equal((await call({ podId: 'bad', userId: ME })).statusCode, 400, 'uuid 아닌 입력 거절');

  isMember = false;
  assert.equal((await call({ podId: POD, userId: ME })).statusCode, 403, '비참가자 거절');
  assert.equal(removed.length, 0);

  isMember = true;
  assert.equal((await call({ podId: POD, userId: ME, paths: [`${OTHER_POD}/x.jpg`] })).statusCode, 400, '다른 팟 경로 거절');
  assert.equal((await call({ podId: POD, userId: ME, paths: [`${POD}/../x.jpg`] })).statusCode, 400, '상위 경로 거절');
  assert.equal(removed.length, 0);

  const one = await call({ podId: POD, userId: ME, paths: [`${POD}/x.jpg`] });
  assert.deepEqual([one.statusCode, one.body.deleted, removed], [200, 1, [`${POD}/x.jpg`]]);

  removed.length = 0;
  const all = await call({ podId: POD, userId: ME });
  assert.deepEqual([all.body.deleted, removed], [2, [`${POD}/a.jpg`, `${POD}/b.jpg`]]);
  console.log('PASS: 사진 삭제는 참가자·자기 팟 폴더로 제한된다');
})().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
