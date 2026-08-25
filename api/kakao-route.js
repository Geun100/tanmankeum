// 카카오모빌리티 길찾기(자동차 길찾기 / 미래 운행 정보 길찾기) 프록시.
// REST API 키는 여기(서버, Vercel 환경변수 KAKAO_REST_API_KEY)에만 있다 — 클라이언트로
// 절대 내려주지 않는다. 카카오 REST 키는 "호출 허용 IP"로 보호하도록 설계된 키라
// (공식 보안 가이드) 브라우저에서 직접 부르면 방문자 아무나 devtools로 꺼내갈 수 있다.
// 이 엔드포인트가 그 대신 서버에서 카카오를 호출해주는 창구다.
//
// 입력은 stops(장소 이름+좌표 배열, 클라이언트가 이미 알고 있는 값)와 선택적 departureTime.
// 좌표를 클라이언트가 보내는 이유: 장소 이름→좌표 변환(PLACE_COORDS 테이블, 사용자가 자동완성으로
// 고른 실검색 결과)은 클라이언트에만 있고, 여기서 다시 구현할 이유가 없다. 여기는 순수 프록시다.

const MAX_STOPS = 7; // origin + 최대 5개 경유지 + destination
const MAX_WAYPOINTS = 5; // 카카오모빌리티 길찾기 API 제한

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
  const stops = Array.isArray(body.stops) ? body.stops.slice(0, MAX_STOPS) : [];
  const departureTime = typeof body.departureTime === 'string' && /^\d{12}$/.test(body.departureTime) ? body.departureTime : null;

  const valid = stops.length >= 2 && stops.every(s => s && typeof s.name === 'string' && isFiniteNum(s.lat) && isFiniteNum(s.lng));
  if (!valid) {
    res.status(400).json({ error: 'stops가 올바르지 않아요(이름+좌표 2곳 이상 필요)' });
    return;
  }

  const asParam = (s) => `${s.lng},${s.lat},name=${encodeURIComponent(s.name)}`;
  const mid = stops.slice(1, -1).slice(0, MAX_WAYPOINTS);
  const waypoints = mid.map(asParam).join('|');

  const url = (departureTime ? 'https://apis-navi.kakaomobility.com/v1/future/directions' : 'https://apis-navi.kakaomobility.com/v1/directions')
    + `?origin=${asParam(stops[0])}`
    + `&destination=${asParam(stops[stops.length - 1])}`
    + (waypoints ? `&waypoints=${waypoints}` : '')
    // RECOMMEND는 실시간 교통을 반영해 호출할 때마다 다른 경로를 준다. 그러면 같은 팟이 접속 시점에
    // 따라 참가 가능/불가로 뒤집히므로, 판정이 흔들리지 않도록 최단거리 경로로 고정한다.
    + '&priority=DISTANCE'
    + (departureTime ? `&departure_time=${departureTime}` : '');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { headers: { Authorization: 'KakaoAK ' + restKey }, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!r.ok) {
      res.status(200).json({ route: null });
      return;
    }
    const data = await r.json();
    const route = data.routes && data.routes[0];
    if (!route || route.result_code !== 0) {
      res.status(200).json({ route: null });
      return;
    }

    const path = [];
    (route.sections || []).forEach(sec => (sec.roads || []).forEach(road => {
      for (let i = 0; i + 1 < road.vertexes.length; i += 2) path.push({ lng: road.vertexes[i], lat: road.vertexes[i + 1] });
    }));

    res.status(200).json({
      route: {
        path,
        fare: (route.summary.fare && route.summary.fare.taxi) || 0,
        distance: route.summary.distance,
        duration: route.summary.duration,
        sections: (route.sections || []).map(sec => ({ distance: sec.distance, duration: sec.duration })),
      },
    });
  } catch (e) {
    // 타임아웃/네트워크 실패 → 클라이언트가 폴백(직선+추정요금)으로 넘어가게 route:null로 응답한다.
    res.status(200).json({ route: null });
  }
};
