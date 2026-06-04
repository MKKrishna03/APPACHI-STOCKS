// auth.js — shared auth check, user info display, PIN/Leave modals, biometric lock

// ── Biometric lock (Capacitor native app only) ────────────────────────────────
(async () => {
  if (!window.Capacitor?.isNativePlatform()) return; // web browser — skip
  const BiometricAuth = window.Capacitor.Plugins?.BiometricAuth;
  if (!BiometricAuth) return;

  try {
    const { isAvailable } = await BiometricAuth.isAvailable();
    if (!isAvailable) return;
  } catch { return; }

  // Show Lock buttons (native app only)
  setTimeout(() => {
    ['_sidebarLockBtn', '_mnavLockBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
  }, 800);

  // Already verified this session? (cleared on manual lock)
  if (sessionStorage.getItem('bio_verified')) return;

  // Show blocking overlay immediately — content hidden until authenticated
  await _showBioLock();
})();

async function _showBioLock() {
  const BiometricAuth = window.Capacitor?.Plugins?.BiometricAuth;
  if (!BiometricAuth) return;

  // Full-screen lock overlay
  let overlay = document.getElementById('_bioLock');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = '_bioLock';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0d1117;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px';
    overlay.innerHTML = `
      <div style="width:80px;height:80px;background:linear-gradient(135deg,#d4af37,#9c7c1a);border-radius:20px;display:grid;place-items:center;font-family:Georgia,serif;font-weight:800;font-size:38px;color:#0d1117">S</div>
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:600;color:#e6edf3;letter-spacing:.04em">APPACHI</div>
      <div id="_bioStatus" style="font-size:15px;color:#8b98a8;text-align:center;padding:0 40px;line-height:1.6">Authenticating…</div>
      <button id="_bioRetry" onclick="_bioAuthenticate()" style="display:none;padding:14px 36px;background:linear-gradient(135deg,#d4af37,#9c7c1a);border:none;border-radius:12px;color:#0d1117;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit">
        🔒 Tap to Unlock
      </button>`;
    document.body.appendChild(overlay);
  }

  await _bioAuthenticate();
}

async function _bioAuthenticate() {
  const BiometricAuth = window.Capacitor?.Plugins?.BiometricAuth;
  if (!BiometricAuth) return;

  const status  = document.getElementById('_bioStatus');
  const retryBtn = document.getElementById('_bioRetry');
  if (status)   status.textContent  = 'Place your finger on the sensor…';
  if (retryBtn) retryBtn.style.display = 'none';

  try {
    await BiometricAuth.authenticate({
      title:      'APPACHI Stocks',
      subtitle:   'Verify your identity to continue',
      cancelText: 'Use PIN Instead',
    });
    // Success — remove overlay and mark session
    sessionStorage.setItem('bio_verified', '1');
    const overlay = document.getElementById('_bioLock');
    if (overlay) overlay.remove();
  } catch (err) {
    // Cancelled or error — show retry button
    if (status)   status.textContent  = 'Authentication cancelled.\nTap the button to try again.';
    if (retryBtn) retryBtn.style.display = 'block';
  }
}

