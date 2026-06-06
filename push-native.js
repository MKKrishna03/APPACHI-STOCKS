/* push-native.js — Capacitor Android utilities
   • Native FCM push registration
   • Custom date picker (replaces broken native date dialog in WebView)
   Include on every authenticated page: <script src="/push-native.js" defer></script>
   Does nothing on web browsers. */

(function () {
  'use strict';

  if (!window.Capacitor?.isNativePlatform?.()) return;

  /* ── FCM Push Registration ─────────────────────────────────────────── */
  async function registerFCM() {
    const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
    if (!PushNotifications) return;
    try {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;
      await PushNotifications.register();
      PushNotifications.addListener('registration', async (token) => {
        try {
          await fetch('/api/push/fcm-token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ token: token.value }),
          });
        } catch (e) { console.warn('[FCM] Failed to save token:', e.message); }
      });
      PushNotifications.addListener('registrationError', (err) => {
        console.error('[FCM] Registration error:', err.error);
      });
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = action.notification.data?.url;
        if (url) window.location.href = url;
      });
    } catch (e) { console.warn('[FCM] Setup failed:', e.message); }
  }

  /* ── Custom Date Picker ────────────────────────────────────────────── */
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function injectPickerStyles() {
    if (document.getElementById('cap-dp-style')) return;
    const s = document.createElement('style');
    s.id = 'cap-dp-style';
    s.textContent = `
      .cap-date-wrap { position:relative; display:inline-block; width:100%; }
      .cap-date-input {
        width:100%; padding:9px 36px 9px 12px; border-radius:8px;
        border:1.5px solid #c0cee4; background:#fff; font-size:14px;
        font-family:inherit; font-weight:700; color:#0f2044; cursor:pointer;
        box-sizing:border-box; text-align:left; outline:none;
      }
      .cap-date-input:focus { border-color:#b8973a; }
      .cap-date-icon {
        position:absolute; right:10px; top:50%; transform:translateY(-50%);
        pointer-events:none; font-size:16px; opacity:.6;
      }
      .cap-dp-popup {
        position:fixed; z-index:99999; background:#fff;
        border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,0.28);
        padding:16px; width:300px; max-width:92vw;
        font-family:inherit;
      }
      .cap-dp-head {
        display:flex; align-items:center; justify-content:space-between;
        margin-bottom:12px;
      }
      .cap-dp-nav {
        background:none; border:none; font-size:20px; cursor:pointer;
        color:#0f2044; padding:4px 10px; border-radius:8px;
        line-height:1;
      }
      .cap-dp-nav:active { background:#eef2f7; }
      .cap-dp-label {
        font-size:15px; font-weight:800; color:#0f2044; letter-spacing:.04em;
      }
      .cap-dp-grid {
        display:grid; grid-template-columns:repeat(7,1fr); gap:2px;
        text-align:center;
      }
      .cap-dp-dow {
        font-size:10px; font-weight:700; color:#8b98a8;
        padding:4px 0; text-transform:uppercase; letter-spacing:.06em;
      }
      .cap-dp-cell {
        padding:8px 0; border-radius:8px; font-size:14px; font-weight:700;
        cursor:pointer; color:#0f2044; border:none; background:none;
      }
      .cap-dp-cell:active { background:#eef2f7; }
      .cap-dp-cell.today { border:1.5px solid #b8973a; color:#b8973a; }
      .cap-dp-cell.selected { background:#0f2044; color:#d4ae56 !important; border-color:transparent; }
      .cap-dp-cell.empty { cursor:default; }
      .cap-dp-cell.other-month { color:#c0cee4; }
      .cap-dp-footer {
        display:flex; justify-content:flex-end; gap:8px; margin-top:12px;
      }
      .cap-dp-btn {
        padding:8px 20px; border-radius:8px; border:none; font-size:13px;
        font-weight:700; cursor:pointer; font-family:inherit;
      }
      .cap-dp-cancel { background:#eef2f7; color:#0f2044; }
      .cap-dp-set { background:#0f2044; color:#d4ae56; }
    `;
    document.head.appendChild(s);
  }

  function buildPopup(currentVal, onSet) {
    const today = new Date();
    let viewYear  = today.getFullYear();
    let viewMonth = today.getMonth(); // 0-based
    let selectedDate = null;

    if (currentVal && /^\d{4}-\d{2}-\d{2}$/.test(currentVal)) {
      const p = currentVal.split('-');
      viewYear  = parseInt(p[0]);
      viewMonth = parseInt(p[1]) - 1;
      selectedDate = currentVal;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.25);';

    const popup = document.createElement('div');
    popup.className = 'cap-dp-popup';

    function renderCalendar() {
      const firstDay = new Date(viewYear, viewMonth, 1).getDay();
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const todayStr = today.toLocaleDateString('en-CA');

      popup.innerHTML = `
        <div class="cap-dp-head">
          <button class="cap-dp-nav" id="dp-prev">&#8249;</button>
          <span class="cap-dp-label">${MONTHS[viewMonth]} ${viewYear}</span>
          <button class="cap-dp-nav" id="dp-next">&#8250;</button>
        </div>
        <div class="cap-dp-grid">
          ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div class="cap-dp-dow">${d}</div>`).join('')}
          ${Array(firstDay).fill('<div class="cap-dp-cell empty"></div>').join('')}
          ${Array.from({length:daysInMonth},(_,i)=>{
            const d = i + 1;
            const ds = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const cls = [
              'cap-dp-cell',
              ds === todayStr   ? 'today'    : '',
              ds === selectedDate ? 'selected' : '',
            ].filter(Boolean).join(' ');
            return `<button class="${cls}" data-date="${ds}">${d}</button>`;
          }).join('')}
        </div>
        <div class="cap-dp-footer">
          <button class="cap-dp-btn cap-dp-cancel" id="dp-cancel">Cancel</button>
          <button class="cap-dp-btn cap-dp-set" id="dp-set">Set</button>
        </div>
      `;

      popup.querySelector('#dp-prev').onclick = () => {
        viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        renderCalendar();
      };
      popup.querySelector('#dp-next').onclick = () => {
        viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        renderCalendar();
      };
      popup.querySelectorAll('.cap-dp-cell[data-date]').forEach(btn => {
        btn.onclick = () => { selectedDate = btn.dataset.date; renderCalendar(); };
      });
      popup.querySelector('#dp-cancel').onclick = close;
      popup.querySelector('#dp-set').onclick = () => {
        if (selectedDate) onSet(selectedDate);
        close();
      };
    }

    function close() {
      overlay.remove();
      popup.remove();
    }

    overlay.onclick = close;

    // Position popup in centre of screen
    popup.style.cssText += 'left:50%;top:50%;transform:translate(-50%,-50%);';

    renderCalendar();
    document.body.appendChild(overlay);
    document.body.appendChild(popup);
  }

  function convertDateInput(input) {
    if (input.dataset.capConverted) return;
    input.dataset.capConverted = '1';

    // Build wrapper
    const wrap = document.createElement('div');
    wrap.className = 'cap-date-wrap';
    input.parentNode.insertBefore(wrap, input);

    // Visible button showing the selected date
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cap-date-input ' + (input.className || '');
    btn.style.cssText = input.style.cssText;

    const icon = document.createElement('span');
    icon.className = 'cap-date-icon';
    icon.textContent = '📅';

    function updateLabel() {
      const v = input.value;
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [y,m,d] = v.split('-');
        btn.textContent = `${d} ${MONTHS[parseInt(m)-1]} ${y}`;
      } else {
        btn.textContent = input.placeholder || 'Select date';
      }
      btn.appendChild(icon);
    }
    updateLabel();

    btn.onclick = () => {
      buildPopup(input.value, (dateStr) => {
        input.value = dateStr;
        updateLabel();
        // Fire change event so page listeners (onchange, renderRecords etc.) fire
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input',  { bubbles: true }));
      });
    };

    // Hide original input but keep it in DOM for value/events
    input.style.display = 'none';
    wrap.appendChild(input);
    wrap.appendChild(btn);
    wrap.appendChild(icon);
  }

  function convertAllDateInputs() {
    document.querySelectorAll('input[type="date"]:not([data-cap-converted])').forEach(convertDateInput);
  }

  function init() {
    injectPickerStyles();
    convertAllDateInputs();
    // Watch for dynamically added date inputs (e.g. addDateRow in leaves.html)
    new MutationObserver(convertAllDateInputs).observe(document.body, { childList: true, subtree: true });
    registerFCM();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
