const assert = require('node:assert/strict');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function runHandler(modulePath, body, upstreamResponse) {
  const previousFetch = global.fetch;
  global.fetch = async () => upstreamResponse;
  delete require.cache[require.resolve(modulePath)];
  const handler = require(modulePath);
  const res = responseRecorder();
  try {
    await handler({ method: 'POST', body }, res);
  } finally {
    global.fetch = previousFetch;
  }
  return res;
}

async function main() {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const failedUpstream = {
      ok: false,
      status: 429,
      text: async () => '{"error":{"message":"quota exceeded"}}',
    };

    const chat = await runHandler('../api/chat.js', {
      originName: '포항역',
      trunkDest: '한동대학교',
      departTime: '13:35',
      peopleCount: 1,
      seatsLeft: 1,
      isLeader: true,
      status: 'in_progress',
    }, failedUpstream);
    assert.equal(chat.statusCode, 200, '채팅 보조 API는 OpenAI 장애 때도 200 폴백을 반환해야 한다');
    assert.equal(typeof chat.body.summary, 'string');
    assert.ok(chat.body.summary.length > 0, '폴백 안내 문장이 있어야 한다');
    assert.equal(chat.body.degraded, true);

    const ocr = await runHandler('../api/ocr-fare.js', {
      image: 'data:image/png;base64,AA==',
    }, failedUpstream);
    assert.equal(ocr.statusCode, 200, 'OCR API는 OpenAI 장애를 네트워크 오류로 위장하지 않아야 한다');
    assert.deepEqual(ocr.body, {
      amount: null,
      degraded: true,
      reason: 'upstream_unavailable',
    });

    console.log('PASS: OpenAI 장애가 채팅·정산 흐름을 깨지 않는다');
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}

main().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
