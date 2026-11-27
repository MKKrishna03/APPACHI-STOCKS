/* Restock — swipe deck. One range per card:
   swipe right (→) = Ordered · left (←) = Not required · down (↓) = Skip · Undo (Ctrl+Z) · Esc closes.
   window.restockSwipe({ title, items: [{ title, sub, fields: [[label, text]], big: [label, text] }], onOrder(i), onNotReq(i), onUndo(i, what), onClose(changed) })
   Self-contained: injects its own styles, uses shared.css colours. */
(function () {
  'use strict';
  var FAR = 110;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  var CSS = '' +
    '.rs-deck{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 16px 22px;background:rgba(10,12,18,.84);opacity:0;transition:opacity .2s;touch-action:none;user-select:none;font-family:inherit}' +
    '.rs-deck.in{opacity:1}' +
    '.rs-top{width:100%;max-width:440px;display:flex;align-items:center;gap:10px;color:#fff;font-size:15px}' +
    '.rs-count{margin-left:auto;font-size:13px;opacity:.75}' +
    '.rs-x{border:0;background:rgba(255,255,255,.12);color:#fff;width:34px;height:34px;border-radius:50%;font-size:15px;cursor:pointer}' +
    '.rs-stack{position:relative;flex:1;width:100%;max-width:440px;max-height:430px;margin:16px 0}' +
    '.rs-card{position:absolute;inset:0;padding:24px 22px;border-radius:20px;background:var(--panel,#131922);border:1px solid var(--border,#222d3d);box-shadow:0 18px 50px rgba(0,0,0,.45);overflow:auto;cursor:grab;will-change:transform;color:var(--text,#e6edf3)}' +
    '.rs-card:active{cursor:grabbing}' +
    '.rs-next{transform:scale(.94) translateY(14px);opacity:.55;pointer-events:none}' +
    '.rs-sub{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim,#8b98a8)}' +
    '.rs-title{font-size:23px;font-weight:800;margin:4px 0 16px;line-height:1.2}' +
    '.rs-big{display:flex;align-items:baseline;gap:10px;margin-bottom:16px;padding:12px 16px;border-radius:14px;background:rgba(212,175,55,.12)}' +
    '.rs-big b{font-size:40px;line-height:1;color:var(--accent,#d4af37)}.rs-big span{font-size:14px;font-weight:700;color:var(--text-dim,#8b98a8)}' +
    '.rs-card dl{display:grid;grid-template-columns:auto 1fr;gap:10px 18px;margin:0}' +
    '.rs-card dt{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-dim,#8b98a8);align-self:center}' +
    '.rs-card dd{margin:0;font-size:18px;font-weight:700}' +
    '.rs-stamp{position:absolute;bottom:22px;padding:4px 12px;border:4px solid;border-radius:8px;font:900 22px/1 Georgia,serif;opacity:0;pointer-events:none;background:var(--panel,#131922)}' +
    '.rs-stamp.ok{right:18px;color:#3fcf6e;transform:rotate(12deg)}.rs-stamp.no{left:18px;color:#ff6b63;transform:rotate(-12deg)}' +
    '.rs-show-ok .rs-stamp.ok,.rs-show-no .rs-stamp.no{opacity:1!important}' +
    '.rs-end{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;cursor:default}' +
    '.rs-end .e{font-size:66px;line-height:1}.rs-end b{font-size:23px;color:#3fcf6e}.rs-end span{color:var(--text-dim,#8b98a8)}' +
    '.rs-btns{display:flex;gap:14px;align-items:center}' +
    '.rs-b{width:62px;height:62px;border-radius:50%;border:0;background:var(--panel,#131922);color:var(--text,#e6edf3);font-size:22px;font-weight:800;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;box-shadow:0 6px 18px rgba(0,0,0,.35);transition:transform .12s;font-family:inherit}' +
    '.rs-b small{font-size:10px;font-weight:700;margin-top:3px}.rs-b:active{transform:scale(.92)}.rs-b:disabled{opacity:.35;cursor:default}' +
    '.rs-no{color:#ff6b63}.rs-ok{color:#3fcf6e;width:76px;height:76px;font-size:28px}' +
    '.rs-undo,.rs-skip{width:48px;height:48px;font-size:17px;color:var(--text-dim,#8b98a8)}' +
    '.rs-tip{margin-top:12px;font-size:12px;color:rgba(255,255,255,.6)}';

  function addCss() {
    if (document.getElementById('rsDeckCss')) return;
    var s = document.createElement('style'); s.id = 'rsDeckCss'; s.textContent = CSS; document.head.appendChild(s);
  }

  window.restockSwipe = function (o) {
    addCss();
    var items = o.items.slice(), i = 0, changed = false, busy = false, done = [], counts = { ok: 0, no: 0 };
    var el = document.createElement('div');
    el.className = 'rs-deck';
    el.innerHTML =
      '<div class="rs-top"><b>' + esc(o.title || 'Restock') + '</b><span class="rs-count"></span><button type="button" class="rs-x" title="Close (Esc)">✕</button></div>' +
      '<div class="rs-stack"></div>' +
      '<div class="rs-btns">' +
        '<button type="button" class="rs-b rs-no" title="Not required (←)">✗<small>Not req.</small></button>' +
        '<button type="button" class="rs-b rs-undo" title="Undo (Ctrl+Z)">↶<small>Undo</small></button>' +
        '<button type="button" class="rs-b rs-skip" title="Skip (↓)">⤼<small>Skip</small></button>' +
        '<button type="button" class="rs-b rs-ok" title="Order (→)">✓<small>Order</small></button>' +
      '</div>' +
      '<div class="rs-tip">Swipe right ✓ Order · left ✗ Not required</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    var stack = el.querySelector('.rs-stack');
    var q = function (s) { return el.querySelector(s); };

    function cardHtml(it, next) {
      return '<div class="rs-card' + (next ? ' rs-next' : '') + '">' +
        '<div class="rs-stamp ok">ORDER ✓</div><div class="rs-stamp no">NOT REQ ✗</div>' +
        (it.sub ? '<div class="rs-sub">' + esc(it.sub) + '</div>' : '') +
        '<div class="rs-title">' + esc(it.title) + '</div>' +
        (it.big ? '<div class="rs-big"><b>' + esc(it.big[1]) + '</b><span>' + esc(it.big[0]) + '</span></div>' : '') +
        '<dl>' + it.fields.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('') + '</dl></div>';
    }
    function render() {
      q('.rs-count').textContent = i < items.length ? (i + 1) + ' of ' + items.length : '';
      q('.rs-undo').disabled = !done.length;
      var end = i >= items.length;
      ['.rs-no', '.rs-skip', '.rs-ok'].forEach(function (s) { q(s).disabled = end; });
      if (end) {
        stack.innerHTML = '<div class="rs-card rs-end"><div class="e">🎉</div><b>All done</b><span>' + counts.ok + ' ordered · ' + counts.no + ' not required</span></div>';
        return;
      }
      stack.innerHTML = (items[i + 1] ? cardHtml(items[i + 1], true) : '') + cardHtml(items[i]);
      wire(stack.lastElementChild);
    }
    function close() {
      el.classList.remove('in');
      removeEventListener('keydown', onKey);
      setTimeout(function () { el.remove(); }, 220);
      if (o.onClose) o.onClose(changed);
    }
    function fling(dir) {
      if (busy || i >= items.length) return;
      var card = stack.lastElementChild, it = items[i];
      busy = true;
      var x = dir === 'ok' ? innerWidth : dir === 'no' ? -innerWidth : 0, y = dir === 'skip' ? innerHeight : 40;
      card.classList.add('rs-show-' + dir);
      card.style.transition = 'transform .32s ease-in, opacity .32s';
      card.style.transform = 'translate(' + x + 'px,' + y + 'px) rotate(' + (dir === 'ok' ? 24 : dir === 'no' ? -24 : 0) + 'deg)';
      card.style.opacity = '0';
      setTimeout(async function () {
        try {
          if (dir === 'ok') { await o.onOrder(it); counts.ok++; done.push([it, 'ok']); changed = true; }
          if (dir === 'no') { await o.onNotReq(it); counts.no++; done.push([it, 'no']); changed = true; }
        } catch (e) { busy = false; if (window.toast) window.toast('Could not save: ' + e.message, 'error'); render(); return; }
        busy = false; i++; render();
      }, 300);
    }
    async function undo() {
      if (busy || !done.length) return;
      var last = done.pop();
      busy = true;
      try { await o.onUndo(last[0], last[1]); counts[last[1]]--; }
      catch (e) { done.push(last); busy = false; if (window.toast) window.toast('Could not undo: ' + e.message, 'error'); return; }
      busy = false;
      i = Math.max(0, items.indexOf(last[0])); render();
    }
    function wire(card) {
      var sx = 0, dx = 0, drag = false, raf = 0;
      var show = function () {
        raf = 0;
        card.style.transform = 'translate(' + dx + 'px,' + Math.abs(dx) * 0.08 + 'px) rotate(' + dx / 18 + 'deg)';
        card.querySelector('.rs-stamp.ok').style.opacity = Math.max(0, Math.min(1, dx / FAR));
        card.querySelector('.rs-stamp.no').style.opacity = Math.max(0, Math.min(1, -dx / FAR));
      };
      card.addEventListener('pointerdown', function (e) {
        if (busy) return;
        drag = true; sx = e.clientX; dx = 0;
        card.setPointerCapture(e.pointerId);
        card.style.transition = 'none';
      });
      card.addEventListener('pointermove', function (e) {
        if (!drag) return;
        dx = e.clientX - sx;
        if (!raf) raf = requestAnimationFrame(show);
      });
      var up = function () {
        if (!drag) return;
        drag = false; cancelAnimationFrame(raf); raf = 0;
        if (dx > FAR) return fling('ok');
        if (dx < -FAR) return fling('no');
        card.style.transition = 'transform .35s cubic-bezier(.3,1.5,.5,1)';
        card.style.transform = '';
        card.querySelectorAll('.rs-stamp').forEach(function (s) { s.style.opacity = 0; });
      };
      card.addEventListener('pointerup', up);
      card.addEventListener('pointercancel', up);
    }
    function onKey(e) {
      if (e.key === 'ArrowRight') fling('ok');
      else if (e.key === 'ArrowLeft') fling('no');
      else if (e.key === 'ArrowDown') fling('skip');
      else if (e.key === 'Escape') close();
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') undo();
      else return;
      e.preventDefault();
    }
    addEventListener('keydown', onKey);
    q('.rs-x').onclick = close;
    q('.rs-ok').onclick = function () { fling('ok'); };
    q('.rs-no').onclick = function () { fling('no'); };
    q('.rs-skip').onclick = function () { fling('skip'); };
    q('.rs-undo').onclick = undo;
    render();
  };
})();
