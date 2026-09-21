# 탄만큼 설정 가이드

이 문서의 1~3단계는 계정 소유자만 할 수 있다. 끝내고 나온 값 두 개(프로젝트 URL, anon key)를 알려주면 클라이언트 연동을 붙인다.

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에서 프로젝트 생성 (리전은 `Northeast Asia (Seoul)` 권장)
2. 좌측 **SQL Editor** 에서 `supabase/schema.sql` 내용을 통째로 붙여넣고 실행
3. 좌측 **Project Settings → API** 에서 아래 두 값을 복사해둔다
   - `Project URL`
   - `anon` `public` key

`service_role` 키는 절대 클라이언트에 넣지 않는다. 이 프로젝트에서는 쓰지 않는다.

## 2. 로그인 없음 — 브라우저 uuid 방식

카카오 로그인은 빼기로 했다. 인증이 없다는 뜻이라, 서버는 "이 요청이 진짜 그 사람 브라우저에서 왔다"를 검증할 방법이 없다.
클라이언트가 최초 접속 시 `crypto.randomUUID()`로 uuid를 만들어 `localStorage`에 저장하고, 이후 모든 요청에 그 값을 `user_id`로 실어 보낸다.

같은 브라우저면 재접속해도 닉네임·내 팟이 유지된다. 다만 anon 키만 있으면 누구나 남의 `user_id`를 흉내 내 요청을 보낼 수 있다 — `schema.sql`의 RLS는 "구조적으로 말이 되는 값인지"만 검사하고 신원까지는 확인하지 못한다. 테스트 단계에서 감수하기로 한 트레이드오프이며, 실사용 단계에서는 인증을 다시 넣어야 한다.

## 3. 키 파일 만들기

`kakao-keys.local.js` 옆에 `supabase-keys.local.js`를 만든다.

```js
window.SUPABASE_KEYS = {
  url: 'https://<프로젝트ID>.supabase.co',
  anonKey: '<anon public key>',
};
```

anon key는 브라우저에 노출돼도 되는 키다. 접근 제어는 전부 `schema.sql`의 RLS 정책이 한다.

## 4. 로컬 실행

```bash
python3 -m http.server 8935
```

`file://`로 열면 안 된다. 카카오맵 SDK가 도메인을 확인하고, 길찾기 API가 CORS 검사를 하기 때문에 둘 다 막힌다.

## 5. 배포 (Vercel)

빌드 과정이 없다. 이 폴더를 그대로 정적 배포하면 된다.

```bash
npx vercel --prod
```

배포 후 나온 도메인을 2단계 5번(카카오 플랫폼)과 3번(Redirect URI)에 추가로 등록한다.

`*.local.js` 파일은 저장소에 커밋하지 않는다. Vercel에는 별도로 올리거나, 배포용 값을 담은 파일을 따로 둔다.

## 검증

브라우저 콘솔에서:

```js
runSelfCheck()   // → {passed: true, fails: []}
```

요금 분배 합계와 하차지점 계산을 확인한다. 캐시가 빈 상태와 팟 생성 후 모두 통과해야 한다.
