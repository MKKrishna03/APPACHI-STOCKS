/* Purchase Pro — MC bills: our own making-charges invoice for "OTHERS" issue vouchers
   (NAMACHIVAYAM HUF, VIMAL MC, VIMAL HUF MC, VIGNESH NAMACHIVAYAM MC …).
   Same as the old Purchase MC Bill page: pick the voucher(s) of one party → gold rate + % →
   rate/g = % × gold rate ÷ 10, amount = weight × rate, total rounded → saved as a Labour bill
   that closes the vouchers, with the printed bill kept as its photo. ₹19.2 lakh per party per FY. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, confirmBox, modal, closeModal, S, rs, n2, n3, val, today, fmtDate, loadingCard, errorCard } = PP;

  // ── bill number: per-party prefix, number runs on across both companies ──
  const PREFIX = { 'VIGNESH NAMACHIVAYAM MC': 'VN', 'VIMAL HUF MC': 'VH', 'VIMAL MC': 'V', 'NAMACHIVAYAM HUF': 'NH' };
  function mcPrefix(name) {
    const key = String(name || '').trim().toUpperCase();
    if (PREFIX[key]) return `${PREFIX[key]}-MC/`;
    const trail = new Set(['MC', 'HUF', 'PVT', 'LTD', 'JEWELLERY', 'JEWELLERS', 'JEWELERS', 'TRADERS', 'ENTERPRISES', 'CO', 'COMPANY', 'BROS', 'BROTHERS']);
    const words = key.split(/\s+/).filter(Boolean);
    while (words.length > 1 && trail.has(words[words.length - 1])) words.pop();
    const ini = words.filter(w => w !== 'AND' && w !== '&').map(w => w[0]).join('');
    return ini ? `${ini}-MC/` : 'MC/';
  }
  const billNum = (no) => { const m = /(\d+)$/.exec(no || ''); return m ? parseInt(m[1], 10) : 0; };
  const defaultPct = (name) => store.get(`pp_mc_pct_${String(name).toUpperCase()}`, /NAMACHIVAYAM/i.test(name) && !/VIGNESH/i.test(name) ? 3 : 3.5);

  const ui = Object.assign({ q: '', party: '', gen: '', from: '', to: '' }, store.get('pp_mc_ui', {}));
  if (!ui.range) ui.range = ui.from || ui.to ? { preset: null, from: ui.from, to: ui.to } : { preset: 'all', from: '', to: '' };
  const saveUi = () => store.set('pp_mc_ui', ui);
  let D = null, viewEl = null, sel = new Set();

  async function viewMc(view) {
    viewEl = view;
    view.innerHTML = loadingCard('Loading MC bills…');
    try { D = await api(`/mc?firm=${S.firm}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    sel = new Set();
    draw();
  }

  const nextNo = (partyName) => {
    const n = String(partyName || '').toUpperCase();
    const pro = D.issues.filter(i => String(i.party_name || '').toUpperCase() === n && i.bill).map(i => billNum(i.bill.bill_no));
    const sole = D.sole.filter(s => s.company_name === n).map(s => billNum(s.bill_no));
    return Math.max(0, ...pro, ...sole) + 1;
  };

  const rng = () => PP.resolveRange(ui.range);
  function filtered() {
    const q = ui.q.trim().toLowerCase();
    return D.issues.filter(i =>
      (!q || `${i.party_name} ${i.issue_no} ${i.bill?.bill_no || ''}`.toLowerCase().includes(q)) &&
      (!ui.party || String(i.party_id) === ui.party) &&
      (!ui.gen || (ui.gen === 'yes') === !!i.bill) &&
      (!rng()[0] || i.issue_date >= rng()[0]) && (!rng()[1] || i.issue_date <= rng()[1]));
  }

  function draw() {
    const parties = [...new Map(D.issues.map(i => [i.party_id, i.party_name])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    const list = filtered();
    for (const id of [...sel]) if (!list.some(i => i.id === id && !i.bill)) sel.delete(id);
    const picked = D.issues.filter(i => sel.has(i.id));
    const pickedWt = n3(picked.reduce((s, i) => s + val(i.net_wt), 0));
    const notGen = D.issues.filter(i => !i.bill).length;
    viewEl.innerHTML = `
      <div class="toolbar">
        <div class="search"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" id="mQ" placeholder="Party, issue no or MC bill no…" value="${esc(ui.q)}" /></div>
        <select class="select" id="mParty" style="width:230px"><option value="">All parties</option>${parties.map(([id, n]) => `<option value="${id}" ${String(id) === ui.party ? 'selected' : ''}>${esc(n || '—')}</option>`).join('')}</select>
        <div class="chips" id="mGen">${[['', 'All'], ['no', `Not generated${notGen ? ' (' + notGen + ')' : ''}`], ['yes', 'Generated']].map(([k, l]) => `<button type="button" class="chip ${ui.gen === k ? 'on' : ''}" data-gen="${k}">${l}</button>`).join('')}</div>
        <div id="mRange"></div>
      </div>
      <div class="card mc-act">
        <span>${picked.length ? `<b>${picked.length}</b> voucher(s) · <b>${pickedWt.toFixed(3)} g</b> · ${esc(picked[0].party_name)}` : '<span class="dim">Tick the issue voucher(s) of one party to make its MC bill.</span>'}</span>
        <span class="spacer"></span>
        <button class="btn primary" id="mGenBtn" ${picked.length ? '' : 'disabled'}>Generate MC bill →</button>
      </div>
      <div class="card" style="padding:0"><div class="table-wrap"><table class="grid">
        <thead><tr><th style="width:34px"></th><th>Issue date</th><th>Issue voucher</th><th>Party</th><th style="text-align:right">Weight</th>
          <th>MC bill</th><th>Bill date</th><th style="text-align:right">Gold rate</th><th style="text-align:right">%</th><th style="text-align:right">Total</th><th></th></tr></thead>
        <tbody>${list.map(i => {
          const b = i.bill;
          const otherParty = picked.length && picked[0].party_id !== i.party_id;
          return `<tr class="${sel.has(i.id) ? 'mc-on' : ''}">
            <td>${b ? '' : `<input type="checkbox" class="mc-chk" data-chk="${i.id}" ${sel.has(i.id) ? 'checked' : ''} ${otherParty ? 'disabled title="One party per MC bill"' : ''} />`}</td>
            <td class="mono">${esc(fmtDate(i.issue_date))}</td>
            <td class="mono cell-main">${esc(i.issue_no)}</td>
            <td>${esc(i.party_name || '—')}</td>
            <td class="mono" style="text-align:right">${n3(i.net_wt).toFixed(3)} g</td>
            ${b ? `<td><a class="mono cell-main" href="#" data-view="${b.id}">${esc(b.bill_no)}</a>${b.accounted_at ? ' <span class="tag HALLMARK">Accounted</span>' : ''}</td>
              <td class="mono">${esc(fmtDate(b.bill_date))}</td>
              <td class="mono" style="text-align:right">${b.mc_gold_rate ? '₹' + Number(b.mc_gold_rate).toLocaleString('en-IN') : ''}</td>
              <td class="mono" style="text-align:right">${b.mc_pct ?? ''}</td>
              <td class="mono cell-main" style="text-align:right">${rs(b.total)}</td>
              <td style="white-space:nowrap"><button class="btn sm" data-view="${b.id}">View</button> <button class="btn sm" data-edit="${b.id}">Edit</button> <button class="btn sm danger" data-del="${b.id}">Delete</button></td>`
            : `<td colspan="5"><span class="tag bad">Not generated</span></td><td></td>`}
          </tr>`; }).join('') || '<tr><td colspan="11"><div class="empty"><b>Nothing here</b>Issue vouchers of type OTHERS show here.</div></td></tr>'}</tbody>
      </table></div></div>`;
    bind();
  }

  function bind() {
    $('#mQ').oninput = (e) => { ui.q = e.target.value; saveUi(); draw(); $('#mQ').focus(); const l = ui.q.length; $('#mQ').setSelectionRange(l, l); };
    $('#mParty').onchange = (e) => { ui.party = e.target.value; saveUi(); draw(); };
    $('#mGen').onclick = (e) => { const b = e.target.closest('[data-gen]'); if (!b) return; ui.gen = b.dataset.gen; saveUi(); draw(); };
    PP.dateRange($('#mRange'), ui.range, (rg) => { ui.range = rg; saveUi(); draw(); });
    $('#mGenBtn').onclick = () => openForm(null);
    viewEl.querySelector('tbody').onclick = (e) => {
      const v = e.target.closest('[data-view]'); if (v) { e.preventDefault(); return printBill(billById(Number(v.dataset.view))); }
      const ed = e.target.closest('[data-edit]'); if (ed) return openForm(billById(Number(ed.dataset.edit)));
      const d = e.target.closest('[data-del]'); if (d) return delBill(billById(Number(d.dataset.del)));
    };
    viewEl.querySelector('tbody').onchange = (e) => {
      const c = e.target.closest('[data-chk]'); if (!c) return;
      const id = Number(c.dataset.chk);
      c.checked ? sel.add(id) : sel.delete(id);
      draw();
    };
  }
  const billById = (id) => D.bills.find(b => b.id === id);
  const issuesOf = (b) => D.issues.filter(i => b.issue_ids.map(Number).includes(i.id));

  // ── the numbers ──
  function calc(weight, goldRate, pct) {
    const fine = Math.round(weight * 100) / 100;               // weight to 2 decimals, as printed
    const rate = goldRate && pct ? (pct / 100) * (goldRate / 10) : 0;
    const subtotal = n2(fine * rate);
    const rounded = Math.round(subtotal);
    return { fine, rate, subtotal, rounded, roundOff: n2(rounded - subtotal) };
  }

  // ── Generate / edit form ──
  async function openForm(bill) {
    const vouchers = bill ? issuesOf(bill) : D.issues.filter(i => sel.has(i.id));
    if (!vouchers.length) return;
    const p = vouchers[0];
    const weight = n3(vouchers.reduce((s, i) => s + val(i.net_wt), 0));
    const prefix = mcPrefix(p.party_name);
    const st = {
      date: bill ? bill.bill_date : today(),
      no: bill ? billNum(bill.bill_no) : nextNo(p.party_name),
      gold: bill ? bill.mc_gold_rate || '' : '',
      pct: bill ? bill.mc_pct || defaultPct(p.party_name) : defaultPct(p.party_name),
    };
    let used = null;
    modal(`<h2>${bill ? 'Edit' : 'Generate'} MC bill — ${esc(p.party_name)}</h2>
      <div class="mc-vlist">${vouchers.map(v => `<div><span class="mono">${esc(v.issue_no)}</span> <span class="dim">${esc(fmtDate(v.issue_date))}</span><b class="mono">${n3(v.net_wt).toFixed(3)} g</b></div>`).join('')}</div>
      <div class="fgrid" style="grid-template-columns:1fr 1fr">
        <div class="field"><label>Bill date</label><input class="input" type="date" id="fDate" value="${esc(st.date)}" max="${today()}" /></div>
        <div class="field"><label>Bill number</label><div style="display:flex;align-items:center;gap:6px"><span class="mono">${esc(prefix)}</span><input class="input mono" type="number" min="1" step="1" id="fNo" value="${st.no}" style="width:90px" /></div></div>
        <div class="field"><label>Gold rate (₹ per 10 g)</label><input class="input mono" type="number" step="0.01" id="fGold" value="${esc(st.gold)}" placeholder="e.g. 139600" /></div>
        <div class="field"><label>Percentage (%)</label><input class="input mono" type="number" step="0.01" id="fPct" value="${esc(st.pct)}" /></div>
      </div>
      <div class="mc-prev" id="fPrev"></div>
      <div class="mc-limit" id="fLimit">Checking the ₹19,20,000 limit…</div>
      <div id="fErr"></div>
      <div class="modal-actions"><button class="btn" id="fNoBtn">Cancel</button><button class="btn primary" id="fOk">${bill ? 'Save & print' : 'Generate & print'} →</button></div>`);
    const refresh = () => {
      const g = val($('#fGold').value), pc = val($('#fPct').value);
      const c = calc(weight, g, pc);
      $('#fPrev').innerHTML = !g || !pc ? `<span class="dim">${vouchers.length} voucher(s) · ${weight.toFixed(3)} g — enter the gold rate and % to see the bill.</span>`
        : `<div>Rate: <b>₹${c.rate.toFixed(2)} / g</b> <span class="dim">(${pc}% of ₹${Number(g).toLocaleString('en-IN')} / 10 g)</span></div>
           <div>${c.fine.toFixed(2)} g × ₹${c.rate.toFixed(2)} = <b>₹${c.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> · round off ₹${c.roundOff.toFixed(2)}</div>
           <div class="mc-total">Total ₹${c.rounded.toLocaleString('en-IN')}</div>`;
      const lim = $('#fLimit');
      if (!used) { lim.textContent = used === false ? 'Could not check the limit — close and open again.' : 'Checking the ₹19,20,000 limit…'; $('#fOk').disabled = true; return; }
      const left = n2(used.limit - used.used), after = n2(left - c.rounded);
      lim.className = 'mc-limit' + (after < 0 ? ' bad' : '');
      lim.innerHTML = `${esc(p.party_name)} · FY ${esc(used.fy)}: limit ₹${used.limit.toLocaleString('en-IN')} − used ₹${used.used.toLocaleString('en-IN')}${used.sole ? ` <span class="dim">(₹${used.sole.toLocaleString('en-IN')} in the sole proprietorship)</span>` : ''} = <b>₹${left.toLocaleString('en-IN')} left</b>`
        + (c.rounded ? `<br>${after < 0 ? `This bill is ₹${Math.abs(after).toLocaleString('en-IN')} more than what is left — cannot generate.` : `After this bill ₹${after.toLocaleString('en-IN')} will be left.`}` : '');
      $('#fOk').disabled = after < 0 || !c.rounded;
    };
    const loadUsed = async () => {
      used = null; refresh();
      try { used = await api(`/mc/used?party_id=${p.party_id}&date=${$('#fDate').value || today()}${bill ? '&exclude=' + bill.id : ''}`); } catch { used = false; }
      refresh();
    };
    ['#fGold', '#fPct'].forEach(s => { $(s).oninput = refresh; });
    $('#fDate').onchange = loadUsed;
    $('#fNoBtn').onclick = closeModal;
    $('#fOk').onclick = async () => {
      const g = val($('#fGold').value), pc = val($('#fPct').value), date = $('#fDate').value, no = parseInt($('#fNo').value, 10) || 1;
      if (!date) return ($('#fErr').innerHTML = '<div class="form-err">Enter the bill date.</div>');
      if (!(g > 0) || !(pc > 0)) return ($('#fErr').innerHTML = '<div class="form-err">Enter the gold rate and the percentage.</div>');
      const billNo = `${prefix}${String(no).padStart(2, '0')}`;
      if (D.bills.some(b => b.party_id === p.party_id && b.bill_no === billNo && (!bill || b.id !== bill.id))) return ($('#fErr').innerHTML = `<div class="form-err">${esc(billNo)} is already used for this party.</div>`);
      const btn = $('#fOk'); btn.disabled = true; btn.textContent = 'Saving…';
      const c = calc(weight, g, pc);
      store.set(`pp_mc_pct_${String(p.party_name).toUpperCase()}`, pc);
      const html = billHtml({ party: p, billNo, date, vouchers, c, gold: g, pct: pc });
      try {
        // the printed bill becomes the bill's photo (goes to Cloudinary only when the bill saves)
        let photos = bill ? bill.photos : [];
        try { photos = [await uploadImage(await captureImage(html), billNo)]; }
        catch (e) { toast('The bill picture could not be made — the bill is still saved.', true); }
        const body = {
          firm: S.firm, party_id: p.party_id, kind: 'LABOUR', bill_no: billNo, bill_date: date,
          items: [
            { description: 'JOB WORK GOLD ORNAMENTS', gross_wt: weight, net_wt: weight, amount: 0, tax_pct: 0 },
            { description: 'MAKING CHARGES', rate: n2(c.rate), amount: c.subtotal, tax_pct: 0 },
          ],
          other_charges: 0, cgst: 0, sgst: 0, igst: 0, round_off: c.roundOff, tds: bill ? val(bill.tds) : 0,
          photos, verified: true, notes: 'MC bill', issue_ids: vouchers.map(v => v.id),
          is_mc: true, mc_gold_rate: g, mc_pct: pc, allow_duplicate: true,
        };
        const saved = bill ? await api('/bills/' + bill.id, { method: 'PUT', body }) : await api('/bills', { method: 'POST', body });
        closeModal();
        toast(`MC bill ${saved.bill_no} ${bill ? 'saved' : 'generated'}.`);
        openHtml(html);
        await viewMc(viewEl);
      } catch (e) {
        $('#fErr').innerHTML = `<div class="form-err">${esc(e.message)}</div>`;
        btn.disabled = false; btn.textContent = bill ? 'Save & print →' : 'Generate & print →';
      }
    };
    loadUsed();
    setTimeout(() => $('#fGold')?.focus(), 50);
  }

  async function delBill(b) {
    if (!b) return;
    const reason = await confirmBox({ title: `Delete MC bill ${b.bill_no}?`, text: 'It moves to the Recycle Bin and its issue vouchers open again. You can restore it any time.', okText: 'Delete', danger: true, reason: true });
    if (!reason) return;
    try { await api('/bills/' + b.id, { method: 'DELETE', body: { reason } }); toast(`${b.bill_no} moved to Recycle Bin.`); viewMc(viewEl); }
    catch (e) { toast(e.message, true); }
  }

  // ── View / print (rebuilt from the saved bill) ──
  function printBill(b) {
    if (!b) return;
    const vouchers = issuesOf(b);
    const p = vouchers[0] || { party_name: '' };
    const mk = b.items.find(it => /MAKING/i.test(it.description || '')) || b.items[0] || {};
    const wt = n3(vouchers.reduce((s, i) => s + val(i.net_wt), 0)) || n3(b.items.reduce((s, it) => s + val(it.net_wt), 0));
    const fine = Math.round(wt * 100) / 100;
    const subtotal = n2(b.taxable);
    const c = { fine, rate: val(mk.rate), subtotal, rounded: Math.round(val(b.total)), roundOff: n2(b.round_off) };
    openHtml(billHtml({ party: p, billNo: b.bill_no, date: b.bill_date, vouchers, c, gold: b.mc_gold_rate, pct: b.mc_pct, photo: b.photos[0] }));
  }
  function openHtml(html) { const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else toast('Allow pop-ups to see the bill.', true); }

  // ── capture the printed bill as a JPG and keep it as a temp photo ──
  async function captureImage(html) {
    await PP.loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;height:1123px;border:none;overflow:hidden;';
      f.setAttribute('scrolling', 'no');
      document.body.appendChild(f);
      const done = (fn, v) => { clearTimeout(t); f.remove(); fn(v); };
      const t = setTimeout(() => done(reject, new Error('timeout')), 15000);
      f.onload = async () => {
        try {
          const st = f.contentDocument.createElement('style'); st.textContent = '.no-print{display:none!important;}'; f.contentDocument.head.appendChild(st);
          if (f.contentDocument.fonts) await f.contentDocument.fonts.ready;
          await new Promise(r => setTimeout(r, 400));
          const canvas = await window.html2canvas(f.contentDocument.body, { scale: 2, useCORS: true, logging: false, width: 794, height: 1123, windowWidth: 794, windowHeight: 1123 });
          canvas.toBlob(b => (b ? done(resolve, b) : done(reject, new Error('no image'))), 'image/jpeg', 0.92);
        } catch (e) { done(reject, e); }
      };
      f.srcdoc = html;
    });
  }
  async function uploadImage(blob, billNo) {
    const fd = new FormData(); fd.append('firm', S.firm); fd.append('label', billNo); fd.append('photo', blob, `${billNo.replace(/\W+/g, '_')}.jpg`);
    const r = await fetch('/purchase-pro/api/photos', { method: 'POST', body: fd, credentials: 'same-origin' });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed');
    return d.url;
  }

  // ── the printed MC bill — same layout as the old Purchase ──
  function billHtml({ party, billNo, date, vouchers, c, gold, pct }) {
    // Changed to the PVT LTD on 14/06/2026 - bills before that are billed to the sole proprietorship.
    const pvt = String(date || '') >= '2026-06-14';
    const fmtD = (iso) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
    const fmtA = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const e = (s) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const foot = pct && gold ? `${pct}% RATE for ${Number(gold).toLocaleString('en-IN')} on ${fmtD(date)} is ${Number(c.rate).toFixed(2)}` : `Rate: ₹${Number(c.rate).toFixed(2)}/g`;
    const city = [party.city, party.pincode].filter(Boolean).join(' - ');
    const meta = [e(city), party.pan ? `PAN - ${e(party.pan)}` : ''].filter(Boolean).join('<br>');
    const issueNo = vouchers.map(v => v.issue_no).filter(Boolean).join(', ');
    const issueDate = vouchers[0]?.issue_date || '';
    return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><title>${e(billNo)} — ${e(party.party_name)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1a1a2e;background:#fff;font-size:14px;}
.page{max-width:none;padding:0 48px 52px;}
.accent{height:4px;background:linear-gradient(90deg,#2b4da5,#1d8fd4);margin-bottom:28px;}
.inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;}
.sender-name{font-size:20px;font-weight:900;color:#2b4da5;letter-spacing:-0.3px;}
.sender-meta{font-size:11px;color:#666;line-height:1.75;margin-top:5px;}
.inv-ref{text-align:right;}
.inv-ref-eye{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;color:#bbb;margin-bottom:2px;}
.inv-ref-no{font-size:18px;font-weight:900;color:#2b4da5;}
.inv-ref-date{font-size:11px;color:#666;margin-top:4px;}
hr.thin{border:none;border-top:1px solid #e4e4ed;margin:14px 0;}
.type-eye{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.14em;color:#bbb;margin-bottom:12px;}
.billto-eye{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:5px;}
.billto-name{font-size:14px;font-weight:800;color:#1a1a2e;}
.billto-gstin{font-size:10.5px;color:#777;margin-top:2px;font-family:'Courier New',monospace;}
.billto-addr{font-size:11px;color:#666;margin-top:3px;line-height:1.6;}
table{width:100%;border-collapse:collapse;margin:18px 0 4px;}
thead th{border-top:2px solid #1a1a2e;border-bottom:1px solid #d0d0da;padding:7px 10px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:#555;text-align:left;}
th.r{text-align:right;}td.r{text-align:right;}
.mc-row td{background:#f5f5fb;font-weight:700;color:#1a1a2e;border-top:1px solid #d0d0da;border-bottom:1.5px solid #c0c0d0;}
.foot{font-size:10px;color:#999;font-style:italic;margin:7px 0 0;}
.totals-wrap{display:flex;justify-content:flex-end;margin-top:14px;}
.totals{width:210px;}
.tot-row{display:flex;justify-content:space-between;font-size:11.5px;color:#777;padding:3px 0;}
.tot-row span:last-child{font-family:'Courier New',monospace;}
.tot-final{display:flex;justify-content:space-between;align-items:baseline;border-top:1.5px solid #ddd;margin-top:6px;padding-top:9px;}
.tot-label{font-size:12px;font-weight:700;color:#555;}
.tot-value{font-size:24px;font-weight:900;color:#c0186a;line-height:1;}
.print-btn{margin-top:36px;display:inline-flex;align-items:center;gap:7px;padding:9px 22px;background:#1a3a5c;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}
@media print{.page{padding:0 28px 32px;}.no-print{display:none!important;}.accent,.mc-row td{-webkit-print-color-adjust:exact;print-color-adjust:exact;}@page{margin:10mm;size:A4;}}
</style></head>
<body>
  <div class="accent"></div>
  <div class="page">
    <div class="inv-header">
      <div><div class="sender-name">${e(party.party_name)}</div><div class="sender-meta">${meta}</div></div>
      <div style="text-align:right;">
        <div class="inv-ref"><div class="inv-ref-eye">Invoice</div><div class="inv-ref-no">${e(billNo)}</div><div class="inv-ref-date">${fmtD(date)}</div></div>
        <div style="margin-top:10px;"><div class="inv-ref-eye">For Issue Voucher</div><div style="font-size:14px;font-weight:800;color:#1a1a2e;">${e(issueNo) || '—'}</div>${issueDate ? `<div class="inv-ref-date">${fmtD(issueDate)}</div>` : ''}</div>
      </div>
    </div>
    <hr class="thin"/>
    <div class="type-eye">Job Work Invoice</div>
    <div style="margin-bottom:20px;">
      <div class="billto-eye">Invoice For</div>
      <div class="billto-name">${pvt ? 'APPACHI JEWELLERY PVT LTD' : 'APPACHI JEWELLERY'}</div>
      <div class="billto-gstin">${pvt ? 'GSTIN: 33ABFCA2567H1ZS' : 'PAN: 33ACSPN6014B1ZV'}</div>
      <div class="billto-addr">Melur – 625106</div>
    </div>
    <table>
      <thead><tr><th style="width:46%">Description</th><th class="r">Qty</th><th class="r">Unit Price/gm</th><th class="r">Total Price</th></tr></thead>
      <tbody>
        <tr class="mc-row"><td style="padding:8px 10px;font-size:12px;">JOB WORK GOLD ORNAMENTS</td><td style="padding:8px 10px;font-size:12px;text-align:right;font-family:'Courier New',monospace;">${Number(c.fine).toFixed(2)}</td><td></td><td></td></tr>
        <tr class="mc-row"><td style="padding:8px 10px;font-size:12px;">MAKING CHARGES</td><td></td><td style="padding:8px 10px;font-size:12px;text-align:right;">₹${fmtA(c.rate)}</td><td style="padding:8px 10px;font-size:12px;text-align:right;">₹${fmtA(c.subtotal)}</td></tr>
      </tbody>
    </table>
    <div class="foot">${e(foot)}</div>
    <div class="totals-wrap"><div class="totals">
      <div class="tot-row"><span>Subtotal</span><span>₹${fmtA(c.subtotal)}</span></div>
      <div class="tot-row"><span>Round off</span><span>₹${fmtA(c.roundOff)}</span></div>
      <div class="tot-final"><span class="tot-label">Total</span><span class="tot-value">₹${Math.round(c.rounded).toLocaleString('en-IN')}</span></div>
    </div></div>
    <div class="no-print"><button class="print-btn" onclick="window.print()">Print Invoice</button></div>
  </div>
</body></html>`;
  }

  PP.views.mc = viewMc;
})();
