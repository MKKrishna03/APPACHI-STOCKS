/* Purchase Pro — GSTR-2B check: upload the GSTR-2B from the GST portal (JSON / ZIP / Excel) →
   every bill the suppliers filed against our GSTIN is matched to the bills entered here (server: gstr2b.js). */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, api, toast, confirmBox, S, rs, fmtDate, loadingCard, errorCard, loadScriptOnce } = PP;
  const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const ui = { period: '' };
  const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
  const load = (src) => (loadScriptOnce ? loadScriptOnce(src) : new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src)); document.head.appendChild(s); }));

  // file → what the server reads: { json } or { sheets: { name: rows[][] } }
  async function readFile(f) {
    const name = f.name || '';
    if (/\.json$/i.test(name)) return { json: JSON.parse(await f.text()) };
    if (/\.zip$/i.test(name)) {
      await load(JSZIP);
      const zip = await window.JSZip.loadAsync(await f.arrayBuffer());
      const entry = Object.values(zip.files).find(z => !z.dir && /\.json$/i.test(z.name));
      if (!entry) throw new Error('No GSTR-2B JSON inside this ZIP.');
      return { json: JSON.parse(await entry.async('string')) };
    }
    if (/\.(xlsx|xls)$/i.test(name)) {
      await load(SHEETJS);
      const wb = window.XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
      const sheets = {};
      for (const n of wb.SheetNames) {
        // only the sheets with bills (B2B, B2BA, B2B-CDNR, B2B-CDNRA) + the first one (has the period / GSTIN)
        if (!/B2B/i.test(n) && n !== wb.SheetNames[0]) continue;
        sheets[n] = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '', blankrows: false }).slice(0, 5000);
      }
      return { sheets };
    }
    throw new Error('Upload the GSTR-2B file from the GST portal: JSON, ZIP or Excel.');
  }

  const STATUS = {
    missing: ['✗ Not entered here', 'bad'], no_supplier: ['✗ Supplier not added', 'bad'], amtdiff: ['⚠ Amount differs', 'EXPENSE'],
    numdiff: ['⚠ Bill no differs', 'EXPENSE'], datediff: ['Date differs', 'EXPENSE'], ok: ['✓ Matches', 'HALLMARK'],
  };

  async function viewGstr(view) {
    view.innerHTML = loadingCard('Matching GSTR-2B with the bills…');
    let d;
    try { d = await api(`/gstr2b?firm=${S.firm}${ui.period ? '&period=' + ui.period : ''}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    ui.period = d.period || '';
    const rows = d.rows || [], nf = d.not_filed || [];
    const by = (s) => rows.filter(r => r.status === s);
    const miss = rows.filter(r => r.status === 'missing' || r.status === 'no_supplier');
    const amt = by('amtdiff'), num = by('numdiff'), dt = by('datediff'), ok = by('ok');
    const tile = (n, label, cls, id) => `<a class="card g2-tile ${n ? cls : 'zero'}" data-jump="${id}"><b>${n}</b><span>${label}</span></a>`;
    const docCell = (r) => `<td>${esc(fmtDate(r.date))}</td><td class="mono cell-main">${esc(r.no)}${r.type !== 'INV' ? ` <span class="dim">${r.type === 'CN' ? 'credit note' : 'debit note'}</span>` : ''}${r.amended ? ' <span class="dim">(amended)</span>' : ''}</td>
      <td class="cell-main">${esc(r.party_name || r.name || '')}<div class="dim mono" style="font-size:11.5px">${esc(r.gstin)}</div></td>
      <td class="mono" style="text-align:right">${rs(r.taxable)}</td><td class="mono" style="text-align:right">${rs(r.tax)}</td>`;
    const section = (id, title, list, extraHead, extra) => list.length ? `<div class="g2-sec" id="g2-${id}"><div class="stmt-h">${title} · ${list.length}</div>
      <div class="card table-wrap"><table class="grid"><thead><tr><th>Bill date</th><th>Bill no</th><th>Supplier</th><th style="text-align:right">Taxable</th><th style="text-align:right">GST</th>${extraHead}</tr></thead>
      <tbody>${list.map(r => `<tr>${docCell(r)}${extra(r)}</tr>`).join('')}</tbody></table></div></div>` : '';

    view.innerHTML = `
      <div class="toolbar">
        <label class="dim" style="font-size:12px">Month</label>
        <input class="input" type="month" id="gMonth" value="${esc(ui.period || prevMonth())}" style="width:170px" />
        <label class="btn primary" for="gFile">Upload GSTR-2B</label><input type="file" id="gFile" accept=".json,.zip,.xlsx,.xls" hidden />
        <span class="dim" id="gMsg" style="font-size:12.5px">JSON or ZIP from the GST portal is best · Excel works too</span>
        <div class="spacer"></div>
        ${d.periods.length ? `<div class="g2-periods">${d.periods.map(p => `<button class="btn sm ${p.period === ui.period ? 'primary' : ''}" data-per="${p.period}" title="${esc(p.file_name || '')} · uploaded ${esc(fmtDate((p.uploaded_at || '').slice(0, 10)))}${p.by_name ? ' by ' + esc(p.by_name) : ''}">${esc(monthName(p.period))} <span class="dim">${p.count}</span></button>`).join('')}</div>` : ''}
      </div>
      ${!d.period ? `<div class="card empty" style="padding:34px"><b>Upload a GSTR-2B to start</b>GST portal → Returns → GSTR-2B → pick the month → Download (JSON or Excel).<br>Every bill your suppliers filed is checked against the bills entered here.</div>` : `
      <div class="g2-tiles">
        ${tile(miss.length, 'Not entered here', 'bad', 'miss')}
        ${tile(amt.length, 'Amount differs', 'warn', 'amt')}
        ${tile(nf.length, 'Supplier has not filed', 'warn', 'nf')}
        ${tile(num.length + dt.length, 'Bill no / date differs', 'warn', 'num')}
        ${tile(ok.length, 'Matches', 'ok', 'ok')}
      </div>
      <div class="dim" style="font-size:12.5px;margin:-4px 0 14px">${esc(monthName(d.period))}: ${rows.length} bill(s) on GSTR-2B · <a href="#" id="gDel" class="dim">remove this upload</a></div>
      ${section('miss', 'On GSTR-2B, not entered here — collect and enter these bills', miss, '<th></th>', r => `<td>${r.status === 'no_supplier' ? `<span class="tag bad">Supplier not added</span> <button class="ghost-btn" data-addsup="${esc(r.name || '')}">+ Add supplier</button>` : '<a class="btn sm" href="#/bills/new">+ Enter bill</a>'}</td>`)}
      ${section('amt', 'Amount differs — check our bill against the supplier\'s bill', amt, '<th>Difference</th><th>Our bill</th>', r => `<td class="bad-t" style="font-size:13px">${esc((r.diffs || []).join('; '))}</td><td><a href="#/bills/${r.bill.id}">${esc(r.bill.bill_no)}</a></td>`)}
      ${nf.length ? `<div class="g2-sec" id="g2-nf"><div class="stmt-h">Entered here with GST, not on any GSTR-2B — supplier has not filed (GST credit at risk) · ${nf.length}</div>
        <div class="card table-wrap"><table class="grid"><thead><tr><th>Bill date</th><th>Bill no</th><th>Supplier</th><th style="text-align:right">Taxable</th><th style="text-align:right">GST</th></tr></thead>
        <tbody>${nf.map(b => `<tr data-href="#/bills/${b.id}"><td>${esc(fmtDate(b.bill_date))}</td><td class="mono cell-main"><a href="#/bills/${b.id}">${esc(b.bill_no)}</a></td><td class="cell-main">${esc(b.party_name)}<div class="dim mono" style="font-size:11.5px">${esc(b.gstin)}</div></td><td class="mono" style="text-align:right">${rs(b.taxable)}</td><td class="mono" style="text-align:right">${rs(b.tax)}</td></tr>`).join('')}</tbody></table></div>
        <div class="dim" style="font-size:12px;margin-top:6px">Ask the supplier to file it in their GSTR-1. If it shows on next month's GSTR-2B, it moves off this list.</div></div>` : ''}
      ${section('num', 'Found, but bill no or date is typed differently', [...num, ...dt], '<th>Result</th><th>Our bill</th>', r => `<td><span class="tag ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></td><td><a href="#/bills/${r.bill.id}">${esc(r.bill.bill_no)}</a> <span class="dim">${esc(fmtDate(r.bill.bill_date))}</span></td>`)}
      ${section('ok', 'Matches', ok, '<th>Our bill</th>', r => `<td><a href="#/bills/${r.bill.id}">${esc(r.bill.bill_no)}</a></td>`)}
      `}`;

    const msg = (t, cls) => { const el = $('#gMsg'); if (el) { el.textContent = t; el.className = cls || 'dim'; } };
    $('#gFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        msg('Reading ' + f.name + '…');
        const body = await readFile(f);
        msg('Matching…');
        const r = await api('/gstr2b', { method: 'POST', body: { firm: S.firm, period: body.json ? undefined : $('#gMonth').value, file_name: f.name, ...body } });
        ui.period = r.period;
        toast(`${r.count} bills from GSTR-2B ${monthName(r.period)} checked.`);
        viewGstr(view);
      } catch (err) { msg('⚠ ' + err.message, 'bad-t'); }
    };
    view.onclick = async (e) => {
      const per = e.target.closest('[data-per]'); if (per) { ui.period = per.dataset.per; viewGstr(view); return; }
      const j = e.target.closest('[data-jump]'); if (j) { const el = document.getElementById('g2-' + j.dataset.jump); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const add = e.target.closest('[data-addsup]'); if (add) { await PP.newSupplier({ name: add.dataset.addsup, type: 'PURCHASE' }); viewGstr(view); return; }
      if (e.target.id === 'gDel') {
        e.preventDefault();
        if (!(await confirmBox({ title: `Remove GSTR-2B ${monthName(ui.period)}?`, text: 'Only the uploaded file is removed. Bills entered here are not touched.', okText: 'Remove', danger: true }))) return;
        try { await api(`/gstr2b/${ui.period}?firm=${S.firm}`, { method: 'DELETE' }); ui.period = ''; viewGstr(view); } catch (err) { toast(err.message, true); }
        return;
      }
      const tr = e.target.closest('tr[data-href]'); if (tr && !e.target.closest('a,button')) location.hash = tr.dataset.href;
    };
  }

  PP.views.gstr2b = viewGstr;
})();
