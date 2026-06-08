// auth.js — shared auth check, user info display, PIN/Leave modals

// ── Settings modal ────────────────────────────────────────────────────────────
function showSettingsModal() {
  let o = document.getElementById('_settingsOverlay');
  if (!o) _buildSettingsModal();
  o = document.getElementById('_settingsOverlay');
  const mob = window.innerWidth <= 1024 || ('ontouchstart' in window);
  o.style.cssText = mob
    ? 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;align-items:flex-end;justify-content:center'
    : 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;align-items:center;justify-content:center;padding:20px';
}

function closeSettingsModal() {
  const o = document.getElementById('_settingsOverlay');
  if (o) o.style.display = 'none';
}

function _buildSettingsModal() {
  const mob = window.innerWidth <= 1024 || ('ontouchstart' in window);
  const fs  = b => (mob ? Math.round(b * 1.15) : b) + 'px';
  const pad = mob ? '15px' : '12px';
  const panelStyle = mob
    ? 'background:#131922;border:1px solid #222d3d;border-radius:22px 22px 0 0;padding:28px 24px 36px;width:100%;max-height:85dvh;overflow-y:auto;box-shadow:0 -8px 40px rgba(0,0,0,0.7)'
    : 'background:#131922;border:1px solid #222d3d;border-radius:16px;padding:32px;width:100%;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,0.6)';

  const o = document.createElement('div');
  o.id = '_settingsOverlay';
  o.onclick = e => { if (e.target === o) closeSettingsModal(); };
  o.innerHTML = `
    <div style="${panelStyle}">
      <h3 style="font-family:'Fraunces',Georgia,serif;font-size:${fs(20)};color:#e6edf3;margin:0 0 24px;display:flex;align-items:center;gap:10px">
        ⚙ Settings
      </h3>

      <!-- Change PIN -->
      <button onclick="closeSettingsModal();showChangePinModal()"
        style="width:100%;text-align:left;padding:${pad} 0;background:transparent;border:none;border-bottom:1px solid #222d3d;color:#e6edf3;font-size:${fs(15)};font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:10px">
        🔑 Change PIN
      </button>

      <!-- Sign Out -->
      <button onclick="fetch('/api/logout',{method:'POST'}).then(()=>location.replace('/login.html'))"
        style="width:100%;text-align:left;padding:${pad} 0;background:transparent;border:none;border-bottom:1px solid #222d3d;color:#ff5d5d;font-size:${fs(15)};font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:10px">
        🚪 Sign Out
      </button>

      <button onclick="closeSettingsModal()"
        style="margin-top:20px;width:100%;padding:${pad};background:transparent;border:1px solid #222d3d;border-radius:8px;color:#8b98a8;cursor:pointer;font-family:inherit;font-size:${fs(14)}">
        Close
      </button>
    </div>`;
  document.body.appendChild(o);
}

