/* company-context.js — injected into every page by server.js */
(function () {
  'use strict';

  // ── Inject X-Company-ID header on all /api fetch calls ──
  var _fetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.startsWith('/purchase/api')) {
      var cid = localStorage.getItem('activeCompany') || '1';
      opts = Object.assign({}, opts || {}, {
        headers: Object.assign({ 'X-Company-ID': cid }, (opts && opts.headers) || {}),
      });
    }
    return _fetch(url, opts);
  };

  // ── Company colour palette ──
  var COS = {
    '1': { name: 'APPACHI JEWELLERY',      sub: 'Sole Proprietorship',  dot: '#f59e0b', badge: '#fef9ec', text: '#92400e', border: '#f6c343' },
    '2': { name: 'AJ PRIVATE LIMITED',     sub: 'Private Limited',      dot: '#10b981', badge: '#ecfdf5', text: '#065f46', border: '#6ee7b7' },
  };

  // ── Old DB (company 1 / APPACHI JEWELLERY) is restricted to specific users ──
  // Mirrors the server-side check in server.js (user_id "16" = MUTHUKUMAR, "admin" = VIMAL).
  var OLD_DB_ALLOWED_USER_IDS = ['16', 'admin'];

  function currentUserId() {
    try {
      var raw = localStorage.getItem('auth_user') || sessionStorage.getItem('auth_user');
      if (!raw) return null;
      var u = JSON.parse(raw);
      return u && (u.id || u.user_id) != null ? String(u.id || u.user_id) : null;
    } catch (e) { return null; }
  }

  function canUseOldDb() {
    var uid = currentUserId();
    return uid !== null && OLD_DB_ALLOWED_USER_IDS.indexOf(uid) !== -1;
  }

  function getActive() { return localStorage.getItem('activeCompany') || '1'; }

  // Restricted users are transparently kept on company 2 — the server would
  // reroute them anyway, but fixing it client-side avoids a stale UI state.
  if (!canUseOldDb() && getActive() === '1') {
    localStorage.setItem('activeCompany', '2');
  }

  window._setCo = function (id) {
    if (String(id) === '1' && !canUseOldDb()) return;
    localStorage.setItem('activeCompany', String(id));
    location.reload();
  };

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    var drop = document.getElementById('_co-drop');
    var btn  = document.getElementById('_co-btn');
    if (drop && !drop.contains(e.target) && btn && !btn.contains(e.target)) {
      drop.style.display = 'none';
    }
  }, true);

  function toggleDrop() {
    var drop = document.getElementById('_co-drop');
    if (drop) drop.style.display = drop.style.display === 'block' ? 'none' : 'block';
  }

  function buildSwitcher() {
    var active = getActive();
    var co     = COS[active];
    var allowOld = canUseOldDb();

    var sidebar = document.querySelector('.sidebar');

    if (sidebar) {
      // ── Sidebar variant (dark background) ──
      var existing = document.getElementById('_co-sw');
      if (existing) existing.remove();

      var wrap = document.createElement('div');
      wrap.id = '_co-sw';
      wrap.style.cssText = [
        'padding:10px 12px 14px',
        'border-top:1px solid rgba(255,255,255,0.08)',
        'margin-top:auto',
        'position:relative',
        'flex-shrink:0',
      ].join(';');

      wrap.innerHTML =
        '<button id="_co-btn" onclick="_coDrop()" style="' +
          'width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.13);' +
          'border-radius:8px;padding:8px 10px;cursor:pointer;text-align:left;color:#fff;' +
          'font-family:inherit;">' +
          '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;' +
               'color:rgba(255,255,255,.42);margin-bottom:3px;">Active Company</div>' +
          '<div style="display:flex;align-items:center;gap:7px;">' +
            '<span style="width:7px;height:7px;border-radius:50%;background:' + co.dot + ';' +
                   'flex-shrink:0;box-shadow:0 0 6px ' + co.dot + ';"></span>' +
            '<span style="font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;' +
                   'text-overflow:ellipsis;">' + co.name + '</span>' +
            '<span style="margin-left:auto;font-size:10px;color:rgba(255,255,255,.35);">▾</span>' +
          '</div>' +
        '</button>' +
        '<div id="_co-drop" style="display:none;position:absolute;bottom:calc(100% + 4px);' +
             'left:8px;right:8px;background:#1a2b1e;border:1px solid rgba(255,255,255,.13);' +
             'border-radius:10px;overflow:hidden;z-index:9999;box-shadow:0 4px 24px rgba(0,0,0,.55);">' +
          (allowOld ? _coItem('1', active) : '') + _coItem('2', active) +
        '</div>';

      sidebar.appendChild(wrap);

    } else {
      // ── Floating pill variant (light pages: login, mobile-upload) ──
      var existing2 = document.getElementById('_co-sw');
      if (existing2) existing2.remove();

      var wrap2 = document.createElement('div');
      wrap2.id = '_co-sw';
      wrap2.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:9999;font-family:inherit;';
      wrap2.innerHTML =
        '<button id="_co-btn" onclick="_coDrop()" style="' +
          'background:' + co.badge + ';border:1px solid ' + co.border + ';border-radius:99px;' +
          'padding:6px 14px 6px 10px;cursor:pointer;display:flex;align-items:center;gap:7px;' +
          'box-shadow:0 2px 10px rgba(0,0,0,.12);font-family:inherit;">' +
          '<span style="width:7px;height:7px;border-radius:50%;background:' + co.dot + ';flex-shrink:0;"></span>' +
          '<span style="font-size:11px;font-weight:700;color:' + co.text + ';">' + co.name + ' ▾</span>' +
        '</button>' +
        '<div id="_co-drop" style="display:none;position:absolute;bottom:calc(100% + 6px);' +
             'left:0;min-width:250px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;' +
             'overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.15);">' +
          (allowOld ? _coItemLight('1', active) : '') + _coItemLight('2', active) +
        '</div>';

      document.body.appendChild(wrap2);
    }
  }

  // Build one option row for the dark-sidebar dropdown
  function _coItem(id, active) {
    var co    = COS[id];
    var isSel = id === active;
    return '<div onclick="window._setCo(\'' + id + '\')" style="' +
      'padding:10px 13px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.07);' +
      'background:' + (isSel ? 'rgba(255,255,255,0.07)' : 'transparent') + ';' +
      '">' +
      '<div style="display:flex;align-items:center;gap:7px;">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + co.dot + ';flex-shrink:0;"></span>' +
        '<span style="font-size:11px;font-weight:700;color:#fff;">' + co.name + '</span>' +
        (isSel ? '<span style="margin-left:auto;font-size:10px;color:rgba(255,255,255,.4);">✓</span>' : '') +
      '</div>' +
      '<div style="font-size:10px;color:rgba(255,255,255,.38);margin-top:2px;padding-left:14px;">' + co.sub + '</div>' +
    '</div>';
  }

  // Build one option row for the light floating dropdown
  function _coItemLight(id, active) {
    var co    = COS[id];
    var isSel = id === active;
    return '<div onclick="window._setCo(\'' + id + '\')" style="' +
      'padding:11px 15px;cursor:pointer;border-bottom:1px solid #f0f0f0;' +
      'background:' + (isSel ? co.badge : '#fff') + ';' +
      '">' +
      '<div style="display:flex;align-items:center;gap:7px;">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + co.dot + ';flex-shrink:0;"></span>' +
        '<span style="font-size:12px;font-weight:700;color:' + co.text + ';">' + co.name + '</span>' +
        (isSel ? '<span style="margin-left:auto;color:' + co.dot + ';font-size:11px;">✓</span>' : '') +
      '</div>' +
      '<div style="font-size:11px;color:#888;margin-top:2px;padding-left:14px;">' + co.sub + '</div>' +
    '</div>';
  }

  window._coDrop = toggleDrop;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSwitcher);
  } else {
    buildSwitcher();
  }
})();
