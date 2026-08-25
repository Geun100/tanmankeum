// "🤖 택시팟 매니저" 인사/안내 한 줄만 만든다. 경로/하차지점/요금 숫자는 여기서 문장으로
// 안 내려준다 — 클라이언트가 calcFinalRouteAndFare로 이미 정확히 계산한 값을 표(participant
// 카드)로 직접 그린다. 돈 관련 숫자를 모델이 나열하게 하면 잘못 옮겨 적을 위험이 있으니, 애초에
// 숫자 나열 자체를 모델한테 안 시킨다.
//
// OpenAI 키는 여기(서버, Vercel 환경변수)에만 있다 — 절대 클라이언트로 내려주지 않는다.
// 인증이 없는 앱이라(schema.sql 참고) 이 엔드포인트도 같은 트레이드오프를 진다: 누구든 호출은
// 가능하지만, 모델을 저렴한 것으로 고정하고 입력/출력 길이를 짧게 캡해 남용 시 피해를 줄인다.

const MAX_PEOPLE = 6;

function clip(s, n = 200) {
  return typeof s === 'string' ? s.slice(0, n) : '';
}

// 숫자를 문장으로 나열하지 않는다 — 그건 클라이언트가 이미 정확히 계산해서 화면에 표
// (participant 카드)로 직접 그린다. 여기선 그 표 위에 붙는 한두 문장짜리 인사/안내만 받는다.
// 숫자를 아예 프롬프트에 안 주면(총액/인원수 정도만 예외) 모델이 잘못된 숫자를 문장에
// 섞어 쓸 걱정 자체가 없다.
function buildSummaryContext(body) {
  const originName = clip(body.originName);
  const trunkDest = clip(body.trunkDest);
  const departTime = clip(body.departTime);
  const peopleCount = Math.max(0, Math.min(MAX_PEOPLE, Number(body.peopleCount) || 0));
  const isSettled = !!body.isSettled;

  return [
    `경로: ${originName} → ${trunkDest} (출발 ${departTime})`,
    `참여 인원: ${peopleCount}명`,
    isSettled ? '실제 택시비가 입력돼 정산까지 끝났다.' : '아직 정산 전(예상 요금 단계)이다.',
  ].join('\n');
}

const SUMMARY_SYSTEM_PROMPT = '너는 "🤖 택시팟 매니저"라는 채팅봇이야. 아래에 경로/하차지점/요금이 표로 따로 표시될 거라, ' +
  '너는 그 표 위에 붙는 짧은 인사·안내 문구만 한 문장(최대 두 문장) 써줘. 숫자를 나열하거나 계산하지 마 — ' +
  '표에 다 있으니 "아래에서 확인하세요" 식으로만 안내해. 존댓말, 이모지는 최대 1개, 설명이나 따옴표 없이 문장만 출력해.';

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
  const context = buildSummaryContext(body);

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.5,
        max_tokens: 60,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: context },
        ],
      }),
    });

    if (!r.ok) {
      // OpenAI 에러 본문을 그대로 클라이언트에 돌려주지 않는다 — 키가 잘못됐을 때 그 응답 안에
      // "sk-...뒤4자리"처럼 부분 키가 섞여 나올 수 있다. 서버 로그(Vercel)에만 남기고, 클라이언트엔
      // 일반 메시지만 준다.
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
    res.status(200).json({ summary: text });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 났어요' });
  }
};
