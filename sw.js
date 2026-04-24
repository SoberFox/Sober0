// ============================================================
// Sober 服装工具平台 - Service Worker
// Offline-first: cache-on-install for app shell, stale-while-revalidate for everything else.
// ============================================================

const VERSION = 'sober-v0.6.0';
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

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    // 只拦截同源
    if (url.origin !== self.location.origin) return;

    event.respondWith((async () => {
        const cache = await caches.open(VERSION);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req).then(resp => {
            if (resp && resp.status === 200 && resp.type === 'basic') {
                cache.put(req, resp.clone()).catch(() => {});
            }
            return resp;
        }).catch(() => cached);
        return cached || fetchPromise;
    })());
});
