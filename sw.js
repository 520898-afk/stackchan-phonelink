/* 只缓存本页静态文件，方便离线打开界面；不碰 WebSocket，不缓存任何 token */
const CACHE = 'phonelink-v12';
const FILES = ['./', 'index.html', 'app.js', 'mcp.js', 'notes.js', 'videos.js', 'records.js', 'homeadmin.js', 'hub.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 网络优先，失败用缓存：更新后手机能拿到新版本
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