// ── Main auth check ───────────────────────────────────────────────────────────
(async () => {
  let me;
  try {
    const r = await fetch('/api/me');
    if (!r.ok) { window.location.replace('/login.html'); return; }
    me = await r.json();
  } catch { window.location.replace('/login.html'); return; }

  const role = me.role || 'STAFF';
  const path = window.location.pathname;
  const isDashboard = path === '/' || path.endsWith('/dashboard.html');

  // ── Page access control ───────────────────────────────────────────────────────
  // OWNER (ID-74): all pages
  // COMPUTER: dashboard, entry, leaves
  // STAFF: dashboard only
  const OWNER_PAGES    = ['/employees.html', '/stocks.html', '/auto-assign.html', '/sql-editor.html'];
  const COMPUTER_PAGES = ['/entry.html', '/leaves.html'];

  if (OWNER_PAGES.some(p => path.endsWith(p)) && role !== 'OWNER') {
    window.location.replace('/'); return;
  }
  if (COMPUTER_PAGES.some(p => path.endsWith(p)) && role === 'STAFF') {
    window.location.replace('/'); return;
  }

  window._authUser = me;

  // ── Show role-appropriate nav elements ────────────────────────────────────────
  // .owner-only    → visible only to OWNER
  // .computer-up   → visible to COMPUTER + OWNER
  // .staff-only    → visible only to STAFF (hidden for COMPUTER/OWNER)
  if (role === 'OWNER') {
    document.querySelectorAll('.owner-only, .computer-up, .admin-only').forEach(e => e.style.removeProperty('display'));
    document.querySelectorAll('.staff-only').forEach(e => { e.style.display = 'none'; });
  } else if (role === 'COMPUTER') {
    document.querySelectorAll('.computer-up').forEach(e => e.style.removeProperty('display'));
    document.querySelectorAll('.staff-only').forEach(e => { e.style.display = 'none'; });
  }
  // STAFF: .computer-up and .owner-only stay hidden, .staff-only stays visible

  // ── Sidebar footer (dark theme pages: dashboard, employees, stocks) ──────────
  const roleTag = role === 'COMPUTER'
    ? ' <span style="color:#8b98a8;font-size:10px">COMPUTER</span>'
    : '';

  const sidebarFooter = document.getElementById('sidebarFooter');
  if (sidebarFooter) {
    let html = `
      <div style="font-weight:600;color:var(--text);margin-bottom:2px">
        ${me.name}${roleTag}
      </div>
      <div style="color:var(--text-dim)">ID&nbsp;${me.id}</div>`;
    if (isDashboard) {
      html += `
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
        <button onclick="showLeaveModal()"
          style="width:100%;padding:5px 0;background:transparent;border:1px solid rgba(212,175,55,0.3);border-radius:6px;color:var(--accent);cursor:pointer;font-size:11px;font-family:inherit;opacity:0.85">
          &#128197; My Leave
        </button>
        <button onclick="showSettingsModal()"
          style="width:100%;padding:5px 0;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text-dim);cursor:pointer;font-size:11px;font-family:inherit">
          ⚙ Settings
        </button>
        <button onclick="fetch('/api/logout',{method:'POST'}).then(()=>location.replace('/login.html'))"
          style="width:100%;padding:5px 0;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text-dim);cursor:pointer;font-size:11px;font-family:inherit">
          Sign out
        </button>
      </div>`;
    }
    sidebarFooter.innerHTML = html;
  }

  // ── Topbar user label (light/navy theme pages: entry, auto-assign, leaves) ───
  const userLabel = document.getElementById('userLabel');
  if (userLabel) userLabel.textContent = me.name + (role === 'COMPUTER' ? ' ●' : '');

  // ── Modal style helpers (fully inline — avoids CSP issues in native WebView) ──
  const _mob = () => window.innerWidth <= 1024 || ('ontouchstart' in window);
  const _panelStyle = () => _mob()
    ? 'background:#131922;border:1px solid #222d3d;border-radius:22px 22px 0 0;padding:28px 24px 36px;width:100%;max-height:88dvh;overflow-y:auto;box-shadow:0 -8px 40px rgba(0,0,0,0.7)'
    : 'background:#131922;border:1px solid #222d3d;border-radius:16px;padding:32px;width:100%;max-width:420px;max-height:82vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.6)';
  const _overlayStyle = () => _mob()
    ? 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;align-items:flex-end;justify-content:center'
    : 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;align-items:center;justify-content:center;padding:20px';

  const _fs = (base) => _mob() ? Math.round(base * 1.2) + 'px' : base + 'px';

  // ── Leave modal ───────────────────────────────────────────────────────────────
  const leaveOverlay = document.createElement('div');
  leaveOverlay.id = 'leaveModalOverlay';
  leaveOverlay.style.cssText = _overlayStyle();
  leaveOverlay.onclick = e => { if (e.target === leaveOverlay) closeLeaveModal(); };
  leaveOverlay.innerHTML = `
    <div id="_leavePanelInner" style="${_panelStyle()}">
      <h3 style="font-family:'Fraunces',Georgia,serif;font-size:${_fs(20)};color:#e6edf3;margin:0 0 8px">My Leave</h3>
      <p style="font-size:${_fs(13)};color:#8b98a8;margin-bottom:16px;line-height:1.6">Book dates you won't be available — you won't be assigned any stocks on those days.</p>
      <div id="leaveTypeRow" data-selected="FULL" style="display:flex;gap:6px;margin-bottom:12px">
        <button onclick="setLeaveType('FULL')" id="lt-FULL"
          style="flex:1;padding:${_mob()?'11px 4px':'7px 4px'};border-radius:8px;font-size:${_fs(12)};font-weight:700;font-family:inherit;cursor:pointer;border:1px solid #d4af37;background:linear-gradient(135deg,#d4af37,#9c7c1a);color:#0d1117;transition:all .15s">
          Full Day
        </button>
        <button onclick="setLeaveType('HALF_AM')" id="lt-HALF_AM"
          style="flex:1;padding:${_mob()?'11px 4px':'7px 4px'};border-radius:8px;font-size:${_fs(12)};font-weight:700;font-family:inherit;cursor:pointer;border:1px solid #222d3d;background:transparent;color:#8b98a8;transition:all .15s">
          Half AM
        </button>
        <button onclick="setLeaveType('HALF_PM')" id="lt-HALF_PM"
          style="flex:1;padding:${_mob()?'11px 4px':'7px 4px'};border-radius:8px;font-size:${_fs(12)};font-weight:700;font-family:inherit;cursor:pointer;border:1px solid #222d3d;background:transparent;color:#8b98a8;transition:all .15s">
          Half PM
        </button>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:10px">
        <input id="leaveDate" type="date"
          style="flex:1;padding:${_mob()?'14px':'10px'} 12px;background:#1a2230;border:1px solid #222d3d;border-radius:8px;color:#e6edf3;font-size:${_fs(15)};font-family:inherit;outline:none;-webkit-appearance:none;color-scheme:dark"/>
        <button onclick="bookLeave()"
          style="padding:${_mob()?'14px 22px':'10px 16px'};background:linear-gradient(135deg,#d4af37,#9c7c1a);border:none;border-radius:8px;color:#0d1117;font-size:${_fs(14)};font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">
          Book
        </button>
      </div>
      <div id="leaveErr" style="display:none;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);border-radius:8px;padding:12px;font-size:${_fs(13)};color:#ff5d5d;margin-bottom:12px"></div>
      <div id="leaveList" style="font-size:${_fs(14)};color:#8b98a8;margin-top:16px">Loading…</div>
      <button onclick="closeLeaveModal()"
        style="margin-top:22px;width:100%;padding:${_mob()?'16px':'11px'};background:transparent;border:1px solid #222d3d;border-radius:8px;color:#8b98a8;cursor:pointer;font-family:inherit;font-size:${_fs(14)}">
        Close
      </button>
    </div>`;
  document.body.appendChild(leaveOverlay);

  // ── PIN change modal ──────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'pinModalOverlay';
  overlay.style.cssText = _overlayStyle();
  overlay.onclick = e => { if (e.target === overlay) closePinModal(); };
  const _pad = _mob() ? '16px' : '12px';
  overlay.innerHTML = `
    <div style="${_panelStyle()}">
      <h3 style="font-family:'Fraunces',Georgia,serif;font-size:${_fs(20)};color:#e6edf3;margin:0 0 22px">Change PIN</h3>
      <div id="pinModalErr" style="display:none;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);border-radius:8px;padding:12px;font-size:${_fs(13)};color:#ff5d5d;margin-bottom:14px"></div>
      ${['Current PIN|pinCurrent|Current PIN', 'New PIN|pinNew|4–6 digits', 'Confirm New PIN|pinConfirm|Repeat new PIN'].map(s => {
        const [label, id, placeholder] = s.split('|');
        return `<div style="margin-bottom:16px">
          <label style="display:block;font-size:${_fs(12)};font-weight:700;color:#8b98a8;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">${label}</label>
          <input id="${id}" type="password" inputmode="numeric" placeholder="${placeholder}"
            style="width:100%;padding:${_pad};background:#1a2230;border:1px solid #222d3d;border-radius:8px;color:#e6edf3;font-size:${_fs(16)};font-family:'JetBrains Mono',monospace,sans-serif;outline:none;-webkit-appearance:none;box-sizing:border-box"/>
        </div>`;
      }).join('')}
      <div style="display:flex;gap:10px;margin-top:8px">
        <button onclick="closePinModal()"
          style="flex:1;padding:${_pad};background:transparent;border:1px solid #222d3d;border-radius:8px;color:#8b98a8;cursor:pointer;font-family:inherit;font-size:${_fs(14)}">
          Cancel
        </button>
        <button onclick="submitPinChange()" id="pinSaveBtn"
          style="flex:2;padding:${_pad};background:linear-gradient(135deg,#d4af37,#9c7c1a);border:none;border-radius:8px;color:#0d1117;font-size:${_fs(14)};font-weight:700;cursor:pointer;font-family:inherit">
          Save PIN
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
})();

function showChangePinModal() {
  const o = document.getElementById('pinModalOverlay');
  if (!o) return;
  const mob = window.innerWidth <= 1024 || ('ontouchstart' in window);
  o.style.cssText = mob
    ? 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;align-items:flex-end;justify-content:center'
    : 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;align-items:center;justify-content:center;padding:20px';
  document.getElementById('pinCurrent')?.focus();
}

function closePinModal() {
  const o = document.getElementById('pinModalOverlay');
  if (!o) return;
  o.style.display = 'none';
  ['pinCurrent', 'pinNew', 'pinConfirm'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const err = document.getElementById('pinModalErr');
  if (err) err.style.display = 'none';
}

async function submitPinChange() {
  const cur  = document.getElementById('pinCurrent')?.value || '';
  const nw   = document.getElementById('pinNew')?.value || '';
  const conf = document.getElementById('pinConfirm')?.value || '';
  const err  = document.getElementById('pinModalErr');
  const btn  = document.getElementById('pinSaveBtn');

  const showErr = msg => { if (err) { err.textContent = msg; err.style.display = 'block'; } };
  if (err) err.style.display = 'none';

  if (!cur || !nw || !conf) return showErr('All fields are required.');
  if (!/^\d{4,6}$/.test(nw)) return showErr('New PIN must be 4–6 digits.');
  if (nw !== conf) return showErr('PINs do not match.');

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const r = await fetch('/api/me/pin', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_pin: cur, new_pin: nw }),
    });
    const d = await r.json();
    if (!r.ok) {
      showErr(d.error || 'Failed to change PIN.');
    } else {
      closePinModal();
      const toast = document.createElement('div');
      toast.textContent = '✓ PIN changed successfully';
      toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#2ecc71;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:10000;box-shadow:0 4px 20px rgba(0,0,0,0.3)';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
  } catch { showErr('Network error. Please try again.'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Save PIN'; }
}

// ── Leave modal functions ─────────────────────────────────────────────────────
function showLeaveModal() {
  const o = document.getElementById('leaveModalOverlay');
  if (!o) return;
  const mob = window.innerWidth <= 1024 || ('ontouchstart' in window);
  o.style.cssText = mob
    ? 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9999;align-items:flex-end;justify-content:center'
    : 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;align-items:center;justify-content:center;padding:20px';
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const inp = document.getElementById('leaveDate');
  if (inp) { inp.min = tomorrowStr; if (!inp.value || inp.value < tomorrowStr) inp.value = tomorrowStr; }
  setLeaveType('FULL');
  loadMyLeaves();
}

function closeLeaveModal() {
  const o = document.getElementById('leaveModalOverlay');
  if (o) o.style.display = 'none';
  const err = document.getElementById('leaveErr');
  if (err) err.style.display = 'none';
}

async function loadMyLeaves() {
  const list = document.getElementById('leaveList');
  if (!list) return;
  list.innerHTML = '<span style="color:#8b98a8">Loading…</span>';
  try {
    const r   = await fetch('/api/my-leaves');
    const all = await r.json();
    if (!all.length) { list.innerHTML = '<span style="color:#8b98a8">No leave days booked yet.</span>'; return; }

    const today    = new Date().toISOString().split('T')[0];
    const upcoming = all.filter(l => l.date >= today);
    const past     = all.filter(l => l.date <  today);
    let html = '';

    if (upcoming.length) {
      html += '<div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#8b98a8;text-transform:uppercase;margin-bottom:8px">Upcoming</div>';
      html += upcoming.map(l => {
        const ltTag = l.leave_type === 'HALF_AM'
          ? `<span style="font-size:10px;padding:2px 7px;background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.25);border-radius:5px;color:#d4af37;margin-left:7px">AM</span>`
          : l.leave_type === 'HALF_PM'
          ? `<span style="font-size:10px;padding:2px 7px;background:rgba(212,175,55,0.1);border:1px solid rgba(212,175,55,0.25);border-radius:5px;color:#d4af37;margin-left:7px">PM</span>`
          : '';
        return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#1a2230;border-radius:8px;margin-bottom:6px">
          <span style="color:#e6edf3;font-family:'JetBrains Mono',monospace;font-size:13px">${fmtDate(l.date)}${ltTag}</span>
          ${l.pending_cancel
            ? `<span style="font-size:10px;padding:3px 10px;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.3);border-radius:6px;color:#d4af37">⏳ Awaiting Approval</span>`
            : `<button onclick="cancelLeave(${l.id},this)"
                style="font-size:10px;padding:3px 10px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.3);border-radius:6px;color:#ff5d5d;cursor:pointer;font-family:inherit">
                Cancel
              </button>`
          }
        </div>`;
      }).join('');
    }
    if (past.length) {
      html += `<div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#8b98a8;text-transform:uppercase;margin:${upcoming.length?'14px':'0'}px 0 8px">Past</div>`;
      html += past.slice(-5).reverse().map(l =>
        `<div style="padding:7px 12px;background:#0d1117;border:1px solid #222d3d;border-radius:8px;margin-bottom:4px;color:#8b98a8;font-family:'JetBrains Mono',monospace;font-size:12px">${fmtDate(l.date)}</div>`
      ).join('');
    }
    list.innerHTML = html;
  } catch { list.innerHTML = '<span style="color:#ff5d5d">Failed to load. Please try again.</span>'; }
}

