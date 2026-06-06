/* ══════════════════════════════════════════════════════════════════════
   pwa.js — Shared PWA client library
   • Service Worker registration
   • Push notification subscribe / unsubscribe
   • Install-to-home-screen prompt
   • Toast helper
   Include this in every page: <script src="/pwa.js" defer></script>
══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  let swReg = null;
  let deferredInstall = null;

  /* ── Utility ──────────────────────────────────────────────────────── */
  function urlB64ToUint8(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(Array.from(raw, c => c.charCodeAt(0)));
  }

  /* ── Toast ────────────────────────────────────────────────────────── */
  window.pwaToast = function (msg, duration = 3200) {
    let el = document.getElementById('pwa-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pwa-toast';
      el.style.cssText = [
        'position:fixed', 'bottom:calc(24px + env(safe-area-inset-bottom,0px))',
        'left:50%', 'transform:translateX(-50%)',
        'background:#0f2044', 'color:#d4ae56',
        'border:1.5px solid rgba(212,174,86,.5)',
        'padding:11px 22px', 'border-radius:10px',
        'font-family:"Montserrat",sans-serif',
        'font-size:13px', 'font-weight:700', 'letter-spacing:.05em',
        'z-index:99999', 'opacity:0',
        'transition:opacity .25s', 'pointer-events:none',
        'white-space:nowrap', 'max-width:90vw', 'text-align:center',
        'box-shadow:0 4px 20px rgba(0,0,0,.35)',
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, duration);
  };

  /* ── Register Service Worker ──────────────────────────────────────── */
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      window._swReg = swReg;
      return swReg;
    } catch (e) {
      console.warn('[PWA] SW registration failed:', e.message);
      return null;
    }
  }

  /* ── Get current push subscription ───────────────────────────────── */
  async function getSubscription() {
    const reg = swReg || await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  /* ── Update notification bell button state ────────────────────────── */
  window.updateNotifBtn = async function () {
    const sidebarBtn = document.getElementById('notif-btn');
    const iconBtns   = ['notif-btn-desktop', 'notif-btn-mobile']
      .map(id => document.getElementById(id)).filter(Boolean);
    const allBtns = [...(sidebarBtn ? [sidebarBtn] : []), ...iconBtns];
    if (!allBtns.length) return;

    // Web push is browser-only; hide bell in Capacitor native app
    if (window.Capacitor?.isNativePlatform?.()) {
      allBtns.forEach(b => { b.style.display = 'none'; });
      return;
    }

    if (!('Notification' in window) || !('PushManager' in window)) {
      allBtns.forEach(b => { b.style.display = 'none'; });
      return;
    }

    const perm = Notification.permission;
    const sub  = await getSubscription().catch(() => null);

    if (perm === 'denied') {
      if (sidebarBtn) sidebarBtn.textContent = '🔕';
      allBtns.forEach(b => { b.title = 'Notifications blocked — enable in browser/device settings'; b.classList.remove('notif-on'); b.style.opacity = '0.5'; });
    } else if (perm === 'granted' && sub) {
      if (sidebarBtn) sidebarBtn.textContent = '🔔';
      allBtns.forEach(b => { b.title = 'Notifications ON — tap to disable'; b.classList.add('notif-on'); b.style.opacity = '1'; });
    } else {
      if (sidebarBtn) sidebarBtn.textContent = '🔔';
      allBtns.forEach(b => { b.title = 'Enable notifications'; b.classList.remove('notif-on'); b.style.opacity = '0.6'; });
    }
  };

  /* ── Toggle notifications ─────────────────────────────────────────── */
  window.toggleNotifications = async function () {
    if (window.Capacitor?.isNativePlatform?.()) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      pwaToast('Push notifications are not supported on this browser/device.');
      return;
    }

    if (Notification.permission === 'denied') {
      pwaToast('Notifications blocked. Enable them in your device settings.');
      return;
    }

    try {
      const reg = swReg || await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        /* ── Unsubscribe ── */
        await sub.unsubscribe();
        await fetch('/api/push/unsubscribe', {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ endpoint: sub.endpoint }),
        });
        pwaToast('🔕 Notifications disabled');

      } else {
        /* ── Subscribe ── */
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          pwaToast('Permission denied — cannot enable notifications');
          await window.updateNotifBtn();
          return;
        }

        const { publicKey } = await fetch('/api/push/public-key').then(r => r.json());
        const newSub = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlB64ToUint8(publicKey),
        });

        await fetch('/api/push/subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(newSub.toJSON()),
        });
        pwaToast('🔔 Notifications enabled!');
      }
    } catch (e) {
      console.error('[PWA] Notification toggle error:', e);
      pwaToast('Error: ' + (e.message || 'unknown'));
    }

    await window.updateNotifBtn();
  };

  /* ── Install prompt (Add to Home Screen) ──────────────────────────── */
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'flex';
  });

  window.installApp = async function () {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    deferredInstall = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
    if (outcome === 'accepted') pwaToast('✅ App installed!');
  };

  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
  });

  /* ── Auto-subscribe (runs on every authenticated page load) ─────── */
  async function autoSubscribe() {
    if (!('PushManager' in window)) return;
    if (window.location.pathname === '/login.html') return;

    // If permission not yet decided, try asking silently (works in Capacitor WebView
    // and some browsers; harmlessly ignored when user-gesture is required)
    if (Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch {}
    }

    if (Notification.permission !== 'granted') return;

    try {
      const reg = swReg || await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await fetch('/api/push/public-key').then(r => r.json());
        if (!publicKey) return;
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(publicKey),
        });
      }
      // Always POST so server records the correct emp_alias for this session
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    } catch (e) {
      console.warn('[PWA] Auto-subscribe failed:', e.message);
    }
    await window.updateNotifBtn();
  }

  /* ── Init ─────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    await registerSW();
    await window.updateNotifBtn();
    await autoSubscribe();
  });

})();
