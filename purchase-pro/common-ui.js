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

  Object.assign(PP, { n2, n3, val, rs, gm, today, fmtDate, monthEnd, partyLabel, partyField, bindParty, csv, loadingCard, errorCard, firmShort });
})();
