# 로고→홈 + 온보딩 스킵/설정화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로고 클릭 시 홈 이동, 재접속 시 온보딩 스킵하고 바로 홈, 출발지/목적지/시간/인원을 나중에 바꿀 수 있는 설정 화면 추가.

**Architecture:** 단일 `index.html` 바닐라 JS 앱. 기존 `screen-ob-route`(경로/시간/인원 폼)를 온보딩과 설정 두 용도로 재사용한다(모드 플래그로 분기) — 위젯(휠피커/스테퍼/자동완성)이 전역 단일 인스턴스라 화면을 새로 만들면 그대로 복제해야 해서, 화면 재사용이 더 적은 코드로 같은 결과를 낸다. 온보딩 등록 로직 중 "홈 진입" 부분을 함수로 뽑아 재접속 스킵 경로에서도 재사용한다.

**Tech Stack:** 바닐라 JS, Supabase JS client v2, 프로젝트 자체 컨벤션(테스트 프레임워크 없음 — `runSelfCheck()` 콘솔 자가진단 + 브라우저 수동 확인).

## Global Constraints

- 닉네임/성별은 이번 범위 아님 — 설정 화면은 출발지/목적지/시간/인원만 다룬다.
- 기존 "내가 팟장이고 참가자가 나 혼자일 때만 팟 값 갱신, 아니면 에러 안내" 로직을 그대로 재사용한다 (`index.html:1580-1600` 부근, `수정 금지 대상 아님 — 재사용`).
- 뒤로가기 체계(`data-back` + 단일 위임 루프, `index.html:978-980`)는 이미 통일돼 있음 — 새로 만들지 않는다.
- 커밋마다 로컬 서버(`python3 -m http.server 8935`)로 브라우저 확인 후 커밋.

---

### Task 1: 홈 로고 클릭 → 홈 이동 + 설정 진입 버튼

**Files:**
- Modify: `index.html:399-400` (홈 topbar 마크업)
- Modify: `index.html` 온보딩 스크립트 블록 근처 (로고 클릭 핸들러 추가 위치는 Task 3에서 만드는 `enterHome`/전역 초기화 코드 다음)

**Interfaces:**
- Consumes: 기존 `showScreen(id)` (`index.html:972`), `STATE.user`
- Produces: 없음 (leaf task)

- [ ] **Step 1: 홈 topbar에 설정 아이콘 버튼 추가**

`index.html:399-400`를 다음으로 교체 (기존 `topbar--brand` 유지, 우측에 아이콘 버튼 추가하려면 topbar를 justify-between으로 만들어야 함 — CSS도 같이 수정):

```html
    <section class="screen" id="screen-home" aria-label="홈">
      <header class="topbar topbar--brand">
        <span class="brand-mark" id="home-logo" role="button" tabindex="0" aria-label="홈으로">탄만큼</span>
        <button class="icon-btn" id="btn-open-settings" aria-label="설정" style="margin-left:auto;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </header>
```

CSS 변경: `index.html:70` `.topbar` 규칙 그대로 두고(이미 `display:flex; align-items:center`), 새 요소 정렬은 인라인 `margin-left:auto`로 충분(다른 화면 CSS 안 건드림). `#home-logo`에 `cursor:pointer` 추가:

`index.html:72` 다음 줄로 교체:
```css
  .brand-mark{ font-size:20px; font-weight:800; letter-spacing:-0.02em; cursor:pointer; }
```

- [ ] **Step 2: 로고 클릭 → 홈, 아직 없으면 무시**

`index.html`에서 `document.querySelectorAll('[data-back]')...` 다음 줄(약 `index.html:980` 이후)에 추가:

```javascript
document.getElementById('home-logo').addEventListener('click', () => {
  if (STATE.user) showScreen('screen-home');
});
```

(`screen-ob-profile`에도 같은 `brand-mark`가 있지만 `id="home-logo"`는 홈 쪽에만 부여 — 온보딩 중엔 홈이 없으므로 클릭 핸들러 자체를 안 붙인다. 두 곳 다 `class="brand-mark"`라 스타일은 공유되지만 클릭 대상은 하나뿐.)

