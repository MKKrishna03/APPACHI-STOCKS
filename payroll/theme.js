/* ═══════════════════════════════════════════════════
   APPACHI PAYROLL — Shared JS Utilities
   ═══════════════════════════════════════════════════ */

/* ── SIDEBAR RENDERER ── */
(function () {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const page = location.pathname.split('/').pop() || 'dashboard.html';

  const NAV = [
    { href: '/home.html',            icon: 'fa-arrow-left',          label: 'Back to Home', first: true },
    { href: 'dashboard.html',        icon: 'fa-house',               label: 'Dashboard' },
    { group: 'Employees' },
    { href: 'employee.html',         icon: 'fa-user-plus',           label: 'Add Employee' },
    { href: 'manage_employee.html',  icon: 'fa-users',               label: 'Manage Employees' },
    { href: '#', icon: 'fa-id-card-clip', label: 'Staff Data', action: 'openStaffDataModal' },
    { group: 'Attendance' },
    { href: 'attendance.html',       icon: 'fa-calendar-check',      label: 'Daily Attendance' },
    { href: '#', icon: 'fa-hourglass-half', label: 'Half Leaves Summary', action: 'openHalfLeaveSummaryModal' },
    { href: 'permissions.html',      icon: 'fa-user-clock',          label: 'Permissions' },
    { group: 'Advance' },
    { href: 'advance.html',          icon: 'fa-money-bill-wave',     label: 'Advance Entry' },
    { group: 'Payroll' },
    { href: 'payroll.html',          icon: 'fa-file-invoice-dollar', label: 'Generate Payroll' },
    { href: 'payslip.html',          icon: 'fa-file-lines',          label: 'Pay Slip' },
    { href: 'payroll_history.html',  icon: 'fa-clock-rotate-left',   label: 'Payroll History' },
    { href: 'leave_incentive.html',      icon: 'fa-award',               label: 'Leave Incentive' },
    { href: 'additional_incentive.html', icon: 'fa-gift',                label: 'Additional Incentive' },
    { href: 'additional_incentive_history.html', icon: 'fa-clock-rotate-left', label: 'Additional Incentive History' },
    { href: 'permission_incentive.html', icon: 'fa-user-clock',          label: 'Permission Incentive' },
    { href: 'salary_report.html',   icon: 'fa-file-invoice-dollar', label: 'Salary Report' }
  ];

  let html = `
    <div class="sidebar-brand">
      <div class="brand-icon"><i class="fa-solid fa-gem"></i></div>
      <div class="brand-text">
        <div class="brand-name">APPACHI</div>
        <div class="brand-sub">Payroll System</div>
      </div>
      <button class="sb-toggle-btn" id="sb-toggle" title="Collapse sidebar">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
    </div>
    <nav>`;

  NAV.forEach(item => {
    if (item.group) {
      html += `<div class="nav-group">${item.group}</div>`;
    } else {
      const active = item.href === page ? ' active' : '';
      const mt     = item.first ? ' style="margin-top:8px;"' : '';
      const click  = item.action ? ` onclick="event.preventDefault();${item.action}();"` : '';
      html += `<a href="${item.href}" class="${active}"${mt}${click} title="${item.label}"><i class="nav-ic fa-solid ${item.icon}"></i><span class="nav-label">${item.label}</span></a>`;
    }
  });

  html += '</nav>';
  sidebar.innerHTML = html;
})();

/* ── TOAST SYSTEM ── */
function showToast(message, type, title) {
  type  = type  || 'info';
  title = title || { success: 'Success', error: 'Error', info: 'Info', warning: 'Warning' }[type];
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML =
    '<i class="toast-icon fa-solid ' + (icons[type] || icons.info) + '"></i>' +
    '<div class="toast-body">' +
      '<div class="toast-title">' + title + '</div>' +
      '<div class="toast-msg">'   + message + '</div>' +
    '</div>';

  container.appendChild(el);
  el.addEventListener('click', function () { dismissToast(el); });
  setTimeout(function () { dismissToast(el); }, 4800);
}

