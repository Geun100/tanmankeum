# 탄만큼 설정 가이드

이 문서의 1~3단계는 계정 소유자만 할 수 있다. 끝내고 나온 값 두 개(프로젝트 URL, anon key)를 알려주면 클라이언트 연동을 붙인다.

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에서 프로젝트 생성 (리전은 `Northeast Asia (Seoul)` 권장)
2. 좌측 **SQL Editor** 에서 `supabase/schema.sql` 내용을 통째로 붙여넣고 실행
3. 좌측 **Project Settings → API** 에서 아래 두 값을 복사해둔다
   - `Project URL`
   - `anon` `public` key

`service_role` 키는 절대 클라이언트에 넣지 않는다. 이 프로젝트에서는 쓰지 않는다.

## 2. 카카오 로그인 설정

기존 카카오 앱(ID 1548866)을 그대로 쓴다. 앱 이름은 라벨일 뿐이라 바꾸지 않아도 된다.

**카카오 디벨로퍼스에서:**

1. **제품 설정 → 카카오 로그인** → 활성화 ON
2. **제품 설정 → 카카오 로그인 → 보안** → Client Secret 생성 후 복사, 활성화 상태 ON
3. **제품 설정 → 카카오 로그인 → Redirect URI** 에 아래를 등록
   ```
   https://<프로젝트ID>.supabase.co/auth/v1/callback
   ```
   `<프로젝트ID>`는 1단계에서 복사한 Project URL에 들어 있다.
4. **제품 설정 → 카카오 로그인 → 동의항목** 에서 닉네임을 필수 또는 선택으로 설정
5. **앱 설정 → 플랫폼 → Web** 에 사이트 도메인 등록
   ```
   http://localhost:8935     (로컬 테스트용)
   https://<배포도메인>        (Vercel 배포 후)
   ```

**Supabase 대시보드에서:**

6. **Authentication → Providers → Kakao** 활성화
   - `Kakao Client ID`: 카카오 앱의 **REST API 키**
   - `Kakao Client Secret`: 2번에서 만든 값

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
