// 팟 채팅방 도우미 두 가지 모드.
// - suggest: 지금 상황을 보고 사용자가 보낼 메시지 한 줄을 추천한다(입력창에 채워짐, 사용자가 직접 보냄).
// - summary: "택시팟 매니저" 페르소나로 경로/하차지점/요금을 자연스러운 문장으로 요약해준다(채팅에 봇 말풍선으로 뜸).
// 숫자(거리/시간/요금)는 전부 클라이언트가 calcFinalRouteAndFare로 이미 정확히 계산해서 넘긴 값이다.
// 돈 관련 숫자를 모델이 스스로 계산/추정하게 두면 안 되므로, 프롬프트에서 "주어진 숫자를 그대로 문장에
// 녹여라, 새로 계산하거나 반올림을 바꾸지 마라"를 명시한다 — 모델은 서술만 하고 값은 안 바꾼다.
//
// OpenAI 키는 여기(서버, Vercel 환경변수)에만 있다 — 절대 클라이언트로 내려주지 않는다.
// 인증이 없는 앱이라(schema.sql 참고) 이 엔드포인트도 같은 트레이드오프를 진다: 누구든 호출은
// 가능하지만, 모델을 저렴한 것으로 고정하고 입력/출력 길이를 짧게 캡해 남용 시 피해를 줄인다.

const MAX_MESSAGES = 8;
const MAX_FIELD_LEN = 200;
const MAX_PEOPLE = 6;

function clip(s, n = MAX_FIELD_LEN) {
  return typeof s === 'string' ? s.slice(0, n) : '';
}

function buildSuggestContext(body) {
  const originName = clip(body.originName);
  const trunkDest = clip(body.trunkDest);
  const myNickname = clip(body.myNickname);
  const myDest = clip(body.myDest);
  const myDropPoint = clip(body.myDropPoint);
  const myWalkTime = Number(body.myWalkTime) || 0;
  const departTime = clip(body.departTime);
  const isLeader = !!body.isLeader;
  const participants = Array.isArray(body.participants)
    ? body.participants.slice(0, MAX_PEOPLE).map(p => `${clip(p.nickname, 20)}(목적지 ${clip(p.dest, 40)})`)
    : [];
  const recentMessages = Array.isArray(body.recentMessages)
    ? body.recentMessages.slice(-MAX_MESSAGES).map(m => `${clip(m.who, 20)}: ${clip(m.text, 120)}`)
    : [];

  return [
    `출발지: ${originName} → 최종 목적지: ${trunkDest}`,
    `출발 시각: ${departTime}`,
    `나: ${myNickname}(${isLeader ? '팟장' : '참여자'}), 목적지 ${myDest}, 하차지점 ${myDropPoint}${myWalkTime > 0 ? ` (도보 ${myWalkTime}분)` : ''}`,
    participants.length ? `팟원: ${participants.join(', ')}` : '',
    recentMessages.length ? `최근 대화:\n${recentMessages.join('\n')}` : '아직 대화 없음',
  ].filter(Boolean).join('\n');
}

function buildSummaryContext(body) {
  const originName = clip(body.originName);
  const trunkDest = clip(body.trunkDest);
  const departTime = clip(body.departTime);
  const totalFare = Number(body.totalFare) || 0;
  const totalMins = Number(body.totalMins) || 0;
  const isRealFare = !!body.isRealFare;
  const people = Array.isArray(body.people)
    ? body.people.slice(0, MAX_PEOPLE).map(p => {
        const walk = Number(p.walkTime) || 0;
        const walkNote = walk > 0 ? `하차지점에서 도보 ${walk}분` : '하차지점이 목적지';
        return `- ${clip(p.nickname, 20)}: 목적지 ${clip(p.dest, 40)} · 하차 ${clip(p.dropPoint, 40)}(${walkNote}) · 예상요금 ${Math.round(Number(p.fare) || 0)}원`;
      })
    : [];
  const settlement = Array.isArray(body.settlement) && body.settlement.length
    ? body.settlement.map(s => `- ${clip(s.nickname, 20)}: 정산금 ${Math.round(Number(s.amount) || 0)}원`)
    : null;

  return [
    `경로: ${originName} → ${trunkDest} (출발 ${departTime}, 예상 소요 ${totalMins}분)`,
    `참여자별 하차/요금:\n${people.join('\n')}`,
    `총 예상 요금: ${totalFare}원 (${isRealFare ? '실제 도로 경로 기준' : '경로 조회 실패로 추정치'})`,
    settlement ? `실제 택시비 입력 완료, 정산 금액:\n${settlement.join('\n')}` : '아직 실제 택시비는 입력 전(정산 전)이다.',
  ].filter(Boolean).join('\n');
}

const SYSTEM_PROMPTS = {
  suggest: '너는 택시 합승 매칭 앱 "탄만큼"의 채팅방 보조야. 사용자가 팟원들과 탑승 장소·시간을 조율하는 걸 돕는다. ' +
    '주어진 팟 정보와 최근 대화를 참고해서, 지금 사용자가 보내면 좋을 메시지를 딱 한 줄 추천해. ' +
    '존댓말 카톡 말투, 이모티콘은 최소한으로, 설명이나 따옴표 없이 메시지 본문만 출력해.',
  summary: '너는 "🤖 택시팟 매니저"라는 이름의 채팅봇이야. 주어진 경로/하차지점/요금 정보를 팟원들에게 친절하고 ' +
    '자연스러운 존댓말로 요약해서 알려줘. 숫자(거리·시간·요금)는 반드시 주어진 값을 그대로 쓰고, 절대 스스로 ' +
    '계산하거나 반올림을 바꾸거나 새로 추정하지 마. 3~6문장 정도로, 경로 요약 → 참여자별 하차 안내 → 요금 순서로 ' +
    '말해줘. 정산 정보가 있으면 마지막에 덧붙이고, 없으면 정산 얘기는 하지 마. 이모지는 문장당 최대 1개.',
};

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
  const mode = body.mode === 'summary' ? 'summary' : 'suggest';
  const context = mode === 'summary' ? buildSummaryContext(body) : buildSuggestContext(body);
  const maxTokens = mode === 'summary' ? 320 : 120;

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: mode === 'summary' ? 0.5 : 0.8,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[mode] },
          { role: 'user', content: context },
        ],
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      res.status(502).json({ error: 'OpenAI 응답 실패', detail: errText.slice(0, 300) });
      return;
    }

    const data = await r.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    if (!text) {
      res.status(502).json({ error: '응답을 만들지 못했어요' });
      return;
    }
    res.status(200).json(mode === 'summary' ? { summary: text } : { suggestion: text });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 났어요' });
  }
};
