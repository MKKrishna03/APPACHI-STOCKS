/* Purchase Pro — single date / month picker in the same look as the date range picker.
   Every <input type="date"> and <input type="month"> on the page is upgraded automatically:
   the input stays (hidden) so its .value, 'input' and 'change' keep working for the page code,
   and a button that looks like the input opens the calendar. */
(function () {
  'use strict';
  const PP = window.PP;
  const { esc } = PP;

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +(m[3] || 1)) : null; };
  const todayD = () => parse(PP.today());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SHORT = MONTHS.map(m => m.slice(0, 3));
  const ICON = '<svg fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>';
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  let pop = null, cur = null;   // one popup for the whole page

  function text(inp) {
    const v = inp.value, d = parse(v);
    if (!d) return '';
    return inp.dataset.dpMode === 'month' ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function paint(inp) {
    const b = inp._dpBtn; if (!b) return;
    const t = text(inp);
    b.querySelector('.dp-t').innerHTML = t ? esc(t) : `<span class="dp-ph">${inp.dataset.dpMode === 'month' ? 'All months' : 'Pick date'}</span>`;
    b.disabled = inp.disabled;
  }

  function enhance(inp) {
    if (inp._dpBtn || inp.closest('.dr, .dp-pop')) return;
    const mode = inp.type === 'month' ? 'month' : 'date';
    inp.dataset.dpMode = mode;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dp-btn ${inp.classList.contains('cin') ? 'cin' : 'input'}`;
    b.style.cssText = inp.style.cssText;
    b.title = inp.title || '';
    b.innerHTML = `${ICON}<span class="dp-t"></span>`;
    inp._dpBtn = b;
    inp.insertAdjacentElement('afterend', b);
    inp.classList.add('dp-hidden');
    // code that sets .value directly updates the button too
    Object.defineProperty(inp, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); paint(this); } });
    new MutationObserver(() => paint(inp)).observe(inp, { attributes: true, attributeFilter: ['disabled', 'value'] });
    b.addEventListener('click', () => (cur === inp ? close() : open(inp)));
    if (inp.id) b.id = inp.id + 'Btn';
    paint(inp);
  }

  function set(inp, v) {
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    inp._dpBtn?.focus();
  }

  function open(inp) {
    close();
    cur = inp;
    const d = parse(inp.value) || todayD();
    view = new Date(d.getFullYear(), d.getMonth(), 1);
    pop = document.createElement('div');
    pop.className = 'dp-pop';
    document.body.appendChild(pop);
    draw();
    place();
    setTimeout(() => { document.addEventListener('mousedown', outside); }, 0);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  }
  function close() {
    if (pop) pop.remove();
    pop = null; cur = null;
    document.removeEventListener('mousedown', outside);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  }
  function outside(e) { if (pop && !pop.contains(e.target) && e.target.closest('.dp-btn') !== cur?._dpBtn) close(); }
  function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
  function place() {
    if (!pop || !cur?._dpBtn?.isConnected) return close();
    const r = cur._dpBtn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8), top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  let view = null;
  const lim = () => ({ min: cur.min || '', max: cur.max || '' });

  function draw() {
    const inp = cur, mode = inp.dataset.dpMode, td = todayD(), { min, max } = lim();
    const maxD = parse(max), minD = parse(min);
    const yHi = Math.max(td.getFullYear() + (maxD ? 0 : 1), maxD ? maxD.getFullYear() : 0), yLo = Math.min(2020, minD ? minD.getFullYear() : 2020);
    const years = []; for (let y = yHi; y >= yLo; y--) years.push(y);
    const yrSel = `<select class="dr-sel" data-yr>${years.map(y => `<option ${y === view.getFullYear() ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
    let body, quick;
    if (mode === 'month') {
      const sel = inp.value.slice(0, 7), tm = ymd(td).slice(0, 7);
      body = `<div class="dp-months">${SHORT.map((n, i) => {
        const k = `${view.getFullYear()}-${pad(i + 1)}`, off = (max && k > max.slice(0, 7)) || (min && k < min.slice(0, 7));
        return `<button type="button" class="dp-m ${k === sel ? 'on' : ''} ${k === tm ? 'today' : ''}" data-v="${k}" ${off ? 'disabled' : ''}>${n}</button>`;
      }).join('')}</div>`;
      const lm = new Date(td.getFullYear(), td.getMonth() - 1, 1);
      quick = `<button type="button" class="btn sm" data-v="${ymd(td).slice(0, 7)}">This month</button><button type="button" class="btn sm" data-v="${ymd(lm).slice(0, 7)}">Last month</button>`;
    } else {
      const first = view, start = addDays(first, -((first.getDay() + 6) % 7)), sel = inp.value, tk = ymd(td);
      let cells = '';
      for (let i = 0; i < 42; i++) {
        const d = addDays(start, i), k = ymd(d);
        if (d.getMonth() !== view.getMonth()) { cells += '<span class="dr-d out"></span>'; continue; }
        const off = (max && k > max) || (min && k < min);
        cells += `<button type="button" class="${['dr-d', k === tk ? 'today' : '', off ? 'fut' : '', k === sel ? 'lo hi' : ''].filter(Boolean).join(' ')}" data-v="${k}" ${off ? 'disabled' : ''}>${d.getDate()}</button>`;
      }
      body = `<div class="dr-cal"><div class="dr-wk">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(x => `<span>${x}</span>`).join('')}</div><div class="dr-days">${cells}</div></div>`;
      const ok = (k) => !(max && k > max) && !(min && k < min);
      const yd = ymd(addDays(td, -1));
      quick = `${ok(tk) ? `<button type="button" class="btn sm" data-v="${tk}">Today</button>` : ''}${ok(yd) ? `<button type="button" class="btn sm" data-v="${yd}">Yesterday</button>` : ''}`;
    }
    const nextOff = maxD && (mode === 'month' ? view.getFullYear() >= maxD.getFullYear() : view.getFullYear() * 12 + view.getMonth() >= maxD.getFullYear() * 12 + maxD.getMonth());
    const step = mode === 'month' ? 'Previous year' : 'Previous month';
    pop.innerHTML = `
      <div class="dp-head">
        <button type="button" class="dr-nav" data-nav="-1" aria-label="${step}">‹</button>
        <div class="dr-hm">${mode === 'month' ? '' : `<select class="dr-sel" data-mon>${MONTHS.map((n, i) => `<option value="${i}" ${i === view.getMonth() ? 'selected' : ''}>${n}</option>`).join('')}</select>`}${yrSel}</div>
        <button type="button" class="dr-nav" data-nav="1" aria-label="Next" ${nextOff ? 'disabled' : ''}>›</button>
      </div>
      ${body}
      <div class="dp-foot">${quick}<span class="spacer"></span>${inp.required ? '' : '<button type="button" class="btn sm" data-clear>Clear</button>'}</div>`;
  }

  document.addEventListener('click', (e) => {
    if (!pop || !pop.contains(e.target)) return;
    const t = e.target.closest('[data-v],[data-nav],[data-clear]');
    if (!t || t.disabled) return;
    if (t.dataset.nav) {
      const n = Number(t.dataset.nav);
      view = cur.dataset.dpMode === 'month' ? new Date(view.getFullYear() + n, 0, 1) : new Date(view.getFullYear(), view.getMonth() + n, 1);
      return draw();
    }
    if (t.hasAttribute('data-clear')) return set(cur, '');
    set(cur, t.dataset.v);
  });
  document.addEventListener('change', (e) => {
    if (!pop || !pop.contains(e.target)) return;
    const m = pop.querySelector('[data-mon]'), y = pop.querySelector('[data-yr]');
    view = new Date(Number(y.value), m ? Number(m.value) : 0, 1);
    draw();
  });

  function scan(root) { root.querySelectorAll?.('input[type="date"], input[type="month"]').forEach(enhance); }
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.('input[type="date"], input[type="month"]')) enhance(n); else scan(n); }
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  PP.datePick = enhance;
})();
