/* Purchase Pro — swipe deck. Full-screen cards, one item at a time:
   swipe right (or →) = OK / verified, swipe left (or ←) = fix (opens the item), Skip, Undo.
   PP.swipeDeck({ title, items: [{ id, href, title, fields: [[label, text]] }], onOk(item), onUndo(item), onClose(changed) }) */
(function () {
  'use strict';
  const PP = window.PP = window.PP || {};
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FAR = 110; // px past which a release counts as a swipe

  PP.swipeDeck = function (o) {
    const items = o.items.slice();
    let i = 0, changed = false, busy = false;
    const done = []; // verified items, for Undo
    const el = document.createElement('div');
    el.className = 'sw-deck';
    el.innerHTML = `
      <div class="sw-top"><b>${esc(o.title || 'Check')}</b><span class="sw-count"></span><button type="button" class="sw-x" title="Close (Esc)">✕</button></div>
      <div class="sw-stack"></div>
      <div class="sw-btns">
        <button type="button" class="sw-b sw-fix" title="Fix — open it (←)">✗<small>Fix</small></button>
        <button type="button" class="sw-b sw-undo" title="Undo last OK">↶<small>Undo</small></button>
        <button type="button" class="sw-b sw-skip" title="Skip (↓)">⤼<small>Skip</small></button>
        <button type="button" class="sw-b sw-ok" title="OK — verified (→)">✓<small>OK</small></button>
      </div>
      <div class="sw-tip">Swipe right ✓ OK · left ✗ Fix</div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const stack = el.querySelector('.sw-stack');

    function cardHtml(it) {
      return `<div class="sw-card">
        <div class="sw-stamp ok">OK ✓</div><div class="sw-stamp fix">FIX ✗</div>
        <div class="sw-title">${esc(it.title)}</div>
        <dl>${it.fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </div>`;
    }
    function render() {
      el.querySelector('.sw-count').textContent = i < items.length ? `${i + 1} of ${items.length}` : '';
      el.querySelector('.sw-undo').disabled = !done.length;
      if (i >= items.length) {
        stack.innerHTML = `<div class="sw-card sw-end"><div class="sw-big">🎉</div><b>All checked</b><span>${done.length} marked OK</span></div>`;
        el.querySelectorAll('.sw-fix,.sw-skip,.sw-ok').forEach(b => b.disabled = true);
        return;
      }
      el.querySelectorAll('.sw-fix,.sw-skip,.sw-ok').forEach(b => b.disabled = false);
      stack.innerHTML = (items[i + 1] ? cardHtml(items[i + 1]).replace('sw-card', 'sw-card sw-next') : '') + cardHtml(items[i]);
      wire(stack.lastElementChild);
    }
    function close() {
      el.classList.remove('in');
      removeEventListener('keydown', onKey);
      setTimeout(() => el.remove(), 220);
      o.onClose?.(changed);
    }
    // throw the top card off-screen, then act
    function fling(dir) {
      if (busy || i >= items.length) return;
      const card = stack.lastElementChild, it = items[i];
      busy = true;
      PP.sound?.('whoosh');
      const x = dir === 'ok' ? innerWidth : dir === 'fix' ? -innerWidth : 0, y = dir === 'skip' ? innerHeight : 40;
      card.classList.add('sw-show-' + dir);
      card.style.transition = 'transform .32s ease-in, opacity .32s';
      card.style.transform = `translate(${x}px, ${y}px) rotate(${dir === 'ok' ? 24 : dir === 'fix' ? -24 : 0}deg)`;
      card.style.opacity = '0';
      setTimeout(async () => {
        busy = false;
        if (dir === 'fix') { if (it.href) location.hash = it.href; close(); return; } // navigate first so Checker doesn't reload over it
        if (dir === 'ok') {
          try { await o.onOk(it); done.push(it); changed = true; }
          catch (e) { PP.toast?.(e.message || 'Could not save', true); render(); return; }
        }
        i++; render();
      }, 300);
    }
    async function undo() {
      if (busy || !done.length) return;
      const it = done.pop();
      try { await o.onUndo?.(it); } catch (e) { PP.toast?.(e.message || 'Could not undo', true); done.push(it); return; }
      i = Math.max(0, items.indexOf(it)); render();
    }
    function wire(card) {
      let sx = 0, sy = 0, dx = 0, drag = false, raf = 0;
      const show = () => {
        raf = 0;
        card.style.transform = `translate(${dx}px, ${Math.abs(dx) * 0.08}px) rotate(${dx / 18}deg)`;
        card.querySelector('.sw-stamp.ok').style.opacity = Math.max(0, Math.min(1, dx / FAR));
        card.querySelector('.sw-stamp.fix').style.opacity = Math.max(0, Math.min(1, -dx / FAR));
      };
      card.addEventListener('pointerdown', (e) => {
        if (busy) return;
        drag = true; sx = e.clientX; sy = e.clientY; dx = 0;
        card.setPointerCapture(e.pointerId);
        card.style.transition = 'none';
      });
      card.addEventListener('pointermove', (e) => {
        if (!drag) return;
        dx = e.clientX - sx;
        if (!raf) raf = requestAnimationFrame(show);
      });
      const up = () => {
        if (!drag) return;
        drag = false; cancelAnimationFrame(raf); raf = 0;
        if (dx > FAR) return fling('ok');
        if (dx < -FAR) return fling('fix');
        card.style.transition = 'transform .35s cubic-bezier(.3,1.5,.5,1)'; // snap back
        card.style.transform = '';
        card.querySelectorAll('.sw-stamp').forEach(s => s.style.opacity = 0);
      };
      card.addEventListener('pointerup', up);
      card.addEventListener('pointercancel', up);
    }
    function onKey(e) {
      if (e.key === 'ArrowRight') fling('ok');
      else if (e.key === 'ArrowLeft') fling('fix');
      else if (e.key === 'ArrowDown') fling('skip');
      else if (e.key === 'Escape') close();
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') undo();
      else return;
      e.preventDefault();
    }
    addEventListener('keydown', onKey);
    el.querySelector('.sw-x').onclick = close;
    el.querySelector('.sw-ok').onclick = () => fling('ok');
    el.querySelector('.sw-fix').onclick = () => fling('fix');
    el.querySelector('.sw-skip').onclick = () => fling('skip');
    el.querySelector('.sw-undo').onclick = undo;
    render();
  };
})();