function fmtDate(s) {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function setLeaveType(type) {
  const row = document.getElementById('leaveTypeRow');
  if (!row) return;
  row.dataset.selected = type;
  ['FULL', 'HALF_AM', 'HALF_PM'].forEach(t => {
    const btn = document.getElementById('lt-' + t);
    if (!btn) return;
    const active = t === type;
    btn.style.background    = active ? 'linear-gradient(135deg,#d4af37,#9c7c1a)' : 'transparent';
    btn.style.borderColor   = active ? '#d4af37' : '#222d3d';
    btn.style.color         = active ? '#0d1117' : '#8b98a8';
  });
}

async function bookLeave() {
  const inp = document.getElementById('leaveDate');
  const err = document.getElementById('leaveErr');
  if (err) err.style.display = 'none';
  const date       = inp?.value;
  const leave_type = document.getElementById('leaveTypeRow')?.dataset.selected || 'FULL';
  if (!date) { if (err) { err.textContent = 'Please select a date.'; err.style.display = 'block'; } return; }
  try {
    const r = await fetch('/api/my-leaves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, leave_type }),
    });
    const d = await r.json();
    if (!r.ok) {
      if (err) { err.textContent = d.error || 'Failed to book leave.'; err.style.display = 'block'; }
    } else if (d.reassigned && d.reassigned.length) {
      closeLeaveModal();
      _showReassignSpinner(d.reassigned);
    } else {
      loadMyLeaves();
    }
  } catch { if (err) { err.textContent = 'Network error.'; err.style.display = 'block'; } }
}

