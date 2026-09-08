// 카카오모빌리티 "도보 길찾기" 프록시 — 제휴 파트너 전용 API다(공식 문서에 명시).
// 일반 REST API 키로 앱 등록만 해서는 안 되고, 카카오와 별도 제휴 계약이 있어야 정상 응답이 온다.
// 계약이 없으면 401/403류로 거부될 수 있어서, 실패하면 클라이언트가 기존 직선거리+분속 70m
// 근사치로 조용히 폴백하게 route:null만 준다(kakao-route.js와 같은 원칙). 실제 원인은
// 서버 로그(Vercel)에만 남긴다 — 클라이언트에 그대로 흘리면 계약 상태 같은 내부 정보가 샌다.

function isFiniteNum(n) { return typeof n === 'number' && Number.isFinite(n); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원해요' });
    return;
  }

  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!restKey) {
    res.status(500).json({ error: '서버에 KAKAO_REST_API_KEY가 설정돼 있지 않아요' });
    return;
  }

  const body = req.body || {};
  const { originLat, originLng, destLat, destLng } = body;
  if (![originLat, originLng, destLat, destLng].every(isFiniteNum)) {
    res.status(400).json({ error: '출발지/목적지 좌표가 올바르지 않아요' });
    return;
  }

  const url = 'https://apis-navi.kakaomobility.com/affiliate/walking/v1/directions'
    + `?origin=${originLng},${originLat}`
    + `&destination=${destLng},${destLat}`
    + '&priority=DISTANCE&summary=true';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { headers: { Authorization: 'KakaoAK ' + restKey }, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Kakao walking API error', r.status, errText.slice(0, 500));
      res.status(200).json({ route: null });
      return;
    }
    const data = await r.json();
    const route = data.routes && data.routes[0];
    if (!route || route.result_code !== 0) {
      console.error('Kakao walking API result_code', route && route.result_code, route && route.result_message);
      res.status(200).json({ route: null });
      return;
    }

    res.status(200).json({
      route: { distance: route.summary.distance, duration: route.summary.duration },
    });
  } catch (e) {
    console.error('Kakao walking API exception', e && e.message);
    res.status(200).json({ route: null });
  }
};
