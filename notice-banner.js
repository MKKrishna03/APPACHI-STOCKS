/* Home — notice banner: phones, all staff, every app open, on the days the owner set (notice.html).
   Moved here from the Stocks page so it greets people on Home. Closes with ✕; back on next app open. */
(function () {
  'use strict';
  var KEY = 'aj_notice_closed_v3';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var native = function () { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); };

  async function show() {
    if (!(native() || window.innerWidth <= 768)) return;
    if (document.querySelector('[data-notice-banner]')) return;
    var n;
    try { var r = await fetch('/api/notice'); if (!r.ok) return; n = (await r.json()).notice; } catch (e) { return; }
    if (!n || !n.body) return;
    var key = String(n.updated_at || '') + '|' + n.date_from;
    try { if (sessionStorage.getItem(KEY) === key) return; } catch (e) {}
    // times (9:51) and dates (01/12/2026) stand out in gold
    var body = esc(n.body).replace(/(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{1,2}:\d{2})/g, '<b style="color:#d4af37">$1</b>').replace(/\n/g, '<br>');
    var ov = document.createElement('div');
    ov.setAttribute('data-notice-banner', '');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = '<div style="position:relative;width:100%;max-width:440px;max-height:88vh;overflow-y:auto;background:var(--panel,#161d29);border:1.5px solid #d4af37;border-radius:18px;padding:24px 20px 20px;box-shadow:0 24px 64px rgba(0,0,0,.6);text-align:center;font-family:Inter,system-ui,sans-serif">' +
      '<button type="button" data-close aria-label="Close" style="position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:1px solid var(--border,#263142);background:var(--panel-elev,#1a2230);color:var(--text,#e8edf4);font-size:18px;line-height:1;cursor:pointer">✕</button>' +
      (n.top_line ? '<div style="font-size:14px;font-weight:700;color:var(--text-dim,#8b98a8);margin:4px 30px 10px;line-height:1.5">' + esc(n.top_line) + '</div>' : '<div style="height:18px"></div>') +
      '<div style="font-size:24px;font-weight:800;color:#d4af37;margin-bottom:14px">📢 ' + esc(n.heading || 'அறிவிப்பு') + '</div>' +
      '<div style="font-size:16.5px;line-height:1.75;color:var(--text,#e8edf4);text-align:left">' + body + '</div></div>';
    ov.addEventListener('click', function (e) {
      if (!e.target.closest('[data-close]')) return;
      try { sessionStorage.setItem(KEY, key); } catch (e2) {}
      ov.remove();
    });
    document.body.appendChild(ov);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
  try { // app brought back from the background counts as opening it again
    window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && window.Capacitor.Plugins.App.addListener('resume', function () {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      show();
    });
  } catch (e) {}
})();
