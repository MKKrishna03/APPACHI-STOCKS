/* Purchase Pro — Reports: supplier balances, TDS, GST, month close, backup. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, confirmBox, fmtWhen, S, rs, gm, n2, today, fmtDate, monthEnd, csv, loadingCard, errorCard, firmShort } = PP;
  const KL = () => PP.billKindLabel || {};

  function fyRange(offset = 0) {
    const t = today(); const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    const s = (m >= 4 ? y : y - 1) + offset;
    return { from: `${s}-04-01`, to: `${s + 1}-03-31`, label: `FY ${s}-${String(s + 1).slice(2)}` };
  }
  const ru = { tab: store.get('pp_rep_tab', 'balances'), from: fyRange().from, to: today() };
  const TABS = { balances: 'Supplier balances', tds: 'TDS', gst: 'GST purchases', close: 'Month close', backup: 'Backup' };

  async function viewReports(view) {
    view.onclick = null;
    view.innerHTML = `
      <div class="toolbar"><div class="chips" id="repTabs">${Object.entries(TABS).map(([k, l]) => `<button class="chip ${ru.tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
        <div class="spacer"></div>
        ${['tds', 'gst'].includes(ru.tab) ? `
          <select class="select" id="repPreset" style="width:170px"><option value="">Quick range…</option>
            <option value="fy0">${fyRange().label}</option><option value="fy-1">${fyRange(-1).label}</option>
            ${[0, 1, 2, 3].map(q => { const fy = fyRange(); const s = Number(fy.from.slice(0, 4)); const ms = [[4, 6], [7, 9], [10, 12], [1, 3]][q]; const yy = q === 3 ? s + 1 : s; return `<option value="q${q}">Q${q + 1} (${['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'][q]} ${yy})</option>`; }).join('')}
            <option value="m0">This month</option></select>
          <input class="input" type="date" id="repFrom" value="${ru.from}" style="width:160px" /><input class="input" type="date" id="repTo" value="${ru.to}" style="width:160px" />` : ''}
        <button class="btn" id="repCsv" ${['close', 'backup'].includes(ru.tab) ? 'hidden' : ''}>Download Excel (CSV)</button>
      </div>
      <div id="repBody">${loadingCard()}</div>`;
    $('#repTabs').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; ru.tab = b.dataset.t; store.set('pp_rep_tab', ru.tab); viewReports(view); };
    $('#repFrom')?.addEventListener('change', (e) => { ru.from = e.target.value; viewReports(view); });
    $('#repTo')?.addEventListener('change', (e) => { ru.to = e.target.value; viewReports(view); });
    $('#repPreset')?.addEventListener('change', (e) => {
      const v = e.target.value; const fy = fyRange(); const s = Number(fy.from.slice(0, 4));
      if (v === 'fy0') Object.assign(ru, { from: fy.from, to: fy.to });
      else if (v === 'fy-1') { const p = fyRange(-1); Object.assign(ru, { from: p.from, to: p.to }); }
      else if (v[0] === 'q') { const q = Number(v[1]); const [a, b] = [[4, 6], [7, 9], [10, 12], [1, 3]][q]; const yy = q === 3 ? s + 1 : s; ru.from = `${yy}-${String(a).padStart(2, '0')}-01`; ru.to = monthEnd(`${yy}-${String(b).padStart(2, '0')}`); }
      else if (v === 'm0') { ru.from = today().slice(0, 7) + '-01'; ru.to = monthEnd(today().slice(0, 7)); }
      viewReports(view);
    });
    const body = $('#repBody');
    try { await ({ balances, tds, gst, close, backup })[ru.tab](body); } catch (e) { body.innerHTML = errorCard(e); }
  }

  async function balances(body) {
    const acc = (await api(`/accounts?firm=${S.firm}`)).filter(a => a.active);
    const tot = acc.reduce((s, a) => ({ m: s.m + a.money, w: s.w + a.weight, d30: s.d30 + a.buckets.d30, d60: s.d60 + a.buckets.d60, d60p: s.d60p + a.buckets.d60p }), { m: 0, w: 0, d30: 0, d60: 0, d60p: 0 });
    body.innerHTML = `<div class="card table-wrap"><table class="grid"><thead><tr><th>Supplier</th><th style="text-align:right">Balance</th><th style="text-align:right">0–30 d</th><th style="text-align:right">31–60 d</th><th style="text-align:right">60+ d</th><th style="text-align:right">Unpaid bills</th><th style="text-align:right">Gold with them</th></tr></thead>
      <tbody>${acc.map(a => `<tr data-href="#/ledger/${a.party_id}"><td class="cell-main">${esc(a.name)}</td><td class="mono cell-main" style="text-align:right;${a.money < 0 ? 'color:var(--warn)' : ''}">${a.money < 0 ? 'Adv ' : ''}${rs(Math.abs(a.money))}</td>
        <td class="mono" style="text-align:right">${a.buckets.d30 ? rs(a.buckets.d30) : ''}</td><td class="mono" style="text-align:right">${a.buckets.d60 ? rs(a.buckets.d60) : ''}</td><td class="mono" style="text-align:right;color:var(--bad)">${a.buckets.d60p ? rs(a.buckets.d60p) : ''}</td>
        <td class="mono" style="text-align:right">${a.open_bills || ''}</td><td class="mono" style="text-align:right">${Math.abs(a.weight) > 0.0005 ? gm(a.weight) : ''}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">No entries yet.</div></td></tr>'}</tbody>
      <tfoot><tr class="foot-row"><td>Total</td><td class="mono" style="text-align:right">${rs(tot.m)}</td><td class="mono" style="text-align:right">${rs(tot.d30)}</td><td class="mono" style="text-align:right">${rs(tot.d60)}</td><td class="mono" style="text-align:right">${rs(tot.d60p)}</td><td></td><td class="mono" style="text-align:right">${gm(tot.w)}</td></tr></tfoot></table></div>`;
    body.onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
    $('#repCsv').onclick = () => csv(`supplier-balances-${firmShort()}-${today()}.csv`, ['Supplier', 'Balance (+ we owe / - advance)', '0-30 days', '31-60 days', '60+ days', 'Unpaid bills', 'Gold with them (g)'],
      acc.map(a => [a.name, n2(a.money), n2(a.buckets.d30), n2(a.buckets.d60), n2(a.buckets.d60p), a.open_bills, a.weight]));
  }

  async function tds(body) {
    const rows = await api(`/reports/tds?firm=${S.firm}&from=${ru.from}&to=${ru.to}`);
    const by = {};
    rows.forEach(r => { const k = r.section; (by[k] ||= { n: 0, base: 0, tds: 0 }); by[k].n++; by[k].base += r.taxable + r.other_charges; by[k].tds += r.tds; });
    body.innerHTML = `<div class="stats">${Object.entries(by).map(([k, v]) => `<div class="card stat"><div class="stat-n">${rs(v.tds)}</div><div class="stat-l">TDS ${k} · ${v.n} bill(s) on ${rs(v.base)}</div></div>`).join('') || '<div class="card stat"><div class="stat-n">₹0.00</div><div class="stat-l">No TDS in this period</div></div>'}</div>
      <div class="card table-wrap"><table class="grid"><thead><tr><th>Bill date</th><th>Bill no</th><th>Supplier</th><th>PAN</th><th>Section</th><th style="text-align:right">Amount (excl. GST)</th><th style="text-align:right">TDS</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-href="#/bills/${r.id}"><td>${esc(fmtDate(r.bill_date))}</td><td class="mono">${esc(r.bill_no)}</td><td class="cell-main">${esc(r.party_name)}</td><td class="mono">${esc(r.pan || 'NO PAN')}</td><td>${esc(r.section)}</td><td class="mono" style="text-align:right">${rs(r.taxable + r.other_charges)}</td><td class="mono cell-main" style="text-align:right">${rs(r.tds)}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">No TDS deducted in this period.</div></td></tr>'}</tbody></table></div>`;
    body.onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
    $('#repCsv').onclick = () => csv(`tds-${firmShort()}-${ru.from}-to-${ru.to}.csv`, ['Bill date', 'Bill no', 'Supplier', 'PAN', 'Section', 'Amount excl GST', 'TDS'],
      rows.map(r => [r.bill_date, r.bill_no, r.party_name, r.pan || '', r.section, n2(r.taxable + r.other_charges), n2(r.tds)]));
  }

  async function gst(body) {
    const rows = await api(`/reports/gst?firm=${S.firm}&from=${ru.from}&to=${ru.to}`);
    const sign = (k) => (k === 'CREDIT_NOTE' || k === 'DEBIT_NOTE' ? -1 : 1);
    const t = rows.reduce((s, r) => { const g = sign(r.kind); return { tx: s.tx + g * (r.taxable + r.other_charges), c: s.c + g * r.cgst, sg: s.sg + g * r.sgst, i: s.i + g * r.igst }; }, { tx: 0, c: 0, sg: 0, i: 0 });
    body.innerHTML = `<div class="stats"><div class="card stat"><div class="stat-n">${rs(t.tx)}</div><div class="stat-l">Taxable value</div></div><div class="card stat"><div class="stat-n">${rs(t.c)}</div><div class="stat-l">CGST</div></div><div class="card stat"><div class="stat-n">${rs(t.sg)}</div><div class="stat-l">SGST</div></div><div class="card stat"><div class="stat-n">${rs(t.i)}</div><div class="stat-l">IGST</div></div></div>
      <div class="card table-wrap"><table class="grid"><thead><tr><th>Date</th><th>Bill no</th><th>Supplier</th><th>GSTIN</th><th>Type</th><th style="text-align:right">Taxable</th><th style="text-align:right">CGST</th><th style="text-align:right">SGST</th><th style="text-align:right">IGST</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${rows.map(r => `<tr data-href="#/bills/${r.id}"><td>${esc(fmtDate(r.bill_date))}</td><td class="mono">${esc(r.bill_no)}</td><td class="cell-main">${esc(r.party_name)}</td><td class="mono">${r.gstin ? esc(r.gstin) : '<span class="tag bad">No GSTIN</span>'}</td><td>${esc(KL()[r.kind] || r.kind)}</td>
        <td class="mono" style="text-align:right">${rs(r.taxable + r.other_charges)}</td><td class="mono" style="text-align:right">${r.cgst ? rs(r.cgst) : ''}</td><td class="mono" style="text-align:right">${r.sgst ? rs(r.sgst) : ''}</td><td class="mono" style="text-align:right">${r.igst ? rs(r.igst) : ''}</td><td class="mono cell-main" style="text-align:right">${rs(r.total)}</td></tr>`).join('') || '<tr><td colspan="10"><div class="empty">No bills in this period.</div></td></tr>'}</tbody></table></div>`;
    body.onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
    $('#repCsv').onclick = () => csv(`gst-purchases-${firmShort()}-${ru.from}-to-${ru.to}.csv`, ['Date', 'Bill no', 'Supplier', 'GSTIN', 'Type', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'],
      rows.map(r => [r.bill_date, r.bill_no, r.party_name, r.gstin || '', KL()[r.kind] || r.kind, n2(r.taxable + r.other_charges), n2(r.cgst), n2(r.sgst), n2(r.igst), n2(r.total)]));
  }

  async function close(body) {
    const locks = await api(`/locks?firm=${S.firm}`);
    const locked = new Map(locks.map(l => [l.month, l]));
    const months = [];
    const t = today(); let y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    for (let i = 0; i < 18; i++) { months.push(`${y}-${String(m).padStart(2, '0')}`); if (--m === 0) { m = 12; y--; } }
    const owner = S.ref.isOwner;
    body.innerHTML = `<div class="card" style="padding:16px 18px;margin-bottom:14px;font-size:13px;line-height:1.6;color:var(--ink-2)">
        <b>How month close works:</b> at month end, confirm each supplier's balance (Supplier Ledger → Confirm balance), then close the month here.
        After closing, entries dated in that month cannot be added, changed or deleted — except by the owner. ${owner ? '' : '<br><b style="color:var(--warn)">Only the owner can close or reopen a month.</b>'}</div>
      <div class="card table-wrap"><table class="grid"><thead><tr><th>Month</th><th>Status</th><th>Closed by</th><th></th></tr></thead><tbody>
      ${months.map(mo => { const l = locked.get(mo); const name = new Date(mo + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        return `<tr style="cursor:default"><td class="cell-main">${esc(name)}</td><td>${l ? '<span class="tag plain">🔒 Closed</span>' : '<span class="tag HALLMARK">Open</span>'}</td><td class="dim">${l ? `${esc(l.locked_by_name || '')} · ${esc(fmtWhen(l.locked_at))}` : ''}</td>
          <td style="text-align:right">${owner ? `<button class="btn sm ${l ? '' : 'primary'}" data-m="${mo}" data-lock="${l ? 0 : 1}">${l ? 'Reopen' : 'Close month'}</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>`;
    body.onclick = async (e) => {
      const b = e.target.closest('button[data-m]'); if (!b) return;
      const lock = b.dataset.lock === '1';
      const ok = await confirmBox({ title: lock ? 'Close this month?' : 'Reopen this month?', text: lock ? 'Staff will not be able to add or change entries dated in this month.' : 'Staff will be able to change entries in this month again.', okText: lock ? 'Close month' : 'Reopen', danger: !lock });
      if (!ok) return;
      try { await api('/locks', { method: 'POST', body: { firm: S.firm, month: b.dataset.m, lock } }); toast(lock ? 'Month closed.' : 'Month reopened.'); close(body); }
      catch (err) { toast(err.message, true); }
    };
  }

  async function backup(body) {
    body.innerHTML = `<div class="card soon-card"><b>Full backup</b><p>Downloads every Purchase entry — suppliers, bills, items, payments, issues, receipts, opening balances, confirmations and the full edit history — as one file. Keep a copy every day (e.g. on Google Drive).</p>
      <a class="btn primary" style="margin-top:18px" href="/purchase-pro/api/backup" download>Download backup now</a></div>`;
  }

  PP.views.reports = viewReports;
})();
