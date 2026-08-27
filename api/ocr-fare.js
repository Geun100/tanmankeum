// 택시 미터기/영수증 사진에서 "최종 결제 금액(원)" 숫자 하나만 뽑는다. 분배 계산은 절대 여기서
// 안 한다 — 그건 클라이언트가 splitProportional로 정확히 한다. 모델한테는 사진에서 총액만 읽게
// 시키고, 그 값도 클라이언트에서 수정 가능한 입력칸에 프리필될 뿐(무확인 확정 없음).
//
// OpenAI 키는 여기(서버, Vercel 환경변수)에만 있다 — chat.js와 같은 트레이드오프: 인증이 없어서
// 누구든 호출은 가능하지만, 저렴한 모델 고정 + 짧은 출력 + 입력 이미지 크기 제한으로 남용 피해를 줄인다.

const MAX_IMAGE_CHARS = 2_000_000; // data URL 기준 약 1.5MB. 클라가 1000px로 리사이즈해 보내면 보통 200~400KB.
const MIN_FARE = 0;
const MAX_FARE = 200000; // 이 범위를 벗어난 값은 오독으로 보고 버린다.

const SYSTEM_PROMPT =
  '너는 택시 미터기 또는 택시 영수증 사진에서 최종 결제 금액을 읽는 도구야. ' +
  '사진이 택시 미터기나 택시 영수증이 아니면(휴대폰/모니터 스크린샷, 일반 사진, 캡처, 문서 등) 무조건 amount는 null. ' +
  '택시 요금 사진이 맞을 때만, 여러 숫자 중 "요금 / 합계 / 총액 / 결제금액 / 카드승인금액"에 해당하는 최종 지불액(원)을 고른다. ' +
  '거리(km)나 시간, 전화번호, 사업자번호, 날짜, 차량번호는 금액이 아니다. ' +
  '조금이라도 확실하지 않으면 amount는 null. ' +
  '반드시 JSON만 출력: {"amount": 정수 또는 null}';

function normalizeAmount(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= MIN_FARE || n > MAX_FARE) return null;
  return n;
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

  const image = (req.body && req.body.image) || '';
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    res.status(400).json({ error: '이미지 데이터가 올바르지 않아요' });
    return;
  }
  if (image.length > MAX_IMAGE_CHARS) {
    res.status(413).json({ error: '사진 용량이 너무 커요' });
    return;
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 30,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: '이 사진에서 최종 결제 금액(원)만 읽어줘.' },
              { type: 'image_url', image_url: { url: image, detail: 'low' } },
            ],
          },
        ],
      }),
    });

    if (!r.ok) {
      // OpenAI 에러 본문을 그대로 돌려주지 않는다 — 키가 잘못됐을 때 부분 키가 섞여 나올 수 있다.
      const errText = await r.text().catch(() => '');
      console.error('OpenAI OCR error', r.status, errText.slice(0, 500));
      res.status(502).json({ error: 'OCR 응답 실패' });
      return;
    }

    const data = await r.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    let amount = null;
    try {
      amount = normalizeAmount(JSON.parse(text).amount);
    } catch (e) {
      amount = null;
    }
    res.status(200).json({ amount });
  } catch (e) {
    res.status(500).json({ error: '요청 처리 중 오류가 났어요' });
  }
};
