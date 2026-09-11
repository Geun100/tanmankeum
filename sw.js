// PWA 설치(안드로이드 "홈 화면에 추가" 배너)를 띄우려면 fetch 핸들러 있는 서비스워커 등록이 필요하다.
// 앱이 자주 바뀌는 중이라 오프라인 캐싱은 일부러 안 한다 — 캐싱하면 배포해도 예전 화면이
// 계속 보이는 문제가 생긴다. 그냥 네트워크로 그대로 흘려보내기만 한다(설치 요건 충족용).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // 빈 핸들러라도 있어야 설치 가능 상태로 인식된다

// 푸시 알림 수신 — api/notify-match.js, api/notify-join.js가 보내는 payload(JSON: title/body/url)를
// 그대로 알림으로 띄운다. 페이로드가 없거나 JSON이 아니면 기본 문구로 조용히 넘어간다.
self.addEventListener('push', (event) => {
  let data = { title: '탄만큼', body: '새 소식이 있어요' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) { /* JSON 아니면 기본값 유지 */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

// 알림 클릭 — 이미 열려있는 탭이 있으면 그 탭을 포커스하고 이동시킨다(새 탭을 계속 늘리지 않는다).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