function _showReassignSpinner(reassigned) {
  const rows = reassigned.map(s =>
    s.to
      ? `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#8b98a8">${s.stock}</span><span style="color:#2ecc71">→ ${s.to}</span></div>`
      : `<div style="display:flex;justify-content:space-between;gap:16px"><span style="color:#8b98a8">${s.stock}</span><span style="color:#ff5d5d">→ no replacement</span></div>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(13,17,23,0.96);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px';
  overlay.innerHTML = `
    <style>@keyframes _dspin{to{transform:rotate(360deg)}}</style>
    <div style="width:48px;height:48px;border:3px solid #222d3d;border-top-color:#d4af37;border-radius:50%;animation:_dspin 0.75s linear infinite;flex-shrink:0"></div>
    <div style="color:#d4af37;font-family:'Fraunces',serif;font-size:17px;font-weight:600">Leave Booked</div>
    <div style="background:#131922;border:1px solid #222d3d;border-radius:12px;padding:16px 20px;min-width:220px;max-width:300px;display:flex;flex-direction:column;gap:8px;font-size:13px">
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#8b98a8;text-transform:uppercase;margin-bottom:4px">${reassigned.length} Stock${reassigned.length > 1 ? 's' : ''} Auto-Reassigned</div>
      ${rows}
    </div>
    <div style="color:#8b98a8;font-size:12px">Refreshing dashboard…</div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => window.location.reload(), 2400);
}

async function cancelLeave(id, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await fetch(`/api/my-leaves/${id}`, { method: 'DELETE' });
    const d = await r.json();
    if (r.ok) {
      loadMyLeaves(); // will show ⏳ Awaiting Approval if pending, or remove entry if approved
    } else {
      btn.disabled = false; btn.textContent = 'Cancel';
    }
  } catch { btn.disabled = false; btn.textContent = 'Cancel'; }
}
