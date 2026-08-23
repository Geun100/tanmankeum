// 팟 채팅방 도우미: 지금 상황(경로/하차지점/최근 대화)을 보고 다음에 보낼 메시지 한 줄을 추천한다.
// OpenAI 키는 여기(서버, Vercel 환경변수)에만 있다 — 절대 클라이언트로 내려주지 않는다.
// 인증이 없는 앱이라(schema.sql 참고) 이 엔드포인트도 같은 트레이드오프를 진다: 누구든 호출은
// 가능하지만, 모델을 저렴한 것으로 고정하고 입력/출력 길이를 짧게 캡해 남용 시 피해를 줄인다.

const MAX_MESSAGES = 8;
const MAX_FIELD_LEN = 200;

function clip(s, n = MAX_FIELD_LEN) {
  return typeof s === 'string' ? s.slice(0, n) : '';
}

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
  const originName = clip(body.originName);
  const trunkDest = clip(body.trunkDest);
  const myNickname = clip(body.myNickname);
  const myDest = clip(body.myDest);
  const myDropPoint = clip(body.myDropPoint);
  const myWalkTime = Number(body.myWalkTime) || 0;
  const departTime = clip(body.departTime);
  const isLeader = !!body.isLeader;
  const participants = Array.isArray(body.participants)
    ? body.participants.slice(0, 6).map(p => `${clip(p.nickname, 20)}(목적지 ${clip(p.dest, 40)})`)
    : [];
  const recentMessages = Array.isArray(body.recentMessages)
    ? body.recentMessages.slice(-MAX_MESSAGES).map(m => `${clip(m.who, 20)}: ${clip(m.text, 120)}`)
    : [];

  const context = [
    `출발지: ${originName} → 최종 목적지: ${trunkDest}`,
    `출발 시각: ${departTime}`,
    `나: ${myNickname}(${isLeader ? '팟장' : '참여자'}), 목적지 ${myDest}, 하차지점 ${myDropPoint}${myWalkTime > 0 ? ` (도보 ${myWalkTime}분)` : ''}`,
    participants.length ? `팟원: ${participants.join(', ')}` : '',
    recentMessages.length ? `최근 대화:\n${recentMessages.join('\n')}` : '아직 대화 없음',
  ].filter(Boolean).join('\n');

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.8,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content: '너는 택시 합승 매칭 앱 "탄만큼"의 채팅방 보조야. 사용자가 팟원들과 탑승 장소·시간을 조율하는 걸 돕는다. ' +
              '주어진 팟 정보와 최근 대화를 참고해서, 지금 사용자가 보내면 좋을 메시지를 딱 한 줄 추천해. ' +
              '존댓말 카톡 말투, 이모티콘은 최소한으로, 설명이나 따옴표 없이 메시지 본문만 출력해.',
          },
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
    const suggestion = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    if (!suggestion) {
      res.status(502).json({ error: '추천 문구를 만들지 못했어요' });
      return;
    }
    res.status(200).json({ suggestion });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 났어요' });
  }
};