- [ ] **Step 3: 브라우저 확인**

`python3 -m http.server 8935`로 띄우고 온보딩 완료 후 홈에서 로고 클릭 시 (이미 홈이라) 화면 유지되는지, 팟 상세/채팅방에 들어갔다가 브라우저 콘솔에서 `showScreen('screen-pod-detail')` 후 로고 클릭 시도는 안 됨(그 화면엔 로고 없음) — 정상. `btn-open-settings`는 Task 2에서 연결하므로 지금은 눌러도 반응 없는 게 정상.

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: 홈 로고 클릭 시 홈 이동, 설정 진입 버튼 추가"
```

---

### Task 2: 설정 화면 (ob-route 재사용 모드 분기)

**Files:**
- Modify: `index.html:348-397` (`screen-ob-route` 헤더의 `data-back` 속성을 동적으로 만듦)
- Modify: `index.html:1539-1616` (`btn-find-pod` 핸들러를 모드 분기)
- Modify: `index.html` 전역 상태 선언부 (`obGender` 근처, `index.html:1379`)

**Interfaces:**
- Consumes: `placeCoord`, `readWheelTime`, `setWheelTime`, `warmPodRoutes`, `friendlyDbError`, `showError`, `renderHome`, `showScreen` (모두 기존 함수, 시그니처 변경 없음)
- Produces: `let obMode = 'onboarding'` 전역 변수 (`'onboarding' | 'settings'`), `function openSettings()` — 설정 화면 진입 시 폼을 현재 `STATE.user` 값으로 채우고 `screen-ob-route`로 이동.

- [ ] **Step 1: 모드 전역 변수 + 뒤로가기 대상을 동적으로 바꾸기**

`index.html:1379` (`let obGender = '여성';` 바로 위)에 추가:

```javascript
let obMode = 'onboarding'; // 'onboarding' | 'settings' — screen-ob-route를 두 용도로 재사용
```

`index.html:350`의 뒤로가기 버튼:
```html
        <button class="icon-btn" data-back="screen-ob-profile" aria-label="뒤로가기">
```
을 아래로 교체 (id 부여, data-back은 JS에서 갱신):
```html
        <button class="icon-btn" id="ob-route-back-btn" data-back="screen-ob-profile" aria-label="뒤로가기">
```

`index.html:353`의 타이틀:
```html
        <div class="topbar-title"><strong>이동 정보</strong></div>
```
을 아래로 교체 (설정 모드일 때 문구 다르게):
```html
        <div class="topbar-title"><strong id="ob-route-title">이동 정보</strong></div>
