/* Purchase Pro — Batch bills: many bills of ONE supplier at once.
   Add all photos (PC or phone QR) → AI reads them one by one in the background →
   check every row against its photo → Save all. Photos go to Cloudinary only on save. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, confirmBox, S, rs, n2, val, today, fmtDate, partyField, bindParty, loadingCard, errorCard } = PP;

  // Single-line service bills only: labour (weights + issue vouchers) and purchase (many weighed lines) need the full editor.
  const KINDS = { HALLMARK: { label: 'Hallmark', desc: 'HALLMARKING CHARGES' }, EXPENSE: { label: 'Expense', desc: 'EXPENSE' } };
  const KEY = () => `pp_batch_${S.firm}`;
  const normNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let B = null;            // { party_id, kind, rows: [...] }
  let parties = [], existing = [], sel = 0, queueBusy = false, qrPoll = null, qrSeen = new Set();
  let viewEl = null;

  const save = () => store.set(KEY(), B);
  const party = () => parties.find(p => p.id === B.party_id) || null;
  const igst = () => party()?.gst_type === 'IGST';
  let uid = Date.now();

  function newRow(url) {
    return { id: ++uid, photo: url, status: 'queued', err: '', bill_no: '', bill_date: '', pcs: '', taxable: '', cgst: '', sgst: '', igst: '', round_off: 0, printed_total: null, tds: '', tdsInfo: null, checked: false, ai: {} };
  }
  const totalOf = (r) => n2(val(r.taxable) + val(r.cgst) + val(r.sgst) + val(r.igst) + val(r.round_off));

  async function viewBatch(view) {
    viewEl = view;
    view.innerHTML = loadingCard();
    try {
      parties = await PP.loadParties();
      const st = store.get(KEY(), null);
      B = st && Array.isArray(st.rows) ? st : { party_id: null, kind: 'HALLMARK', rows: [] };
      // rows left "reading" by a closed tab start again
      B.rows.forEach(r => { if (r.status === 'reading') r.status = 'queued'; });
      await loadExisting();
    } catch (e) { view.innerHTML = errorCard(e); return; }
    draw();
    runQueue();
  }

  async function loadExisting() {
    existing = B.party_id ? await api(`/bills?firm=${S.firm}&party_id=${B.party_id}`).catch(() => []) : [];
  }

  // ── flags shown on each row ──
  function flags(r) {
    const f = [];
    if (r.status === 'queued') f.push(['dim', 'Waiting for AI…']);
    if (r.status === 'reading') f.push(['dim', 'AI is reading…']);
    if (r.status === 'failed') f.push(['bad', 'AI could not read: ' + r.err]);
    if (r.status !== 'done' && r.status !== 'failed') return f;
    const n = normNo(r.bill_no);
    if (!n) f.push(['bad', 'Bill no missing']);
    else {
      const dupOld = existing.find(b => normNo(b.bill_no) === n);
      if (dupOld) f.push(['bad', `Already entered (${fmtDate(dupOld.bill_date)})`]);
      if (B.rows.filter(x => normNo(x.bill_no) === n).length > 1) f.push(['bad', 'Same bill no twice in this batch']);
    }
    if (!r.bill_date) f.push(['bad', 'Date missing']);
    else if (r.bill_date > today()) f.push(['bad', 'Date in the future']);
    if (!(val(r.taxable) > 0)) f.push(['bad', 'Amount missing']);
    if (!igst() && Math.abs(val(r.cgst) - val(r.sgst)) > 0.01) f.push(['warn', 'CGST ≠ SGST']);
    if (r.printed_total != null && Math.abs(r.printed_total - totalOf(r)) > 0.5) f.push(['warn', `Bill says ${rs(r.printed_total)}`]);
    if (r.ai.gst_valid === false) f.push(['warn', 'Our GSTIN not found on bill']);
    const pg = party()?.gstin, sg = String(r.ai.supplier_gstin || '').replace(/\s/g, '').toUpperCase();
    if (pg && sg && sg.length === 15 && sg !== pg) f.push(['warn', `Supplier GSTIN on bill: ${sg}`]);
    if (r.tdsInfo && r.tdsInfo.required && r.tdsInfo.suggested > 0 && !(val(r.tds) > 0)) f.push(['warn', 'TDS needed']);
    if (r.saveErr) f.push(['warn', 'Not saved: ' + r.saveErr]);
    return f;
  }
  const isBad = (r) => flags(r).some(([c]) => c === 'bad') || r.status !== 'done';

  // Redraw, but keep the cursor where it was (the AI queue redraws while you type)
  function draw() {
    const a = document.activeElement;
    const keep = a && a.dataset && a.dataset.f ? { i: a.dataset.i, f: a.dataset.f, s: a.selectionStart } : null;
    drawNow();
    if (keep) {
      const el = viewEl.querySelector(`[data-i="${keep.i}"][data-f="${keep.f}"]`);
      if (el) { el.focus(); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.s); } catch {} }
    }
  }
  function drawNow() {
    const p = party();
    const done = B.rows.filter(r => r.status === 'done').length, waiting = B.rows.filter(r => r.status === 'queued' || r.status === 'reading').length;
    const ready = B.rows.filter(r => r.checked && !isBad(r));
    if (sel >= B.rows.length) sel = Math.max(0, B.rows.length - 1);
    const cur = B.rows[sel];
    viewEl.innerHTML = `
      <div class="card" style="padding:16px 18px;margin-bottom:14px">
        <div class="fgrid" style="grid-template-columns:2fr 1fr auto;align-items:end">
          ${partyField('bSup', parties, B.party_id, { label: 'Supplier (all bills in this batch)', want: B.kind })}
          <div class="field"><label>Bill type</label><select class="select" id="bKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${B.kind === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
          <div class="field"><label>&nbsp;</label><div style="display:flex;gap:8px">
            <label class="btn" for="bFiles" ${p ? '' : 'style="opacity:.5;pointer-events:none"'}>Add photos from PC</label><input type="file" id="bFiles" accept="image/*" multiple hidden />
            <button class="btn" id="bQr" type="button" ${p ? '' : 'disabled'}>Use phone (QR)</button>
          </div></div>
        </div>
        ${p ? '' : '<div class="dim" style="margin-top:8px">Pick the supplier first. Labour and purchase bills (weights, issue vouchers) still go through New bill.</div>'}
        <div class="qr-box hidden" id="bQrBox" style="max-width:280px"><div id="bQrCode"></div><div class="dim" style="margin-top:8px">Scan once with the phone camera, then take every bill photo. They appear here automatically.</div><button class="ghost-btn" id="bQrStop" style="margin-top:8px">Close</button></div>
      </div>
      ${B.rows.length ? `
      <div class="batch">
        <div class="card batch-list">
          <div class="batch-head">
            <span><b>${B.rows.length}</b> bills · ${done} read${waiting ? ` · <span class="dim">${waiting} waiting for AI (about 2 a minute)</span>` : ''}</span>
            <span class="spacer"></span>
            <button class="btn sm" id="bAll">Tick all ready</button>
            <button class="btn sm danger" id="bClear">Clear batch</button>
          </div>
          <div class="table-wrap"><table class="grid batch-table">
            <thead><tr><th style="width:30px">✓</th><th>#</th><th></th><th>Bill no</th><th>Date</th><th style="text-align:right">Pcs</th><th style="text-align:right">Taxable</th>
              ${igst() ? '<th style="text-align:right">IGST</th>' : '<th style="text-align:right">CGST</th><th style="text-align:right">SGST</th>'}
              <th style="text-align:right">Total</th><th style="text-align:right">TDS</th><th>Check</th><th></th></tr></thead>
            <tbody>${B.rows.map((r, i) => {
              const fl = flags(r), bad = isBad(r);
              const inp = (f, w, t = 'number') => `<input class="cin mono" ${t === 'number' ? 'type="number" step="0.01"' : t === 'date' ? 'type="date"' : ''} data-i="${i}" data-f="${f}" value="${esc(r[f] ?? '')}" style="width:${w}px;${t === 'number' ? 'text-align:right' : ''}" ${r.status === 'done' || r.status === 'failed' ? '' : 'disabled'} />`;
              return `<tr class="${i === sel ? 'on' : ''} ${bad ? 'b-bad' : r.checked ? 'b-ok' : ''}" data-row="${i}">
                <td><input type="checkbox" data-chk="${i}" ${r.checked ? 'checked' : ''} ${bad ? 'disabled title="Fix the red items first"' : ''} /></td>
                <td class="dim">${i + 1}</td>
                <td><img class="b-thumb" src="${esc(r.photo)}" alt="" /></td>
                <td>${inp('bill_no', 120, 'text')}</td>
                <td>${inp('bill_date', 135, 'date')}</td>
                <td>${inp('pcs', 60)}</td>
                <td>${inp('taxable', 95)}</td>
                ${igst() ? `<td>${inp('igst', 85)}</td>` : `<td>${inp('cgst', 80)}</td><td>${inp('sgst', 80)}</td>`}
                <td class="mono cell-main" style="text-align:right">${r.status === 'done' ? rs(totalOf(r)) : ''}</td>
                <td>${inp('tds', 75)}</td>
                <td class="b-flags">${fl.map(([c, t]) => `<div class="${c === 'bad' ? 'bad-t' : c === 'warn' ? 'warn-t' : 'dim'}">${esc(t)}</div>`).join('') || '<span class="ok-t">Looks fine</span>'}
                  ${r.status === 'failed' ? `<button class="ghost-btn" data-retry="${i}">Read again</button>` : ''}</td>
                <td><button class="ghost-btn" data-del="${i}" title="Remove from batch">×</button></td>
              </tr>`; }).join('')}</tbody>
          </table></div>
          <div class="batch-foot">
            <span class="dim">Tick a bill only after checking it against its photo (click a row to see the photo).</span>
            <span class="spacer"></span>
            <button class="btn primary" id="bSave" ${ready.length ? '' : 'disabled'}>Save ${ready.length || ''} ticked bill${ready.length === 1 ? '' : 's'}</button>
          </div>
        </div>
        <div class="card batch-photo">${cur ? `<div class="dim" style="margin-bottom:6px">Bill ${sel + 1} of ${B.rows.length}${cur.bill_no ? ' · ' + esc(cur.bill_no) : ''} — <a href="${esc(cur.photo)}" target="_blank" rel="noopener">open full size ↗</a></div><img src="${esc(cur.photo)}" alt="Bill photo" />` : ''}</div>
      </div>` : `<div class="card empty"><b>No bills yet</b>${p ? 'Add all the bill photos at once — from the PC (select many) or the phone (scan the QR once, take every photo).' : 'Pick the supplier, then add the photos.'}</div>`}`;
    bind();
  }

  function bind() {
    bindParty($('#bSup'), parties, async (id) => {
      if (id === B.party_id) return;
      B.party_id = id; save(); await loadExisting();
      B.rows.forEach(r => { r.tdsInfo = null; if (r.status === 'done') fetchTds(r); });
      draw();
    });
    $('#bKind').onchange = (e) => { B.kind = e.target.value; save(); B.rows.forEach(r => { if (r.status === 'done') fetchTds(r); }); draw(); };
    $('#bFiles').onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        const fd = new FormData(); fd.append('firm', S.firm); fd.append('photo', f);
        try {
          const r = await fetch('/purchase-pro/api/photos', { method: 'POST', body: fd, credentials: 'same-origin' });
          const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed');
          addPhoto(d.url);
        } catch (err) { toast(`${f.name}: ${err.message}`, true); }
      }
    };
    $('#bQr').onclick = startQr;
    $('#bQrStop').onclick = stopQr;
    if (!B.rows.length) return;
    $('#bClear').onclick = async () => {
      if (!(await confirmBox({ title: 'Clear this batch?', text: 'All rows not saved yet are removed from this screen. Saved bills are not touched.', okText: 'Clear', danger: true }))) return;
      B.rows = []; save(); draw();
    };
    $('#bAll').onclick = () => { B.rows.forEach(r => { if (!isBad(r)) r.checked = true; }); save(); draw(); };
    $('#bSave').onclick = saveAll;
    const tb = viewEl.querySelector('.batch-table tbody');
    tb.addEventListener('change', (e) => {
      const c = e.target.closest('[data-chk]');
      if (c) { B.rows[Number(c.dataset.chk)].checked = c.checked; save(); draw(); return; }
      const el = e.target.closest('[data-f]'); if (!el) return;
      const r = B.rows[Number(el.dataset.i)], f = el.dataset.f;
      r[f] = f === 'bill_no' ? el.value.trim().toUpperCase() : f === 'bill_date' ? el.value : (el.value === '' ? '' : Number(el.value));
      r.checked = false; delete r.saveErr; // changed after checking → check again
      if (r.status === 'failed') r.status = 'done'; // typed in by hand instead
      if (f === 'taxable' || f === 'bill_date') fetchTds(r);
      save(); draw();
    });
    tb.addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]');
      if (d) { B.rows.splice(Number(d.dataset.del), 1); save(); draw(); return; }
      const rt = e.target.closest('[data-retry]');
      if (rt) { B.rows[Number(rt.dataset.retry)].status = 'queued'; save(); draw(); runQueue(); return; }
      if (e.target.closest('input,button,a')) { const tr = e.target.closest('[data-row]'); if (tr && Number(tr.dataset.row) !== sel) { sel = Number(tr.dataset.row); drawPhoto(); } return; }
      const tr = e.target.closest('[data-row]'); if (tr) { sel = Number(tr.dataset.row); draw(); }
    });
  }
  // switch the big photo without redrawing the table (keeps the cursor in the box being typed in)
  function drawPhoto() {
    const cur = B.rows[sel], box = viewEl.querySelector('.batch-photo'); if (!box || !cur) return;
    viewEl.querySelectorAll('.batch-table tr[data-row]').forEach(tr => tr.classList.toggle('on', Number(tr.dataset.row) === sel));
    box.innerHTML = `<div class="dim" style="margin-bottom:6px">Bill ${sel + 1} of ${B.rows.length}${cur.bill_no ? ' · ' + esc(cur.bill_no) : ''} — <a href="${esc(cur.photo)}" target="_blank" rel="noopener">open full size ↗</a></div><img src="${esc(cur.photo)}" alt="Bill photo" />`;
  }

  function addPhoto(url) {
    if (B.rows.some(r => r.photo === url)) return;
    B.rows.push(newRow(url)); save(); draw(); runQueue();
  }

  async function startQr() {
    try {
      await PP.loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
      const s = await api('/upload-sessions', { method: 'POST', body: { firm: S.firm, label: `${party()?.name || ''} bills` } });
      $('#bQrCode').innerHTML = '';
      new window.QRCode($('#bQrCode'), { text: location.origin + s.url, width: 180, height: 180 });
      $('#bQrBox').classList.remove('hidden');
      clearInterval(qrPoll);
      qrPoll = setInterval(async () => {
        if (!document.body.contains($('#bQrBox'))) { clearInterval(qrPoll); return; }
        try {
          const r = await api('/upload-sessions/' + s.token);
          (r.urls || []).filter(u => !qrSeen.has(u)).forEach(u => { qrSeen.add(u); addPhoto(u); });
          if (r.expired) stopQr();
        } catch {}
      }, 2500);
    } catch (e) { toast(e.message, true); }
  }
  function stopQr() { clearInterval(qrPoll); qrPoll = null; $('#bQrBox')?.classList.add('hidden'); }

  // ── AI queue: one bill at a time (Groq free plan ≈ 2 bills a minute) ──
  async function runQueue() {
    if (queueBusy) return;
    queueBusy = true;
    try {
      for (;;) {
        const r = B.rows.find(x => x.status === 'queued');
        if (!r || !document.body.contains(viewEl) || location.hash.indexOf('#/batch') !== 0) break;
        r.status = 'reading'; save(); draw();
        try {
          let fields;
          for (let k = 0; ; k++) {
            try { fields = (await api('/scan', { method: 'POST', body: { image_url: r.photo } })).fields; break; }
            catch (e) { if (!/busy|quota/i.test(e.message) || k >= 4) throw e; await new Promise(ok => setTimeout(ok, 20000)); }
          }
          applyAi(r, fields || {});
          r.status = 'done';
          await fetchTds(r, true);
        } catch (e) { r.status = 'failed'; r.err = String(e.message || e).slice(0, 120); }
        save();
        if (document.body.contains(viewEl)) draw();
      }
    } finally { queueBusy = false; }
  }

  function applyAi(r, f) {
    r.ai = { gst_valid: f.gst_valid, supplier_gstin: f.supplier_gstin || '' };
    r.bill_no = String(f.bill_no || '').toUpperCase();
    r.bill_date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : '';
    const items = Array.isArray(f.items) ? f.items : [];
    const pcs = items.reduce((s, it) => s + (Number(it.pcs) || 0), 0);
    r.pcs = pcs || '';
    const itemSum = n2(items.reduce((s, it) => s + (Number(it.amount) || 0), 0));
    r.taxable = f.taxable_value > 0 ? n2(f.taxable_value) : itemSum || '';
    if (igst()) { r.igst = n2(val(f.igst) || val(f.cgst) + val(f.sgst)); r.cgst = ''; r.sgst = ''; }
    else { r.cgst = f.cgst != null ? n2(f.cgst) : ''; r.sgst = f.sgst != null ? n2(f.sgst) : ''; r.igst = ''; }
    r.printed_total = f.total_value > 0 ? n2(f.total_value) : null;
    // small difference between the printed total and taxable + GST = round off
    const diff = r.printed_total != null ? n2(r.printed_total - n2(val(r.taxable) + val(r.cgst) + val(r.sgst) + val(r.igst))) : 0;
    r.round_off = Math.abs(diff) <= 2 ? diff : 0;
  }

  async function fetchTds(r, quiet) {
    if (!B.party_id || !r.bill_date || !(val(r.taxable) > 0)) { r.tdsInfo = null; return; }
    try {
      const t = await api(`/tds/suggest?firm=${S.firm}&party_id=${B.party_id}&kind=${B.kind}&date=${r.bill_date}&amount=${val(r.taxable)}`);
      r.tdsInfo = t;
      if ((t.required || t.mode === 'ALWAYS') && t.suggested > 0) r.tds = t.suggested;
      else if (r.tds === '' || r.tds == null) r.tds = 0;
    } catch {}
    save();
    if (!quiet && document.body.contains(viewEl)) draw();
  }

  async function saveAll() {
    const list = B.rows.filter(r => r.checked && !isBad(r));
    if (!list.length) return;
    const btn = $('#bSave'); btn.disabled = true; btn.textContent = 'Saving…';
    let ok = 0; const errs = [];
    for (const r of list) {
      const body = {
        firm: S.firm, party_id: B.party_id, kind: B.kind, bill_no: r.bill_no, bill_date: r.bill_date,
        items: [{ description: KINDS[B.kind].desc, pcs: val(r.pcs), amount: val(r.taxable), tax_pct: val(r.taxable) ? Math.round(((val(r.cgst) + val(r.sgst) + val(r.igst)) / val(r.taxable)) * 1000) / 10 : 0 }],
        other_charges: 0, cgst: val(r.cgst), sgst: val(r.sgst), igst: val(r.igst), round_off: val(r.round_off),
        tds: val(r.tds), photos: [r.photo], verified: true, notes: 'Entered in a batch',
      };
      try { await api('/bills', { method: 'POST', body }); ok++; r.saved = true; }
      catch (e) { r.checked = false; errs.push(`${r.bill_no}: ${e.message}`); r.saveErr = e.message; }
    }
    B.rows = B.rows.filter(r => !r.saved);
    save();
    await loadExisting();
    draw();
    if (ok) toast(`${ok} bill${ok === 1 ? '' : 's'} saved.`);
    if (errs.length) toast(`${errs.length} not saved — ${errs[0]}`, true);
  }

  window.addEventListener('hashchange', () => { if (location.hash.indexOf('#/batch') !== 0) stopQr(); });
  PP.views.batch = viewBatch;
})();
