/* ═══════════════════════════════════════════════════════════════
   polish.js — Global interactive polish layer for Appachi
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── TOAST SYSTEM ──
  // Works alongside any existing showToast / showMessage on the page.
  // Other modules can call window._toast(msg, type) for a polished notification.
  function getOrCreateToastWrap() {
    let w = document.getElementById('polish-toast-wrap');
    if (!w) {
      w = document.createElement('div');
      w.id = 'polish-toast-wrap';
      document.body.appendChild(w);
    }
    return w;
  }

  window._toast = function (msg, type, duration) {
    type = type || 'default';
    duration = duration != null ? duration : 3200;
    const wrap = getOrCreateToastWrap();
    const t = document.createElement('div');
    t.className = 'polish-toast ' + type;
    t.textContent = msg;
    wrap.appendChild(t);
    // Force reflow then show
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { t.classList.add('show'); });
    });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, duration);
  };

  // ── FETCH INTERCEPTOR — attach JWT to all /api/ requests ──
  (function () {
    var _origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/purchase/api/') !== -1) {
        var token = localStorage.getItem('auth_token');
        if (token) {
          init = init || {};
          init.headers = Object.assign({}, init.headers, { Authorization: 'Bearer ' + token });
        }
      }
      return _origFetch.call(this, input, init).then(function (res) {
        if (res.status === 401 && url.indexOf('/purchase/api/') !== -1) {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth_user');
          localStorage.removeItem('auth_exp');
          localStorage.removeItem('auth_device');
          _origFetch('/purchase/api/auth/logout', { method: 'POST' }).catch(function () {});
          if (window.location.pathname !== '/purchase/login' && window.location.pathname !== '/purchase/' && window.location.pathname !== '/purchase') {
            window.location.href = '/purchase/login';
          }
        }
        return res;
      });
    };
  })();

  // ── SESSION EXPIRY WARNING ──
  function checkSessionExpiry() {
    try {
      var exp = parseInt(localStorage.getItem('auth_exp') || '0', 10);
      if (!exp) return;
      var remaining = exp - Date.now();
      var WARN_AT = 5 * 60 * 1000; // warn when < 5 min left
      if (remaining <= 0) return; // login redirect handled elsewhere
      if (remaining > WARN_AT) {
        // reschedule when we get close
        var nextCheck = Math.min(remaining - WARN_AT + 2000, 2 * 60 * 1000);
        setTimeout(checkSessionExpiry, nextCheck);
        return;
      }
      var mins = Math.ceil(remaining / 60000);
      var banner = document.getElementById('session-expiry-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'session-expiry-banner';
        document.body.prepend(banner);
      }
      banner.innerHTML =
        '⚠ Your session expires in ' + mins + ' minute' + (mins !== 1 ? 's' : '') +
        ' — save your work before it logs you out.' +
        ' <button onclick="this.parentElement.classList.remove(\'show\')">Dismiss</button>';
      banner.classList.add('show');
      // Re-check every minute to update the countdown
      setTimeout(checkSessionExpiry, 60000);
    } catch (e) {}
  }

  // ── BUTTON RIPPLE ──
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('button, .btn, .camera-btn, .upload-btn, .retake-btn, .folder-card');
    if (!btn || btn.disabled) return;
    // Skip buttons that have external badges (overflow:hidden would clip them)
    if (btn.classList.contains('bell-btn') || btn.classList.contains('logoutButton') ||
        btn.classList.contains('toggle-btn') || btn.classList.contains('lightbox-close')) return;

    // Create ripple span
    var ripple = document.createElement('span');
    ripple.className = 'ripple-wave';

    var rect = btn.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 1.6;
    var x = e.clientX - rect.left - size / 2;
    var y = e.clientY - rect.top - size / 2;

    ripple.style.cssText =
      'width:' + size + 'px;height:' + size + 'px;left:' + x + 'px;top:' + y + 'px;';

    // Ensure button has relative positioning + overflow hidden (polish.css already does this,
    // but belt-and-suspenders for elements not covered)
    var cs = getComputedStyle(btn);
    if (cs.position === 'static') btn.style.position = 'relative';
    if (cs.overflow === 'visible') btn.style.overflow = 'hidden';

    btn.appendChild(ripple);
    setTimeout(function () {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 650);
  }, true);

  // ── SCROLL-REVEAL TABLE ROWS ──
  function initScrollReveal() {
    if (!window.IntersectionObserver) return;

    var rows = document.querySelectorAll('tbody tr:not(.subtotal-row):not(.tfoot-row)');
    if (!rows.length) return;

    var delay = 0;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var row = entry.target;
        setTimeout(function () {
          row.classList.add('revealed');
        }, row._revealDelay || 0);
        observer.unobserve(row);
      });
    }, { rootMargin: '0px 0px -10px 0px', threshold: 0.05 });

    rows.forEach(function (row, i) {
      row.classList.add('reveal-row');
      row._revealDelay = Math.min(i * 18, 240);
      observer.observe(row);
    });
  }

  // ── STICKY THEAD SHADOW ──
  function initStickyTheadShadow() {
    var tables = document.querySelectorAll('table');
    tables.forEach(function (table) {
      var thead = table.querySelector('thead');
      if (!thead) return;

      // Find the scrollable ancestor
      var el = table.parentElement;
      var scroller = null;
      while (el && el !== document.body) {
        var overflow = getComputedStyle(el).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') { scroller = el; break; }
        el = el.parentElement;
      }
      var target = scroller || window;

      function onScroll() {
        var scrollTop = scroller ? scroller.scrollTop : window.scrollY;
        table.classList.toggle('thead-shadow', scrollTop > 8);
      }
      target.addEventListener('scroll', onScroll, { passive: true });
    });
  }

  // ── DIRTY FORM CHECK ──
  function initDirtyFormCheck() {
    var dirty = false;
    var watchables = document.querySelectorAll('[data-dirty-check] input, [data-dirty-check] select, [data-dirty-check] textarea');
    if (!watchables.length) return;

    watchables.forEach(function (el) {
      el.addEventListener('input', function () { dirty = true; });
      el.addEventListener('change', function () { dirty = true; });
    });

    window.addEventListener('beforeunload', function (e) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Pages call this after a successful save
    window._markFormClean = function () { dirty = false; };
  }

  // ── COUNT-UP ANIMATION ──
  // Usage: _countUp(element, targetNumber, optionalDurationMs)
  window._countUp = function (el, end, duration) {
    if (!el) return;
    duration = duration || 900;
    var start = 0;
    var startTime = null;
    var isFloat = String(end).indexOf('.') !== -1;

    function step(ts) {
      if (!startTime) startTime = ts;
      var elapsed = ts - startTime;
      var progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = start + (end - start) * eased;

      if (isFloat) {
        el.textContent = current.toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      } else {
        el.textContent = Math.round(current).toLocaleString('en-IN');
      }

      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  // ── LAST SAVED CHIP ──
  // Usage: _showLastSaved(anchorElement)  — inserts chip after anchorElement
  window._showLastSaved = function (anchor) {
    if (!anchor) return;
    // Remove any existing chip
    var prev = anchor.parentNode && anchor.parentNode.querySelector('.last-saved-chip');
    if (prev) prev.parentNode.removeChild(prev);

    var chip = document.createElement('span');
    chip.className = 'last-saved-chip';
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    chip.textContent = '✓ Saved ' + h + ':' + m;
    anchor.parentNode.insertBefore(chip, anchor.nextSibling);

    // Fade out after 8 seconds
    setTimeout(function () {
      chip.style.transition = 'opacity 0.5s ease';
      chip.style.opacity = '0';
      setTimeout(function () { if (chip.parentNode) chip.parentNode.removeChild(chip); }, 600);
    }, 8000);
  };

  // ── SEARCHABLE COMPANY SELECT ──
  // Converts <select id="companySelect"> into a type-to-filter widget.
  // Works with dynamically loaded options and programmatic .value changes.

  function injectSSStyles() {
    if (document.getElementById('ss-styles')) return;
    var s = document.createElement('style');
    s.id = 'ss-styles';
    s.textContent = [
      '.ss-wrap{position:relative;display:block;}',
      '.ss-input{width:100%;padding:9px 28px 9px 12px;',
        'border:1px solid var(--border-strong,rgba(0,0,0,.14));',
        'border-radius:var(--radius,8px);',
        'background-color:var(--surface-2,#f9f9f6);',
        'background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath fill=\'%238888aa\' d=\'M6 8L1 3h10z\'/%3E%3C/svg%3E");',
        'background-repeat:no-repeat;background-position:right 10px center;',
        'color:var(--ink,#1a1a2e);font-size:13px;font-family:inherit;',
        'cursor:pointer;box-sizing:border-box;outline:none;',
        '-webkit-appearance:none;appearance:none;',
        'transition:border-color .15s,box-shadow .15s;}',
      '.ss-input:focus,.ss-input.ss-open{',
        'border-color:var(--accent,#1d6fa4)!important;',
        'box-shadow:0 0 0 3px rgba(29,111,164,.1)!important;',
        'background-color:var(--surface,#fff);}',
      '.ss-input::placeholder{color:var(--ink-3,#8888aa);}',
      '.ss-dropdown{display:none;position:absolute;top:calc(100% + 4px);',
        'left:0;right:0;z-index:9999;background:#fff;',
        'border:1px solid rgba(0,0,0,.12);border-radius:10px;',
        'box-shadow:0 8px 24px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.06);',
        'max-height:240px;overflow-y:auto;box-sizing:border-box;}',
      '.ss-dropdown.ss-open{display:block;}',
      '.ss-dropdown::-webkit-scrollbar{width:4px;}',
      '.ss-dropdown::-webkit-scrollbar-thumb{background:#e0e0da;border-radius:2px;}',
      '.ss-item{padding:9px 12px;cursor:pointer;font-size:13px;',
        'color:var(--ink,#1a1a2e);white-space:nowrap;',
        'overflow:hidden;text-overflow:ellipsis;}',
      '.ss-item:hover,.ss-item.ss-focused{background:var(--surface-2,#f9f9f6);}',
      '.ss-item.ss-selected{color:var(--accent,#1d6fa4);font-weight:600;',
        'background:var(--accent-light,#dbeeff);}',
      '.ss-item.ss-placeholder{color:var(--ink-3,#8888aa);}',
      '.ss-item.ss-empty{color:var(--ink-3,#8888aa);font-style:italic;pointer-events:none;}',
      '.ss-item mark{background:var(--accent-light,#dbeeff);color:var(--accent,#1d6fa4);',
        'border-radius:2px;padding:0 1px;font-style:normal;}',
    ].join('');
    document.head.appendChild(s);
  }

  function initSearchableSelect(sel) {
    if (!sel || sel.dataset.ssInit) return;
    sel.dataset.ssInit = '1';
    injectSSStyles();

    var wrapper = document.createElement('div');
    wrapper.className = 'ss-wrap';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'ss-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    var dropdown = document.createElement('div');
    dropdown.className = 'ss-dropdown';

    sel.parentNode.insertBefore(wrapper, sel);
    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);
    wrapper.appendChild(sel);
    sel.style.display = 'none';

    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function updateDisplay() {
      var opts = sel.options;
      var idx = sel.selectedIndex;
      var opt = opts[idx];
      if (opt && opt.value !== '') {
        input.value = opt.text;
        input.placeholder = opts[0] ? opts[0].text : '— Choose a company —';
      } else {
        input.value = '';
        input.placeholder = (opts[0] && opts[0].text) || '— Choose a company —';
      }
    }

    function renderList(query) {
      var q = (query || '').toLowerCase().trim();
      dropdown.innerHTML = '';
      var count = 0;
      var cur = String(sel.value);
      Array.from(sel.options).forEach(function(opt) {
        if (opt.value === '') {
          if (!q) {
            var ph = document.createElement('div');
            ph.className = 'ss-item ss-placeholder';
            ph.textContent = opt.text;
            ph.dataset.value = ''; ph.dataset.text = opt.text;
            dropdown.appendChild(ph); count++;
          }
          return;
        }
        if (q && opt.text.toLowerCase().indexOf(q) === -1) return;
        var item = document.createElement('div');
        item.className = 'ss-item' + (String(opt.value) === cur ? ' ss-selected' : '');
        if (q) {
          var lo = opt.text.toLowerCase(), i = lo.indexOf(q);
          item.innerHTML = esc(opt.text.slice(0,i)) +
            '<mark>' + esc(opt.text.slice(i, i+q.length)) + '</mark>' +
            esc(opt.text.slice(i+q.length));
        } else {
          item.textContent = opt.text;
        }
        item.dataset.value = opt.value; item.dataset.text = opt.text;
        dropdown.appendChild(item); count++;
      });
      if (!count) {
        var empty = document.createElement('div');
        empty.className = 'ss-item ss-empty';
        empty.textContent = 'No match';
        dropdown.appendChild(empty);
      }
    }

    function isOpen() { return dropdown.classList.contains('ss-open'); }

    function openDropdown() {
      input.value = '';
      input.placeholder = 'Type to search…';
      input.classList.add('ss-open');
      dropdown.classList.add('ss-open');
      renderList('');
      var active = dropdown.querySelector('.ss-selected');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function closeDropdown() {
      input.classList.remove('ss-open');
      dropdown.classList.remove('ss-open');
      updateDisplay();
    }

    function choose(value, text) {
      // Update the underlying select without triggering our setter
      var opts = Array.from(sel.options);
      for (var i = 0; i < opts.length; i++) {
        if (String(opts[i].value) === String(value)) { sel.selectedIndex = i; break; }
      }
      closeDropdown();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── Input events ──
    input.addEventListener('focus', function() { if (!isOpen()) openDropdown(); });

    input.addEventListener('input', function() {
      if (!isOpen()) {
        input.classList.add('ss-open'); dropdown.classList.add('ss-open');
        input.placeholder = 'Type to search…';
      }
      renderList(this.value);
    });

    input.addEventListener('keydown', function(e) {
      if (!isOpen()) return;
      var items = Array.from(dropdown.querySelectorAll('.ss-item:not(.ss-empty)'));
      var fi = items.indexOf(dropdown.querySelector('.ss-focused'));
      if (e.key === 'Escape') { closeDropdown(); input.blur(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        var ni = fi < 0 ? 0 : Math.min(fi + 1, items.length - 1);
        items.forEach(function(x){ x.classList.remove('ss-focused'); });
        if (items[ni]) { items[ni].classList.add('ss-focused'); items[ni].scrollIntoView({ block:'nearest' }); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        var pi = Math.max(fi - 1, 0);
        items.forEach(function(x){ x.classList.remove('ss-focused'); });
        if (items[pi]) { items[pi].classList.add('ss-focused'); items[pi].scrollIntoView({ block:'nearest' }); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var focused = dropdown.querySelector('.ss-focused');
        if (focused) choose(focused.dataset.value, focused.dataset.text);
      } else if (e.key === 'Tab') { closeDropdown(); }
    });

    dropdown.addEventListener('mousedown', function(e) {
      var item = e.target.closest('.ss-item');
      if (!item || item.classList.contains('ss-empty')) return;
      e.preventDefault();
      choose(item.dataset.value, item.dataset.text);
    });

    document.addEventListener('mousedown', function(e) {
      if (isOpen() && !wrapper.contains(e.target)) closeDropdown();
    });

    // ── Watch for dynamic option loading (loadCompanies etc.) ──
    new MutationObserver(function() {
      updateDisplay();
      if (isOpen()) renderList(input.value);
    }).observe(sel, { childList: true });

    // ── Intercept programmatic .value = ... assignments ──
    var vDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      get: function() { return vDesc.get.call(this); },
      set: function(v) { vDesc.set.call(this, v); updateDisplay(); },
      configurable: true,
    });
    var iDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    Object.defineProperty(sel, 'selectedIndex', {
      get: function() { return iDesc.get.call(this); },
      set: function(v) { iDesc.set.call(this, v); updateDisplay(); },
      configurable: true,
    });

    updateDisplay();
  }

  function initSearchableSelects() {
    var ids = ['companySelect', 'companyDropdown', 'cb_company', 'companySwitcher', 'chittaiCompany', 'filterCompany'];
    ids.forEach(function(id) {
      var sel = document.getElementById(id);
      if (sel) initSearchableSelect(sel);
    });
  }

  // ── INIT ──
  function init() {
    checkSessionExpiry();
    initDirtyFormCheck();
    initSearchableSelects();
    // Defer visual inits until after the page has rendered its content
    setTimeout(function () {
      initScrollReveal();
      initStickyTheadShadow();
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
