/* Purchase Pro — date range picker (shared).
   PP.dateRange(host, state, onChange)
     state = { preset: 'tm' | … | null, from: 'YYYY-MM-DD' | '', to: 'YYYY-MM-DD' | '' }
     A preset is worked out again from today every time, so "This month" stays this month.
   PP.resolveRange(state) → [from, to] ('' = open end). */
(function () {
  'use strict';
  const PP = window.PP;
  const { esc } = PP;

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const todayD = () => parse(PP.today());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const monthEnd = (y, m) => new Date(y, m + 1, 0);
  const DAY = 864e5;
  const days = (a, b) => Math.round((b - a) / DAY) + 1;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const nice = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  // Presets: label + [from, to] from today (null = open end)
  const PRESETS = [
    { k: 'today', l: 'Today', f: (t) => [t, t] },
    { k: 'yday', l: 'Yesterday', f: (t) => [addDays(t, -1), addDays(t, -1)] },
    { k: 'tw', l: 'This week', f: (t) => [addDays(t, -((t.getDay() + 6) % 7)), t] },
    { k: 'lw', l: 'Last week', f: (t) => { const s = addDays(t, -((t.getDay() + 6) % 7) - 7); return [s, addDays(s, 6)]; } },
    { k: 'l7', l: 'Last 7 days', f: (t) => [addDays(t, -6), t] },
    { k: 'l30', l: 'Last 30 days', f: (t) => [addDays(t, -29), t] },
    { sep: true },
    { k: 'tm', l: 'This month', f: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), t] },
    { k: 'lm', l: 'Last month', f: (t) => [new Date(t.getFullYear(), t.getMonth() - 1, 1), monthEnd(t.getFullYear(), t.getMonth() - 1)] },
    { k: 'l3m', l: 'Last 3 months', f: (t) => [new Date(t.getFullYear(), t.getMonth() - 2, 1), t] },
    { k: 'l6m', l: 'Last 6 months', f: (t) => [new Date(t.getFullYear(), t.getMonth() - 5, 1), t] },
    { sep: true },
    { k: 'tq', l: 'This quarter', f: (t) => [new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1), t] },
    { k: 'lq', l: 'Last quarter', f: (t) => { const q = Math.floor(t.getMonth() / 3) * 3; return [new Date(t.getFullYear(), q - 3, 1), monthEnd(t.getFullYear(), q - 1)]; } },
    { k: 'fy', l: 'This financial year', f: (t) => [new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1), t] },
    { k: 'lfy', l: 'Last financial year', f: (t) => { const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; return [new Date(y - 1, 3, 1), new Date(y, 2, 31)]; } },
    { k: 'ly', l: 'Last calendar year', f: (t) => [new Date(t.getFullYear() - 1, 0, 1), new Date(t.getFullYear() - 1, 11, 31)] },
    { sep: true },
    { k: 'all', l: 'All time', f: () => [null, null] },
  ];
  const presetOf = (k) => PRESETS.find(p => p.k === k);

  function resolveRange(st) {
    const p = st.preset && presetOf(st.preset);
    if (p) { const [a, b] = p.f(todayD()); return [a ? ymd(a) : '', b ? ymd(b) : '']; }
    return [st.from || '', st.to || ''];
  }
  // FY label for an Indian financial year starting in April of y
  const fyLabel = (y) => `FY ${y}-${String(y + 1).slice(2)}`;

  function label(st) {
    const p = st.preset && presetOf(st.preset);
    const [f, t] = resolveRange(st), a = parse(f), b = parse(t);
    if (!a && !b) return { main: 'All time', sub: '' };
    const span = a && b ? (ymd(a) === ymd(b) ? nice(a) : `${nice(a)} – ${nice(b)}`) : a ? `From ${nice(a)}` : `Up to ${nice(b)}`;
    // Whole month / whole FY: say it in words
    let name = p ? p.l : '';
    if (!name && a && b) {
      if (a.getDate() === 1 && ymd(b) === ymd(monthEnd(a.getFullYear(), a.getMonth()))) name = `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
      else if (a.getMonth() === 3 && a.getDate() === 1 && b.getMonth() === 2 && b.getDate() === 31 && b.getFullYear() === a.getFullYear() + 1) name = fyLabel(a.getFullYear());
      // Running period that ends today
      else if (ymd(b) === ymd(todayD()) && a.getDate() === 1) {
        if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) name = `${MONTHS[a.getMonth()]} ${a.getFullYear()} · so far`;
        else if (a.getMonth() === 3 && (b.getFullYear() * 12 + b.getMonth()) - (a.getFullYear() * 12 + 3) < 12) name = `${fyLabel(a.getFullYear())} · so far`;
      }
    }
    return { main: name || span, sub: name ? span + (a && b ? ` · ${days(a, b)} ${days(a, b) === 1 ? 'day' : 'days'}` : '') : (a && b ? `${days(a, b)} ${days(a, b) === 1 ? 'day' : 'days'}` : '') };
  }

  // ‹ › : move the range by its own length (whole months move by months, a whole FY by a year)
  function shift(st, dir) {
    const [f, t] = resolveRange(st), a = parse(f), b0 = parse(t);
    if (!a || !b0) return null;
    const td = todayD();
    let b = b0;
    // A running period that ends today ("This month") counts as the whole period
    if (ymd(b) === ymd(td) && a.getDate() === 1) b = monthEnd(td.getFullYear(), td.getMonth());
    const wholeMonths = a.getDate() === 1 && ymd(b) === ymd(monthEnd(b.getFullYear(), b.getMonth()));
    let na, nb;
    if (wholeMonths) {
      const n = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
      na = new Date(a.getFullYear(), a.getMonth() + dir * n, 1);
      nb = monthEnd(na.getFullYear(), na.getMonth() + n - 1);
    } else {
      const n = days(a, b);
      na = addDays(a, dir * n); nb = addDays(b, dir * n);
    }
    if (na > td) return null;
    return { preset: null, from: ymd(na), to: ymd(nb > td ? td : nb) };
  }

  function dateRange(host, st, onChange) {
    let cur = { ...st };
    let draft = null, hover = null, view = null, picking = 'from';
    const root = document.createElement('div');
    root.className = 'dr';
    host.innerHTML = '';
    host.appendChild(root);

    function drawTrigger() {
      const lb = label(cur), canNext = !!shift(cur, 1), canPrev = !!shift(cur, -1);
      root.innerHTML = `
        <button type="button" class="dr-step" data-dr="prev" title="Previous period" aria-label="Previous period" ${canPrev ? '' : 'disabled'}>‹</button>
        <button type="button" class="dr-btn" data-dr="open" aria-haspopup="dialog">
          <svg fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
          <span class="dr-txt"><b>${esc(lb.main)}</b>${lb.sub ? `<small>${esc(lb.sub)}</small>` : ''}</span>
          <svg class="dr-car" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <button type="button" class="dr-step" data-dr="next" title="Next period" aria-label="Next period" ${canNext ? '' : 'disabled'}>›</button>
        <div class="dr-pop" hidden></div>`;
    }
    const pop = () => root.querySelector('.dr-pop');

    function open() {
      const [f, t] = resolveRange(cur);
      draft = { preset: cur.preset, from: f, to: t };
      const base = parse(t) || parse(f) || todayD();
      view = new Date(base.getFullYear(), base.getMonth() - 1, 1);   // right calendar = the range's end month
      picking = 'from'; hover = null;
      pop().hidden = false;
      drawPop();
      setTimeout(() => document.addEventListener('mousedown', outside), 0);
      document.addEventListener('keydown', onKey);
    }
    function close() {
      pop().hidden = true;
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', onKey);
    }
    function outside(e) { if (!root.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') apply(); }
    function apply() {
      let { from, to } = draft;
      if (from && to && from > to) [from, to] = [to, from];
      cur = draft.preset ? { preset: draft.preset, from: '', to: '' } : { preset: null, from, to };
      close(); drawTrigger(); onChange({ ...cur });
    }

    function monthGrid(y, m) {
      const first = new Date(y, m, 1), start = addDays(first, -((first.getDay() + 6) % 7)), td = ymd(todayD());
      const a = draft.from, b = draft.to || (picking === 'to' && hover ? hover : '');
      const lo = a && b ? (a < b ? a : b) : a, hi = a && b ? (a < b ? b : a) : a;
      let cells = '';
      for (let i = 0; i < 42; i++) {
        const d = addDays(start, i), k = ymd(d), out = d.getMonth() !== m;
        const cls = ['dr-d', out ? 'out' : '', k === td ? 'today' : '', k > td ? 'fut' : '',
          lo && hi && k >= lo && k <= hi ? 'in' : '', k === lo ? 'lo' : '', k === hi ? 'hi' : ''].filter(Boolean).join(' ');
        cells += out ? '<span class="dr-d out"></span>' : `<button type="button" class="${cls}" data-day="${k}" ${k > td ? 'disabled' : ''}>${d.getDate()}</button>`;
      }
      return `<div class="dr-cal"><div class="dr-wk">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(x => `<span>${x}</span>`).join('')}</div><div class="dr-days">${cells}</div></div>`;
    }

    function drawPop() {
      const l = view, r = new Date(l.getFullYear(), l.getMonth() + 1, 1), td = todayD();
      const years = []; for (let y = td.getFullYear(); y >= 2020; y--) years.push(y);
      const fyStart = td.getMonth() >= 3 ? td.getFullYear() : td.getFullYear() - 1;
      const fys = []; for (let y = fyStart; y >= 2020; y--) fys.push(y);
      const monSel = (d, side) => `<select class="dr-sel" data-mon="${side}">${MONTHS.map((n, i) => `<option value="${i}" ${i === d.getMonth() ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <select class="dr-sel" data-yr="${side}">${years.map(y => `<option ${y === d.getFullYear() ? 'selected' : ''}>${y}</option>`).join('')}</select>`;
      const a = parse(draft.from), b = parse(draft.to), n = a && b ? days(a < b ? a : b, a < b ? b : a) : 0;
      pop().innerHTML = `
        <div class="dr-presets">${PRESETS.map(p => p.sep ? '<div class="dr-sep"></div>' : `<button type="button" class="dr-pre ${draft.preset === p.k ? 'on' : ''}" data-pre="${p.k}">${p.l}</button>`).join('')}</div>
        <div class="dr-main">
          <div class="dr-head">
            <button type="button" class="dr-nav" data-nav="-1" aria-label="Previous month">‹</button>
            <div class="dr-hm">${monSel(l, 'l')}</div>
            <div class="dr-hm">${monSel(r, 'r')}</div>
            <button type="button" class="dr-nav" data-nav="1" aria-label="Next month" ${r.getFullYear() * 12 + r.getMonth() >= td.getFullYear() * 12 + td.getMonth() ? 'disabled' : ''}>›</button>
          </div>
          <div class="dr-cals">${monthGrid(l.getFullYear(), l.getMonth())}${monthGrid(r.getFullYear(), r.getMonth())}</div>
          <div class="dr-quick">
            <span class="dr-ql">Whole month</span>
            <select class="dr-sel" id="drMonth"><option value="">Pick…</option>${(() => { let o = ''; for (let i = 0; i < 24; i++) { const d = new Date(td.getFullYear(), td.getMonth() - i, 1); o += `<option value="${ymd(d)}">${MONTHS[d.getMonth()]} ${d.getFullYear()}</option>`; } return o; })()}</select>
            <span class="dr-ql">Financial year</span>
            <select class="dr-sel" id="drFy"><option value="">Pick…</option>${fys.map(y => `<option value="${y}">${fyLabel(y)}</option>`).join('')}</select>
          </div>
          <div class="dr-foot">
            <label class="dr-in ${picking === 'from' ? 'act' : ''}"><span>From</span><input type="date" id="drFrom" value="${esc(draft.from)}" max="${ymd(td)}" /></label>
            <span class="dr-dash">→</span>
            <label class="dr-in ${picking === 'to' ? 'act' : ''}"><span>To</span><input type="date" id="drTo" value="${esc(draft.to)}" max="${ymd(td)}" /></label>
            <span class="dr-n">${n ? `${n} ${n === 1 ? 'day' : 'days'}` : !draft.from && !draft.to ? 'All dates' : picking === 'to' ? 'Now pick the end date' : ''}</span>
            <span class="spacer"></span>
            <button type="button" class="btn sm" data-dr="clear">All time</button>
            <button type="button" class="btn sm" data-dr="cancel">Cancel</button>
            <button type="button" class="btn sm primary" data-dr="apply">Apply</button>
          </div>
        </div>`;
    }

    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-dr],[data-pre],[data-day],[data-nav]');
      if (!t) return;
      if (t.dataset.dr === 'open') return pop().hidden ? open() : close();
      if (t.dataset.dr === 'prev' || t.dataset.dr === 'next') {
        const s = shift(cur, t.dataset.dr === 'next' ? 1 : -1);
        if (s) { cur = s; drawTrigger(); onChange({ ...cur }); }
        return;
      }
      if (t.dataset.dr === 'apply') return apply();
      if (t.dataset.dr === 'cancel') return close();
      if (t.dataset.dr === 'clear') { draft = { preset: 'all', from: '', to: '' }; return apply(); }
      if (t.dataset.pre) {
        const [f, to] = resolveRange({ preset: t.dataset.pre });
        draft = { preset: t.dataset.pre, from: f, to };
        return apply();   // one click on a preset is enough
      }
      if (t.dataset.nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(t.dataset.nav), 1); return drawPop(); }
      if (t.dataset.day) {
        const k = t.dataset.day;
        if (picking === 'from') { draft = { preset: null, from: k, to: '' }; picking = 'to'; }
        else { draft.preset = null; if (k < draft.from) { draft.to = draft.from; draft.from = k; } else draft.to = k; picking = 'from'; hover = null; }
        drawPop();
      }
    });
    root.addEventListener('mouseover', (e) => {
      if (picking !== 'to') return;
      const d = e.target.closest('[data-day]');
      const k = d ? d.dataset.day : null;
      if (k !== hover) { hover = k; drawPop(); }
    });
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.mon != null || t.dataset.yr != null) {
        const side = t.dataset.mon || t.dataset.yr, wrap = t.parentElement;
        const m = Number(wrap.querySelector('[data-mon]').value), y = Number(wrap.querySelector('[data-yr]').value);
        view = side === 'l' ? new Date(y, m, 1) : new Date(y, m - 1, 1);
        return drawPop();
      }
      if (t.id === 'drMonth' && t.value) {
        const d = parse(t.value), e2 = monthEnd(d.getFullYear(), d.getMonth()), td = todayD();
        draft = { preset: null, from: t.value, to: ymd(e2 > td ? td : e2) };
        return apply();
      }
      if (t.id === 'drFy' && t.value) {
        const y = Number(t.value), e2 = new Date(y + 1, 2, 31), td = todayD();
        draft = { preset: null, from: `${y}-04-01`, to: ymd(e2 > td ? td : e2) };
        return apply();
      }
      if (t.id === 'drFrom' || t.id === 'drTo') {
        draft.preset = null;
        draft[t.id === 'drFrom' ? 'from' : 'to'] = t.value;
        const d = parse(t.value);
        if (d) view = new Date(d.getFullYear(), d.getMonth() - (t.id === 'drTo' ? 1 : 0), 1);
        picking = 'from';
        drawPop();
      }
    });

    drawTrigger();
    return { get: () => ({ ...cur }), set: (s) => { cur = { ...s }; drawTrigger(); } };
  }

  Object.assign(PP, { dateRange, resolveRange, rangeLabel: label });
})();