/** Call this to lock the app (from Lock button in UI) */
function lockApp() {
  sessionStorage.removeItem('bio_verified');
  _showBioLock();
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
  const roleTag = role === 'OWNER'
    ? ' <span style="color:var(--accent);font-size:10px">OWNER</span>'
    : role === 'COMPUTER'
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
        <button onclick="showChangePinModal()"
          style="width:100%;padding:5px 0;background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text-dim);cursor:pointer;font-size:11px;font-family:inherit">
          Change PIN
        </button>
        <button id="_sidebarLockBtn" onclick="lockApp()" style="display:none;width:100%;padding:5px 0;background:transparent;border:1px solid rgba(212,175,55,0.25);border-radius:6px;color:var(--accent);cursor:pointer;font-size:11px;font-family:inherit">
          🔒 Lock App
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
  if (userLabel) userLabel.textContent = me.name + (role === 'OWNER' ? ' ★' : role === 'COMPUTER' ? ' ●' : '');

  // ── Responsive modal styles (bottom-sheet on mobile) ─────────────────────────
  const _ms = document.createElement('style');
  _ms.textContent = `
    .auth-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;align-items:center;justify-content:center;padding:20px}
    .auth-modal-panel{background:#131922;border:1px solid #222d3d;border-radius:16px;padding:32px;width:100%;max-width:420px;max-height:82vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.6)}
    @media(max-width:1024px),(hover:none) and (pointer:coarse){
      .auth-modal-overlay{align-items:flex-end!important;padding:0!important}
      .auth-modal-panel{max-width:100%!important;max-height:88dvh!important;border-radius:22px 22px 0 0!important;padding:28px 24px 32px!important}
      .auth-modal-panel h3{font-size:22px!important}
      .auth-modal-panel p{font-size:15px!important}
      .auth-modal-panel label{font-size:13px!important}
      .auth-modal-panel input{font-size:16px!important;padding:14px!important}
      .auth-modal-panel button{font-size:16px!important;padding:15px!important}
      .auth-modal-panel .leave-date-row button{padding:14px 20px!important}
      .auth-modal-panel #leaveList{font-size:15px!important}
      .auth-modal-panel #leaveErr,
      .auth-modal-panel #pinModalErr{font-size:14px!important}
    }
  `;
  document.head.appendChild(_ms);

  // ── Leave modal ───────────────────────────────────────────────────────────────
  const leaveOverlay = document.createElement('div');
  leaveOverlay.id = 'leaveModalOverlay';
  leaveOverlay.className = 'auth-modal-overlay';
  leaveOverlay.onclick = e => { if (e.target === leaveOverlay) closeLeaveModal(); };
  leaveOverlay.innerHTML = `
    <div class="auth-modal-panel">
      <h3 style="font-family:'Fraunces',Georgia,serif;font-size:18px;color:#e6edf3;margin:0 0 6px">My Leave</h3>
      <p style="font-size:12px;color:#8b98a8;margin-bottom:20px;line-height:1.5">Book dates you won't be available — you won't be assigned any stocks on those days.</p>
      <div class="leave-date-row" style="display:flex;gap:10px;margin-bottom:8px">
        <input id="leaveDate" type="date"
          style="flex:1;padding:9px 12px;background:#1a2230;border:1px solid #222d3d;border-radius:8px;color:#e6edf3;font-size:14px;font-family:inherit;outline:none;-webkit-appearance:none"/>
        <button onclick="bookLeave()"
          style="padding:9px 16px;background:linear-gradient(135deg,#d4af37,#9c7c1a);border:none;border-radius:8px;color:#0d1117;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">
          Book
        </button>
      </div>
      <div id="leaveErr" style="display:none;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);border-radius:8px;padding:10px 12px;font-size:13px;color:#ff5d5d;margin-bottom:12px"></div>
      <div id="leaveList" style="font-size:13px;color:#8b98a8;margin-top:16px">Loading…</div>
      <button onclick="closeLeaveModal()"
        style="margin-top:20px;width:100%;padding:10px;background:transparent;border:1px solid #222d3d;border-radius:8px;color:#8b98a8;cursor:pointer;font-family:inherit;font-size:13px">
        Close
      </button>
    </div>`;
  document.body.appendChild(leaveOverlay);

  // ── PIN change modal ──────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'pinModalOverlay';
  overlay.className = 'auth-modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) closePinModal(); };
  overlay.innerHTML = `
    <div class="auth-modal-panel">
      <h3 style="font-family:'Fraunces',Georgia,serif;font-size:18px;color:#e6edf3;margin:0 0 20px">Change PIN</h3>
      <div id="pinModalErr" style="display:none;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);border-radius:8px;padding:10px 12px;font-size:13px;color:#ff5d5d;margin-bottom:14px"></div>
      ${['Current PIN|pinCurrent|Current PIN', 'New PIN|pinNew|4–6 digits', 'Confirm New PIN|pinConfirm|Repeat new PIN'].map(s => {
        const [label, id, placeholder] = s.split('|');
        return `<div style="margin-bottom:14px">
          <label style="display:block;font-size:11px;font-weight:600;color:#8b98a8;text-transform:uppercase;letter-spacing:.8px;margin-bottom:7px">${label}</label>
          <input id="${id}" type="password" inputmode="numeric" placeholder="${placeholder}"
            style="width:100%;padding:10px 12px;background:#1a2230;border:1px solid #222d3d;border-radius:8px;color:#e6edf3;font-size:16px;font-family:'JetBrains Mono',monospace,sans-serif;outline:none;-webkit-appearance:none;box-sizing:border-box"/>
        </div>`;
      }).join('')}
      <div style="display:flex;gap:10px;margin-top:6px">
        <button onclick="closePinModal()"
          style="flex:1;padding:11px;background:transparent;border:1px solid #222d3d;border-radius:8px;color:#8b98a8;cursor:pointer;font-family:inherit;font-size:13px">
          Cancel
        </button>
        <button onclick="submitPinChange()" id="pinSaveBtn"
          style="flex:2;padding:11px;background:linear-gradient(135deg,#d4af37,#9c7c1a);border:none;border-radius:8px;color:#0d1117;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
          Save PIN
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
})();

function showChangePinModal() {
  const o = document.getElementById('pinModalOverlay');
  if (o) { o.style.display = 'flex'; document.getElementById('pinCurrent')?.focus(); }
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
  o.style.display = 'flex';
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const inp = document.getElementById('leaveDate');
  if (inp) { inp.min = tomorrowStr; if (!inp.value || inp.value < tomorrowStr) inp.value = tomorrowStr; }
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
      html += upcoming.map(l => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#1a2230;border-radius:8px;margin-bottom:6px">
          <span style="color:#e6edf3;font-family:'JetBrains Mono',monospace;font-size:13px">${fmtDate(l.date)}</span>
          <button onclick="cancelLeave(${l.id},this)"
            style="font-size:10px;padding:3px 10px;background:rgba(255,93,93,0.15);border:1px solid rgba(255,93,93,0.3);border-radius:6px;color:#ff5d5d;cursor:pointer;font-family:inherit">
            Cancel
          </button>
        </div>`).join('');
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

async function bookLeave() {
  const inp = document.getElementById('leaveDate');
  const err = document.getElementById('leaveErr');
  if (err) err.style.display = 'none';
  const date = inp?.value;
  if (!date) { if (err) { err.textContent = 'Please select a date.'; err.style.display = 'block'; } return; }
  try {
    const r = await fetch('/api/my-leaves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }),
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
    if (r.ok) loadMyLeaves(); else { btn.disabled = false; btn.textContent = 'Cancel'; }
  } catch { btn.disabled = false; btn.textContent = 'Cancel'; }
}
