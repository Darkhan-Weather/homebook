/* ═══════════════════════════════════════════════════════════════
   HomeBook — Service Worker
   ───────────────────────────────────────────────────────────────
   Кэшийн стратеги:
   · Апп өөрөө (index.html)  → network-first  (шинэчлэлт шууд ирнэ,
                                                офлайн үед кэшээс)
   · CDN (icons, xlsx)       → cache-first    (офлайн үед ажиллана)
   · Google API / auth       → кэшлэхгүй      (токен, өгөгдөл хэзээ ч
                                                кэшэнд орох ёсгүй)

   ⚠ ЧУХАЛ: index.html-г өөрчлөх бүрдээ доорх VERSION-г ӨСГӨНӨ.
   Эс бөгөөс хэрэглэгч хуучин хувилбарт гацна.
   ═══════════════════════════════════════════════════════════════ */

const VERSION = 'v1.5.0';
const SHELL_CACHE  = 'hb-shell-'  + VERSION;
const ASSET_CACHE  = 'hb-assets-' + VERSION;

/* Апп ажиллахад зайлшгүй хэрэгтэй өөрийн файлууд */
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

/* Гадаад CDN — офлайн үед icon болон Excel экспорт ажиллахын тулд */
const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.11.0/dist/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

/* Кэшлэхгүй домэйнууд — Google-ийн бүх дуудлага сүлжээгээр шууд явна */
const NEVER_CACHE = /(^|\.)(googleapis\.com|google\.com|gstatic\.com|googleusercontent\.com)$/;

/* ─── Суулгах ─────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL_FILES);

    // CDN нь унтарсан байж болзошгүй тул алдаа гарвал суулгалтыг зогсоохгүй
    const assets = await caches.open(ASSET_CACHE);
    await Promise.allSettled(
      CDN_FILES.map(url => assets.add(new Request(url, { mode: 'cors' })))
    );
  })());
  // Шинэ SW-г хүлээлгэлгүй идэвхжүүлэхгүй — хэрэглэгч өөрөө шийднэ
  // (index.html доторх SKIP_WAITING мессежээр идэвхжинэ)
});

/* ─── Идэвхжих — хуучин кэшийг цэвэрлэх ──────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('hb-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map(k => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

/* ─── index.html-аас ирэх мессеж ──────────────────────────── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') {
    event.source && event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

/* ─── Стратегиуд ──────────────────────────────────────────── */
async function networkFirst(request, preload) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = (preload && await preload) || await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Навигаци бол апп-ийн үндсэн хуудсыг буцаана
    const shell = await cache.match('./index.html');
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  // opaque (no-cors) хариуг ч хадгална — фонт ихэвчлэн ийм байдаг
  if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(request, fresh.clone());
  return fresh;
}

/* ─── Fetch ───────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Зөвхөн GET — POST/PATCH (Drive хадгалалт) хөндөхгүй
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // chrome-extension:// гэх мэт схемүүдийг алгасна
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') return;

  // Google-ийн юуг ч кэшлэхгүй — токен, хэрэглэгчийн өгөгдөл
  if (NEVER_CACHE.test(url.hostname)) return;

  // Range хүсэлт (видео/аудио) — хөндөхгүй
  if (req.headers.has('range')) return;

  // Хуудас нээх
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, event.preloadResponse));
    return;
  }

  // CDN — офлайн ажиллахын тулд кэшээс түрүүлж
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Өөрийн файлууд
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  }
});
