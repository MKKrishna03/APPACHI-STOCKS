/* app-native.js — phone-app helpers (does nothing in a normal browser).
   window.AJ:
     AJ.isApp                      true inside the installed app
     AJ.shareFile(blob, name)      share / save a file (WhatsApp, Files, Drive…)
     AJ.shareText(text, url)       share a message or link
     AJ.scan()                     camera barcode / QR scan → Promise<text | null>
     AJ.refreshWidget()            redraw the home-screen widget
   Also, in the app:
     • any <a download> (e.g. Download JPG / PDF / Excel) opens the share sheet,
       because the app's web view can't save downloads itself
     • "new app version" banner when /api/app-version says there is one */
(function () {
  'use strict';
  if (window.AJ) return;
  const isApp = !!window.Capacitor?.isNativePlatform?.();
  const P = () => window.Capacitor?.Plugins || {};
  const AJ = window.AJ = { isApp };
  // The start (splash) screen stays up until a page hides it (launchAutoHide:false).
  // Pages without push-native.js (Home, Login, Purchase Pro) must hide it too, or the app
  // sits on a blank dark screen.
  // Pages with the login check (auth.js) keep the splash until it has decided — so the
  // page never flashes before a jump to Login / Home. Others hide it once the page is in.
  if (isApp) {
    let hidden = false;
    const hideSplash = () => { if (hidden) return; hidden = true; try { P().SplashScreen?.hide?.({ fadeOutDuration: 200 }); } catch {} };
    const hasAuth = !!document.querySelector('script[src="/auth.js"]');
    if (hasAuth) {
      if (window._ajAuthDone) hideSplash();
      else window.addEventListener('aj-auth-done', hideSplash, { once: true });
      setTimeout(hideSplash, 8000); // never stuck on the splash
    } else {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideSplash, { once: true });
      else hideSplash();
      setTimeout(hideSplash, 1500);
    }
  }
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

  // ── Fingerprint lock: REMOVED (it sometimes stopped the app from opening) ──
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  ['aj_fingerprint', 'aj_unlocked_at', 'aj_seen_at', 'aj_away_at'].forEach(k => ls.set(k, null));
  AJ.fingerprint = { available: async () => false, enabled: () => false, setEnabled: async () => false };
  const onLoginPage = //(login|signup|reset).html$/.test(location.pathname);

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
