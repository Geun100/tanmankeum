# 탄만큼 프로덕션 업그레이드 설계

날짜: 2026-08-18

## 배경

현재 `index.html`은 단일 파일 프론트엔드 프로토타입이다. 팟/참여자/채팅 데이터가 모두 브라우저 인메모리(`STATE`)에 있어 새로고침하면 사라진다. 지도는 canvas로 좌표를 직선 연결해 그린 것이고 "실제 도로 경로 아님"이라고 화면에 명시돼 있다. 사용자 식별은 닉네임 입력만으로 이뤄진다.

목표는 실제 사용자가 바로 쓸 수 있는 수준으로 올리는 것이다. 범위는 백엔드+DB 도입, 카카오맵 실제 연동 두 가지다. 결제/정산은 이번 범위에서 제외한다.

## 아키텍처 방침

빌드 도구 없이 지금의 단일 HTML 구조를 유지하고, CDN `<script>`로 Supabase JS SDK와 카카오맵 JS SDK만 얹는다. 프레임워크 재작성(Next.js/Vite)은 현재 서비스 규모에 과하다.

카카오모빌리티 Directions API는 CORS가 열려 있음을 확인했다(`Access-Control-Allow-Origin`이 요청 origin을 반사, preflight에서 `authorization` 헤더 허용). 따라서 API 프록시 서버는 불필요하다.

카카오 앱은 기존 앱(ID 1548866, 이름 "나란히")을 그대로 재사용한다. 앱 이름은 라벨일 뿐 기능에 영향이 없다. 카카오맵 JS SDK는 도메인 화이트리스트를 검사하므로, 플랫폼 키 → JS SDK 도메인에 실행할 도메인을 모두 등록해야 한다(`http://localhost:8935`, `https://tanmankeum.vercel.app`). 미등록 도메인에서는 SDK 요청이 401로 막힌다.

## 1. 데이터 구조 (Supabase Postgres)

```
users            (Supabase Auth 연동)
  id, nickname, gender
  - 닉네임 중복 허용 (unique 제약 없음)

pods
  id, leader_id, origin_name, origin_coords,
  leader_dest, leader_dest_coords,
  depart_date, depart_time, desired_size,
  status (open/dissolved), created_at

pod_participants
  id, pod_id, user_id, dest_name, dest_coords,
  dropoff_point, fare, joined_at

pod_messages
  id, pod_id, user_id, text, created_at
```

RLS 정책: open 상태 팟은 누구나 읽기 가능, 참여자 행은 본인 것만 insert/delete 가능, 메시지는 해당 팟 참여자만 insert 가능.

## 2. 인증 — 없음 (2026-08-20 변경)

당초 카카오 소셜 로그인을 넣기로 했으나, 테스트를 빨리 돌리기 위해 인증을 빼기로 했다.

```
1. 최초 접속 시 crypto.randomUUID()로 uuid 생성 → localStorage 저장
2. 이후 모든 요청에 그 uuid를 user_id로 실어 보냄
3. profiles 테이블에 (uuid, 닉네임, 성별) upsert
```

같은 브라우저면 재접속해도 닉네임·내 팟이 유지된다.

**감수한 트레이드오프**: 서버가 "이 요청이 진짜 그 사람 브라우저에서 왔다"를 검증할 수 없다. anon 키만 있으면 누구나 남의 `user_id`를 흉내 내 팟을 만들거나 남의 참가를 취소시킬 수 있다. `auth.uid()`를 쓸 수 없으므로 RLS도 신원 검사를 못 하고, 구조적 검사(예: 메시지는 그 팟 참여자 목록에 있는 user_id로만 insert 가능)만 남는다. 실사용 단계에서는 인증을 다시 넣어야 한다.

`supabase-keys.local.js`에 값이 비어 있으면 `SUPA_ENABLED=false`가 되어 인메모리 프로토타입(시드 팟, 새로고침 시 소실)으로 동작한다. 키 없이도 로컬에서 계산 로직을 계속 테스트할 수 있게 남겨둔 폴백이다.

## 3. 실시간 동기화 (Supabase Realtime)

팟 상세화면 진입 시에만 채널을 구독하고, 화면을 벗어나면 해제한다.

