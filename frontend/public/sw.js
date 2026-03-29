// IkonetU Service Worker
// Strategy:
//   Static assets  → Cache-first (CSS, JS, fonts, images)
//   API calls      → Network-first with 5s timeout → cached response fallback
//   Navigation     → Network-first → /offline.html fallback
// Light mode only — no dark mode logic here either.

const CACHE_VERSION  = 'v1';
const STATIC_CACHE   = `ikonetu-static-${CACHE_VERSION}`;
const API_CACHE      = `ikonetu-api-${CACHE_VERSION}`;
const OFFLINE_URL    = '/offline.html';

const STATIC_ASSETS = [
  '/',
  '/offline.html',
  '/manifest.json',
];

// ── Install ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ──────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin && !url.pathname.startsWith('/api/')) return;

  // API calls → network-first, fall back to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithTimeout(request, 5000));
    return;
  }

  // Navigation (HTML pages) → network-first → offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets → cache-first
  event.respondWith(cacheFirst(request));
});

// ── Cache-first strategy ─────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

// ── Network-first with timeout ────────────────────────────────
async function networkFirstWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    clearTimeout(timeout);
    const cached = await caches.match(request);
    if (cached) return cached;

    // Return a JSON error for API calls when offline
    return new Response(
      JSON.stringify({ error: 'offline', message: 'No network connection. Showing cached data.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Push notifications ───────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const { title = 'IkonetU', body = '', icon = '/icons/icon-192.png', data: notifData = {} } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icons/badge-72.png',
      data: notifData,
      requireInteraction: false,
      silent: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const existing = clients.find(c => c.url.includes(self.location.origin));
        if (existing) { existing.focus(); existing.navigate(url); }
        else self.clients.openWindow(url);
      })
  );
});
