const CACHE_NAME = "ledger-pwa-v2";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll([OFFLINE_URL]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API 一律走网络，避免缓存导致“列表不更新”
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // 对页面导航使用“网络优先”，离线时回退到离线页
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          return response;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(OFFLINE_URL);
          return cached || new Response("离线", { status: 503 });
        }
      })()
    );
    return;
  }

  // 静态资源：缓存优先 + 后台刷新（避免影响数据接口）
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);

      const fetchPromise = (async () => {
        try {
          const response = await fetch(request);
          // 避免缓存非常规响应
          if (response && response.ok) {
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          return cached;
        }
      })();

      return cached || fetchPromise;
    })()
  );
});

