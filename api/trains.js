// 국토교통부 TAGO 열차정보 API 프록시. 서비스키는 서버(Vercel 환경변수 TRAIN_API_SERVICE_KEY)에만
// 있다 — 클라이언트로 절대 내려주지 않는다(api/kakao-route.js와 같은 이유·같은 패턴).
//
// GET /api/trains?date=YYYYMMDD&departure=포항&arrival=서울&trainType=KTX
//
// 실제 TAGO 엔드포인트(GetStrtpntAlocFndTrainInfo)는 출발역·도착역 둘 다 필수라 "역 하나
// 기준으로 방향 무관 전체 열차"를 한 번에 못 준다. 그래서 arrival을 생략하고 departure(또는
// arrival)만 포항으로 주면, 포항에서 실제로 KTX가 다니는 주요 상대역(서울·수서·동대구·부산·행신)
// 전부를 서버에서 대신 조회해 합친다 — 탄만큼 UI가 필요한 건 "몇 시에 포항에서 뭔가 있다"이지
// 상대역이 어딘지가 아니다.

const STATION_NODE_ID = {
  포항: 'NAT8B0351',
  서울: 'NAT010000',
  수서: 'NATH30000',
  동대구: 'NAT013271',
  부산: 'NAT014445',
  행신: 'NAT110147',
};
// 포항역과 실제로 KTX가 오가는 주요 상대역. depPlaceId/arrPlaceId를 둘 다 요구하는 API 제약을
// 우회하려고 이 목록을 순회해 합친다 — 새 노선이 생기면 여기에 역만 추가하면 된다.
const POHANG_COUNTERPARTS = ['서울', '수서', '동대구', '부산', '행신'];

const TAGO_URL = 'https://apis.data.go.kr/1613000/TrainInfo/GetStrtpntAlocFndTrainInfo';

const cache = new Map(); // key: "date:dep:arr" -> { at, items }
const CACHE_MS = 20 * 60 * 1000; // 20분 — 정기 열차 시간표라 자주 안 바뀐다

function todayYmd(){
  const d = new Date();
  const kst = new Date(d.getTime() + (9 * 60 - d.getTimezoneOffset()) * 60000); // KST 기준 날짜
  return `${kst.getFullYear()}${String(kst.getMonth() + 1).padStart(2, '0')}${String(kst.getDate()).padStart(2, '0')}`;
}

function toHHMM(yyyymmddhhmmss){
  return typeof yyyymmddhhmmss === 'string' && yyyymmddhhmmss.length >= 12
    ? `${yyyymmddhhmmss.slice(8, 10)}:${yyyymmddhhmmss.slice(10, 12)}`
    : '';
}
function toDashedDate(yyyymmdd){
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

// 한 OD 쌍(출발역→도착역, 날짜)을 조회해 표준 형태 배열로 돌려준다. 실패해도 빈 배열만 준다 —
// 호출부가 여러 상대역을 순회하므로 하나 실패했다고 전체가 죽으면 안 된다.
async function fetchOnePair(apiKey, depId, arrId, date){
  const cacheKey = `${date}:${depId}:${arrId}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;

  const url = `${TAGO_URL}?serviceKey=${apiKey}&depPlaceId=${depId}&arrPlaceId=${arrId}&depPlandTime=${date}&numOfRows=100&pageNo=1&_type=json`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!r.ok) return [];
    const data = await r.json();
    // TAGO는 결과가 1건이면 item이 배열이 아니라 객체 하나로 오기도 한다 — 항상 배열로 맞춘다.
    const raw = (data.response && data.response.body && data.response.body.items && data.response.body.items.item) || [];
    const items = Array.isArray(raw) ? raw : [raw];
    const mapped = items
      .filter(it => it && it.trainno)
      .map(it => ({
        trainNo: it.trainno,
        trainType: it.traingradename || 'KTX',
        departureStation: it.depplacename,
        arrivalStation: it.arrplacename,
        departureDate: toDashedDate(date),
        departureTime: toHHMM(it.depplandtime),
        arrivalTime: toHHMM(it.arrplandtime),
        fare: it.adultcharge ? Number(it.adultcharge) : null,
      }));
    cache.set(cacheKey, { at: Date.now(), items: mapped });
    return mapped;
  } catch (e) {
    return [];
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET만 지원해요' });
    return;
  }

  const apiKey = process.env.TRAIN_API_SERVICE_KEY;
  if (!apiKey) {
    res.status(500).json({ error: '서버에 TRAIN_API_SERVICE_KEY가 설정돼 있지 않아요' });
    return;
  }

  const q = req.query || {};
  const date = typeof q.date === 'string' && /^\d{8}$/.test(q.date) ? q.date : todayYmd();
  const departureName = typeof q.departure === 'string' ? q.departure.trim() : '';
  const arrivalName = typeof q.arrival === 'string' ? q.arrival.trim() : '';
  const trainTypeFilter = typeof q.trainType === 'string' ? q.trainType.trim() : 'KTX';

  const depId = STATION_NODE_ID[departureName];
  const arrId = STATION_NODE_ID[arrivalName];

  if (departureName && !depId) { res.status(200).json({ trains: [], error: '알 수 없는 출발역이에요.' }); return; }
  if (arrivalName && !arrId) { res.status(200).json({ trains: [], error: '알 수 없는 도착역이에요.' }); return; }
  if (!departureName && !arrivalName) { res.status(200).json({ trains: [], error: 'departure 또는 arrival 중 하나는 있어야 해요.' }); return; }

  try {
    let trains = [];
    if (departureName && arrivalName) {
      // 출발·도착 둘 다 지정 — 그 OD 쌍 하나만 조회한다.
      trains = await fetchOnePair(apiKey, depId, arrId, date);
    } else {
      // 한쪽만 포항이면(주로 이 경우) 반대편 방향으로 주요 상대역 전부를 조회해 합친다.
      const known = departureName ? STATION_NODE_ID[departureName] : STATION_NODE_ID[arrivalName];
      const counterparts = POHANG_COUNTERPARTS.filter(n => STATION_NODE_ID[n] !== known);
      const results = await Promise.all(counterparts.map(name => {
        const cId = STATION_NODE_ID[name];
        return departureName ? fetchOnePair(apiKey, known, cId, date) : fetchOnePair(apiKey, cId, known, date);
      }));
      // 한 열차가 여러 상대역을 경유하면(예: 포항→동대구→서울) OD 쌍마다 한 번씩 잡혀 같은 trainNo가
      // 중복된다. 열차번호 기준으로 하나만 남긴다 — 사용자가 궁금한 건 "몇 시에 포항에 열차가 있냐"지
      // 최종 도착역이 아니다.
      const seen = new Set();
      trains = results.flat().filter(t => {
        if (seen.has(t.trainNo)) return false;
        seen.add(t.trainNo);
        return true;
      });
    }

    if (trainTypeFilter) {
      trains = trains.filter(t => t.trainType.includes(trainTypeFilter));
    }
    trains.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

    res.status(200).json({ trains, date: toDashedDate(date) });
  } catch (e) {
    res.status(200).json({ trains: [], error: '열차 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.' });
  }
};
