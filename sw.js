/* ══════════════════════════════════════════════════════════════════════
   APPACHI — Service Worker
   Handles: offline cache, push notifications, notification clicks
══════════════════════════════════════════════════════════════════════ */

const CACHE   = 'aj-stocks-v1';
const PRECACHE = [
  '/',
  '/entry.html',
  '/auto-assign.html',
  '/dashboard.html',
  '/sql-editor.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
  '/icons/badge-72.png',
];

// ── Install: pre-cache shell ───────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches, claim clients ──────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fall back to cache ───────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Skip API calls — always go to network
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache fresh responses for next offline use
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push: show notification ────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let payload = {
    title: '✦ APPACHI',
    body:  'You have a new notification.',
    url:   '/',
    tag:   'aj-stocks',
  };

  try {
    if (e.data) Object.assign(payload, e.data.json());
  } catch (_) {}

  const options = {
    body:             payload.body,
    icon:             '/icons/icon-192.png',
    badge:            '/icons/badge-72.png',
    tag:              payload.tag || 'aj-stocks',
    renotify:         true,
    requireInteraction: false,
    vibrate:          [100, 50, 100, 50, 200],
    data:             { url: payload.url || '/' },
    // Action buttons (Android Chrome)
    actions: [
      { action: 'open',   title: '📋 Open App' },
      { action: 'dismiss',title: '✕ Dismiss'   },
    ],
  };

  e.waitUntil(self.registration.showNotification(payload.title, options));
});

// ── Notification click: open/focus the app ────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  const targetUrl = e.notification.data?.url || '/';

  e.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Focus an already-open tab
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // No open tab — open a new one
        return self.clients.openWindow(targetUrl);
      })
  );
});
