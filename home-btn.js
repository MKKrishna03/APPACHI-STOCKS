// home-btn.js — "Back to Home" on every page, for owners on the desktop web.
// Home (home.html) shows each person only their own pages; the app skips it.
// Fits into whatever the page already has: the Stocks sidebar (nav.js), the Sales
// sidebar, or the top bar of the Reorder / Restocking pages; otherwise a small pill.
(function () {
  'use strict';
  if (window.__ajHomeBtn) return;
  window.__ajHomeBtn = true;
  if (window.Capacitor?.isNativePlatform?.()) return;
  if (/\/(login|signup|reset|home)\.html$/i.test(location.pathname) || /^\/payroll\//.test(location.pathname)) return;

  const ICON = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>';

  function place() {
    if (document.querySelector('.aj-home')) return true;
    // 1) Stocks pages: sidebar built by nav.js
    const side = document.getElementById('sidebar-mount');
    const brand = side && side.querySelector('.brand');
    if (brand) {
      const a = document.createElement('a');
      a.href = '/home.html'; a.className = 'nav-item aj-home';
      a.innerHTML = ICON + '<span>Back to Home</span>';
      a.style.cssText = 'color:var(--accent,#d4af37);font-weight:700;margin-bottom:6px';
      brand.after(a);
      return true;
    }
    // 2) Sales pages: their own sidebar
    const nav = document.querySelector('aside nav.nav');
    if (nav) {
      const a = document.createElement('a');
      a.href = '/home.html'; a.className = 'nav-item aj-home';
      a.innerHTML = ICON.replace(/16/g, '18') + 'Back to Home';
      a.style.cssText = 'color:#d4af37;font-weight:700';
      nav.prepend(a);
      return true;
    }
    // 3) Reorder / Restocking pages: top bar, next to the theme button
    const theme = document.querySelector('.topbar .theme-btn');
    if (theme) {
      if (!document.getElementById('ajTbCss')) {
        const st = document.createElement('style'); st.id = 'ajTbCss';
        st.textContent =
          '.aj-tb{display:inline-flex;align-items:center;gap:8px;margin-left:auto;margin-right:10px}' +
          '.aj-tb a{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:8px;' +
          'border:1px solid var(--border,var(--line-strong,#2a3340));background:var(--panel,var(--surface-2,transparent));' +
          'color:var(--text,#e8eaed);font:600 13px Inter,system-ui,sans-serif;text-decoration:none;white-space:nowrap;transition:all .15s}' +
          '.aj-tb a:hover{border-color:var(--accent,var(--gold,#d4af37));color:var(--accent,var(--gold,#d4af37))}' +
          '.aj-tb a.aj-home{border-color:var(--accent,var(--gold,#d4af37));color:var(--accent,var(--gold,#d4af37));font-weight:700}' +
          '@media (max-width:600px){.aj-tb a span{display:none}.aj-tb a{padding:0 10px}}';
        document.head.appendChild(st);
      }
      const wrap = document.createElement('div');
      wrap.className = 'aj-tb';
      wrap.innerHTML =
        '<a href="/" title="Dashboard"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">' +
        '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg><span>Dashboard</span></a>' +
        '<a href="/home.html" class="aj-home" title="Back to Home">' + ICON + '<span>Home</span></a>';
      theme.before(wrap);
      return true;
    }
    return false;
  }
  function pill() {
    if (document.querySelector('.aj-home')) return;
    const a = document.createElement('a');
    a.href = '/home.html'; a.className = 'aj-home'; a.title = 'Back to Home';
    a.innerHTML = ICON + '<span>Home</span>';
    a.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9000;display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;' +
      'border-radius:18px;background:#131922;border:1px solid #d4af37;color:#d4af37;font:700 13px Inter,system-ui,sans-serif;text-decoration:none;box-shadow:0 8px 24px -8px rgba(0,0,0,.6)';
    document.body.appendChild(a);
  }

  fetch('/api/me', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null))
    .then(me => {
      if (!me) return;
      if (place()) return;
      // nav.js may still be building the sidebar — try again shortly, then fall back to the pill
      let tries = 0;
      const t = setInterval(() => {
        if (place()) return clearInterval(t);
        if (++tries > 10) { clearInterval(t); pill(); }
      }, 200);
    })
    .catch(() => {});
})();