function dismissToast(el) {
  if (el.classList.contains('hide')) return;
  el.classList.add('hide');
  setTimeout(function () { el.remove(); }, 320);
}

/* ── OVERRIDE window.alert ── */
window._origAlert = window.alert;
window.alert = function (msg) {
  var m = String(msg).toLowerCase();
  var type = (m.includes('error') || m.includes('fail') || m.includes('invalid'))    ? 'error'
           : (m.includes('saved') || m.includes('done') || m.includes('deleted') ||
              m.includes('updated') || m.includes('success') || m.includes('import')) ? 'success'
           : (m.includes('exceeds') || m.includes('warning') || m.includes('select')) ? 'warning'
           : 'info';
  showToast(String(msg), type);
};

/* ── CLAY RIPPLE ON BUTTONS ── */
(function () {
  var style = document.createElement('style');
  style.textContent = '@keyframes _ripple{0%{transform:scale(0);opacity:.5;}100%{transform:scale(4);opacity:0;}}';
  document.head.appendChild(style);

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.btn');
    if (!btn) return;
    var rect = btn.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 2;
    var r = document.createElement('span');
    r.style.cssText =
      'position:absolute;width:' + size + 'px;height:' + size + 'px;' +
      'left:' + (e.clientX - rect.left - size / 2) + 'px;' +
      'top:'  + (e.clientY - rect.top  - size / 2) + 'px;' +
      'border-radius:50%;background:rgba(255,255,255,.22);' +
      'transform:scale(0);animation:_ripple .55s ease-out forwards;pointer-events:none;';
    btn.appendChild(r);
    setTimeout(function () { r.remove(); }, 600);
  });
})();

