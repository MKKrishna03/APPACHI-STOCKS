/* ══════════════════════════════════════════════════════════════════════
   APPACHI — Service Worker
   Handles: offline cache, push notifications, notification clicks
══════════════════════════════════════════════════════════════════════ */

const CACHE   = 'aj-stocks-v3';
const PRECACHE = [
  '/',
  '/entry.html',
  '/stock-entry.html',
  '/auto-assign.html',
  '/dashboard.html',
  '/sql-editor.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/logo.png',
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
      .catch(() => caches.match(e.request).then(hit =>
        hit || (e.request.mode === 'navigate' ? offlinePage() : Response.error())))
  );
});

// No internet and the page isn't saved: a simple page that reopens by itself
// (instead of the phone's "web page not available" screen).
function offlinePage() {
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>APPACHI</title><body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;box-sizing:border-box;text-align:center;background:#0b0f15;color:#e8eaed;font-family:Inter,system-ui,sans-serif">'
    + '<div style="font-size:42px">&#128246;</div><div style="font:700 19px Inter,system-ui,sans-serif">No internet</div>'
    + '<div style="color:#9aa4b2;font-size:14px">The page will open by itself when the internet is back.</div>'
    + '<button onclick="location.reload()" style="height:44px;padding:0 22px;border-radius:12px;border:0;background:#d4af37;color:#1a1405;font:800 15px Inter,system-ui,sans-serif">Try again</button>'
    + '<script>try{window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.SplashScreen&&Capacitor.Plugins.SplashScreen.hide()}catch(e){}addEventListener("online",function(){location.reload()})</script></body>';
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

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

  // A "reminder-cancel" push means the staff member already marked the stock
  // done (from another device/session) — close the matching pinned reminder
  // instead of showing anything new.
  if (payload.type === 'reminder-cancel') {
    e.waitUntil(
      self.registration.getNotifications({ tag: payload.tag }).then(list => list.forEach(n => n.close()))
    );
    return;
  }

  const isReminder = payload.type === 'stock-reminder';
  const options = {
    body:             payload.body,
    icon:             '/icons/icon-192.png',
    badge:            '/icons/badge-72.png',
    tag:              payload.tag || 'aj-stocks',
    renotify:         true,
    // Best-effort "pinned" behavior: requireInteraction keeps it on-screen
    // until interacted with on desktop Chrome. Mobile Chrome/Android still
    // allows swipe-dismiss regardless — that's a platform ceiling, not
    // something a web push notification can override (true non-dismissible
    // pinning only exists on the native Android app).
    requireInteraction: isReminder,
    vibrate:          [100, 50, 100, 50, 200],
    data:             { url: payload.url || '/' },
    // Action buttons (Android Chrome) — reminders skip "Dismiss" since
    // there's no supported skip action, only opening the app to mark done.
    actions: isReminder
      ? [{ action: 'open', title: '📋 Open & Mark Done' }]
      : [
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
