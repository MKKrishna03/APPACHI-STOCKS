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
    const sorted = parties.slice().sort((a, b) => (want ? (b.types.includes(want) - a.types.includes(want)) : 0) || a.name.localeCompare(b.name));
    const sel = parties.find(p => p.id === Number(selectedId));
    return `<div class="field"><label>${esc(label)} <span class="req">*</span></label>
      <input class="input" id="${id}" list="${id}List" value="${esc(partyLabel(sel))}" placeholder="${esc(placeholder)}" autocomplete="off" />
      <datalist id="${id}List">${sorted.map(p => `<option value="${esc(partyLabel(p))}">${esc([p.gstin, p.types.join('/')].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
      <div class="hint" id="${id}Hint"></div></div>`;
  }
  function bindParty(input, parties, onPick) {
    const find = () => {
      const v = input.value.trim().toUpperCase();
      return parties.find(x => partyLabel(x).toUpperCase() === v) || parties.find(x => x.name.toUpperCase() === v) || null;
    };
    const hint = document.getElementById(input.id + 'Hint');
    const show = () => {
      const p = find();
      if (hint) hint.innerHTML = !p && input.value.trim() ? '<span style="color:var(--bad)">Pick from the list (or add it under Suppliers).</span>' : '';
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

  Object.assign(PP, { n2, n3, val, rs, gm, today, fmtDate, monthEnd, partyLabel, partyField, bindParty, csv, loadingCard, errorCard, firmShort, loadScriptOnce, cropPhoto, canCrop });
})();
