/* Purchase Pro — Issue & Receipt vouchers (weight account per worker). */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, confirmBox, fmtWhen, S, gm, n3, val, today, fmtDate, monthEnd, partyField, bindParty, loadingCard, errorCard, firmShort } = PP;
  const STATUS = { OPEN: ['Not received', 'bad'], PARTIAL: ['Part received', 'EXPENSE'], RECEIVED: ['Received', 'HALLMARK'] };

  // Voucher types — same list as the old Purchase
  const VTYPES = ['BULLION ISSUE VOUCHER', 'REFINERY', 'OLD SILVER', 'OTHERS'];
  const VLABEL = { 'BULLION ISSUE VOUCHER': 'Bullion', REFINERY: 'Refinery', 'OLD SILVER': 'Old silver', OTHERS: 'Others (MC)' };
  const typeOf = (i) => String(i.item_type || '').trim().toUpperCase();
  // "OTHERS" = MC issue vouchers: they live only in the MC section, never on this page
  const VT_MAIN = VTYPES.filter(t => t !== 'OTHERS');
  const notMc = (i) => typeOf(i) !== 'OTHERS';
  // the month always starts on this month when the page opens
  const ui = { tab: store.get('pp_iv_tab', 'issues'), q: '', range: { preset: 'tm', from: '', to: '' }, vtype: '', openOnly: store.get('pp_iv_open', true) };

  async function viewIssues(view) {
    view.innerHTML = loadingCard();
    let issues, receipts, acc;
    try {
      const [rf, rt] = PP.resolveRange(ui.range), q = (rf ? `&from=${rf}` : '') + (rt ? `&to=${rt}` : '');
      [issues, receipts, acc] = await Promise.all([api(`/issues?firm=${S.firm}${q}`), api(`/receipts?firm=${S.firm}${q}`), api(`/accounts?firm=${S.firm}`)]);
    } catch (e) { view.innerHTML = errorCard(e); return; }
    issues = issues.filter(notMc);
    if (ui.vtype === 'OTHERS') ui.vtype = '';
    // status per issue from each worker's account
    const istat = {}, rlinks = {};
    const pids = [...new Set([...issues, ...receipts].map(x => x.party_id))];
    await Promise.all(pids.map(async pid => {
      try { const a = await api(`/accounts/${pid}?firm=${S.firm}`); a.issues.forEach(i => (istat[i.id] = i)); a.receipts.forEach(r => (rlinks[r.id] = r)); } catch {}
    }));
    // Everything below follows the chosen voucher type (and the month for "issued")
    const ofType = (i) => !ui.vtype || typeOf(i) === ui.vtype;
    const allOpen = Object.values(istat).filter(i => i.remaining > 0.0005 && notMc(i) && ofType(i));
    const pendingWt = allOpen.reduce((s, i) => s + i.remaining, 0);
    const openCount = allOpen.length;
    const monthIssues = issues.filter(ofType);
    const monthWt = monthIssues.reduce((s, i) => s + val(i.net_wt), 0);
    const tLabel = ui.vtype ? VLABEL[ui.vtype] || ui.vtype : 'All types';
    const mLabel = PP.rangeLabel(ui.range).main;

    view.innerHTML = `
      <div class="stats">
        <div class="card stat"><div class="stat-n">${gm(pendingWt)}</div><div class="stat-l">With workers now · ${esc(tLabel)}</div></div>
        <div class="card stat"><div class="stat-n" style="color:${openCount ? 'var(--warn)' : 'inherit'}">${openCount}</div><div class="stat-l">Not fully received · ${esc(tLabel)}</div></div>
        <div class="card stat"><div class="stat-n">${monthIssues.length} <small class="dim" style="font-size:15px">· ${gm(monthWt)}</small></div><div class="stat-l">Issued in ${esc(mLabel)} · ${esc(tLabel)}</div></div>
      </div>
      <div class="toolbar">
        ${receipts.length || ui.tab === 'receipts' ? `<div class="chips" id="ivTabs"><button class="chip ${ui.tab === 'issues' ? 'on' : ''}" data-t="issues">Issue vouchers</button><button class="chip ${ui.tab === 'receipts' ? 'on' : ''}" data-t="receipts">Old receipt vouchers</button></div>` : '<div id="ivTabs"></div>'}
        <div class="search"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><input class="input" id="ivQ" placeholder="Search worker, number…" value="${esc(ui.q)}" /></div>
        <select class="select" id="ivType" style="width:190px" title="Voucher type"><option value="">All voucher types</option>${VT_MAIN.map(t => `<option value="${t}" ${ui.vtype === t ? 'selected' : ''}>${esc(VLABEL[t])}</option>`).join('')}</select>
        <div id="ivRange"></div>
        ${ui.tab === 'issues' ? `<button class="chip ${ui.openOnly ? 'on' : ''}" id="openOnly">Not received only</button>` : ''}
        <div class="spacer"></div>
        <button class="btn" id="newRc" title="The labour bill closes the issue vouchers">+ Labour bill (receive back)</button>
        <button class="btn primary" id="newIv">+ Issue voucher</button>
      </div>
      <div class="card table-wrap"><table class="grid" id="ivTable"></table></div>`;

    const draw = () => {
      const q = ui.q.trim().toUpperCase();
      const match = (x, no) => !q || [x.party_name, no].some(v => v && String(v).toUpperCase().includes(q));
      if (ui.tab === 'issues') {
        const rows = issues.filter(i => match(i, i.issue_no) && ofType(i) && (!ui.openOnly || (istat[i.id]?.remaining ?? i.net_wt) > 0.0005));
        $('#ivTable').innerHTML = `<thead><tr><th>Date</th><th>Issue no</th><th>Worker</th><th>Voucher type · item</th><th style="text-align:right">Issued</th><th style="text-align:right">Received</th><th style="text-align:right">Pending</th><th>Status</th><th style="text-align:right">Days</th></tr></thead>
          <tbody>${rows.length ? rows.map(i => { const s = istat[i.id] || { received: 0, remaining: i.net_wt, status: 'OPEN', days: 0 }; const [lbl, cls] = STATUS[s.status];
            return `<tr data-kind="issue" data-id="${i.id}"><td>${esc(fmtDate(i.issue_date))}</td><td class="mono cell-main">${esc(i.issue_no)}</td><td class="cell-main">${esc(i.party_name)}</td>
              <td>${esc([i.item_type, i.description].filter(Boolean).join(' · ') || '—')}</td><td class="mono" style="text-align:right">${gm(i.net_wt)}</td>
              <td class="mono" style="text-align:right">${s.received ? gm(s.received) : '—'}</td><td class="mono cell-main" style="text-align:right">${s.remaining > 0.0005 ? gm(s.remaining) : '—'}</td>
              <td><span class="tag ${cls}">${lbl}</span></td><td class="mono" style="text-align:right;${s.remaining > 0.0005 && s.days > 15 ? 'color:var(--bad);font-weight:700' : ''}">${s.remaining > 0.0005 ? s.days : ''}</td></tr>`; }).join('')
            : `<tr><td colspan="9"><div class="empty"><b>${ui.openOnly ? 'Nothing pending' : 'No issue vouchers'}</b>${ui.openOnly ? 'Every issue has been received back.' : 'Click "+ Issue voucher" to add one.'}</div></td></tr>`}</tbody>`
          + (rows.length ? (() => { const st = (i) => istat[i.id] || { received: 0, remaining: i.net_wt };
              const iss = rows.reduce((t, i) => t + val(i.net_wt), 0), rec = rows.reduce((t, i) => t + val(st(i).received), 0), pend = rows.reduce((t, i) => t + Math.max(0, val(st(i).remaining)), 0);
              return `<tfoot><tr class="foot-row"><td colspan="4">Total · ${rows.length} issue(s)</td><td class="mono" style="text-align:right">${gm(iss)}</td><td class="mono" style="text-align:right">${gm(rec)}</td><td class="mono" style="text-align:right">${gm(pend)}</td><td colspan="2"></td></tr></tfoot>`; })() : '');
      } else {
        const rows = receipts.filter(r => match(r, r.receipt_no));
        $('#ivTable').innerHTML = `<thead><tr><th>Date</th><th>Receipt no</th><th>Worker</th><th style="text-align:right">Received</th><th>Against issues</th><th style="text-align:right">Extra (carried)</th></tr></thead>
          <tbody>${rows.length ? rows.map(r => { const l = rlinks[r.id] || { links: [], extra: 0 };
            return `<tr data-kind="receipt" data-id="${r.id}"><td>${esc(fmtDate(r.receipt_date))}</td><td class="mono cell-main">${esc(r.receipt_no || '—')}</td><td class="cell-main">${esc(r.party_name)}</td>
              <td class="mono cell-main" style="text-align:right">${gm(r.net_wt)}</td><td style="font-size:12.5px">${l.links.map(x => `${esc(x.to)} <span class="dim">${gm(x.amount)}</span>`).join('<br>') || '—'}</td>
              <td class="mono" style="text-align:right">${l.extra > 0.0005 ? `<span class="tag EXPENSE">${gm(l.extra)}</span>` : '—'}</td></tr>`; }).join('')
            : '<tr><td colspan="6"><div class="empty"><b>No receipt vouchers</b>Click "+ Receipt voucher" to add one.</div></td></tr>'}</tbody>`
          + (rows.length ? `<tfoot><tr class="foot-row"><td colspan="3">Total · ${rows.length} receipt(s)</td><td class="mono" style="text-align:right">${gm(rows.reduce((t, r) => t + val(r.net_wt), 0))}</td><td></td><td class="mono" style="text-align:right">${gm(rows.reduce((t, r) => t + Math.max(0, val((rlinks[r.id] || {}).extra)), 0))}</td></tr></tfoot>` : '');
      }
      PP.sortAll(view);
    };
    draw();
    $('#ivTabs').onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; ui.tab = b.dataset.t; store.set('pp_iv_tab', ui.tab); viewIssues(view); };
    $('#ivQ').oninput = (e) => { ui.q = e.target.value; draw(); };
    PP.dateRange($('#ivRange'), ui.range, (rg) => { ui.range = rg; viewIssues(view); });
    $('#ivType').onchange = (e) => { ui.vtype = e.target.value; viewIssues(view); };
    $('#openOnly')?.addEventListener('click', (e) => { ui.openOnly = !ui.openOnly; store.set('pp_iv_open', ui.openOnly); e.target.classList.toggle('on', ui.openOnly); draw(); });
    $('#ivTable').onclick = (e) => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      if (tr.dataset.kind === 'issue') openIssue(issues.find(i => i.id === Number(tr.dataset.id)), view);
      else openReceipt(receipts.find(r => r.id === Number(tr.dataset.id)), view);
    };
    $('#newIv').onclick = () => openIssue(null, view);
    $('#newRc').onclick = () => { store.set('pp_last_kind', 'LABOUR'); location.hash = '#/bills/new'; };
  }

  function metaLine(x) {
    if (!x) return 'Fill the details and save.';
    return `Entered ${esc(fmtWhen(x.created_at))}${x.created_by_name ? ' by ' + esc(x.created_by_name) : ''}${x.updated_at ? ` · Edited ${esc(fmtWhen(x.updated_at))}${x.updated_by_name ? ' by ' + esc(x.updated_by_name) : ''}` : ''}`;
  }
  const inp = (id, label, v, o = {}) => `<div class="field ${o.full ? 'full' : ''}"><label>${esc(label)}${o.req ? ' <span class="req">*</span>' : ''}</label><input class="input ${o.mono ? 'mono' : ''}" id="${id}" ${o.type ? `type="${o.type}"` : ''} ${o.step ? `step="${o.step}"` : ''} value="${esc(v ?? '')}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${o.max ? `max="${o.max}"` : ''} /></div>`;

  async function drawerShell(title, x, bodyHtml, entity) {
    PP.openDrawer(`<div class="drawer-head"><div class="drawer-title">${esc(title)} <span class="tag plain">${esc(firmShort())}</span><button class="x-btn" id="dClose">×</button></div><div class="drawer-meta">${metaLine(x)}</div></div>
      <div class="drawer-body" id="dBody"><div id="dErr"></div>${bodyHtml}</div>
      <div class="drawer-foot"><button class="btn primary" id="dSave">Save</button><button class="btn" id="dCancel">Cancel</button><div class="spacer"></div>
      ${x ? `<button class="btn" id="dHist">History</button><button class="btn danger" id="dDel">Delete</button>` : ''}</div>`);
    $('#dClose').onclick = () => PP.closeDrawer();
    $('#dCancel').onclick = () => PP.closeDrawer();
    $('#dBody').addEventListener('input', () => PP.markDrawerDirty());
    if (x) $('#dHist').onclick = () => PP.showHistory(entity, x.id, title);
  }
  async function del(path, x, label, view, after) {
    const reason = await confirmBox({ title: `Delete ${label}?`, text: 'It moves to the Recycle Bin and can be restored any time.', okText: 'Delete', danger: true, reason: true });
    if (!reason) return;
    try { await api(`/${path}/${x.id}`, { method: 'DELETE', body: { reason } }); toast(`${label} moved to Recycle Bin.`); PP.closeDrawer(true); after ? after() : viewIssues(view); }
    catch (e) { toast(e.message, true); }
  }

  // ── Issue voucher ──
  async function openIssue(x, view, opts = {}) {
    const mc = !!opts.mc || (x && typeOf(x) === 'OTHERS');
    const parties = await PP.loadParties(true);
    await drawerShell(x ? `${mc ? 'MC issue' : 'Issue'} ${x.issue_no}` : (mc ? 'New MC issue voucher' : 'New issue voucher'), x, `
      <div class="form-sec"><div class="fgrid">
        <div class="full">${partyField('ivParty', parties, x?.party_id, { label: 'Worker', want: 'LABOUR' })}</div>
        ${inp('ivNo', 'Issue number', x?.issue_no, { mono: true, ph: 'Leave empty for next number' })}
        ${inp('ivDate', 'Issue date', x?.issue_date || today(), { type: 'date', req: true, max: today() })}
        <div class="field"><label>Voucher type <span class="req">*</span></label><select class="select" id="ivVType">
          ${(mc ? ['OTHERS'] : [...VT_MAIN, ...(x?.item_type && !VTYPES.includes(typeOf(x)) ? [typeOf(x)] : [])]).map(t => `<option value="${esc(t)}" ${(x ? typeOf(x) : (mc ? 'OTHERS' : ui.vtype || VT_MAIN[0])) === t ? 'selected' : ''}>${esc(VLABEL[t] || t)}</option>`).join('')}
        </select></div>
        ${inp('ivDesc', 'Description', x?.description, { ph: 'Optional' })}
      </div></div>
      <div class="form-sec"><h3>Weight given</h3><div class="fgrid" style="grid-template-columns:1fr 1fr 1fr">
        ${inp('ivPcs', 'Pcs', x?.pcs || '', { type: 'number', step: '1', mono: true })}
        ${inp('ivGross', 'Gross wt (g)', x?.gross_wt || '', { type: 'number', step: '0.001', mono: true })}
        ${inp('ivNet', 'Net wt (g)', x?.net_wt || '', { type: 'number', step: '0.001', mono: true, req: true })}
      </div></div>
      <div class="form-sec">${inp('ivNotes', 'Notes', x?.notes, { full: true, ph: 'Optional' })}</div>
      <div class="form-sec"><h3>Voucher photo</h3>
        <div class="iv-ph-acts">
          <label class="btn sm" for="ivFile">⬆ Upload</label><input type="file" id="ivFile" accept="image/*,application/pdf" multiple hidden />
          <button type="button" class="btn sm" id="ivQrBtn">📱 Phone (QR)</button>
          <button type="button" class="btn sm primary" id="ivAi">✨ AI scan</button>
          <button type="button" class="btn sm" id="ivCrop">Crop / Rotate</button>
        </div>
        <div class="iv-qr hidden" id="ivQrBox"><div id="ivQr"></div><div class="dim">Scan with the phone camera, then take photos. They appear here. <button type="button" class="btn sm" id="ivQrStop">Stop</button></div></div>
        <div class="ai-status" id="ivAiStatus"></div>
        <div class="iv-thumbs" id="ivThumbs"></div>
      </div>`, 'issue');
    let partyId = x?.party_id || null;
    bindParty($('#ivParty'), parties, (id) => (partyId = id));

    // ── photos: temporary until Save (then they go to Cloudinary), same as bills ──
    const photos = (x?.photos || []).slice();
    let sel = 0;
    const isPdf = (u) => /\.pdf($|\?)/i.test(u) || String(u).includes('/raw/');
    const drawThumbs = () => {
      if (sel >= photos.length) sel = Math.max(0, photos.length - 1);
      $('#ivThumbs').innerHTML = photos.length ? photos.map((u, i) => `<div class="iv-th ${i === sel ? 'on' : ''}" data-i="${i}">
          ${isPdf(u) ? '<span class="ph-pdf">PDF</span>' : `<img src="${esc(u)}" alt="" />`}
          <button type="button" class="iv-th-x" data-x="${i}" title="Remove">×</button>
          <a class="iv-th-open" href="${esc(u)}" target="_blank" rel="noopener" title="Open full size">↗</a></div>`).join('')
        : '<div class="dim" style="font-size:12.5px">No photo yet — upload one or use the phone.</div>';
      $('#ivAi').disabled = !photos.length || isPdf(photos[sel]);
      $('#ivCrop').disabled = !photos.length || !PP.canCrop(photos[sel]);
    };
    const addPhotos = (urls) => { const fresh = urls.filter(u => u && !photos.includes(u)); if (!fresh.length) return; photos.push(...fresh); sel = photos.length - 1; drawThumbs(); PP.markDrawerDirty(); };
    drawThumbs();
    const setAi = (t, cls) => { const el = $('#ivAiStatus'); if (el) { el.textContent = t; el.className = 'ai-status ' + (cls || ''); } };
    $('#ivThumbs').onclick = (e) => {
      const xb = e.target.closest('[data-x]');
      if (xb) { photos.splice(Number(xb.dataset.x), 1); drawThumbs(); PP.markDrawerDirty(); return; }
      if (e.target.closest('a')) return;
      const t = e.target.closest('[data-i]'); if (t) { sel = Number(t.dataset.i); drawThumbs(); }
    };
    const sendPhoto = async (blob, name) => {
      const fd = new FormData(); fd.append('firm', S.firm); fd.append('photo', blob, name);
      const res = await fetch('/purchase-pro/api/photos', { method: 'POST', body: fd, credentials: 'same-origin' });
      const d = await res.json(); if (!res.ok) throw new Error(d.error || 'Upload failed');
      return d.url;
    };
    // PDF → a JPG of each page (max 4), so AI scan can read it
    const pdfPages = async (file) => {
      await PP.loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      const urls = [];
      for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
        const page = await doc.getPage(n), vp = page.getViewport({ scale: 2 });
        const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.9));
        urls.push(await sendPhoto(blob, `${file.name}-p${n}.jpg`));
      }
      return urls;
    };
    $('#ivFile').onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      for (const file of files) {
        setAi('Uploading ' + file.name + '…');
        try {
          const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
          addPhotos(pdf ? await pdfPages(file) : [await sendPhoto(file, file.name)]); setAi('');
        } catch (err) { setAi('⚠ ' + err.message, 'bad'); }
      }
    };
    let qrPoll = null; const qrSeen = new Set();
    const stopQr = () => { clearInterval(qrPoll); qrPoll = null; $('#ivQrBox')?.classList.add('hidden'); };
    $('#ivQrBtn').onclick = async () => {
      try {
        await PP.loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
        const sess = await api('/upload-sessions', { method: 'POST', body: { firm: S.firm, label: 'Issue voucher ' + ($('#ivNo').value.trim() || '') } });
        $('#ivQr').innerHTML = '';
        new window.QRCode($('#ivQr'), { text: location.origin + sess.url, width: 150, height: 150 });
        $('#ivQrBox').classList.remove('hidden');
        clearInterval(qrPoll);
        qrPoll = setInterval(async () => {
          if (!document.body.contains($('#ivQrBox'))) { clearInterval(qrPoll); return; }
          try {
            const q = await api('/upload-sessions/' + sess.token);
            const fresh = (q.urls || []).filter(u => !qrSeen.has(u)); fresh.forEach(u => qrSeen.add(u));
            addPhotos(fresh);
            if (q.expired) stopQr();
          } catch {}
        }, 2000);
      } catch (err) { toast(err.message, true); }
    };
    $('#ivQrStop').onclick = stopQr;
    $('#ivCrop').onclick = async () => {
      const u = photos[sel]; if (!u) return;
      const nu = await PP.cropPhoto(u);
      if (nu && nu !== u) { photos[sel] = nu; drawThumbs(); PP.markDrawerDirty(); }
    };
    $('#ivAi').onclick = async () => {
      const u = photos[sel]; if (!u) return;
      const btn = $('#ivAi'); btn.disabled = true;
      setAi('AI is reading the voucher… (can take up to 30 seconds when busy)');
      try {
        const { fields: fl } = await api('/scan-issue', { method: 'POST', body: { image_url: u } });
        const set = (id, v) => { if (v !== '' && v != null && v !== 0) { const el = $(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
        set('#ivNo', fl.issue_no); set('#ivDate', fl.date && fl.date <= today() ? fl.date : '');
        set('#ivDesc', fl.description); set('#ivPcs', fl.pcs || ''); set('#ivGross', fl.gross_wt || ''); set('#ivNet', fl.net_wt || '');
        // worker: match the name on the voucher to a supplier / worker
        let who = '';
        if (fl.worker_name && !partyId) {
          const nm = fl.worker_name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
          const cand = parties.filter(p => !p.deleted_at);
          const hit = cand.find(p => p.name.toUpperCase() === nm) || cand.find(p => nm && (p.name.toUpperCase().includes(nm) || nm.includes(p.name.toUpperCase())))
            || cand.find(p => p.alias && nm.includes(String(p.alias).toUpperCase()));
          if (hit) {
            const el = $('#ivParty'); el.value = PP.partyLabel ? PP.partyLabel(hit) : hit.name;
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
            who = ' · worker ' + hit.name;
          } else who = ' · worker on voucher: "' + fl.worker_name + '" (not found — pick it)';
        }
        setAi('✓ Filled from photo' + who + '. Please check every number.', 'ok');
      } catch (err) { setAi('⚠ ' + err.message, 'bad'); }
      finally { btn.disabled = false; }
    };
    $('#dSave').onclick = async () => {
      const body = { firm: S.firm, party_id: partyId, issue_no: $('#ivNo').value, issue_date: $('#ivDate').value, item_type: $('#ivVType').value, description: $('#ivDesc').value, pcs: $('#ivPcs').value, gross_wt: $('#ivGross').value, net_wt: $('#ivNet').value, notes: $('#ivNotes').value, photos };
      try {
        const s = x ? await api('/issues/' + x.id, { method: 'PUT', body }) : await api('/issues', { method: 'POST', body });
        stopQr(); toast(`${mc ? 'MC issue' : 'Issue'} ${s.issue_no} saved.`); PP.closeDrawer(true); opts.onSaved ? opts.onSaved(s) : viewIssues(view);
      } catch (e) { $('#dErr').innerHTML = `<div class="form-err">${esc(e.message)}</div>`; }
    };
    if (x) $('#dDel').onclick = () => del('issues', x, `issue ${x.issue_no}`, view, opts.onSaved);
  }

  // ── Receipt voucher: only that worker's open issues can be linked ──
  async function openReceipt(x, view) {
    const parties = await PP.loadParties(true);
    await drawerShell(x ? `Receipt ${x.receipt_no || ''}` : 'New receipt voucher', x, `
      <div class="form-sec"><div class="fgrid">
        <div class="full">${partyField('rcParty', parties, x?.party_id, { label: 'Worker', want: 'LABOUR' })}</div>
        ${inp('rcNo', 'Receipt number', x?.receipt_no, { mono: true, ph: 'As on the worker\'s slip' })}
        ${inp('rcDate', 'Receipt date', x?.receipt_date || today(), { type: 'date', req: true, max: today() })}
      </div></div>
      <div class="form-sec"><h3>Against issue vouchers <span class="req">*</span></h3><div id="rcIssues" class="mlist"><div class="dim">Pick the worker first.</div></div></div>
      <div class="form-sec"><h3>Weight received</h3><div class="fgrid" style="grid-template-columns:1fr 1fr 1fr">
        ${inp('rcPcs', 'Pcs', x?.pcs || '', { type: 'number', step: '1', mono: true })}
        ${inp('rcGross', 'Gross wt (g)', x?.gross_wt || '', { type: 'number', step: '0.001', mono: true })}
        ${inp('rcNet', 'Net wt (g)', x?.net_wt || '', { type: 'number', step: '0.001', mono: true, req: true })}
      </div><div id="rcPreview"></div></div>
      <div class="form-sec"><div class="fgrid">
        <div class="field full"><label>Labour bill (optional)</label><select class="select" id="rcBill"><option value="">— Not linked —</option></select></div>
        ${inp('rcNotes', 'Notes', x?.notes, { full: true, ph: 'Optional' })}
      </div></div>`, 'receipt');
    let partyId = x?.party_id || null, picked = x ? x.issue_ids.slice() : [], acct = null;

    function preview() {
      const box = $('#rcPreview'); if (!box || !acct) return;
      const mine = x ? (acct.receipts.find(r => r.id === x.id)?.links || []) : [];
      const open = acct.issues.map(i => ({ ...i, open: n3(i.remaining + mine.filter(l => l.key === 'i' + i.id).reduce((s, l) => s + l.amount, 0)) }))
        .filter(i => i.open > 0.0005).sort((a, b) => (a.issue_date < b.issue_date ? -1 : a.issue_date > b.issue_date ? 1 : a.id - b.id));
      let left = val($('#rcNet').value);
      if (!left) { box.innerHTML = ''; return; }
      const lines = [];
      for (const i of [...open.filter(i => picked.includes(i.id)), ...open]) {
        if (left <= 0.0005) break;
        if (lines.some(l => l.id === i.id)) continue;
        const t = Math.min(left, i.open); left = n3(left - t);
        lines.push({ id: i.id, no: i.issue_no, t, after: n3(i.open - t) });
      }
      // weight not covered by the ticked issues → suggest an open issue of exactly that weight
      const extra = n3(val($('#rcNet').value) - open.filter(i => picked.includes(i.id)).reduce((s, i) => s + i.open, 0));
      const sugg = extra > 0.0005 ? open.filter(i => !picked.includes(i.id) && Math.abs(i.open - extra) < 0.0005) : [];
      box.innerHTML = `<div class="m-prev">${lines.map(l => `<div>${esc(l.no)}: ${gm(l.t)} ${l.after > 0.0005 ? `<span class="warn-t">· ${gm(l.after)} still pending</span>` : '<span class="ok-t">· fully received</span>'}</div>`).join('')}
        ${sugg.length ? `<div style="margin-top:8px"><b>${gm(extra)} matches ${sugg.length > 1 ? 'these open issues' : 'this open issue'} — tap to link and close:</b><div class="chips" style="margin-top:6px">${sugg.map(i => `<button type="button" class="chip" data-sugg="${i.id}">${esc(i.issue_no)} · ${esc(fmtDate(i.issue_date))} · ${gm(i.open)}</button>`).join('')}</div></div>`
          : extra > 0.0005 ? `<div class="warn-t">${gm(extra)} extra — ${picked.length ? 'tick which other issue it is for' : 'tick the issue(s) on the slip'}. Otherwise it goes to this worker's next issue.</div>` : ''}</div>`;
    }
    $('#rcPreview').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sugg]'); if (!b) return;
      const id = Number(b.dataset.sugg);
      if (!picked.includes(id)) picked.push(id);
      const cb = $(`#rcIssues [data-iid="${id}"]`);
      if (cb) { cb.checked = true; cb.closest('.mrow').classList.add('hit'); }
      preview();
    });
    async function loadWorker() {
      const box = $('#rcIssues'); const sel = $('#rcBill');
      sel.innerHTML = '<option value="">— Not linked —</option>';
      if (!partyId) { box.innerHTML = '<div class="dim">Pick the worker first.</div>'; return; }
      box.innerHTML = '<div class="dim">Loading…</div>';
      try { acct = await api(`/accounts/${partyId}?firm=${S.firm}`); } catch (e) { box.innerHTML = `<div class="form-err">${esc(e.message)}</div>`; return; }
      const mine = x ? (acct.receipts.find(r => r.id === x.id)?.links || []) : [];
      const list = acct.issues.map(i => ({ ...i, open: n3(i.remaining + mine.filter(l => l.key === 'i' + i.id).reduce((s, l) => s + l.amount, 0)) }))
        .filter(i => i.open > 0.0005 || picked.includes(i.id));
      box.innerHTML = list.length ? list.map(i => `<label class="mrow ${picked.includes(i.id) ? 'hit' : ''}"><input type="checkbox" data-iid="${i.id}" ${picked.includes(i.id) ? 'checked' : ''}/>
          <span class="mrow-main"><b class="mono">${esc(i.issue_no)}</b> <span class="dim">${esc(fmtDate(i.issue_date))} · ${i.days}d</span><br><span class="dim">${esc([i.item_type, i.description].filter(Boolean).join(' · '))}</span></span>
          <span class="mrow-res"><b>${gm(i.open)}</b><br><span class="dim">pending of ${gm(i.net_wt)}</span></span></label>`).join('')
        : '<div class="photo-empty" style="padding:18px"><b>No pending issues</b>This worker has nothing pending. Enter the issue voucher first.</div>';
      const lb = acct.bills.filter(b => b.kind === 'LABOUR');
      sel.innerHTML += lb.map(b => `<option value="${b.id}" ${x?.bill_id === b.id ? 'selected' : ''}>${esc(b.bill_no)} · ${esc(fmtDate(b.bill_date))} · ₹${b.net}</option>`).join('');
      preview();
    }
    $('#rcIssues').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-iid]'); if (!cb) return;
      const id = Number(cb.dataset.iid);
      picked = cb.checked ? [...picked, id] : picked.filter(v => v !== id);
      cb.closest('.mrow').classList.toggle('hit', cb.checked);
      preview();
    });
    $('#rcNet').addEventListener('input', preview);
    bindParty($('#rcParty'), parties, (id) => { if (id !== partyId) { partyId = id; picked = []; loadWorker(); } });
    loadWorker();
    $('#dSave').onclick = async () => {
      const body = { firm: S.firm, party_id: partyId, receipt_no: $('#rcNo').value, receipt_date: $('#rcDate').value, pcs: $('#rcPcs').value, gross_wt: $('#rcGross').value, net_wt: $('#rcNet').value, issue_ids: picked, bill_id: $('#rcBill').value || null, notes: $('#rcNotes').value };
      try {
        x ? await api('/receipts/' + x.id, { method: 'PUT', body }) : await api('/receipts', { method: 'POST', body });
        toast('Receipt saved.'); PP.closeDrawer(true); viewIssues(view);
      } catch (e) { $('#dErr').innerHTML = `<div class="form-err">${esc(e.message)}</div>`; }
    };
    if (x) $('#dDel').onclick = () => del('receipts', x, 'this receipt', view);
  }

  PP.views.issues = viewIssues;
  PP.openIssue = openIssue; // the MC section opens the same form (type OTHERS)
})();