/* ── COUNT-UP ANIMATION ── */
function countUp(el, target, duration) {
  duration = duration || 1100;
  var start = performance.now();
  function step(now) {
    var p = Math.min((now - start) / duration, 1);
    var eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * target);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ── STAGGER ANIMATION HELPER ── */
function staggerIn(selector, delay) {
  delay = delay || 60;
  document.querySelectorAll(selector).forEach(function (el, i) {
    el.style.animationDelay = (i * delay) + 'ms';
  });
}

/* ── EMPLOYEE CACHE (sessionStorage) ── */
const EmpCache = {
  key: 'appachi_employees',
  get() {
    try {
      const raw = sessionStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  set(data) {
    try { sessionStorage.setItem(this.key, JSON.stringify(data)); } catch {}
  },
  clear() {
    try { sessionStorage.removeItem(this.key); } catch {}
  }
};

function sortEmployees(a, b) {
  const PINNED = ['AACHI', 'RAMAPRIYADEVI', 'CHURCH', 'CAR TOLLGATE', 'POOKADAI', 'BATHROOM MUNIYANDI'];
  const name = e => (e.alias_name || e.employee_name || '').toUpperCase().trim();
  const pin  = e => { const i = PINNED.indexOf(name(e)); return i === -1 ? Infinity : i; };
  const pa = pin(a), pb = pin(b);
  if (pa !== pb) return pa - pb;
  const order = e => {
    if ((e.type || '').toUpperCase() === 'OTHERS') return 0;
    if ((e.gender || '').toUpperCase() === 'MALE')  return 1;
    return 2;
  };
  const diff = order(a) - order(b);
  if (diff !== 0) return diff;
  return name(a).localeCompare(name(b));
}

/* ── SIDEBAR COLLAPSE / MOBILE DRAWER ── */
(function () {
  // Inject overlay (mobile)
  const overlay = document.createElement('div');
  overlay.className = 'sb-overlay';
  overlay.onclick = closeSidebar;
  document.body.appendChild(overlay);

  // Inject mobile hamburger into topbar-left
  const topbarLeft = document.querySelector('.topbar-left');
  if (topbarLeft) {
    const btn = document.createElement('button');
    btn.className = 'mob-menu-btn';
    btn.setAttribute('aria-label', 'Open menu');
    btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
    btn.onclick = openSidebar;
    topbarLeft.prepend(btn);
  }

  // Desktop collapse toggle
  const toggleBtn = document.getElementById('sb-toggle');
  if (toggleBtn) toggleBtn.onclick = toggleCollapse;

  // Restore saved state on desktop (≥1200px full, 1000-1199 auto-icon)
  if (window.innerWidth >= 1200 && localStorage.getItem('sb_collapsed') === '1') {
    document.body.classList.add('sb-collapsed');
  }
  if (window.innerWidth >= 1000 && window.innerWidth < 1200 &&
      localStorage.getItem('sb_expanded') === '1') {
    document.body.classList.add('sb-expanded');
  }

  // Close mobile drawer when a nav link is clicked
  document.querySelectorAll('.sidebar nav a').forEach(a => {
    a.addEventListener('click', closeSidebar);
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebar();
  });

  function toggleCollapse() {
    const w = window.innerWidth;
    if (w < 1000) return; // mobile — use hamburger instead
    if (w < 1200) {
      // medium: toggle expanded (default is icon-only)
      const expanded = document.body.classList.toggle('sb-expanded');
      localStorage.setItem('sb_expanded', expanded ? '1' : '0');
    } else {
      // large: toggle collapsed (default is full)
      const collapsed = document.body.classList.toggle('sb-collapsed');
      localStorage.setItem('sb_collapsed', collapsed ? '1' : '0');
    }
  }
  function openSidebar()  { document.body.classList.add('sb-open'); }
  function closeSidebar() { document.body.classList.remove('sb-open'); }
})();

/* ── ICON-ONLY SIDEBAR TOOLTIP (shows label on hover when sidebar is collapsed) ── */
(function () {
  var tip = document.createElement('div');
  tip.id = 'sb-tooltip';
  tip.style.cssText =
    'position:fixed;z-index:9999;pointer-events:none;display:none;' +
    'background:#1e1545;color:#fff;padding:5px 13px;border-radius:9px;' +
    'font-size:12.5px;font-weight:600;white-space:nowrap;' +
    'box-shadow:0 4px 18px rgba(30,21,80,.28);opacity:0;transition:opacity .14s;';
  document.body.appendChild(tip);

  function isIconOnly() {
    var w = window.innerWidth;
    if (w < 1000) return false;
    if (w >= 1200) return document.body.classList.contains('sb-collapsed');
    return !document.body.classList.contains('sb-expanded');
  }

  function show(a) {
    if (!isIconOnly()) return;
    var label = a.querySelector('.nav-label');
    if (!label) return;
    tip.textContent = label.textContent.trim();
    var r = a.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.top  = Math.round(r.top + (r.height - 28) / 2) + 'px';
    tip.style.left = Math.round(r.right + 10) + 'px';
    requestAnimationFrame(function () { tip.style.opacity = '1'; });
  }

  function hide() {
    tip.style.opacity = '0';
    setTimeout(function () { tip.style.display = 'none'; }, 150);
  }

  document.querySelectorAll('.sidebar nav a').forEach(function (a) {
    a.addEventListener('mouseenter', function () { show(a); });
    a.addEventListener('mouseleave', hide);
    a.addEventListener('click', hide);
  });
})();

async function fetchEmployees(activeOnly, month) {
  const url = activeOnly
    ? '/payroll/api/employees?active=1' + (month ? '&month=' + month : '')
    : '/payroll/api/employees';
  if (!activeOnly) {
    const cached = EmpCache.get();
    if (cached) return cached;
  }
  const res  = await fetch(url);
  const data = await res.json();
  if (!activeOnly) EmpCache.set(data);
  return data;
}

/* ── STAFF DATA MODAL (global — usable from every page via sidebar) ── */
(function () {
  let modalBuilt      = false;
  let sdEmployees     = [];
  let sdEmployeesPromise = null;

  function loadSdEmployees() {
    if (!sdEmployeesPromise) {
      sdEmployeesPromise = fetchEmployees(true).then(list => {
        sdEmployees = list.slice().sort(sortEmployees);
        return sdEmployees;
      });
    }
    return sdEmployeesPromise;
  }
  // Prefetch as soon as the page loads so the list is usually ready before the button is clicked.
  loadSdEmployees();

  function buildModal() {
    if (modalBuilt) return;
    modalBuilt = true;

    const overlay = document.createElement('div');
    overlay.id = 'sd_overlay';
    overlay.className = 'sd-overlay';
    overlay.innerHTML = `
      <div class="sd-modal">
        <div class="sd-hdr">
          <div class="sd-title"><i class="fa-solid fa-id-card-clip" style="color:#6366f1;"></i> Staff Data</div>
          <button class="btn btn-ghost btn-sm btn-icon" id="sd_close_btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="sd-search-wrap">
          <div class="sd-emp-select-wrap">
            <input type="text" id="sd_emp_search" class="sd-emp-search" placeholder="Search Employee ID / Name…" autocomplete="off">
            <input type="hidden" id="sd_emp_id" value="">
            <i class="fa-solid fa-chevron-down sd-emp-select-arrow"></i>
            <div class="sd-emp-dropdown" id="sd_emp_dropdown"></div>
          </div>
          <span class="sd-month-badge" id="sd_month_badge"></span>
          <span class="sd-asof-hint" id="sd_asof_hint" style="display:none;"></span>
        </div>
        <div class="sd-body" id="sd_body">
          <div class="sd-empty">Select an employee to view their staff data.</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('sd_close_btn').onclick = closeStaffDataModal;
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeStaffDataModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStaffDataModal(); });

    const searchEl = document.getElementById('sd_emp_search');
    const dropEl   = document.getElementById('sd_emp_dropdown');

    /* Move to body — .sd-modal's transform-based open animation creates a containing
       block that would otherwise break position:fixed on this dropdown. */
    document.body.appendChild(dropEl);
    dropEl.addEventListener('mousedown', e => e.preventDefault());

    function positionDrop() {
      const r = searchEl.getBoundingClientRect();
      dropEl.style.top   = (r.bottom + 2) + 'px';
      dropEl.style.left  = r.left + 'px';
      dropEl.style.width = r.width + 'px';
    }

    function renderOptions(q) {
      const filtered = q
        ? sdEmployees.filter(e =>
            (e.alias_name || e.employee_name || '').toLowerCase().includes(q.toLowerCase()) ||
            String(e.employee_id).includes(q))
        : sdEmployees;

      dropEl.innerHTML = '';
      if (!filtered.length) {
        dropEl.innerHTML = '<div class="sd-emp-option no-match">No match found</div>';
        return;
      }
      filtered.forEach(emp => {
        const d = document.createElement('div');
        d.className = 'sd-emp-option';
        d.textContent = `${emp.employee_id} — ${emp.alias_name || emp.employee_name}`;
        d.onmousedown = (e) => {
          e.preventDefault();
          dropEl.classList.remove('open');
          selectStaffDataEmployee(emp);
        };
        dropEl.appendChild(d);
      });
    }

    function openDrop() {
      positionDrop();
      renderOptions('');       // always show the full list on open — searchEl.value may hold "id — name" from a prior selection
      searchEl.select();       // typing immediately replaces it
      dropEl.classList.add('open');
    }
    // 'click' is needed in addition to 'focus': after a selection, the input keeps focus
    // (selection uses mousedown+preventDefault to avoid blur), so a later click on it
    // fires no 'focus' event at all — 'click' is the only reliable "user wants to reopen" signal.
    searchEl.addEventListener('focus', openDrop);
    searchEl.addEventListener('click', openDrop);
    searchEl.addEventListener('input', () => { positionDrop(); renderOptions(searchEl.value); });
    searchEl.addEventListener('blur',  () => setTimeout(() => dropEl.classList.remove('open'), 160));
    document.addEventListener('scroll', (e) => {
      if (dropEl.contains(e.target)) return; // scrolling the option list itself shouldn't close it
      dropEl.classList.remove('open');
    }, true);
  }

  function fmtMoney(n) {
    return '₹' + (parseFloat(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function tile(label, val, cls) {
    return `<div class="sd-tile${cls ? ' ' + cls : ''}"><div class="sd-tile-lbl">${label}</div><div class="sd-tile-val">${val}</div></div>`;
  }

  async function selectStaffDataEmployee(emp) {
    document.getElementById('sd_emp_search').value = `${emp.employee_id} — ${emp.alias_name || emp.employee_name}`;
    document.getElementById('sd_emp_id').value = emp.employee_id;
    const body = document.getElementById('sd_body');
    body.innerHTML = '<div class="sd-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>';
    document.getElementById('sd_asof_hint').style.display = 'none';

    const month = new Date().toISOString().slice(0, 7);
    try {
      const res = await fetch(`/payroll/api/staff-data?month=${month}&employee_id=${emp.employee_id}`);
      const d   = await res.json();
      if (!res.ok) { body.innerHTML = `<div class="sd-empty">${d.error || 'Failed to load staff data'}</div>`; return; }
      renderStaffData(d);
      updateAsOfHint(d.last_filled_date);
    } catch (e) {
      body.innerHTML = '<div class="sd-empty">Failed to load staff data.</div>';
    }
  }

  function updateAsOfHint(isoDate) {
    const hint = document.getElementById('sd_asof_hint');
    if (!isoDate) {
      hint.style.display = 'none';
      return;
    }
    const [y, m, dd] = isoDate.split('-');
    hint.textContent = `As of ${dd}/${m}/${y}`;
    hint.title = 'Last date attendance was filled in for this employee this month';
    hint.style.display = '';
  }

  function renderStaffData(d) {
    const body = document.getElementById('sd_body');
    const pt = d.permission_timing || {};
    const isCash = (d.mop || '').toUpperCase() === 'CASH';

    // CASH staff generally have no PF/ESIC/LA split — show one combined "Salary" tile instead.
    const salaryTiles = isCash
      ? tile('Salary', fmtMoney(d.net_salary), 'green')
      : `${tile('Gross Pay', fmtMoney(d.gross_pay), 'accent')}
         ${tile('PF', fmtMoney(d.pf_ee))}
         ${tile('ESIC', fmtMoney(d.esic_ip))}
         ${tile('L.A.', fmtMoney(d.labour_act))}
         ${tile('Net Pay', fmtMoney(d.net_salary), 'green')}`;

    const allowanceSection = d.has_allowance ? `
      <div class="sd-section">
        <div class="sd-section-title"><i class="fa-solid fa-gift"></i> Allowance</div>
        <div class="sd-grid">
          ${tile('Allowance', fmtMoney(d.allowance), 'accent')}
          ${tile('Allowance Deduction (LOP)', fmtMoney(d.allowance_deduction), 'red')}
        </div>
      </div>` : '';

    body.innerHTML = `
      <div class="sd-section">
        <div class="sd-section-title"><i class="fa-solid fa-wallet"></i> Salary Summary</div>
        <div class="sd-grid">
          ${tile('Employee ID', d.employee_id)}
          ${tile('Name', d.alias_name || d.employee_name)}
          ${salaryTiles}
          ${tile('Advance', fmtMoney(d.advance))}
          ${tile(`LOP (${d.lop_days || 0} days)`, fmtMoney(d.lop_amount), 'red')}
          ${tile('Available Salary', fmtMoney(d.available_salary), 'green')}
        </div>
      </div>
      ${allowanceSection}

      <div class="sd-section">
        <div class="sd-section-title"><i class="fa-solid fa-calendar-days"></i> Attendance &amp; Incentives</div>
        <div class="sd-grid">
          ${tile('Present Days', d.present_days)}
          ${tile('Absent Days', d.absent_days)}
          ${tile('Permission Days Debited', d.permission_days_debited)}
          ${tile('Permission Incentive Amount', `${d.permission_incentive_days || 0}d · ${fmtMoney(d.permission_incentive_amount)}`, 'amber')}
          ${tile('Leave Incentive', `${d.leave_incentive_days || 0}d · ${fmtMoney(d.leave_incentive_amount)}`, 'amber')}
        </div>
      </div>

      <div class="sd-section">
        <div class="sd-section-title"><i class="fa-solid fa-clock"></i> Permission Timing</div>
        <div class="sd-grid">
          ${tile('Total Permission', pt.total_perm_fmt || '0:00')}
          ${tile('Free Permission', pt.free_perm_fmt || '0:00')}
          ${tile('Net Permission', pt.net_perm_fmt || '0:00')}
          ${tile('Earned Days', pt.earned_days || 0)}
          ${tile('Debited Days', pt.debited_days || 0)}
        </div>
      </div>`;
  }

  window.openStaffDataModal = async function () {
    buildModal();
    document.getElementById('sd_overlay').classList.add('open');
    document.getElementById('sd_month_badge').textContent =
      new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    const searchEl = document.getElementById('sd_emp_search');
    if (!sdEmployees.length) {
      searchEl.disabled    = true;
      searchEl.placeholder = 'Loading employees…';
      await loadSdEmployees();
      searchEl.disabled    = false;
      searchEl.placeholder = 'Search Employee ID / Name…';
    }
  };

  window.closeStaffDataModal = function () {
    const overlay = document.getElementById('sd_overlay');
    if (overlay) overlay.classList.remove('open');
  };
})();

/* ── HALF LEAVES SUMMARY MODAL (global — usable from every page via sidebar) ──
   Tallies each employee's Half-day (H) leaves for a month: every AM pairs off
   with a PM (earliest-first) into a matched full day; whatever's left over
   (all from whichever side — AM or PM — had more) is "Pending". */
(function () {
  let modalBuilt        = false;
  let hlEmployees        = [];
  let hlEmployeesPromise = null;
  let hlRows             = [];   // last computed summary, kept for Export Excel
  let xlsxStyleLoaded    = false;

  function loadHlEmployees() {
    if (!hlEmployeesPromise) {
      hlEmployeesPromise = fetchEmployees(true).then(list => {
        hlEmployees = list.slice().sort(sortEmployees);
        return hlEmployees;
      });
    }
    return hlEmployeesPromise;
  }

  function buildModal() {
    if (modalBuilt) return;
    modalBuilt = true;

    const overlay = document.createElement('div');
    overlay.id = 'hl_overlay';
    overlay.className = 'hl-overlay';
    overlay.innerHTML = `
      <div class="hl-modal">
        <div class="hl-hdr">
          <div class="hl-title"><i class="fa-solid fa-hourglass-half" style="color:#6366f1;"></i> Half Leaves Summary</div>
          <button class="btn btn-ghost btn-sm btn-icon" id="hl_close_btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="hl-toolbar">
          <span style="font-size:11px;font-weight:700;color:var(--c-text3);text-transform:uppercase;letter-spacing:.9px;">Month</span>
          <input type="month" id="hl_month" class="form-control" style="width:auto;padding:8px 12px;">
          <button class="btn btn-cyan btn-sm" id="hl_export_btn" style="margin-left:auto;" disabled>
            <i class="fa-solid fa-file-excel"></i> Export Excel
          </button>
        </div>
        <div class="hl-body" id="hl_body">
          <div class="hl-empty">Select a month to view half-day leave tallies.</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('hl_close_btn').onclick = closeHalfLeaveSummaryModal;
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeHalfLeaveSummaryModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHalfLeaveSummaryModal(); });

    document.getElementById('hl_month').addEventListener('change', loadHalfLeaveSummary);
    document.getElementById('hl_export_btn').addEventListener('click', exportHalfLeaveSummary);
  }

  function dayLabel(d, period) { return String(d).padStart(2, '0') + '/' + period; }

  /* Pair off earliest-AM with earliest-PM, one for one, until one side runs out.
     Whatever's left over (always from the side with more) is pending. */
  function tallyEmployee(halfDays) {
    const am = halfDays.filter(h => h.period !== 'PM').sort((a, b) => a.day - b.day);
    const pm = halfDays.filter(h => h.period === 'PM').sort((a, b) => a.day - b.day);
    const pairCount = Math.min(am.length, pm.length);
    const matched = [...am.slice(0, pairCount), ...pm.slice(0, pairCount)];
    const pending = [...am.slice(pairCount), ...pm.slice(pairCount)].sort((a, b) => a.day - b.day);
    return {
      all: halfDays.slice().sort((a, b) => a.day - b.day),
      matched, pending, pairCount
    };
  }

  /* What's left to balance the pending half-days: pending is always all-AM or all-PM
     (matching depletes whichever side is smaller to zero), so the opposite period,
     one for each pending item, is what the employee still has to take. */
  function neededLabel(r) {
    if (!r.pending.length) return '—';
    const neededPeriod = r.pending[0].period === 'PM' ? 'AM' : 'PM';
    return `${neededPeriod}-${r.pending.length}`;
  }

  async function loadHalfLeaveSummary() {
    const month     = document.getElementById('hl_month').value;
    const body      = document.getElementById('hl_body');
    const exportBtn = document.getElementById('hl_export_btn');
    exportBtn.disabled = true;
    hlRows = [];
    if (!month) { body.innerHTML = '<div class="hl-empty">Select a month to view half-day leave tallies.</div>'; return; }

    body.innerHTML = '<div class="hl-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>';

    try {
      const [attRows] = await Promise.all([
        fetch(`/payroll/api/attendance/daily?month=${month}`).then(r => r.json()),
        loadHlEmployees()
      ]);

      const byEmp = {};
      attRows.forEach(r => {
        if (r.status !== 'H') return;
        if (!byEmp[r.employee_id]) byEmp[r.employee_id] = [];
        byEmp[r.employee_id].push({ day: r.day, period: r.period === 'PM' ? 'PM' : 'AM' });
      });

      const empMap = {};
      hlEmployees.forEach(e => { empMap[String(e.employee_id)] = e; });

      hlRows = Object.keys(byEmp)
        .map(empId => {
          const emp  = empMap[empId];
          const name = emp ? (emp.alias_name || emp.employee_name) : ('#' + empId);
          return { employee_id: empId, name, ...tallyEmployee(byEmp[empId]) };
        })
        .sort((a, b) => b.pending.length - a.pending.length || a.name.localeCompare(b.name));

      renderHalfLeaveSummary();
      exportBtn.disabled = hlRows.length === 0;
    } catch (e) {
      body.innerHTML = '<div class="hl-empty">Failed to load attendance data.</div>';
    }
  }

  function renderHalfLeaveSummary() {
    const body = document.getElementById('hl_body');
    if (!hlRows.length) {
      body.innerHTML = '<div class="hl-empty">No half-day leaves recorded for this month.</div>';
      return;
    }

    let html = `<table class="hl-table"><thead><tr>
      <th>#</th><th>Name</th><th>Half Days Taken</th><th>Need To Take</th><th>Pending</th><th>Pending Count</th>
    </tr></thead><tbody>`;

    hlRows.forEach((r, i) => {
      const allChips = r.all.map(h => {
        const isMatched = r.matched.some(m => m.day === h.day && m.period === h.period);
        return `<span class="hl-chip ${isMatched ? 'matched' : 'pending'}">` +
          (isMatched ? '<i class="fa-solid fa-circle-check"></i> ' : '') +
          `${dayLabel(h.day, h.period)}</span>`;
      }).join('');
      const pendingChips = r.pending.length
        ? r.pending.map(h => `<span class="hl-chip pending">${dayLabel(h.day, h.period)}</span>`).join('')
        : '<span style="color:var(--c-text3);font-size:12px;">—</span>';
      const pendingCls = r.pending.length ? 'some' : 'zero';

      html += `<tr>
        <td>${i + 1}</td>
        <td class="hl-name">${r.name}</td>
        <td>${allChips}</td>
        <td class="hl-taken">${neededLabel(r)}</td>
        <td>${pendingChips}</td>
        <td><span class="hl-pending-count ${pendingCls}">${r.pending.length}</span></td>
      </tr>`;
    });

    html += '</tbody></table>';
    body.innerHTML = html;
  }

  /* Excel needs borders/fills, which plain SheetJS (loaded on some pages) can't
     write — always (re)load the style-capable fork fresh so this export works
     correctly regardless of what XLSX build the host page already has, if any. */
  function ensureXlsxStyleLib() {
    return new Promise((resolve, reject) => {
      if (xlsxStyleLoaded) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
      script.onload  = () => { xlsxStyleLoaded = true; resolve(); };
      script.onerror = () => reject(new Error('Failed to load Excel export library'));
      document.head.appendChild(script);
    });
  }

  function buildHalfLeaveWorkbook(rows, month) {
    const THIN    = { style: 'thin', color: { rgb: 'B7B7B7' } };
    const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };
    const headers = ['S.No', 'Employee ID', 'Name', 'Half Days Taken', 'Need To Take', 'Matched Pairs', 'Pending Half Days', 'Pending Count'];

    const aoa = [headers];
    rows.forEach((r, i) => {
      aoa.push([
        i + 1,
        r.employee_id,
        r.name,
        r.all.map(h => dayLabel(h.day, h.period)).join(', '),
        neededLabel(r),
        r.pairCount,
        r.pending.map(h => dayLabel(h.day, h.period)).join(', ') || '—',
        r.pending.length
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 24 }, { wch: 36 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 12 }];

    const cell = (r, c) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      return ws[addr];
    };
    const styleCell  = (r, c, s) => { const cc = cell(r, c); cc.s = Object.assign({}, cc.s, s); };
    const styleRange = (r1, c1, r2, c2, s) => { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) styleCell(r, c, s); };

    const NUMCOLS = headers.length;
    styleRange(0, 0, 0, NUMCOLS - 1, {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '4338CA' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: BORDERS
    });

    for (let r = 1; r <= rows.length; r++) {
      styleRange(r, 0, r, NUMCOLS - 1, {
        border: BORDERS,
        alignment: { vertical: 'center', wrapText: true },
        fill: { patternType: 'solid', fgColor: { rgb: (r % 2 === 0) ? 'F5F6FA' : 'FFFFFF' } }
      });
      const pendingCount = rows[r - 1].pending.length;
      styleCell(r, 7, { font: { bold: true, color: { rgb: pendingCount > 0 ? 'DC2626' : '059669' } }, alignment: { horizontal: 'center', vertical: 'center' } });
      styleCell(r, 5, { alignment: { horizontal: 'center', vertical: 'center' } });
      styleCell(r, 4, { alignment: { horizontal: 'center', vertical: 'center' } });
      styleCell(r, 0, { alignment: { horizontal: 'center', vertical: 'center' } });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Half Leaves');
    XLSX.writeFile(wb, `half_leave_summary_${month}.xlsx`);
  }

  async function exportHalfLeaveSummary() {
    if (!hlRows.length) return;
    const month    = document.getElementById('hl_month').value;
    const btn      = document.getElementById('hl_export_btn');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Building…';
    btn.disabled  = true;

    try {
      await ensureXlsxStyleLib();
      buildHalfLeaveWorkbook(hlRows, month);
      if (window.showToast) showToast('Half leave summary exported', 'success');
    } catch (e) {
      if (window.showToast) showToast('Export failed: ' + e.message, 'error');
    } finally {
      btn.innerHTML = original;
      btn.disabled  = false;
    }
  }

  window.openHalfLeaveSummaryModal = async function () {
    buildModal();
    document.getElementById('hl_overlay').classList.add('open');
    const monthEl = document.getElementById('hl_month');
    if (!monthEl.value) monthEl.value = new Date().toISOString().slice(0, 7);
    loadHalfLeaveSummary();
  };

  window.closeHalfLeaveSummaryModal = function () {
    const overlay = document.getElementById('hl_overlay');
    if (overlay) overlay.classList.remove('open');
  };
})();
