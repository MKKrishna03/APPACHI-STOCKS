/* app-native.js — phone-app helpers (does nothing in a normal browser).
   window.AJ:
     AJ.isApp                      true inside the installed app
     AJ.shareFile(blob, name)      share / save a file (WhatsApp, Files, Drive…)
     AJ.shareText(text, url)       share a message or link
     AJ.scan()                     camera barcode / QR scan → Promise<text | null>
     AJ.refreshWidget()            redraw the home-screen widget
     AJ.fingerprint.{available, enabled, setEnabled(on)}
   Also, in the app:
     • any <a download> (e.g. Download JPG / PDF / Excel) opens the share sheet,
       because the app's web view can't save downloads itself
     • fingerprint lock when the app opens (if turned on in Settings)
     • "new app version" banner when /api/app-version says there is one */
(function () {
  'use strict';
  if (window.AJ) return;
  const isApp = !!window.Capacitor?.isNativePlatform?.();
  const P = () => window.Capacitor?.Plugins || {};
  const AJ = window.AJ = { isApp };
  if (!isApp) {
    // browser fallbacks so pages can call AJ.* without checking
    AJ.shareFile = async (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
    AJ.shareText = async (text, url) => { if (navigator.share) return navigator.share({ text, url }); await navigator.clipboard?.writeText([text, url].filter(Boolean).join(' ')); };
    AJ.scan = async () => null;
    AJ.refreshWidget = () => {};
    AJ.fingerprint = { available: async () => false, enabled: () => false, setEnabled: async () => false };
    return;
  }

  // ── Share / save files ──────────────────────────────────────────────────
  const toBase64 = (blob) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = bad; r.readAsDataURL(blob); });
  const safeName = (n) => String(n || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'file';
  AJ.shareFile = async (blob, name) => {
    const { Filesystem, Share } = P();
    if (!Filesystem || !Share) throw new Error('Sharing needs the latest app version.');
    const w = await Filesystem.writeFile({ path: safeName(name), data: await toBase64(blob), directory: 'CACHE' });
    try { await Share.share({ title: name, files: [w.uri], dialogTitle: 'Share or save' }); }
    catch (e) { if (!/cancel/i.test(e?.message || '')) throw e; }
  };
  AJ.shareText = async (text, url) => { const { Share } = P(); if (Share) await Share.share({ text, url }); };

  // <a download> → share sheet (also catches the a.click() that pages use to save a Blob)
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[download]');
    if (!a || !a.href) return;
    e.preventDefault(); e.stopPropagation();
    try {
      const name = a.getAttribute('download') || decodeURIComponent(a.href.split('/').pop().split('?')[0]) || 'file';
      const res = await fetch(a.href, { credentials: 'include' });
      if (!res.ok) throw new Error('Download failed (' + res.status + ')');
      await AJ.shareFile(await res.blob(), name);
    } catch (err) { alert(err.message || String(err)); }
  }, true);

  // ── Barcode / QR scanner ────────────────────────────────────────────────
  AJ.scan = async () => {
    const B = P().BarcodeScanner;
    if (!B) { alert('The scanner needs the latest app version.'); return null; }
    try {
      const m = await B.isGoogleBarcodeScannerModuleAvailable?.();
      if (m && !m.available) { await B.installGoogleBarcodeScannerModule(); alert('The scanner is being set up — try again in a few seconds.'); return null; }
      const r = await B.scan();
      return r?.barcodes?.[0]?.rawValue || r?.barcodes?.[0]?.displayValue || null;
    } catch (e) { if (!/cancel/i.test(e?.message || '')) alert(e.message || String(e)); return null; }
  };

  AJ.refreshWidget = () => { try { P().HomeWidget?.refresh?.(); } catch {} };
  // Give the home-screen widget its own key (it can't use this web view's login)
  (async () => {
    if (/\/(login|signup|reset)\.html$/.test(location.pathname) || !P().HomeWidget?.setToken) return;
    try {
      const r = await fetch('/api/widget/token', { method: 'POST', credentials: 'include' });
      if (!r.ok) return;
      const { token } = await r.json();
      if (token) await P().HomeWidget.setToken({ token, base: location.origin });
    } catch {}
  })();

  // ── Fingerprint lock ────────────────────────────────────────────────────
  const BIO_KEY = 'aj_fingerprint', UNLOCK_KEY = 'aj_unlocked_at', AWAY_MS = 5 * 60 * 1000;
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  // Unlock is remembered across page loads (an offline blip, a reload or a jump to the login page
  // must not ask for the finger again). The app locks only after 5+ minutes not in use.
  const SEEN_KEY = 'aj_seen_at';
  const seen = () => ls.set(SEEN_KEY, String(Date.now()));
  const isUnlocked = () => {
    const u = Number(ls.get(UNLOCK_KEY) || 0), s = Number(ls.get(SEEN_KEY) || 0);
    return u > 0 && Date.now() - Math.max(u, s) < AWAY_MS;
  };
  const ss = ls;
  const bio = () => P().BiometricAuthNative;
  AJ.fingerprint = {
    available: async () => { try { return !!(await bio()?.checkBiometry())?.isAvailable; } catch { return false; } },
    enabled: () => ls.get(BIO_KEY) === '1',
    setEnabled: async (on) => {
      if (on) {
        if (!(await AJ.fingerprint.available())) { alert('No fingerprint is set up on this phone. Add one in the phone Settings first.'); return false; }
        try { await bio().internalAuthenticate({ reason: 'Confirm your fingerprint', cancelTitle: 'Cancel', allowDeviceCredential: true }); }
        catch { return false; }
        ls.set(BIO_KEY, '1'); ss.set(UNLOCK_KEY, String(Date.now()));
        return true;
      }
      ls.set(BIO_KEY, null);
      return true;
    },
  };
  const onLoginPage = /\/(login|signup|reset)\.html$/.test(location.pathname);
  let locking = false;
  // While the app is opening it can jump page (Stocks → Home); a fingerprint request started on a
  // page that is already gone never gets its answer. So the prompt starts only once the page has
  // settled, only one runs at a time, and it is never started while the page is leaving.
  let leaving = false;
  window.addEventListener('pagehide', () => { leaving = true; });
  window.addEventListener('beforeunload', () => { leaving = true; });
  let authing = false;
  async function lock() {
    if (locking || onLoginPage || !AJ.fingerprint.enabled() || !bio()) return;
    locking = true;
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0b0f15;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:Inter,system-ui,sans-serif;color:#e8eaed;text-align:center;padding:24px';
    ov.innerHTML = '<img src="/icons/logo.png" alt="" style="width:84px;height:84px"><div style="font:700 19px Inter,system-ui,sans-serif">APPACHI is locked</div>'
      + '<button type="button" data-a="try" style="height:48px;padding:0 26px;border-radius:12px;border:0;background:#d4af37;color:#1a1405;font:800 16px Inter,system-ui,sans-serif">Unlock with fingerprint</button>'
      + '<div data-msg style="min-height:18px;font-size:13px;color:#ff8a80"></div>'
      + '<button type="button" data-a="pin" style="height:40px;padding:0 18px;border-radius:10px;border:1px solid #2a3340;background:transparent;color:#9aa4b2;font:600 14px Inter,system-ui,sans-serif">Sign in with PIN instead</button>';
    const add = () => document.body.appendChild(ov);
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
    const msg = (t) => { const m = ov.querySelector('[data-msg]'); if (m) m.textContent = t || ''; };
    const unlock = () => { ss.set(UNLOCK_KEY, String(Date.now())); seen(); ov.remove(); locking = false; };
    let userCancelled = false, tries = 0;
    // auto = started by itself (retries quietly while the app is still opening)
    const tryIt = async (auto) => {
      if (authing || leaving || !locking) return;
      if (auto && userCancelled) return;
      authing = true; msg('');
      let retry = false;
      try {
        await bio().internalAuthenticate({ reason: 'Unlock APPACHI', cancelTitle: 'Cancel', allowDeviceCredential: true, androidConfirmationRequired: false });
        unlock();
      } catch (e) {
        const code = e?.code || '';
        if (code === 'userCancel') { userCancelled = true; msg(''); }
        else if (code === 'authenticationFailed') msg('Not recognised — try again.');
        else if (auto && tries < 4) retry = true; // Android cancelled it while the app was opening
        else msg(e?.message || 'Could not unlock — tap to try again.');
      } finally { authing = false; }
      if (retry) { tries++; setTimeout(() => tryIt(true), 1200); }
    };
    AJ._unlockNow = () => tryIt(true);
    ov.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'try') { userCancelled = false; tryIt(false); }
      else { try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch {} ls.set(BIO_KEY, null); location.replace('/login.html'); }
    });
    // start by itself once the page has settled (not on a page that is about to jump)
    const auto = () => setTimeout(() => { if (!leaving) tryIt(true); }, 600);
    if (document.readyState === 'complete') auto(); else window.addEventListener('load', auto, { once: true });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') auto(); });
  }
  if (!isUnlocked()) lock();
  // while the app is open and unlocked, keep "last used" fresh so page loads don't lock it
  const tick = () => { if (!locking && document.visibilityState === 'visible') seen(); };
  tick(); setInterval(tick, 30 * 1000);
  window.addEventListener('pagehide', () => { if (!locking) seen(); });
  // back after 5+ minutes away → lock again
  try {
    P().App?.addListener?.('appStateChange', ({ isActive }) => {
      if (!isActive) { if (!locking) seen(); return; }
      if (locking) setTimeout(() => AJ._unlockNow?.(), 400);
      else if (!isUnlocked()) lock();
      else seen();
    });
  } catch {}

  // ── New app version banner ──────────────────────────────────────────────
  (async () => {
    try {
      if (onLoginPage) return;
      const info = await P().App?.getInfo?.();
      const have = Number(info?.build || 0);
      const r = await fetch('/api/app-version', { credentials: 'include' });
      if (!r.ok) return;
      const v = await r.json();
      if (!v || !v.url || !(Number(v.code) > have)) return;
      const day = new Date().toISOString().slice(0, 10);
      if (ls.get('aj_update_hidden') === v.code + ':' + day) return;
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:10px;right:10px;bottom:10px;z-index:2147483646;background:#131922;border:1px solid #d4af37;border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:10px;font-family:Inter,system-ui,sans-serif;color:#e8eaed;box-shadow:0 10px 30px rgba(0,0,0,.5)';
      // app 1.1 has no download handler, so a download inside it does nothing — it can only be told
      const canDownload = have >= 3;
      const note = canDownload ? (v.notes || 'Tap Update to install it.') : 'Ask the office to install the new app on this phone.';
      bar.innerHTML = `<div style="flex:1;font-size:13.5px"><b style="color:#d4af37">New app version ${String(v.name || '').replace(/[<>&"]/g, '')}</b><div style="color:#9aa4b2;font-size:12px;margin-top:2px">${String(note).replace(/[<>&"]/g, '')}</div></div>`
        + (canDownload ? '<button type="button" data-a="go" style="height:40px;padding:0 16px;border-radius:10px;border:0;background:#d4af37;color:#1a1405;font:800 14px Inter,system-ui,sans-serif">Update</button>' : '')
        + '<button type="button" data-a="x" aria-label="Later" style="height:40px;width:36px;border-radius:10px;border:1px solid #2a3340;background:transparent;color:#9aa4b2;font-size:18px">×</button>';
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        if (b.dataset.a === 'go') location.href = v.url; // another site → the app hands it to the phone browser, which downloads the new app
        else { ls.set('aj_update_hidden', v.code + ':' + day); bar.remove(); }
      });
      const add = () => document.body.appendChild(bar);
      if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
    } catch {}
  })();
})();
