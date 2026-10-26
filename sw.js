const CACHE_NAME = "asakusa-line-shell-v16";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./stations.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ODPT APIへのリクエストはキャッシュせず、常にネットワークから取得する
  // (列車位置・運行情報はリアルタイム性が必須のため)
  if (url.hostname.includes("api.odpt.org")) {
    return;
  }

  // アプリシェル(静的ファイル)はキャッシュ優先
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
