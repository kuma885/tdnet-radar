// OneSignalの実通知は別スコープのOneSignalSDKWorker.jsが処理する。
const CACHE = "tdnet-radar-v4";
const ASSETS = ["./", "./index.html", "./detail.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
const BASE = new URL("./", self.location.href);
const assetUrls = new Set(ASSETS.map(path => new URL(path, BASE).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("tdnet-radar-") && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.search = "";
  url.hash = "";
  // APIやOneSignal SDK、原文PDFはキャッシュしない。
  if (!assetUrls.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) event.waitUntil(cache.put(url.href, response.clone()));
      return response;
    } catch {
      return await cache.match(url.href) || new Response("通信できません。接続後に開き直してください。", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});

// このSWが出す端末内通知専用。閉じている場合も宛先を引き継ぐ。
self.addEventListener("notificationclick", event => {
  event.notification.close();
  let target = BASE.href;
  try {
    const url = new URL(event.notification.data?.url || "./", BASE);
    if ((url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname)) ||
        (url.protocol === "https:" && url.hostname === "www.release.tdnet.info" &&
         !url.username && !url.password && !url.port && url.pathname.startsWith("/inbs/"))) target = url.href;
  } catch { /* 不正URLはトップへ */ }
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = list.find(client => client.url === target);
    if (client) {
      try { return await client.focus(); } catch { /* 新規ウィンドウで開く */ }
    }
    return self.clients.openWindow(target);
  })());
});
