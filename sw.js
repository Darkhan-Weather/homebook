/* HomeBook — Service Worker
   Зорилго: апп офлайн ажиллах, CDN-ээс татдаг icon/xlsx-г кэшлэх.
   Кэшийн хувилбар: index.html шинэчлэх бүрд VERSION-ыг нэмэгдүүлнэ. */
const VERSION = 'v10';
const CACHE   = 'homebook-' + VERSION;

/* Заавал кэшлэх — апп-ийн үндсэн бүрэлдэхүүн */
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './HomeBook%20Logo.jpg',
  './Background.jpg',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

/* Хэзээ ч кэшлэхгүй — нэвтрэлт, өгөгдлийн API */
function isNetworkOnly(url) {
  return url.hostname === 'accounts.google.com'
      || url.hostname.endsWith('googleapis.com')
      || url.hostname.endsWith('google.com');
}

/* Ажиллах үед кэшлэх — CDN-ийн фонт зэрэг */
function isRuntimeCacheable(url) {
  return url.hostname === 'cdn.jsdelivr.net';
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Нэг файл алдаа өгвөл бусад нь кэшлэгдэхгүй болохоос сэргийлж тус тусад нь
    await Promise.all(CORE.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[SW] кэшлэж чадсангүй:', url); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (isNetworkOnly(url)) return;   // нэвтрэлт/API — SW оролцохгүй

  /* Хуудас ачаалах: сүлжээ эхэлж (шинэчлэлт авахын тулд),
     амжилтгүй бол кэшнээс */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html');
        return cached || new Response('Офлайн байна', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  /* Бусад нөөц: кэш эхэлж (хурдан), зэрэгцээд шинэчилнэ */
  if (url.origin === self.location.origin || isRuntimeCacheable(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const network = fetch(req).then(res => {
        if (res && res.status === 200) {
          caches.open(CACHE).then(c => c.put(req, res.clone()));
        }
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('', { status: 504 });
    })());
  }
});

/* Апп-аас шинэчлэлт хүсэх боломж */
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
