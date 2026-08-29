// "🤖 택시팟 매니저" — 팟 상태(모집중/정원참/확정/완료)에 맞는 "지금 할 일" 안내 한두 문장을 만든다.
// 단순히 이미 표에 나온 숫자를 요약해 읊는 게 아니라, 상태별로 뭘 하면 되는지(자리 더 모으기,
// 확정 재촉, 탑승 조율, 완료 인사)를 안내한다. 경로/하차지점/요금 숫자는 여기서 문장으로
// 안 내려준다 — 클라이언트가 calcFinalRouteAndFare로 이미 정확히 계산한 값을 표(participant
// 카드)로 직접 그린다. 돈 관련 숫자를 모델이 나열하게 하면 잘못 옮겨 적을 위험이 있으니, 애초에
// 숫자 나열 자체를 모델한테 안 시킨다 — "지금 할 일"이라는 가공된 텍스트 힌트만 준다.
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
// 팟 상태(status)에 따라 "지금 뭘 하면 되는지"가 다르다 — 모집중인데 자리 남았으면 공유를
// 독려하고, 정원 찼으면 팟장한테 확정을 재촉하고, 확정됐으면 탑승 조율을, 정산 끝났으면
// 마무리 인사를 하는 식이다. 표에 이미 나온 숫자를 그대로 읊는 인사말은 정보 가치가 없어서
// (그냥 요약이면 표를 다시 읽는 것과 같다), 상태별로 "지금 할 일"을 안내하게 바꿨다.
function statusHint(status, seatsLeft, isLeader) {
  if (status === 'recruiting') {
    if (seatsLeft > 0) return isLeader ? '아직 자리가 남았다. 팟장은 채팅방 링크를 공유해서 더 모을 수 있다.' : '아직 자리가 남았다. 팟장이 확정하기 전까지 기다리는 중이다.';
    return isLeader ? '정원이 다 찼다. 팟장이 지금 확정하면 최종 경로와 요금이 나온다.' : '정원이 다 찼다. 팟장의 확정을 기다리는 중이다.';
  }
  if (status === 'confirmed' || status === 'in_progress') return '팟이 확정됐다. 탑승 장소와 순서를 채팅으로 맞추면 된다.';
  if (status === 'done') return '정산까지 끝난 완료된 팟이다.';
  return '';
}

function buildSummaryContext(body) {
  const originName = clip(body.originName);
  const trunkDest = clip(body.trunkDest);
  const departTime = clip(body.departTime);
  const peopleCount = Math.max(0, Math.min(MAX_PEOPLE, Number(body.peopleCount) || 0));
  const seatsLeft = Math.max(0, Math.min(MAX_PEOPLE, Number(body.seatsLeft) || 0));
  const isLeader = !!body.isLeader;
  const status = clip(body.status, 20) || 'recruiting';

  return [
    `경로: ${originName} → ${trunkDest} (출발 ${departTime})`,
    `참여 인원: ${peopleCount}명, 남은 자리 ${seatsLeft}명`,
    `이 메시지를 보는 사람은 ${isLeader ? '팟장이다' : '참여자다(팟장 아님)'}.`,
    `지금 할 일: ${statusHint(status, seatsLeft, isLeader)}`,
  ].join('\n');
}

const SUMMARY_SYSTEM_PROMPT = '너는 "🤖 택시팟 매니저"라는 채팅봇이야. 경로/하차지점/요금 같은 숫자는 아래에 표로 이미 표시돼 있으니 ' +
  '절대 나열하거나 계산하지 마. 대신 "지금 할 일" 정보를 받았으니, 그걸 자연스러운 안내 문장 한두 문장으로 바꿔서 말해줘 — ' +
  '단순히 상황을 요약하지 말고, 지금 이 사람이 뭘 하면 되는지(또는 왜 기다리는지)를 실질적으로 안내해. ' +
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
