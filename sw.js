// ============================================================
// Sober 服装工具平台 - Service Worker
// Offline-first: cache-on-install for app shell, stale-while-revalidate for everything else.
// ============================================================

const VERSION = 'sober-v0.8.0';
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './search.js',
    './cloth.js',
    './orders.js',
    './materials.js',
    './timeline.js',
    './packing.js',
    './sizechart.js',
    './fabric.js',
    './xlssearch.js',
    './convert.js',
    './compare.js',
    './labeldiff.js',
    './manifest.json',
    './icon-192.svg',
    './icon-512.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(VERSION).then(cache => cache.addAll(APP_SHELL).catch(() => {}))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== VERSION).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

// 允许缓存的 CDN 白名单 (用于 PDF/Excel 等离线模块)
const CDN_HOSTS = [
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'unpkg.com',
];

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch { return; }

    const sameOrigin = url.origin === self.location.origin;
    const isCdn = CDN_HOSTS.includes(url.hostname);
    if (!sameOrigin && !isCdn) return;

    event.respondWith((async () => {
        const cache = await caches.open(VERSION);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req).then(resp => {
            // 'basic' = 同源；'cors' = 跨域支持 CORS；'opaque' 不能 put
            if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors')) {
                cache.put(req, resp.clone()).catch(() => {});
            }
            return resp;
        }).catch(() => cached);
        return cached || fetchPromise;
    })());
});