```js
supabase.channel('pod:' + podId)
  .on('postgres_changes', {event:'*', table:'pod_participants', filter:'pod_id=eq.'+podId}, refetchParticipants)
  .on('postgres_changes', {event:'*', table:'pod_messages', filter:'pod_id=eq.'+podId}, appendMessage)
  .on('postgres_changes', {event:'UPDATE', table:'pods', filter:'id=eq.'+podId}, syncPodStatus)
  .subscribe()
```

추천 팟 목록 화면은 실시간 구독하지 않는다. 진입 및 수동 새로고침 시 재조회로 충분하다.

Supabase 무료 티어(동시접속 200, 월 200만 메시지) 한도 내에서 비용이 발생하지 않는다.

## 4. 카카오맵 연동

```
1. index.html에 카카오맵 SDK 스크립트 추가
   //dapi.kakao.com/v2/maps/sdk.js?appkey=JS_KEY&libraries=services
2. 팟 상세화면에서 kakao.maps.Map 인스턴스 생성
3. Directions API 호출 (REST 키, fetch)
   GET https://apis-navi.kakaomobility.com/v1/directions
   헤더: Authorization: KakaoAK ${REST_API_KEY}
   - origin: ${경도},${위도},name=${이름}
   - destination: 동일 포맷
   - waypoints: 참여자 하차지점, `|` 구분, 최대 5개
4. 응답 sections[].roads[].vertexes로 실제 도로 위에 Polyline 렌더
5. summary.fare.taxi를 총 요금으로 삼고, 기존 splitProportional로 인원별 분배
   (이 계산 로직은 QA 통과했으므로 그대로 재사용)
6. API 실패 시 기존 canvas 방식으로 폴백 + "실제 경로 조회 실패" 안내
```

장소 데이터는 카카오 로컬 API로 조회한 실제 포항 장소로 교체한다. 가상 지명(`죽도시장상가`, `영일대카페거리`, `해도동`)은 제거한다.

계산도 직선 근사에서 실제 경로 기반으로 바꾼다.

| 항목 | 기존 | 변경 |
|---|---|---|
| 경로 적합성 | 출발지 기준 직선 방위각 25° 이내 | 실제 도로 경로선에서 1,200m 이내 |
| 하차 순서 | 출발지에서의 직선거리 순 | 출발지→하차지점 실제 주행거리 순 |
| 구간 요금 가중치 | 구간마다 추정 기본요금 | 실제 주행거리 |

경로 적합성 판정에는 각 팟의 실제 경로가 먼저 필요하므로, 팟을 만들기 전에 경로를 받아둔다.

## 5. 배포

Supabase: 프로젝트 생성 → 섹션1 테이블 마이그레이션 SQL 실행 → RLS 정책 적용 → Kakao OAuth provider 설정.

Vercel: 폴더를 정적 배포한다(빌드 없음, `index.html`이 진입점). 배포 후 나온 URL을 카카오 디벨로퍼스 플랫폼 및 Redirect URI에 등록한다.

키 관리: `kakao-keys.local.js`와 같은 방식으로 `supabase-keys.local.js`를 둔다. 여기엔 프로젝트 URL과 anon key만 넣는다. anon key는 공개돼도 안전한 키이며 실제 접근 제어는 RLS가 담당한다. service_role 키는 클라이언트에 두지 않는다.

## 6. 에러 처리

- 카카오 로그인 실패/취소 → 원래 화면 복귀, 안내 메시지
- Supabase 네트워크 오류 → 재시도 버튼이 있는 토스트
- Directions API 실패 → canvas 폴백 (섹션4)
- 동시 참가 레이스: 정원이 찬 팟에 두 명이 동시에 마지막 자리를 신청하는 경우, DB 트리거에서 `count(participants) < desired_size`를 검사해 초과 insert를 거부하고 "정원 마감"을 안내한다

## 7. 테스트

기존 순수 함수(`isRouteEligible`, `calcMatchScore`, `splitProportional`)는 현재처럼 브라우저 콘솔 직접 호출 방식의 QA를 유지한다. 여기에 브라우저 세션 2개를 띄워 실시간 반영을 확인하는 시나리오를 추가한다.

## 범위 제외

- 결제/정산 연동
- 전화번호 본인인증
- 팟 목록 화면의 실시간 구독
