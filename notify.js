// notify.js — shared toast + modal dialogs, used in place of alert()/confirm().
//
// Same convention as theme.js: reads document.documentElement.dataset.theme
// ("light"/"dark") for styling, no page-specific CSS variables required.
// Include with <script src="notify.js"></script> on any page that needs it.
//
//   toast('Saved.')                          // info, auto-dismiss
//   toast('Saved.', 'success')
//   toast(err.message || 'Network error.', 'error')
//   await confirmModal('Delete "X"? This cannot be undone.', { danger: true })
//   await infoModal('To enable notifications:\n\n• Chrome: ...')

(function () {
  const STYLE_ID = 'aj-notify-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#aj-toast-stack{position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;max-width:min(360px,calc(100vw - 32px))}
@media (max-width:520px){#aj-toast-stack{left:16px;right:16px;bottom:16px;max-width:none}}
.aj-toast{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:10px;font-size:13px;line-height:1.45;font-weight:600;color:#f4f6f9;background:#1d2430;border-left:4px solid #7a8699;box-shadow:0 8px 28px rgba(0,0,0,.35);cursor:pointer;animation:aj-toast-in .18s ease-out}
.aj-toast.aj-out{animation:aj-toast-out .16s ease-in forwards}
.aj-toast .aj-toast-icon{flex:0 0 auto;font-size:15px;line-height:1}
.aj-toast .aj-toast-msg{white-space:pre-line;word-break:break-word}
.aj-toast.success{border-left-color:#2ecc71}
.aj-toast.error{border-left-color:#ff5d5d}
.aj-toast.info{border-left-color:#d4af37}
:root[data-theme="light"] .aj-toast{background:#20262f;color:#f4f6f9}
@keyframes aj-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes aj-toast-out{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(8px)}}

#aj-modal-backdrop{position:fixed;inset:0;background:rgba(8,10,14,.55);display:flex;align-items:center;justify-content:center;z-index:100000;padding:20px;animation:aj-fade-in .14s ease-out}
#aj-modal-backdrop.aj-out{animation:aj-fade-out .12s ease-in forwards}
.aj-modal{background:#151b24;color:#e6edf3;border:1px solid #2a3341;border-radius:14px;padding:22px 22px 18px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
:root[data-theme="light"] .aj-modal{background:#ffffff;color:#16233d;border-color:#e0ddd4}
.aj-modal-title{font-size:15px;font-weight:700;margin:0 0 8px}
.aj-modal-msg{font-size:13px;line-height:1.55;color:inherit;opacity:.88;white-space:pre-line}
.aj-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.aj-modal-btn{border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.aj-modal-btn.cancel{background:transparent;color:inherit;opacity:.65;border:1px solid currentColor}
.aj-modal-btn.cancel:hover{opacity:1}
.aj-modal-btn.confirm{background:#d4af37;color:#1a1206}
.aj-modal-btn.confirm.danger{background:#ff5d5d;color:#2b0505}
.aj-modal-btn.confirm.ok{background:#d4af37;color:#1a1206}
@keyframes aj-fade-in{from{opacity:0}to{opacity:1}}
@keyframes aj-fade-out{from{opacity:1}to{opacity:0}}
`;
    document.head.appendChild(style);
  }

  const ICONS = { success: '✓', error: '✕', info: 'ℹ' };

  function toast(message, type = 'info', duration = 3800) {
    injectStyles();
    let stack = document.getElementById('aj-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'aj-toast-stack';
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `aj-toast ${type}`;
    el.innerHTML = `<span class="aj-toast-icon">${ICONS[type] || ICONS.info}</span><span class="aj-toast-msg"></span>`;
    el.querySelector('.aj-toast-msg').textContent = message;
    const remove = () => {
      el.classList.add('aj-out');
      setTimeout(() => el.remove(), 160);
    };
    el.addEventListener('click', remove);
    stack.appendChild(el);
    setTimeout(remove, duration);
    return el;
  }

  function showModal({ title = '', message = '', confirmText = 'OK', cancelText = null, danger = false }) {
    injectStyles();
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.id = 'aj-modal-backdrop';
      const hasCancel = cancelText !== null;
      backdrop.innerHTML = `
        <div class="aj-modal" role="dialog" aria-modal="true">
          ${title ? `<p class="aj-modal-title"></p>` : ''}
          <p class="aj-modal-msg"></p>
          <div class="aj-modal-actions">
            ${hasCancel ? `<button type="button" class="aj-modal-btn cancel"></button>` : ''}
            <button type="button" class="aj-modal-btn confirm ${danger ? 'danger' : 'ok'}"></button>
          </div>
        </div>`;
      if (title) backdrop.querySelector('.aj-modal-title').textContent = title;
      backdrop.querySelector('.aj-modal-msg').textContent = message;
      if (hasCancel) backdrop.querySelector('.aj-modal-btn.cancel').textContent = cancelText;
      backdrop.querySelector('.aj-modal-btn.confirm').textContent = confirmText;

      const close = (result) => {
        backdrop.classList.add('aj-out');
        document.removeEventListener('keydown', onKey);
        setTimeout(() => backdrop.remove(), 120);
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter' && !hasCancel) close(true);
      };
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
      if (hasCancel) backdrop.querySelector('.aj-modal-btn.cancel').addEventListener('click', () => close(false));
      backdrop.querySelector('.aj-modal-btn.confirm').addEventListener('click', () => close(true));
      document.addEventListener('keydown', onKey);

      document.body.appendChild(backdrop);
      // Destructive confirms default focus to Cancel so a stray Enter doesn't confirm.
      (hasCancel ? backdrop.querySelector('.aj-modal-btn.cancel') : backdrop.querySelector('.aj-modal-btn.confirm')).focus();
    });
  }

  function confirmModal(message, { title = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = true } = {}) {
    return showModal({ title, message, confirmText, cancelText, danger });
  }

  function infoModal(message, { title = '', okText = 'Got it' } = {}) {
    return showModal({ title, message, confirmText: okText, cancelText: null, danger: false });
  }

  window.toast = toast;
  window.confirmModal = confirmModal;
  window.infoModal = infoModal;
})();
