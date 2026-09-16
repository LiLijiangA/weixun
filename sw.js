// ===== 微讯 Service Worker：离线缓存 + 后台推送 =====
// 功能：
//  1. 离线缓存（网络优先 + 超时兜底）——保证安装为 App 后能离线打开、秒开
//  2. periodicsync 后台推送——页面全关后，浏览器按系统策略定期唤醒本 SW，
//     读取页面端写入的快照，弹系统通知（省电，不依赖页面常开）
//  3. notificationclick——点击通知聚焦/打开微讯页面

const CACHE = 'weixun-v1';
const PRECACHE = [
  './index.html',
  './manifest.json',
  './icon.svg'
];
const NETWORK_TIMEOUT = 3500; // 小资源网络等待上限
const INDEX_NETWORK_TIMEOUT = 30000; // 主 HTML 大文件，给长超时

// periodicsync 相关键名（与页面端约定一致）
const PSYNC_TAG = 'weixun-psync';
const PSYNC_SNAP_KEY = 'weixun-psync-snap';
const PSYNC_QUEUE_KEY = 'weixun-psync-queue';
const PSYNC_SNAP_TTL = 6 * 60 * 60 * 1000; // 快照 6 小时内有效

// 带超时的 fetch
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('net-timeout')), ms);
    fetch(req).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

// ---------- IDB 读写（SW 内） ----------
function psyncOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('weixun-psync', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function psyncIdbGet(key) {
  return psyncOpenDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
function psyncIdbSet(key, val) {
  return psyncOpenDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  }));
}

// ---------- 安装：预缓存 ----------
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(PRECACHE.map((url) =>
        fetchWithTimeout(url, url.indexOf('index.html') >= 0 ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)
          .then((res) => { if (res && res.ok) return c.put(url, res); })
      ))
    ).catch(() => {})
  );
});

// ---------- 激活：清旧缓存 ----------
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ---------- 请求拦截：网络优先 + 超时回退缓存 ----------
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  // 只处理同源请求
  if (!url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetchWithTimeout(req, url.indexOf('index.html') >= 0 ? INDEX_NETWORK_TIMEOUT : NETWORK_TIMEOUT)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('./index.html'))
      )
  );
});

// ---------- periodicsync：后台推送 ----------
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== PSYNC_TAG) return;
  e.waitUntil((async () => {
    const snap = await psyncIdbGet(PSYNC_SNAP_KEY);
    if (!snap || !Array.isArray(snap.texts) || !snap.texts.length) return;
    if (!snap.ts || Date.now() - snap.ts > PSYNC_SNAP_TTL) return;
    const pick = snap.texts[Math.floor(Math.random() * snap.texts.length)];
    const text = pick && pick.t ? String(pick.t) : '';
    if (!text) return;
    let arr = [];
    try { const q = await psyncIdbGet(PSYNC_QUEUE_KEY); if (Array.isArray(q)) arr = q; } catch (e2) {}
    arr.push({ t: text, ts: Date.now() });
    while (arr.length > 20) arr.shift();
    await psyncIdbSet(PSYNC_QUEUE_KEY, arr);
    await self.registration.showNotification(snap.name || 'TA', {
      body: text,
      tag: PSYNC_TAG,
      renotify: true,
      icon: './icon.svg',
      badge: './icon.svg'
    });
  })().catch(() => {}));
});

// ---------- 点击通知：聚焦/打开页面 ----------
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (cs.length) {
      cs[0].focus();
      try { cs[0].postMessage({ type: 'weixun-open' }); } catch (e2) {}
      return;
    }
    const win = await self.clients.openWindow('./index.html');
    if (win) win.focus();
  })());
});