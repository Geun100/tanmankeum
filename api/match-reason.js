// 매칭 점수는 전부 클라이언트의 calcMatchScore(규칙 기반: haversine 거리, bearing 각도차)가
// 이미 정확히 계산해뒀다. 이 엔드포인트는 그 결과를 사람이 읽기 좋은 한 문장으로 "설명"만
// 한다 — 순위나 점수 자체를 AI가 새로 매기지 않는다. 프롬프트에 준 숫자 외에 새 숫자를
// 만들어내지 못하게 명시적으로 막는다(환각 방지). AI 호출이 실패해도 화면엔 이미 점수·배지가
// 떠 있으니 이 문장은 "있으면 좋은 것"이지 필수 정보가 아니다.
//
// OpenAI 키는 여기(서버, Vercel 환경변수)에만 있다. 인증 없는 앱이라 chat.js/ocr-fare.js와
// 같은 트레이드오프: 누구든 호출 가능하지만 저렴한 모델 고정 + 짧은 출력으로 남용 피해를 줄인다.

function clip(s, n = 60) {
  return typeof s === 'string' ? s.slice(0, n) : '';
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const SYSTEM_PROMPT = '너는 택시 합승 매칭 점수를 설명하는 도우미야. 아래에 항목별 점수와 근거 수치가 주어질 거야. ' +
  '그 값 외에 새로운 숫자를 절대 만들어내지 마(거리·시간·금액을 추측해서 쓰지 마). ' +
  '점수를 그대로 나열하지 말고, "출발지가 가까워요", "경로가 많이 겹쳐요", "출발 시간이 잘 맞아요"처럼 ' +
  '의미로 풀어서 자연스러운 한국어 한 문장(최대 두 문장)으로 설명해. 왜 이 조합이 좋은지(또는 아쉬운지)를 말해. ' +
  '존댓말, 이모지는 최대 1개, 설명이나 따옴표 없이 문장만 출력해.';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원해요' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '서버에 OPENAI_API_KEY가 설정돼 있지 않아요' });
    return;
  }

  const body = req.body || {};
  // 각 항목의 만점 대비 값 그대로 넘긴다 — AI는 이 숫자를 "해석"만 하고 다시 계산하지 않는다.
  const context = [
    `총점: ${num(body.total)}/100`,
    `출발지 근접성: ${num(body.originScore)}/30 (실제 거리 약 ${num(body.originDistM)}m)`,
    `경로 적합성: ${num(body.fitScore)}/30`,
    `실제 경로 포함 여부: ${num(body.routeScore)}/25 (${body.eligible ? '경로 안에 있음' : '경로 밖이라 참가 불가'})`,
    `출발시간 차이: ${num(body.timeScore)}/10 (약 ${num(body.diffMin)}분 차이)`,
    `인원 조건: ${num(body.sizeScore)}/5`,
    `경로: ${clip(body.originName)} → ${clip(body.trunkDest)}`,
  ].join('\n');

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 70,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: context },
        ],
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('OpenAI API error', r.status, errText.slice(0, 500));
      res.status(502).json({ error: 'OpenAI 응답 실패' });
      return;
    }

    const data = await r.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    if (!text) {
      res.status(502).json({ error: '응답을 만들지 못했어요' });
      return;
    }
    res.status(200).json({ reason: text });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 났어요' });
  }
};
