/* Purchase Pro — helpers shared by the screen files. */
(function () {
  'use strict';
  const PP = window.PP;
  const { esc } = PP;

  const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const n3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
  const val = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
  const rs = (v) => (n2(v) < 0 ? '−' : '') + '₹' + Math.abs(n2(v)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gm = (v) => n3(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' g';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };

  // Supplier picker: <input list> + datalist. bindParty() calls onPick(id|null).
  const partyLabel = (p) => (p ? `${p.name}${p.city ? ' — ' + p.city : ''}` : '');
  function partyField(id, parties, selectedId, { label = 'Supplier', want, placeholder = 'Type to search…' } = {}) {
    const sel = parties.find(p => p.id === Number(selectedId));
    return `<div class="field"><label class="lbl-row"><span>${esc(label)} <span class="req">*</span></span><button type="button" class="ghost-btn add-sup" id="${id}Add" data-want="${esc(want || '')}" title="Add a supplier that is not in the list yet">+ New supplier</button></label>
      <input class="input" id="${id}" list="${id}List" value="${esc(partyLabel(sel))}" placeholder="${esc(placeholder)}" autocomplete="off" />
      <datalist id="${id}List">${partyOptions(parties, want)}</datalist>
      <div class="hint" id="${id}Hint"></div></div>`;
  }
  function partyOptions(parties, want) {
    const sorted = parties.slice().sort((a, b) => (want ? (b.types.includes(want) - a.types.includes(want)) : 0) || a.name.localeCompare(b.name));
    return sorted.map(p => `<option value="${esc(partyLabel(p))}">${esc([p.gstin, p.types.join('/')].filter(Boolean).join(' · '))}</option>`).join('');
  }
  // "+ New supplier" next to a picker: opens the supplier form on top of the entry page;
  // the saved supplier is added to the list and picked. parties = the page's own list.
  async function addSupplierFor(input, parties, want) {
    const typed = input.value.trim();
    const saved = await PP.newSupplier({ name: parties.some(p => partyLabel(p).toUpperCase() === typed.toUpperCase()) ? '' : typed, type: want || undefined });
    if (!saved) return null;
    if (!parties.some(p => p.id === saved.id)) parties.push(saved);
    const dl = document.getElementById(input.getAttribute('list'));
    if (dl) dl.innerHTML = partyOptions(parties, want);
    input.value = partyLabel(saved);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return saved;
  }
  function bindParty(input, parties, onPick) {
    const add = document.getElementById(input.id + 'Add');
    if (add) add.onclick = () => addSupplierFor(input, parties, add.dataset.want);
    const find = () => {
      const v = input.value.trim().toUpperCase();
      return parties.find(x => partyLabel(x).toUpperCase() === v) || parties.find(x => x.name.toUpperCase() === v) || null;
    };
    const hint = document.getElementById(input.id + 'Hint');
    const show = () => {
      const p = find();
      if (hint) hint.innerHTML = !p && input.value.trim() ? '<span style="color:var(--bad)">Not in the list — pick one, or press “+ New supplier”.</span>' : '';
      return p;
    };
    input.addEventListener('input', () => onPick(show()?.id || null));
    show();
  }

  function csv(name, header, rows) {
    const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [header, ...rows].map(r => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const loadingCard = (t = 'Loading…') => `<div class="card empty">${esc(t)}</div>`;
  const errorCard = (e) => `<div class="card empty"><b>Something went wrong</b>${esc(e.message || e)}</div>`;
  const firmShort = () => (PP.S.ref.firms.find(f => f.id === PP.S.firm) || {}).short || '';

  function loadScriptOnce(src) {
    return new Promise((ok, bad) => {
      if ([...document.scripts].some(s => s.src === src)) return ok();
      const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src)); document.head.appendChild(s);
    });
  }

  // ── Crop a bill photo ──
  // Saved photos: a Cloudinary crop step in the URL (the original stays in Cloudinary, so
  // "Full photo" brings it back). Not-yet-saved (temp) photos: ?crop=x,y,w,h on our own URL.
  // Relative x/y/w/h (0–1) so resized copies crop the same part.
  // cropPhoto(url) → Promise of the new URL, or null if cancelled.
  const isTemp = (u) => String(u).startsWith('/purchase-pro/api/temp/');
  const CROP_RE = /\/c_crop,[^/]+(?=\/)/;
  const TCROP_RE = /\?crop=([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/;
  const uncrop = (u) => (isTemp(u) ? u.replace(TCROP_RE, '') : u.replace(CROP_RE, ''));
  const fx = (n) => Math.min(1, Math.max(0, n)).toFixed(4);
  function cropUrl(u, r) {
    const base = uncrop(u);
    if (!r) return base;
    if (isTemp(base)) return `${base}?crop=${fx(r.x)},${fx(r.y)},${fx(r.w)},${fx(r.h)}`;
    const t = `c_crop,x_${fx(r.x)},y_${fx(r.y)},w_${fx(r.w)},h_${fx(r.h)}`;
    const m = base.match(/\/image\/upload\/((?:[^/]+\/)*?)(v\d+\/)/);
    return m ? base.replace(m[0], `/image/upload/${m[1]}${t}/${m[2]}`) : base.replace('/image/upload/', `/image/upload/${t}/`);
  }
  function cropOf(u) {
    let r;
    if (isTemp(u)) {
      const t = u.match(TCROP_RE); if (!t) return null;
      r = { x: +t[1], y: +t[2], w: +t[3], h: +t[4] };
    } else {
      const m = u.match(CROP_RE); if (!m) return null;
      const g = (k) => Number((m[0].match(new RegExp(k + '_([\\d.]+)')) || [])[1]);
      r = { x: g('x'), y: g('y'), w: g('w'), h: g('h') };
    }
    return [r.x, r.y, r.w, r.h].every(n => n >= 0 && n <= 1) ? r : null;
  }
  const canCrop = (u) => !!u && !/\.pdf($|\?)/i.test(u) && !String(u).includes('/raw/') && (String(u).includes('/image/upload/') || isTemp(u));
  function cropPhoto(u) {
    return new Promise((resolve) => {
      if (!canCrop(u)) return resolve(null);
      const ov = document.createElement('div');
      ov.className = 'crop-ov';
      ov.innerHTML = `<div class="crop-box">
          <div class="crop-top"><b>Crop photo</b><span class="dim">Drag a box around the bill. Drag inside the box to move it.</span></div>
          <div class="crop-stage"><div class="crop-wrap"><img alt="Bill photo" /><div class="crop-sel" hidden></div></div></div>
          <div class="crop-foot">
            <button class="btn" type="button" data-c="full" ${cropOf(u) ? '' : 'disabled'}>Full photo</button>
            <span class="spacer"></span>
            <button class="btn" type="button" data-c="x">Cancel</button>
            <button class="btn primary" type="button" data-c="ok" disabled>Use crop</button>
          </div></div>`;
      document.body.appendChild(ov);
      const wrap = ov.querySelector('.crop-wrap'), img = wrap.querySelector('img'), box = wrap.querySelector('.crop-sel'), okB = ov.querySelector('[data-c=ok]');
      let r = cropOf(u); // fractions of the full photo
      const drawSel = () => {
        box.hidden = !r;
        okB.disabled = !r || r.w < 0.03 || r.h < 0.03;
        if (r) Object.assign(box.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
      };
      img.onload = drawSel;
      img.src = uncrop(u);
      const pt = (e) => { const b = wrap.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) }; };
      let drag = null;
      wrap.addEventListener('pointerdown', (e) => {
        e.preventDefault(); wrap.setPointerCapture(e.pointerId);
        const p = pt(e);
        const inside = r && p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
        drag = inside ? { move: true, p, r0: { ...r } } : { p };
      });
      wrap.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const p = pt(e);
        if (drag.move) {
          const { r0 } = drag;
          r = { ...r0, x: Math.min(1 - r0.w, Math.max(0, r0.x + p.x - drag.p.x)), y: Math.min(1 - r0.h, Math.max(0, r0.y + p.y - drag.p.y)) };
        } else {
          r = { x: Math.min(p.x, drag.p.x), y: Math.min(p.y, drag.p.y), w: Math.abs(p.x - drag.p.x), h: Math.abs(p.y - drag.p.y) };
        }
        drawSel();
      });
      wrap.addEventListener('pointerup', () => { drag = null; });
      const done = (url) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(url); };
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      document.addEventListener('keydown', onKey);
      ov.addEventListener('click', (e) => {
        const b = e.target.closest('[data-c]');
        if (!b) { if (e.target === ov) done(null); return; }
        if (b.dataset.c === 'x') done(null);
        else if (b.dataset.c === 'full') done(uncrop(u));
        else if (b.dataset.c === 'ok' && r) done(r.w > 0.995 && r.h > 0.995 ? uncrop(u) : cropUrl(u, r));
      });
    });
  }

  // ── Click a column header to sort the table (again = reverse). Numbers (₹, g, commas),
  // dates ("15 Nov 2026") and text all sort the right way; "Adv ₹…" counts as negative.
  // A cell can give its own sort value with data-sort="…". The total row (tfoot) stays put.
  function sortKey(td) {
    if (!td) return { n: -Infinity };
    if (td.dataset.sort !== undefined) { const v = td.dataset.sort; return isNaN(Number(v)) || v === '' ? { s: v.toLowerCase() } : { n: Number(v) }; }
    const t = td.textContent.trim();
    if (!t || t === '—') return { n: -Infinity };
    const d = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(t);
    if (d) return { n: Date.parse(`${d[2]} ${d[1]}, ${d[3]}`) };
    const num = t.replace(/^Adv\s*/i, '-').replace(/[₹,\s]|g$/g, '').replace('−', '-');
    if (/^-?\d+(\.\d+)?$/.test(num)) return { n: Number(num) };
    return { s: t.toLowerCase() };
  }
  function makeSortable(table) {
    // marked on the header row, so a table whose rows are redrawn gets its new header bound again
    const head = table && table.tHead;
    if (!head || head.dataset.sortable) return;
    head.dataset.sortable = '1';
    const ths = [...table.querySelectorAll('thead th')];
    ths.forEach((th, col) => {
      if (!th.textContent.trim()) return;
      th.classList.add('sortable');
      th.title = 'Click to sort';
      th.addEventListener('click', () => {
        const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        ths.forEach(h => { delete h.dataset.dir; });
        th.dataset.dir = dir;
        const tb = table.tBodies[0]; if (!tb) return;
        const rows = [...tb.rows].filter(r => r.cells.length > 1);
        if (rows.length < 2) return;
        rows.sort((a, b) => {
          const x = sortKey(a.cells[col]), y = sortKey(b.cells[col]);
          const c = x.n !== undefined && y.n !== undefined ? x.n - y.n : String(x.s ?? x.n).localeCompare(String(y.s ?? y.n), 'en', { numeric: true });
          return dir === 'asc' ? c : -c;
        });
        rows.forEach(r => tb.appendChild(r));
      });
    });
  }
  // not the ledger (running balance needs date order) or tables you type into
  const NO_SORT = '.led-table, .batch-table, .b-lines, .stmt-table, .items-table, #itemsTable';
  const sortAll = (root) => (root || document).querySelectorAll('table.grid').forEach(t => { if (!t.matches(NO_SORT) && !t.querySelector('tbody input')) makeSortable(t); });
  // every list / report in the page area gets sortable headers as soon as it is drawn
  const viewEl = document.getElementById('view');
  if (viewEl && window.MutationObserver) {
    let queued = false;
    new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; sortAll(viewEl); }); })
      .observe(viewEl, { childList: true, subtree: true });
  }

  Object.assign(PP, { n2, n3, val, rs, gm, today, fmtDate, monthEnd, partyLabel, partyField, bindParty, csv, loadingCard, errorCard, firmShort, loadScriptOnce, cropPhoto, canCrop, addSupplierFor, partyOptions, makeSortable, sortAll });
})();
