// PWA 설치(안드로이드 "홈 화면에 추가" 배너)를 띄우려면 fetch 핸들러 있는 서비스워커 등록이 필요하다.
// 앱이 자주 바뀌는 중이라 오프라인 캐싱은 일부러 안 한다 — 캐싱하면 배포해도 예전 화면이
// 계속 보이는 문제가 생긴다. 그냥 네트워크로 그대로 흘려보내기만 한다(설치 요건 충족용).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // 빈 핸들러라도 있어야 설치 가능 상태로 인식된다