```

- [ ] **Step 2: `openSettings()` 함수 작성 — 현재 값으로 폼 프리필 후 이동**

`btn-find-pod` 핸들러 바로 위(`index.html:1539` 근처)에 추가:

```javascript
function openSettings(){
  const u = STATE.user;
  if (!u) return;
  obMode = 'settings';
  document.getElementById('ob-route-back-btn').dataset.back = 'screen-home';
  document.getElementById('ob-route-title').textContent = '이동 정보 수정';
  document.getElementById('ob-origin').value = u.origin;
  document.getElementById('ob-dest').value = u.dest;
  registerPlace(u.origin, placeCoord(u.origin)?.lat, placeCoord(u.origin)?.lng); // 이미 등록돼 있으므로 사실상 no-op 방어용
  setWheelTime(u.time);
  partySize = u.partySize;
  sizeValueEl.textContent = String(partySize);
  document.getElementById('btn-find-pod').textContent = '저장하기';
  showScreen('screen-ob-route');
}
document.getElementById('btn-open-settings').addEventListener('click', openSettings);
```

- [ ] **Step 3: 제출 핸들러를 모드 분기 — 설정 모드는 "갱신만" 하고 홈으로 복귀**

`index.html:1539-1616`의 `btn-find-pod` 클릭 핸들러 전체를 아래로 교체:

```javascript
document.getElementById('btn-find-pod').addEventListener('click', async () => {
  const nickname = STATE.user ? STATE.user.nickname : document.getElementById('ob-nickname').value.trim();
  if (obMode === 'onboarding' && !nickname) { document.getElementById('ob-nickname').focus(); return; }
  const originInput = document.getElementById('ob-origin');
  const destInput = document.getElementById('ob-dest');
  const originName = originInput.value.trim();
  const destName = destInput.value.trim();
  if (!placeCoord(originName)) { originInput.focus(); return; }
  if (!placeCoord(destName)) { destInput.focus(); return; }
  const time = readWheelTime();
  const now = new Date();
  const todayStr = localDateStr(now);
  const date = new Date(`${todayStr}T${time}`) < now
    ? localDateStr(new Date(now.getTime() + 86400000))
    : todayStr;

  const btn = document.getElementById('btn-find-pod');
  btn.disabled = true;
  btn.textContent = obMode === 'settings' ? '저장 중…' : '경로 확인 중…';

  if (obMode === 'settings') {
    try {
      const mine = findPod(STATE.myPodId);
      if (!mine || mine.leaderId !== STATE.user.id) {
        showError('지금은 값을 바꿀 수 없어요. 채팅방에서 확인해주세요.');
        return;
      }
      if (mine.participants.length > 1) {
        showError('이미 다른 사람이 참가한 팟이라 경로를 바꿀 수 없어요. 바꾸려면 채팅방에서 팟을 취소한 뒤 다시 등록해주세요.');
        return;
      }
      const originC = placeCoord(originName), destC = placeCoord(destName);
      if (SUPA_ENABLED) {
        const { error: podErr } = await supa.from('pods').update({
          origin_name: originName, origin_lat: originC.lat, origin_lng: originC.lng,
          leader_dest: destName, leader_dest_lat: destC.lat, leader_dest_lng: destC.lng,
          depart_date: date, depart_time: time, desired_size: partySize,
        }).eq('id', mine.id);
        if (podErr) throw podErr;
        const { error: partErr } = await supa.from('pod_participants').update({
          dest_name: destName, dest_lat: destC.lat, dest_lng: destC.lng, dropoff_point: destName,
        }).eq('pod_id', mine.id).eq('user_id', STATE.user.id);
        if (partErr) throw partErr;
        const updated = await loadPod(mine.id);
        if (updated) STATE.pods = STATE.pods.map(p => p.id === mine.id ? updated : p);
      } else {
        mine.originName = originName; mine.leaderDest = destName;
        mine.departTime = time; mine.departDate = date; mine.desiredSize = partySize;
      }
      STATE.user = { ...STATE.user, origin: originName, dest: destName, time, date, partySize };
      saveOnboardingCache(STATE.user);
      await Promise.all(STATE.pods.map(warmPodRoutes));
    } catch (e) {
      showError(friendlyDbError(e));
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = '저장하기';
      obMode = 'onboarding';
    }
    renderHome();
    showScreen('screen-home');
    return;
  }

  STATE.user = { id: getOrCreateUserId(), nickname, gender: obGender, origin: originName, dest: destName, date, time, partySize };
  try {
    await enterHome();
  } catch (e) {
    showError(friendlyDbError(e));
    return;
  } finally {
    btn.disabled = false;
    btn.textContent = '등록하기';
  }
  renderHome();
  showScreen('screen-home');
});
```

(`enterHome()`과 `saveOnboardingCache()`는 Task 3에서 정의 — 이 Task 3 코드가 Task 2보다 먼저 로드되도록, Task 3 스텝을 이 핸들러 위쪽에 배치한다. 순서는 Step 4에서 명시.)

- [ ] **Step 4: 함수 정의 순서 확인**

`index.html`은 스크립트가 순서대로 실행되지만 함수 선언(`function foo(){}`)은 호이스팅되므로, `enterHome`/`saveOnboardingCache`가 `function` 키워드로 선언돼 있으면(화살표 함수 아님) 이 핸들러보다 아래에 있어도 동작한다. Task 3에서 정확히 `function enterHome(){...}`, `function saveOnboardingCache(u){...}` 형태로 선언할 것 — 위치는 상관없지만 관례상 `getOrCreateUserId` 근처(`index.html:557` 부근)에 둔다.

- [ ] **Step 5: 브라우저로 확인**

1. 온보딩 완료 → 홈 진입.
2. 설정 아이콘 클릭 → `이동 정보 수정` 타이틀, 기존 값 프리필, 뒤로가기 누르면 홈으로 가는지 확인.
3. 목적지를 바꿔서 저장 → 홈으로 돌아오고 status card에 새 목적지 반영되는지 확인.
4. 콘솔에서 `runSelfCheck()` 통과 확인.

- [ ] **Step 6: 커밋**

```bash
git add index.html
git commit -m "feat: 설정 화면 추가 (출발지/목적지/시간/인원 재설정)"
```

---

### Task 3: 재접속 시 온보딩 스킵

**Files:**
- Modify: `index.html` (`getOrCreateUserId` 근처, `index.html:555-561`)
- Modify: `index.html` 부팅 시퀀스 (`leaveSplash`/`setTimeout(leaveSplash, SPLASH_MS)` 부근, `index.html:1372-1377`)

**Interfaces:**
- Consumes: `upsertProfile`, `loadOpenPods`, `createOwnPod`, `warmPodRoutes`, `prefetchBaseRoutes`, `renderHome`, `showScreen`, `SUPA_ENABLED`
- Produces: `function saveOnboardingCache(user)`, `function loadOnboardingCache()`, `async function enterHome()` — 이 세 개를 Task 2의 제출 핸들러가 그대로 소비한다.

- [ ] **Step 1: 캐시 저장/조회 함수**

`index.html:561`(`getOrCreateUserId` 함수 끝) 바로 아래에 추가:

```javascript
const ONBOARDING_CACHE_KEY = 'tanmankeum_onboarding_v1';
function saveOnboardingCache(user){
  localStorage.setItem(ONBOARDING_CACHE_KEY, JSON.stringify({
    nickname: user.nickname, gender: user.gender,
    origin: user.origin, dest: user.dest, time: user.time, partySize: user.partySize,
  }));
}
function loadOnboardingCache(){
  try {
    const raw = localStorage.getItem(ONBOARDING_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c.nickname || !c.origin || !c.dest || !c.time || !c.partySize) return null;
    return c;
  } catch { return null; }
}
```

- [ ] **Step 2: `enterHome()` — 기존 등록 로직을 함수로 추출**

같은 위치에 이어서 추가 (기존 `btn-find-pod` 핸들러의 등록 로직을 그대로 옮긴 것 — `STATE.user`가 이미 채워져 있다고 가정):

```javascript
async function enterHome(){
  await prefetchBaseRoutes(STATE.user.origin, STATE.user.dest);
  if (SUPA_ENABLED) {
    await upsertProfile(STATE.user.id, STATE.user.nickname, STATE.user.gender);
    STATE.pods = await loadOpenPods();
    const mine = STATE.pods.find(p => p.participants.some(x => x.id === STATE.user.id));
    STATE.myPodId = mine ? mine.id : null;
    STATE.committed = !!(mine && mine.leaderId !== STATE.user.id);
    STATE.userState = STATE.committed ? '채팅방' : '대기';

    if (mine && mine.leaderId === STATE.user.id && mine.participants.length === 1) {
      const originC = placeCoord(STATE.user.origin), destC = placeCoord(STATE.user.dest);
      const { error: podErr } = await supa.from('pods').update({
        origin_name: STATE.user.origin, origin_lat: originC.lat, origin_lng: originC.lng,
        leader_dest: STATE.user.dest, leader_dest_lat: destC.lat, leader_dest_lng: destC.lng,
        depart_date: STATE.user.date, depart_time: STATE.user.time, desired_size: STATE.user.partySize,
      }).eq('id', mine.id);
      if (podErr) throw podErr;
      const { error: partErr } = await supa.from('pod_participants').update({
        dest_name: STATE.user.dest, dest_lat: destC.lat, dest_lng: destC.lng, dropoff_point: STATE.user.dest,
      }).eq('pod_id', mine.id).eq('user_id', STATE.user.id);
      if (partErr) throw partErr;
      const updated = await loadPod(mine.id);
      if (updated) STATE.pods = STATE.pods.map(p => p.id === mine.id ? updated : p);
    } else if (mine && mine.leaderId === STATE.user.id && mine.participants.length > 1) {
      showError('이미 다른 사람이 참가한 팟이라 경로를 바꿀 수 없어요. 바꾸려면 채팅방에서 팟을 취소한 뒤 다시 등록해주세요.');
    }
  } else {
    STATE.pods = seedPods();
    STATE.userState = '대기';
  }
  if (!STATE.myPodId) await createOwnPod();
  await Promise.all(STATE.pods.map(warmPodRoutes));
  saveOnboardingCache(STATE.user);
}
```

- [ ] **Step 3: 부팅 시 캐시 있으면 스플래시/온보딩 건너뛰기**

`index.html:1372-1377`:
```javascript
const SPLASH_MS = 1750;
let splashDone = false;
function leaveSplash(){
  if (splashDone) return;
  splashDone = true;
  showScreen('screen-ob-profile');
}
setTimeout(leaveSplash, SPLASH_MS);
document.getElementById('screen-splash').addEventListener('click', leaveSplash);
```
를 아래로 교체:

```javascript
const SPLASH_MS = 1750;
let splashDone = false;
function leaveSplash(){
  if (splashDone) return;
  splashDone = true;
  showScreen('screen-ob-profile');
}
const cachedOnboarding = loadOnboardingCache();
if (cachedOnboarding) {
  splashDone = true;
  STATE.user = { id: getOrCreateUserId(), ...cachedOnboarding };
  enterHome()
    .then(() => { renderHome(); showScreen('screen-home'); })
    .catch(e => { showError(friendlyDbError(e)); showScreen('screen-ob-profile'); });
} else {
  setTimeout(leaveSplash, SPLASH_MS);
  document.getElementById('screen-splash').addEventListener('click', leaveSplash);
}
```

- [ ] **Step 4: 온보딩 최초 완료 시에도 캐시 저장**

Task 2 Step 3에서 이미 `enterHome()` 안에서 `saveOnboardingCache(STATE.user)`를 호출하므로 별도 작업 없음 — 최초 온보딩도 `enterHome()`을 거치기 때문에 자동으로 캐시된다.

- [ ] **Step 5: 브라우저로 전체 흐름 확인**

1. `localStorage.clear()` 후 새로고침 → 스플래시부터 온보딩 정상 진행되는지.
2. 온보딩 완료 → 홈 진입 확인.
3. 새로고침(F5) → 스플래시/온보딩 없이 바로 홈으로 가는지, `my-status-card`가 정상 표시되는지.
4. 시크릿창(다른 uuid)에서도 같은 흐름 확인.
5. 콘솔 `runSelfCheck()` 통과 확인.

- [ ] **Step 6: 커밋**

```bash
git add index.html
git commit -m "feat: 재접속 시 온보딩 스킵하고 바로 홈으로"
```

---

### Task 4: 배포

**Files:** 없음 (배포만)

- [ ] **Step 1: Task 1~3 전부 통과 확인 후 프로덕션 배포**

```bash
npx vercel --prod
```

- [ ] **Step 2: 배포된 URL에서 재확인**

`https://tanmankeum.vercel.app` 새로고침 → 캐시 있으면 바로 홈, 로고 클릭, 설정에서 값 변경까지 실제 라이브 환경에서 1회 더 확인. 확인 후 테스트로 만든 계정/팟은 정리(anon key로 `profiles` DELETE — 이전 세션에서 쓴 방식과 동일).

## Self-Review 메모

- Spec 커버리지: A(로고→홈)=Task1, D(스킵+설정)=Task2·3 커버. B(RLS)/E(성별 기본값)/F(설명)은 이번 플랜 범위 밖 — 사용자가 이번 라운드에 명시적으로 승인한 두 항목만 담음.
- 타입/시그니처 일관성: `enterHome()`은 인자 없이 `STATE.user`를 읽음(Task2·3 양쪽에서 동일하게 소비), `saveOnboardingCache(user)`는 `STATE.user` 형태(nickname/gender/origin/dest/time/partySize 포함) 객체를 받음 — Task2 설정 저장 경로와 Task3 최초 온보딩 경로 모두 이 형태로 호출.
- 플레이스홀더 없음, 전부 실제 코드 포함.
