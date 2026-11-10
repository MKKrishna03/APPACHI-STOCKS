// idle.js — desktop browsers sign out after 30 minutes with no mouse / keyboard use.
// The Android app and phone browsers are left alone (the server applies the same rule,
// so a closed laptop or a sleeping tab is signed out too — this file just does it on time
// and warns a minute before).
(function () {
  'use strict';
  if (window.__ajIdle) return;
  window.__ajIdle = true;
  if (window.Capacitor?.isNativePlatform?.()) return;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return;
  if (/\/(login|signup|reset)\.html$/i.test(location.pathname)) return;

  const LIMIT = 30 * 60 * 1000, WARN = 60 * 1000, PING_EVERY = 2 * 60 * 1000, KEY = 'aj_last_activity';
  let lastPing = 0, warnEl = null, done = false;

  // Shared by every open tab, so working in one tab keeps the others signed in too
  const getLast = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
  const setLast = (t) => { try { localStorage.setItem(KEY, String(t)); } catch {} };

  function activity() {
    if (done) return;
    const now = Date.now();
    if (now - getLast() > 5000) setLast(now);
    hideWarn();
    if (now - lastPing > PING_EVERY) {
      lastPing = now;
      fetch('/api/activity', { method: 'POST', credentials: 'same-origin' })
        .then(r => { if (r.status === 401) signOut(); }).catch(() => {});
    }
  }

  async function signOut() {
    if (done) return;
    done = true;
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    location.replace('/login.html?timeout=1');
  }

  function showWarn(secs) {
    if (!warnEl) {
      warnEl = document.createElement('div');
      warnEl.setAttribute('role', 'alert');
      warnEl.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;' +
        'background:#1b2330;color:#f3f5f8;border:1px solid #d4af37;border-radius:12px;padding:14px 20px;' +
        'font:600 14px Inter,system-ui,sans-serif;box-shadow:0 18px 40px -12px rgba(0,0,0,.6);display:flex;gap:14px;align-items:center';
      warnEl.innerHTML = '<span></span><button type="button" style="height:32px;padding:0 14px;border-radius:8px;border:0;' +
        'background:#d4af37;color:#1a1405;font:700 13px Inter,system-ui,sans-serif;cursor:pointer">Stay signed in</button>';
      warnEl.querySelector('button').onclick = activity;
      document.body.appendChild(warnEl);
    }
    warnEl.firstChild.textContent = 'No activity — you will be signed out in ' + secs + ' s.';
  }
  function hideWarn() { if (warnEl) { warnEl.remove(); warnEl = null; } }

  function check() {
    if (done) return;
    const idle = Date.now() - getLast();
    if (idle >= LIMIT) return signOut();
    if (idle >= LIMIT - WARN) showWarn(Math.ceil((LIMIT - idle) / 1000));
    else hideWarn();
  }

  if (!getLast() || Date.now() - getLast() >= LIMIT) setLast(Date.now());   // opening a page counts as use
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, activity, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setInterval(check, 1000);
})();
