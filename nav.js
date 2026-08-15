/* ══════════════════════════════════════════════════════════════════════
   nav.js — shared app-shell sidebar
   Injects the common page-navigation sidebar into <aside id="sidebar-mount">,
   found on every authenticated page. Role-gating classes (.owner-only/
   .computer-up/.staff-only) are left in place for auth.js's existing
   querySelectorAll pass to show/hide — load this BEFORE auth.js so the
   items exist in the DOM by the time that pass runs.

   A page can splice its own extra sidebar items in (after Account, before
   the footer) by including a hidden <div id="sidebar-extra">...</div>
   anywhere in its body — its children are moved into place and the wrapper
   is discarded.
   Include on every page: <link rel="stylesheet" href="/nav.css">
                           <script src="/nav.js"></script> (before auth.js)
══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const SIDEBAR_HTML = `
    <a href="/" class="brand">
      <div class="brand-mark">S</div>
      <div class="brand-name">Stocks</div>
    </a>

    <a href="/" class="nav-item" data-path="/">
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Dashboard
    </a>

    <div class="nav-section computer-up" style="display:none">
      <div class="nav-label">Staff</div>
      <a href="/entry.html" class="nav-item" data-path="/entry.html">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Entry
      </a>
      <a href="/leaves.html" class="nav-item" data-path="/leaves.html">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/></svg>
        Leaves
      </a>
    </div>

    <div class="nav-section owner-only" style="display:none">
      <div class="nav-label">Manage</div>
      <a href="/employees.html" class="nav-item" data-path="/employees.html">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Employees
      </a>
      <a href="/stocks.html" class="nav-item" data-path="/stocks.html">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        Stocks
      </a>
      <a href="/auto-assign.html" class="nav-item" data-path="/auto-assign.html">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
        Auto-Assign
      </a>
    </div>

    <div class="nav-section owner-only" style="display:none">
      <div class="nav-label">Reports</div>
      <a href="/insights.html" class="nav-item" data-path="/insights.html">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-4"/></svg>
        Insights
      </a>
      <a href="/sql-editor.html" class="nav-item" data-path="/sql-editor.html">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        SQL Editor
      </a>
    </div>

    <div class="nav-section">
      <div class="nav-label">App</div>
      <button id="pwa-install-btn" onclick="installApp()" class="nav-item" style="display:none">&#128242; Install App</button>
    </div>

    <div class="nav-section">
      <div class="nav-label">Account</div>
      <a href="/settings.html" class="nav-item" data-path="/settings.html">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Settings
      </a>
    </div>

    <div id="sidebar-extra-mount"></div>

    <div class="sidebar-footer" id="sidebarFooter">v0.1 &middot; APPACHI</div>
  `;

  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;
  mount.innerHTML = SIDEBAR_HTML;

  // Highlight whichever nav-item matches the current page
  mount.querySelectorAll('.nav-item[data-path]').forEach(el => {
    if (el.getAttribute('data-path') === location.pathname) el.classList.add('active');
  });

  // Splice in page-specific extra items (e.g. dashboard's quick-action
  // buttons) if the page defines a #sidebar-extra block
  const extraSrc = document.getElementById('sidebar-extra');
  const extraDst = document.getElementById('sidebar-extra-mount');
  if (extraSrc && extraDst) {
    while (extraSrc.firstChild) extraDst.appendChild(extraSrc.firstChild);
    extraSrc.remove();
  }
})();
