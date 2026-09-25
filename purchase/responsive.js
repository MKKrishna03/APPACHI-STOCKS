/* responsive.js — mobile topbar + sidebar overlay for all pages */
(function () {
  var MOBILE = 768;
  function isMobile() { return window.innerWidth < MOBILE; }

  function setup() {
    /* ── Find sidebars ── */
    var dashSidebar = document.getElementById('sidebar') ||
                      document.querySelector('aside.sidebar');

    var entrySidebar = null;
    var mainEl = document.querySelector('.main-content') ||
                 document.querySelector('main.main') ||
                 document.querySelector('.main');
    if (mainEl) {
      var next = mainEl.nextElementSibling;
      if (next && next.classList.contains('sidebar')) entrySidebar = next;
    }

    var activeSidebar = dashSidebar || entrySidebar;

    /* ── Always inject mobile topbar (shows page title on all mobile screens) ── */
    var topbar = document.createElement('div');
    topbar.className = 'mobile-topbar';

    var titleDiv = document.createElement('div');
    titleDiv.className = 'mobile-topbar-title';
    titleDiv.textContent = (document.title || 'Appachi Jewellery').replace(/ [-|].*/, '');

    var menuIcon = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="5" x2="17" y2="5"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="15" x2="17" y2="15"/></svg>';
    var closeIcon = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg>';

    if (activeSidebar) {
      /* Add hamburger only when there is a sidebar to open */
      var ham = document.createElement('button');
      ham.className = 'mobile-hamburger';
      ham.setAttribute('aria-label', 'Toggle navigation');
      ham.setAttribute('type', 'button');
      ham.innerHTML = menuIcon;
      topbar.appendChild(ham);
    }

    topbar.appendChild(titleDiv);
    document.body.insertBefore(topbar, document.body.firstChild);

    if (!activeSidebar) return; /* no sidebar — topbar only, done */

    /* ── Overlay backdrop ── */
    var overlay = document.createElement('div');
    overlay.className = 'mobile-overlay';
    document.body.appendChild(overlay);

    /* ── Open / close helpers ── */
    function openSidebar() {
      activeSidebar.classList.add('mobile-open');
      overlay.classList.add('show');
      ham.innerHTML = closeIcon;
      document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
      activeSidebar.classList.remove('mobile-open');
      overlay.classList.remove('show');
      ham.innerHTML = menuIcon;
      document.body.style.overflow = '';
    }

    ham.addEventListener('click', function () {
      activeSidebar.classList.contains('mobile-open') ? closeSidebar() : openSidebar();
    });
    overlay.addEventListener('click', closeSidebar);

    /* Close when resizing to desktop */
    window.addEventListener('resize', function () {
      if (!isMobile()) closeSidebar();
    });

    /* Close when a nav link inside sidebar is tapped */
    activeSidebar.addEventListener('click', function (e) {
      if (!isMobile()) return;
      var target = e.target.closest('a, .sidebar-option, .sidebar-nav-link');
      if (target) setTimeout(closeSidebar, 120);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
