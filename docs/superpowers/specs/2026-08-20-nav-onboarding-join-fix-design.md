# 설계: 글로벌 내비게이션 · 참가 버그 · 온보딩 스킵/설정 · 온보딩 성별 기본값

상태: 승인됨 (2026-08-20)

## 배경

라이브 사이트(https://tanmankeum.vercel.app)에서 콘솔로 `joinPod()`를 직접 실행해 재현 확인:

```
new row violates row-level security policy for table "pods" (42501)
```

원인: 라이브 Supabase DB의 `pods` UPDATE RLS 정책이 구버전(`with check status <> 'dissolved'`)
그대로 걸려있음. `supabase/schema.sql`과 `supabase/fix-rls.sql`은 이미 고쳐진 정책을 담고 있지만,
아직 Supabase SQL Editor에서 실행된 적이 없다. `joinPod()`가 "내 팟 먼저 해체" UPDATE를 시도할 때마다
이 정책에 막혀 예외가 던져지고, `friendlyDbError()`가 이 메시지를 못 알아봐서 사용자에게는
"네트워크 문제로 처리하지 못했어요"로 보인다.

이 세션에서 REST API로 직접 재확인(DELETE로 테스트 데이터 정리 완료), `pods`/`pod_participants`
테이블에 고아 데이터는 없음을 확인함 — 데이터 정합성 문제는 아니고 순수 RLS 정책 미적용 문제.

## A. Supabase 정책 적용 (사람이 직접 해야 함)

담당자(계정 소유자)가 Supabase 대시보드 → SQL Editor에서 `supabase/fix-rls.sql` 전체를 붙여넣고
실행. `schema.sql` 전체를 다시 실행해도 동일한 결과(멱등). 실행 후 아래로 재확인 가능:

```sql
select policyname, cmd, qual, with_check from pg_policies
where tablename = 'pods' and policyname = 'pods_update';
```

`with_check`가 `true`여야 한다. 실행 전에는 이 저장소 쪽에서 코드로 해결할 수 없는 항목 — 클라이언트
코드는 이미 맞게 짜여 있다(`joinPod`의 dissolve-then-insert 로직 자체는 정상).

## B. 참가 흐름 코드 보강 (클라이언트)

1. `friendlyDbError()`에 RLS 위반 메시지(`row-level security policy`) 매칭 케이스 추가.
   정책이 다시 어긋나는 배포 사고가 나도 "네트워크 문제"라는 오해의 소지가 있는 문구 대신
   더 정확한 안내를 보여준다. (A가 적용되면 평상시엔 안 뜨는 방어선.)
2. `joinPod()` 성공 후 홈 화면 status card가 새로 참가한 팟을 반영하도록 보장.
   현재도 `STATE.myPodId`/`STATE.committed`는 갱신되지만, 참가 직후 화면 흐름은
   `renderPodChat` → `screen-pod-chat`으로 바로 넘어가 홈을 다시 그리지 않는다.
   채팅방에서 뒤로가기로 홈에 돌아왔을 때 status card가 새 팟 기준으로 뜨는지 확인하고,
   `renderHome()`이 `STATE.myPodId` 기준으로 다시 그려지도록 보장한다(별도 홈 이동 트리거는
   추가하지 않음 — PRD 10번 "참가 누르면 바로 채팅방으로 이동" 유지).

## C. 글로벌 로고 → 홈

`.brand-mark`가 있는 화면은 현재 `screen-home`, `screen-ob-profile` 두 곳뿐. 뒤로가기(`data-back`)
체계는 이미 전 화면에 통일된 한 개의 이벤트 위임 루프로 처리되고 있어 추가 작업 불필요.

- `.brand-mark`에 클릭 핸들러 추가: `STATE.user`가 있으면 `showScreen('screen-home')`,
  없으면 무시(온보딩 완료 전엔 갈 홈이 없음).
- 커서 포인터 스타일 등 클릭 가능함을 시각적으로 표시.

## D. 온보딩 스킵 + 설정 화면

**스킵 로직**: 페이지 로드 시 `localStorage`에 완료된 온보딩 값(닉네임/성별/출발지/목적지/시간/인원)이
있으면 스플래시 애니메이션과 온보딩 두 화면을 건너뛰고, 기존 `btn-find-pod` 핸들러가 하던
"홈 진입 로직"(`upsertProfile` → `loadOpenPods` → 내 팟 판별 → 없으면 `createOwnPod`)을 그대로
재사용해 바로 `screen-home`으로 진입한다. 온보딩 제출 시 이 값들을 `localStorage`에 저장하는
코드를 추가해야 한다(현재는 `getOrCreateUserId()`로 uuid만 저장하고 있음).

**설정 화면**: 홈 상단바에 설정 아이콘 추가 → `screen-settings` 신설.
- `ob-route`(출발지/목적지/시간/인원) 폼 마크업/로직 재사용, 현재 값으로 프리필.
- 저장 시 기존 "내가 팟장이고 혼자뿐이면 팟 값 갱신, 이미 참가자가 있으면 에러 안내"
  로직(현재 `btn-find-pod` 핸들러 안에 있음) 그대로 재사용.
- 닉네임/성별은 이번 범위 아님.
- 뒤로가기: 설정 → 홈.

## E. 온보딩 성별 기본값 제거

현재 `여성` 버튼에 `class="choice is-on"`, `aria-checked="true"`가 마크업에 고정으로 박혀있어
사용자가 아무것도 안 눌러도 여성으로 선택된 것처럼 보이고 실제로 그렇게 제출된다.
- 두 버튼 모두 초기 미선택 상태로 변경.
- `다음` 버튼은 닉네임 입력 + 성별 명시적 선택 두 조건 모두 충족해야 활성화(현재 로직에서
  성별은 이미 선택된 것으로 카운트되고 있어 닉네임만 채우면 넘어가짐 — 이 부분도 같이 고침).

## F. 4번 — 하차지점/도보 안내 (신규 구현 아님)

이미 구현되어 있음: `recommendDropOff()`가 팟장 경로 위 후보 중 도보 최단 지점 추천,
`renderPodDetail()`이 지도(팟경로 실선/도보 점선/하차지점 마커) + "택시 OO 하차 · 도보 N분·Mm"
+ "여기서 내리면 목적지까지 도보 N분이에요" 문구 + 카카오맵 딥링크 2종을 표시.
`renderPodChat()`도 참여자별 하차지점을 `chat-participants`에 표시.
구현 검토 후 사용자에게 동작 방식을 설명하는 것으로 마무리 — 코드 변경 없음.

## 테스트/검증

- `runSelfCheck()` 콘솔 자가진단 통과 확인(변경 후에도 유지).
- A 적용 후 라이브 사이트에서 실제 두 브라우저(또는 시크릿창)로 팟장 1명 + 참가자 1명 시나리오
  재현: 참가자가 다른 팟에 참가 시 자신의 팟이 자동 해체되고 정상적으로 새 팟 채팅방으로 이동하는지.
- 온보딩 성별 미선택 상태에서 `다음` 버튼 비활성 확인.
- 재접속(새로고침) 시 온보딩 없이 바로 홈 진입 확인, 설정에서 값 변경 후 팟 갱신 확인.
- 모바일 뷰포트(375px)에서 로고 클릭, 설정 화면 레이아웃 확인.
