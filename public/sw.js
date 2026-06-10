// 최소 service worker - PWA 설치 가능 조건 충족용 (오프라인 캐시는 하지 않음)
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
