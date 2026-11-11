/* Purchase Pro — Bills screen (list + editor with photo panel and AI scan). */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, confirmBox, fmtWhen, S } = PP;

  const KIND_LABEL = { PURCHASE: 'Purchase', EXPENSE: 'Expense', HALLMARK: 'Hallmark', LABOUR: 'Labour', CREDIT_NOTE: 'Credit Note', DEBIT_NOTE: 'Debit Note' };
  const KIND_TAG = { PURCHASE: 'PURCHASE', EXPENSE: 'EXPENSE', HALLMARK: 'HALLMARK', LABOUR: 'LABOUR', CREDIT_NOTE: 'plain', DEBIT_NOTE: 'plain' };
  const KIND_PARTY = { PURCHASE: 'PURCHASE', EXPENSE: 'EXPENSE', HALLMARK: 'HALLMARK', LABOUR: 'LABOUR' };
  const GST_RATES = [0, 0.25, 1.5, 3, 5, 12, 18, 28];

  const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const n3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
  const val = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
  const rs = (v) => '₹' + n2(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gm = (v) => n3(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' g';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  const firmName = () => (S.ref.firms.find(f => f.id === S.firm) || {}).short || '';

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // ═════════════════════════════ LIST ═════════════════════════════
  const ui = { q: store.get('pp_bill_q', ''), kind: store.get('pp_bill_kind', 'ALL'), month: store.get('pp_bill_month', today().slice(0, 7)), nophoto: false };

  async function viewBills(view, parts) {
    if (parts[0]) return viewEditor(view, parts[0]);
    view.onclick = null;
    view.innerHTML = '<div class="card empty">Loading bills…</div>';
    const monthStart = ui.month ? ui.month + '-01' : '';
    const monthEnd = ui.month ? ui.month + '-31' : '';
    let list;
    try {
      list = await api(`/bills?firm=${S.firm}${monthStart ? `&from=${monthStart}&to=${monthEnd}` : ''}`);
    } catch (e) { view.innerHTML = `<div class="card empty"><b>Could not load bills</b>${esc(e.message)}</div>`; return; }

    view.innerHTML = `
      <div class="stats" id="billStats"></div>
      <div class="toolbar">
        <div class="search">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" id="billQ" placeholder="Search bill no, supplier…" value="${esc(ui.q)}" />
        </div>
        <input class="input" type="month" id="billMonth" value="${esc(ui.month)}" style="width:170px" title="Month (clear for all)" />
        <div class="chips" id="billChips">
          ${['ALL', ...S.ref.billKinds].map(k => `<button class="chip ${ui.kind === k ? 'on' : ''}" data-k="${k}">${k === 'ALL' ? 'All' : KIND_LABEL[k]}</button>`).join('')}
        </div>
        <button class="chip ${ui.nophoto ? 'on' : ''}" id="noPhotoChip">No photo</button>
        <div class="spacer"></div>
        <button class="btn primary" id="newBillBtn">+ New bill</button>
      </div>
      <div class="card table-wrap"><table class="grid">
        <thead><tr><th>Date</th><th>Bill no</th><th>Supplier</th><th>Type</th><th style="text-align:right">Net wt</th><th style="text-align:right">Taxable</th><th style="text-align:right">GST</th><th style="text-align:right">TDS</th><th style="text-align:right">Net payable</th><th>Photo</th></tr></thead>
        <tbody id="billRows"></tbody>
      </table></div>`;

    const draw = () => {
      const q = ui.q.trim().toUpperCase();
      const rows = list.filter(b =>
        (ui.kind === 'ALL' || b.kind === ui.kind) &&
        (!ui.nophoto || !b.photos.length) &&
        (!q || [b.bill_no, b.party_name].some(v => v && String(v).toUpperCase().includes(q))));
      const payable = rows.reduce((s, b) => s + b.sign * b.net, 0);
      const wt = rows.reduce((s, b) => s + b.sign * b.net_wt, 0);
      $('#billStats').innerHTML = `
        <div class="card stat"><div class="stat-n">${rows.length}</div><div class="stat-l">Bills${ui.month ? ' this month' : ''}</div></div>
        <div class="card stat"><div class="stat-n">${rs(payable)}</div><div class="stat-l">Net payable</div></div>
        <div class="card stat"><div class="stat-n">${gm(wt)}</div><div class="stat-l">Net weight</div></div>
        <div class="card stat"><div class="stat-n" style="color:${rows.some(b => !b.photos.length) ? 'var(--bad)' : 'inherit'}">${rows.filter(b => !b.photos.length).length}</div><div class="stat-l">Without photo</div></div>`;
      $('#billRows').innerHTML = rows.length ? rows.map(b => `
        <tr data-id="${b.id}">
          <td>${esc(fmtDate(b.bill_date))}</td>
          <td class="mono cell-main">${esc(b.bill_no)}</td>
          <td><div class="cell-main">${esc(b.party_name || '—')}</div></td>
          <td><span class="tag ${KIND_TAG[b.kind]}">${KIND_LABEL[b.kind]}</span></td>
          <td class="mono" style="text-align:right">${b.net_wt ? gm(b.net_wt) : '—'}</td>
          <td class="mono" style="text-align:right">${rs(b.taxable + b.other_charges)}</td>
          <td class="mono" style="text-align:right">${rs(b.cgst + b.sgst + b.igst)}</td>
          <td class="mono" style="text-align:right">${b.tds ? rs(b.tds) : '—'}</td>
          <td class="mono cell-main" style="text-align:right;${b.sign < 0 ? 'color:var(--ok)' : ''}">${b.sign < 0 ? '−' : ''}${rs(b.net)}</td>
          <td>${b.photos.length ? `<span class="tag HALLMARK">${b.photos.length} ✓</span>` : '<span class="tag bad">Missing</span>'}</td>
        </tr>`).join('')
        : `<tr><td colspan="10"><div class="empty"><b>${list.length ? 'No bill matches' : 'No bills ' + (ui.month ? 'this month' : 'yet')}</b>${list.length ? 'Try a different filter.' : `Click "+ New bill" to enter one for ${esc(firmName())}.`}</div></td></tr>`;
    };
    draw();

    $('#billQ').oninput = (e) => { ui.q = e.target.value; store.set('pp_bill_q', ui.q); draw(); };
    $('#billMonth').onchange = (e) => { ui.month = e.target.value; store.set('pp_bill_month', ui.month); viewBills(view, []); };
    $('#billChips').onclick = (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      ui.kind = b.dataset.k; store.set('pp_bill_kind', ui.kind);
      view.querySelectorAll('#billChips .chip').forEach(c => c.classList.toggle('on', c === b));
      draw();
    };
    $('#noPhotoChip').onclick = (e) => { ui.nophoto = !ui.nophoto; e.target.classList.toggle('on', ui.nophoto); draw(); };
    $('#billRows').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/bills/' + tr.dataset.id; };
    $('#newBillBtn').onclick = () => { location.hash = '#/bills/new'; };
  }

  // ═════════════════════════════ EDITOR ═════════════════════════════
  async function viewEditor(view, idPart) {
    view.onclick = null;
    const isNew = idPart === 'new';
    view.innerHTML = '<div class="card empty">Loading…</div>';
    let bill = null, parties;
    try {
      [parties, bill] = await Promise.all([PP.loadParties(true), isNew ? null : api('/bills/' + Number(idPart))]);
    } catch (e) { view.innerHTML = `<div class="card empty"><b>Could not open the bill</b>${esc(e.message)}</div>`; return; }
    if (bill && bill.firm !== S.firm) {
      S.firm = bill.firm; store.set('pp_firm', S.firm);
      document.querySelectorAll('#firmSwitch button').forEach(b => b.classList.toggle('on', Number(b.dataset.firm) === S.firm));
    }

    const DRAFT = 'pp_draft_bill_' + S.firm;
    const draft = isNew ? store.get(DRAFT, null) : null;
    // Editor state
    const st = bill ? {
      kind: bill.kind, party_id: bill.party_id, bill_no: bill.bill_no, bill_date: bill.bill_date,
      items: bill.items.map(it => ({ ...it, manualAmt: Math.abs(n2(it.net_wt * it.rate) - n2(it.amount)) > 0.01 })),
      other_charges: bill.other_charges, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst, gstManual: true,
      round_off: bill.round_off, printed_total: bill.total, tds: bill.tds, photos: bill.photos.slice(), notes: bill.notes || '', verified: false,
    } : (draft || {
      kind: store.get('pp_last_kind', 'PURCHASE'), party_id: null, bill_no: '', bill_date: today(),
      items: [{}], other_charges: 0, cgst: 0, sgst: 0, igst: 0, gstManual: false, round_off: 0, printed_total: '', tds: 0, photos: [], notes: '', verified: false,
    });
    if (!st.items.length) st.items = [{}];
    st.issue_ids = bill ? (bill.issue_ids || []).slice() : (st.issue_ids || []);
    let photoIdx = 0, ivAcct = null;
    PP.setDirty(false);

    const partyById = (id) => parties.find(p => p.id === Number(id));
    const partyLabel = (p) => p ? `${p.name}${p.city ? ' — ' + p.city : ''}` : '';

    view.innerHTML = `
      <div class="bill-ed">
        <div class="bill-left">
          <div class="card bill-card">
            <div class="ed-head">
              <a href="#/bills" class="back-link">← Bills</a>
              <div class="ed-title">${isNew ? 'New bill' : 'Bill ' + esc(bill.bill_no)} <span class="tag plain">${esc(firmName())}</span></div>
              ${!isNew ? `<div class="ed-meta">Entered ${esc(fmtWhen(bill.created_at))}${bill.created_by_name ? ' by ' + esc(bill.created_by_name) : ''}${bill.updated_at ? ` · Edited ${esc(fmtWhen(bill.updated_at))}${bill.updated_by_name ? ' by ' + esc(bill.updated_by_name) : ''}` : ''}</div>` : ''}
            </div>
            ${draft ? '<div class="draft-note">Restored your unsaved draft. <button type="button" class="ghost-btn" id="clearDraft">Start fresh</button></div>' : ''}
            <div id="edErr"></div>

            <div class="field"><label>Bill type <span class="req">*</span></label>
              <div class="checks" id="kindChecks">${S.ref.billKinds.map(k => `<label><input type="radio" name="kind" value="${k}" ${st.kind === k ? 'checked' : ''}/>${KIND_LABEL[k]}</label>`).join('')}</div>
            </div>

            <div class="ed-row">
              <div class="field" style="flex:2.2"><label>Supplier <span class="req">*</span></label>
                <input class="input" id="partyIn" list="partyList" placeholder="Type to search supplier…" value="${esc(partyLabel(partyById(st.party_id)))}" autocomplete="off" />
                <datalist id="partyList"></datalist>
                <div class="hint" id="partyInfo"></div>
              </div>
              <div class="field" style="flex:1.2"><label>Bill number <span class="req">*</span></label>
                <input class="input mono" id="billNo" value="${esc(st.bill_no)}" autocomplete="off" />
                <div class="hint" id="dupInfo"></div>
              </div>
              <div class="field" style="flex:1"><label>Bill date <span class="req">*</span></label>
                <input class="input" type="date" id="billDate" value="${esc(st.bill_date)}" max="${today()}" />
              </div>
            </div>

            <div class="field hidden" id="refWrap" style="margin-bottom:16px"><label>Note is against bill (optional)</label>
              <select class="select" id="refBill"><option value="">— Not linked: reduces the oldest unpaid bill —</option></select></div>

            <div class="field hidden" id="ivWrap" style="margin-bottom:16px"><label>Against issue vouchers (Material Out) — the net wt on the lines closes them</label>
              <div id="ivList" class="mlist"></div><div id="ivPrev"></div></div>

            <div class="items-wrap">
              <table class="items">
                <thead><tr><th style="width:34px">#</th><th>Description</th><th style="width:118px">HUID</th><th style="width:62px">Pcs</th><th style="width:96px">Gross wt</th><th style="width:96px">Net wt</th><th style="width:104px">Rate</th><th style="width:82px">GST %</th><th style="width:128px">Amount</th><th style="width:34px"></th></tr></thead>
                <tbody id="itemRows"></tbody>
                <tfoot><tr><td></td><td><button class="btn sm" id="addLine" type="button">+ Add line</button></td><td></td>
                  <td class="mono" id="tPcs"></td><td class="mono" id="tGross"></td><td class="mono" id="tNet"></td><td></td><td></td><td class="mono" id="tAmt"></td><td></td></tr></tfoot>
              </table>
            </div>

            <div class="ed-bottom">
              <div class="field" style="flex:1"><label>Notes</label><textarea class="textarea" id="notes" placeholder="Optional">${esc(st.notes)}</textarea></div>
              <div class="totals" id="totals"></div>
            </div>

            <label class="verify"><input type="checkbox" id="verified" ${st.verified ? 'checked' : ''}/> I checked this bill against the photo / paper bill</label>

            <div class="ed-actions">
              <button class="btn primary" id="saveBill" type="button">${isNew ? 'Save bill' : 'Save changes'}</button>
              ${isNew ? '<button class="btn" id="saveNew" type="button">Save &amp; new</button>' : ''}
              <a class="btn" href="#/bills">Cancel</a>
              <div class="spacer"></div>
              ${!isNew ? '<button class="btn" id="histBtn" type="button">Edit history</button><button class="btn danger" id="delBill" type="button">Delete</button>' : ''}
            </div>
          </div>
        </div>

        <div class="bill-right">
          <div class="card photo-card">
            <div class="photo-head"><b>Bill photo</b><span class="dim" id="photoCount"></span></div>
            <div class="photo-main" id="photoMain"></div>
            <div class="photo-thumbs" id="photoThumbs"></div>
            <div class="photo-btns">
              <label class="btn" for="pcFile">Upload from PC</label>
              <input type="file" id="pcFile" accept="image/*,application/pdf" multiple hidden />
              <button class="btn" id="phoneBtn" type="button">Use phone (QR)</button>
            </div>
            <div class="qr-box hidden" id="qrBox"><div id="qrCode"></div><div class="dim" style="margin-top:8px">Scan with the phone camera. Photos appear here automatically.</div><button class="ghost-btn" id="qrStop" style="margin-top:8px">Close</button></div>
            <button class="btn primary ai-btn" id="aiBtn" type="button">AI Scan — fill from photo</button>
            <div class="ai-status" id="aiStatus"></div>
          </div>
        </div>
      </div>`;

    // ── Supplier picker ──
    function fillPartyList() {
      const want = KIND_PARTY[st.kind];
      const sorted = parties.slice().sort((a, b) => (want ? (b.types.includes(want) - a.types.includes(want)) : 0) || a.name.localeCompare(b.name));
      $('#partyList').innerHTML = sorted.map(p => `<option value="${esc(partyLabel(p))}">${esc([p.gstin, p.types.join('/')].filter(Boolean).join(' · '))}</option>`).join('');
    }
    function showPartyInfo() {
      const p = partyById(st.party_id);
      $('#partyInfo').innerHTML = p
        ? `<span class="mono">${esc(p.gstin || 'No GSTIN')}</span> · ${esc(p.gst_type)} · TDS ${esc(p.tds_mode === 'AUTO' ? 'auto' : p.tds_mode.toLowerCase())}`
        : ($('#partyIn').value.trim() ? '<span style="color:var(--bad)">Pick a supplier from the list (or add it under Suppliers).</span>' : '');
    }
    fillPartyList(); showPartyInfo();
    $('#partyIn').addEventListener('input', () => {
      const v = $('#partyIn').value.trim().toUpperCase();
      const p = parties.find(x => partyLabel(x).toUpperCase() === v) || parties.find(x => x.name.toUpperCase() === v);
      st.party_id = p ? p.id : null;
      showPartyInfo(); recalc(); checkDup(); dirty();
    });

    // ── Duplicate bill number (live) ──
    let dupTimer;
    function checkDup() {
      clearTimeout(dupTimer);
      $('#dupInfo').textContent = '';
      const no = $('#billNo').value.trim().toUpperCase();
      if (!no || !st.party_id) return;
      dupTimer = setTimeout(async () => {
        try {
          const same = await api(`/bills?firm=${S.firm}&party_id=${st.party_id}`);
          const hit = same.find(b => b.bill_no.toUpperCase() === no && (!bill || b.id !== bill.id));
          $('#dupInfo').innerHTML = hit ? `<span style="color:var(--bad);font-weight:600">Already entered on ${esc(fmtDate(hit.bill_date))}</span>` : '';
        } catch {}
      }, 350);
    }
    checkDup();

    // ── Items ──
    function rowHtml(it, i) {
      return `<tr data-i="${i}">
        <td class="dim">${i + 1}</td>
        <td><input class="cin" data-f="description" value="${esc(it.description || '')}" /></td>
        <td><input class="cin mono" data-f="huid" value="${esc(it.huid || '')}" maxlength="6" /></td>
        <td><input class="cin num" data-f="pcs" type="number" step="1" min="0" value="${it.pcs ?? ''}" /></td>
        <td><input class="cin num" data-f="gross_wt" type="number" step="0.001" min="0" value="${it.gross_wt ?? ''}" /></td>
        <td><input class="cin num" data-f="net_wt" type="number" step="0.001" min="0" value="${it.net_wt ?? ''}" /></td>
        <td><input class="cin num" data-f="rate" type="number" step="0.01" min="0" value="${it.rate ?? ''}" /></td>
        <td><select class="cin" data-f="tax_pct">${GST_RATES.map(r => `<option value="${r}" ${Number(it.tax_pct ?? 3) === r ? 'selected' : ''}>${r}%</option>`).join('')}</select></td>
        <td><input class="cin num ${it.manualAmt ? 'manual' : ''}" data-f="amount" type="number" step="0.01" min="0" value="${it.amount ?? ''}" title="Net wt × Rate. Type to override." /></td>
        <td><button class="row-x" data-del="${i}" type="button" title="Remove line">×</button></td>
      </tr>`;
    }
    function drawItems() { $('#itemRows').innerHTML = st.items.map(rowHtml).join(''); }
    drawItems();

    $('#itemRows').addEventListener('input', (e) => {
      const inp = e.target.closest('.cin'); if (!inp) return;
      const i = Number(inp.closest('tr').dataset.i); const f = inp.dataset.f;
      const it = st.items[i];
      it[f] = inp.type === 'number' || f === 'tax_pct' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
      if (f === 'amount') { it.manualAmt = inp.value !== ''; inp.classList.toggle('manual', it.manualAmt); }
      if ((f === 'net_wt' || f === 'rate') && !it.manualAmt) {
        const a = n2(val(it.net_wt) * val(it.rate));
        it.amount = a || '';
        inp.closest('tr').querySelector('[data-f="amount"]').value = a || '';
      }
      recalc(); dirty();
    });
    $('#itemRows').addEventListener('change', (e) => { if (e.target.dataset.f === 'tax_pct') { st.items[Number(e.target.closest('tr').dataset.i)].tax_pct = Number(e.target.value); recalc(); dirty(); } });
    $('#itemRows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      st.items.splice(Number(b.dataset.del), 1);
      if (!st.items.length) st.items.push({});
      drawItems(); recalc(); dirty();
    });
    // Enter in the last row's amount adds a new line.
    $('#itemRows').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const tr = e.target.closest('tr');
      if (Number(tr.dataset.i) === st.items.length - 1) addLine();
      else tr.nextElementSibling?.querySelector('.cin')?.focus();
    });
    function addLine() {
      const last = st.items[st.items.length - 1] || {};
      st.items.push({ tax_pct: last.tax_pct ?? 3 });
      drawItems();
      $('#itemRows tr:last-child .cin')?.focus();
      dirty();
    }
    $('#addLine').onclick = addLine;

    // ── Totals ──
    function autoGst() {
      // GST per line on its amount; other charges taxed at the main line rate.
      const p = partyById(st.party_id);
      const igstMode = p && p.gst_type === 'IGST';
      const lines = st.items.filter(it => val(it.amount));
      const mainRate = lines.length ? val(lines.reduce((a, b) => (val(b.amount) > val(a.amount) ? b : a)).tax_pct ?? 3) : 3;
      let g = lines.reduce((s, it) => s + val(it.amount) * val(it.tax_pct ?? 3) / 100, 0) + val(st.other_charges) * mainRate / 100;
      g = n2(g);
      if (igstMode) return { cgst: 0, sgst: 0, igst: g };
      const half = n2(g / 2);
      return { cgst: half, sgst: n2(g - half), igst: 0 };
    }
    function recalc() {
      const pcs = st.items.reduce((s, it) => s + val(it.pcs), 0);
      const gross = st.items.reduce((s, it) => s + val(it.gross_wt), 0);
      const net = st.items.reduce((s, it) => s + val(it.net_wt), 0);
      const taxable = n2(st.items.reduce((s, it) => s + val(it.amount), 0));
      $('#tPcs').textContent = pcs || ''; $('#tGross').textContent = gross ? n3(gross).toFixed(3) : ''; $('#tNet').textContent = net ? n3(net).toFixed(3) : '';
      $('#tAmt').textContent = taxable ? n2(taxable).toFixed(2) : '';
      if (!st.gstManual) Object.assign(st, autoGst());
      const p = partyById(st.party_id);
      const igstMode = p ? p.gst_type === 'IGST' : false;
      const total = n2(taxable + val(st.other_charges) + val(st.cgst) + val(st.sgst) + val(st.igst) + val(st.round_off));
      const netPay = n2(total - val(st.tds));
      const printed = st.printed_total === '' || st.printed_total == null ? null : n2(st.printed_total);
      const mismatch = printed != null && Math.abs(printed - total) > 0.01;
      const tbox = $('#totals');
      const focused = document.activeElement && tbox.contains(document.activeElement) ? document.activeElement.dataset.t : null;
      tbox.innerHTML = `
        <div class="t-row"><span>Taxable (lines)</span><b class="mono">${rs(taxable)}</b></div>
        <div class="t-row"><span>Other charges</span><input class="tin num" data-t="other_charges" type="number" step="0.01" value="${st.other_charges || ''}" placeholder="0.00"/></div>
        ${igstMode
          ? `<div class="t-row"><span>IGST</span><input class="tin num" data-t="igst" type="number" step="0.01" value="${st.igst || ''}" placeholder="0.00"/></div>`
          : `<div class="t-row"><span>CGST</span><input class="tin num" data-t="cgst" type="number" step="0.01" value="${st.cgst || ''}" placeholder="0.00"/></div>
             <div class="t-row"><span>SGST</span><input class="tin num" data-t="sgst" type="number" step="0.01" value="${st.sgst || ''}" placeholder="0.00"/></div>`}
        <div class="t-row t-small"><span>${st.gstManual ? 'GST typed by hand' : 'GST worked out from lines'}</span>${st.gstManual ? '<button class="ghost-btn" id="gstAuto" type="button">Auto</button>' : ''}</div>
        <div class="t-row"><span>Round off</span><input class="tin num" data-t="round_off" type="number" step="0.01" value="${st.round_off || ''}" placeholder="0.00"/></div>
        <div class="t-row t-big"><span>Bill total</span><b class="mono">${rs(total)}</b></div>
        <div class="t-row"><span>Total printed on bill</span><input class="tin num ${mismatch ? 'err' : ''}" data-t="printed_total" type="number" step="0.01" value="${printed ?? ''}" placeholder="optional check"/></div>
        ${mismatch ? `<div class="t-warn">Differs by ${rs(printed - total)}. <button class="ghost-btn" id="fixRound" type="button">Put difference in round off</button></div>` : ''}
        <div class="t-row"><span>TDS</span><input class="tin num" data-t="tds" type="number" step="0.01" min="0" value="${st.tds || ''}" placeholder="0.00"/></div>
        <div class="t-tds" id="tdsHint"></div>
        <div class="t-row t-big t-net"><span>${['CREDIT_NOTE', 'DEBIT_NOTE'].includes(st.kind) ? 'Reduces payable by' : 'Net payable'}</span><b class="mono">${rs(netPay)}</b></div>`;
      if (focused) { const el = tbox.querySelector(`[data-t="${focused}"]`); if (el) { el.focus(); const l = el.value.length; try { el.setSelectionRange(l, l); } catch {} } }
      $('#gstAuto')?.addEventListener('click', () => { st.gstManual = false; recalc(); dirty(); });
      $('#fixRound')?.addEventListener('click', () => { st.round_off = n2(val(st.round_off) + printed - total); recalc(); dirty(); });
      renderTdsHint();
      fetchTds(n2(taxable));
      drawIvPrev();
    }

    // ── Labour bill = worker's receipt: link the issue vouchers it brings back ──
    function ivOpen() {
      if (!ivAcct) return [];
      const own = 'b' + (bill ? bill.id : 0);
      return ivAcct.issues.map(i => ({ ...i, open: n3(i.remaining + (i.links || []).filter(l => l.key === own).reduce((s, l) => s + l.amount, 0)) }))
        .filter(i => i.open > 0.0005 || st.issue_ids.includes(i.id))
        .sort((a, b) => (a.issue_date < b.issue_date ? -1 : a.issue_date > b.issue_date ? 1 : a.id - b.id));
    }
    async function loadIv() {
      const on = st.kind === 'LABOUR';
      $('#ivWrap').classList.toggle('hidden', !on);
      ivAcct = null;
      if (!on) return;
      if (!st.party_id) { $('#ivList').innerHTML = '<div class="dim">Pick the worker first.</div>'; $('#ivPrev').innerHTML = ''; return; }
      $('#ivList').innerHTML = '<div class="dim">Loading…</div>';
      try { ivAcct = await api(`/accounts/${st.party_id}?firm=${S.firm}`); } catch (e) { $('#ivList').innerHTML = `<div class="form-err">${esc(e.message)}</div>`; return; }
      drawIv();
    }
    function drawIv() {
      const list = ivOpen();
      $('#ivList').innerHTML = list.length ? list.map(i => `<label class="mrow ${st.issue_ids.includes(i.id) ? 'hit' : ''}"><input type="checkbox" data-iid="${i.id}" ${st.issue_ids.includes(i.id) ? 'checked' : ''}/>
          <span class="mrow-main"><b class="mono">${esc(i.issue_no)}</b> <span class="dim">${esc(fmtDate(i.issue_date))} · ${i.days}d</span><br><span class="dim">${esc([i.item_type, i.description].filter(Boolean).join(' · '))}</span></span>
          <span class="mrow-res"><b>${gm(i.open)}</b><br><span class="dim">pending of ${gm(i.net_wt)}</span></span></label>`).join('')
        : '<div class="dim">No pending issue vouchers for this worker.</div>';
      drawIvPrev();
    }
    function drawIvPrev() {
      const box = $('#ivPrev'); if (!box) return;
      if (st.kind !== 'LABOUR' || !ivAcct) { box.innerHTML = ''; return; }
      const open = ivOpen().filter(i => i.open > 0.0005);
      const wt = n3(st.items.reduce((s, it) => s + val(it.net_wt), 0));
      if (!wt) { box.innerHTML = open.length ? '<div class="dim" style="margin-top:6px">Enter the net wt on the bill lines to close the issues.</div>' : ''; return; }
      let left = wt; const lines = [];
      for (const i of [...open.filter(i => st.issue_ids.includes(i.id)), ...open]) {
        if (left <= 0.0005) break;
        if (lines.some(l => l.id === i.id) || !st.issue_ids.length) continue;
        const t = Math.min(left, i.open); left = n3(left - t);
        lines.push({ no: i.issue_no, id: i.id, t, after: n3(i.open - t) });
      }
      const extra = n3(wt - open.filter(i => st.issue_ids.includes(i.id)).reduce((s, i) => s + i.open, 0));
      const sugg = extra > 0.0005 ? open.filter(i => !st.issue_ids.includes(i.id) && Math.abs(i.open - extra) < 0.0005) : [];
      box.innerHTML = `<div class="m-prev">${lines.map(l => `<div>${esc(l.no)}: ${gm(l.t)} ${l.after > 0.0005 ? `<span class="warn-t">· ${gm(l.after)} still pending</span>` : '<span class="ok-t">· fully received</span>'}</div>`).join('')}
        ${sugg.length ? `<div style="margin-top:8px"><b>${gm(extra)} matches — tap to link and close:</b><div class="chips" style="margin-top:6px">${sugg.map(i => `<button type="button" class="chip" data-ivs="${i.id}">${esc(i.issue_no)} · ${esc(fmtDate(i.issue_date))} · ${gm(i.open)}</button>`).join('')}</div></div>`
          : extra > 0.0005 && open.length ? `<div class="warn-t">${gm(extra)} ${st.issue_ids.length ? 'extra — tick which other issue it is for.' : 'on this bill — tick the issue voucher(s) it is for.'}</div>` : ''}</div>`;
    }
    $('#ivList').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-iid]'); if (!cb) return;
      const id = Number(cb.dataset.iid);
      st.issue_ids = cb.checked ? [...st.issue_ids, id] : st.issue_ids.filter(v => v !== id);
      cb.closest('.mrow').classList.toggle('hit', cb.checked);
      drawIvPrev(); dirty();
    });
    $('#ivPrev').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ivs]'); if (!b) return;
      const id = Number(b.dataset.ivs);
      if (!st.issue_ids.includes(id)) st.issue_ids.push(id);
      drawIv(); dirty();
    });

    // ── TDS: rate by PAN letter, on taxable value — same as old Purchase ──
    let tdsInfo = null, tdsTimer = null, tdsKey = '';
    function fetchTds(amount) {
      const key = [st.party_id, st.kind, st.bill_date, amount].join('|');
      if (key === tdsKey) return;
      tdsKey = key;
      clearTimeout(tdsTimer);
      tdsTimer = setTimeout(async () => {
        if (!st.party_id || !amount) { tdsInfo = null; renderTdsHint(); return; }
        try {
          tdsInfo = await api(`/tds/suggest?firm=${S.firm}&party_id=${st.party_id}&kind=${st.kind}&date=${st.bill_date}&amount=${amount}${bill ? '&exclude=' + bill.id : ''}`);
        } catch { tdsInfo = null; }
        renderTdsHint();
      }, 400);
    }
    function renderTdsHint() {
      const el = $('#tdsHint'); if (!el) return;
      if (!tdsInfo || !tdsInfo.reason) { el.innerHTML = ''; return; }
      const s = tdsInfo.suggested || 0;
      const differs = Math.abs(val(st.tds) - s) > 0.009;
      el.className = 't-tds' + (s > 0 && !val(st.tds) && (tdsInfo.mode === 'ALWAYS' || tdsInfo.required) ? ' need' : '');
      el.innerHTML = `${esc(tdsInfo.reason)}
        ${differs ? ` <button class="ghost-btn" id="useTds" type="button">Deduct ${rs(s)}</button>` : ''}`;
      $('#useTds')?.addEventListener('click', () => { st.tds = s; recalc(); dirty(); });
    }
    $('#totals').addEventListener('input', (e) => {
      const t = e.target.dataset.t; if (!t) return;
      st[t] = e.target.value === '' ? '' : Number(e.target.value);
      if (['cgst', 'sgst', 'igst'].includes(t)) st.gstManual = true;
      recalc(); dirty();
    });
    recalc();

    // ── Credit / debit note: optionally against one bill of the same supplier ──
    if (bill) st.ref_bill_id = bill.ref_bill_id || null;
    async function drawRef() {
      const isNote = st.kind === 'CREDIT_NOTE' || st.kind === 'DEBIT_NOTE';
      $('#refWrap').classList.toggle('hidden', !isNote);
      if (!isNote || !st.party_id) return;
      try {
        const list = (await api(`/bills?firm=${S.firm}&party_id=${st.party_id}`)).filter(b => b.sign > 0);
        $('#refBill').innerHTML = '<option value="">— Not linked: reduces the oldest unpaid bill —</option>' +
          list.map(b => `<option value="${b.id}" ${st.ref_bill_id === b.id ? 'selected' : ''}>${esc(b.bill_no)} · ${esc(fmtDate(b.bill_date))} · ${rs(b.net)}</option>`).join('');
      } catch {}
    }
    $('#refBill').addEventListener('change', (e) => { st.ref_bill_id = Number(e.target.value) || null; dirty(); });
    let ivParty = st.party_id;
    $('#partyIn').addEventListener('input', () => { st.ref_bill_id = null; drawRef(); if (st.party_id !== ivParty) { ivParty = st.party_id; st.issue_ids = []; loadIv(); } });
    drawRef();
    loadIv();

    // ── Other fields ──
    $('#kindChecks').addEventListener('change', (e) => { st.kind = e.target.value; store.set('pp_last_kind', st.kind); fillPartyList(); drawRef(); loadIv(); recalc(); dirty(); });
    $('#billNo').addEventListener('input', (e) => { st.bill_no = e.target.value; checkDup(); dirty(); });
    $('#billDate').addEventListener('input', (e) => { st.bill_date = e.target.value; dirty(); });
    $('#notes').addEventListener('input', (e) => { st.notes = e.target.value; dirty(); });
    $('#verified').addEventListener('change', (e) => { st.verified = e.target.checked; });
    $('#clearDraft')?.addEventListener('click', () => { store.del(DRAFT); PP.setDirty(false); viewEditor(view, 'new'); });

    function dirty() {
      PP.setDirty(true);
      if (isNew) store.set(DRAFT, { ...st, verified: false });
    }

    // ── Photos ──
    const isPdf = (u) => /\.pdf($|\?)/i.test(u) || u.includes('/raw/');
    function drawPhotos() {
      photoIdx = Math.min(photoIdx, Math.max(0, st.photos.length - 1));
      $('#photoCount').textContent = st.photos.length ? `${st.photos.length} attached` : '';
      const u = st.photos[photoIdx];
      $('#photoMain').innerHTML = !u
        ? '<div class="photo-empty"><b>No photo yet</b>Upload from the PC or use the phone.<br>You can also save now and add it later.</div>'
        : isPdf(u) ? `<a class="pdf-link" href="${esc(u)}" target="_blank" rel="noopener">Open PDF ↗</a>`
        : `<a href="${esc(u)}" target="_blank" rel="noopener" title="Open full size"><img src="${esc(u)}" alt="Bill photo" /></a>`;
      $('#photoThumbs').innerHTML = st.photos.map((p, i) => `<div class="thumb ${i === photoIdx ? 'on' : ''}" data-pi="${i}">${isPdf(p) ? '<span>PDF</span>' : `<img src="${esc(p)}" alt="" />`}<button class="thumb-x" data-px="${i}" title="Remove">×</button></div>`).join('');
      $('#aiBtn').disabled = !st.photos.length;
    }
    drawPhotos();
    $('#photoThumbs').addEventListener('click', async (e) => {
      const x = e.target.closest('[data-px]');
      if (x) {
        e.stopPropagation();
        const ok = await confirmBox({ title: 'Remove this photo?', text: 'It is only removed from this bill.', okText: 'Remove', danger: true });
        if (!ok) return;
        st.photos.splice(Number(x.dataset.px), 1); drawPhotos(); photosChanged(); return;
      }
      const t = e.target.closest('[data-pi]'); if (t) { photoIdx = Number(t.dataset.pi); drawPhotos(); }
    });
    // On an existing bill, photo changes save straight away (no full re-check needed).
    async function photosChanged() {
      if (isNew) { dirty(); return; }
      try { await api(`/bills/${bill.id}/photos`, { method: 'PATCH', body: { photos: st.photos } }); toast('Photos saved.'); }
      catch (e) { toast(e.message, true); }
    }
    function addPhotos(urls) {
      const fresh = urls.filter(u => !st.photos.includes(u));
      if (!fresh.length) return;
      st.photos.push(...fresh); photoIdx = st.photos.length - 1; drawPhotos(); photosChanged();
      fresh.filter(u => !isPdf(u)).forEach(u => runOcr(u));
    }

    $('#pcFile').addEventListener('change', async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) {
        setAi('Uploading ' + f.name + '…');
        const fd = new FormData();
        fd.append('firm', S.firm);
        fd.append('label', [partyById(st.party_id)?.name, $('#billNo').value].filter(Boolean).join(' '));
        fd.append('photo', f);
        try {
          const r = await fetch('/purchase-pro/api/photos', { method: 'POST', body: fd, credentials: 'same-origin' });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Upload failed');
          addPhotos([d.url]);
          setAi('');
        } catch (err) { setAi('⚠ ' + err.message, 'bad'); }
      }
    });

    let qrPoll = null, qrToken = null;
    $('#phoneBtn').onclick = async () => {
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
        const label = [partyById(st.party_id)?.name, $('#billNo').value.trim()].filter(Boolean).join(' · ') || 'Bill photo';
        const s = await api('/upload-sessions', { method: 'POST', body: { firm: S.firm, label } });
        qrToken = s.token;
        $('#qrCode').innerHTML = '';
        new window.QRCode($('#qrCode'), { text: location.origin + s.url, width: 180, height: 180 });
        $('#qrBox').classList.remove('hidden');
        clearInterval(qrPoll);
        qrPoll = setInterval(async () => {
          if (!document.body.contains($('#qrBox'))) { clearInterval(qrPoll); return; }
          try { const r = await api('/upload-sessions/' + qrToken); addPhotos(r.urls); if (r.expired) stopQr(); } catch {}
        }, 2000);
      } catch (e) { toast(e.message, true); }
    };
    function stopQr() { clearInterval(qrPoll); qrPoll = null; $('#qrBox')?.classList.add('hidden'); }
    $('#qrStop').onclick = stopQr;

    // ── AI scan: browser OCR text → AI, else AI vision on the photo ──
    const ocrText = {};
    function setAi(t, cls) { const el = $('#aiStatus'); if (el) { el.textContent = t; el.className = 'ai-status ' + (cls || ''); } }
    async function runOcr(url) {
      try {
        await loadScript('https://unpkg.com/tesseract.js@4.1.4/dist/tesseract.min.js');
        const w = await window.Tesseract.createWorker('eng', 1, { logger: () => {} });
        const { data: { text } } = await w.recognize(url);
        await w.terminate();
        if (text && text.trim()) ocrText[url] = text.trim();
      } catch {}
    }
    $('#aiBtn').onclick = async () => {
      const url = st.photos[photoIdx] || st.photos[0];
      if (!url) return;
      const btn = $('#aiBtn'); btn.disabled = true;
      try {
        if (!ocrText[url] && !isPdf(url)) { setAi('Reading text from photo…'); await runOcr(url); }
        setAi(ocrText[url] ? 'AI is reading the bill…' : 'AI is looking at the photo…');
        const { fields } = await api('/scan', { method: 'POST', body: { image_url: url, ocr_text: ocrText[url] || null } });
        applyScan(fields);
        if (fields.gst_valid) setAi('✓ Filled from photo · our GSTIN found on the bill. Please check every number.', 'ok');
        else setAi('⚠ Filled from photo, but our GSTIN was NOT found on the bill. Check it is billed to us.', 'warn');
      } catch (e) { setAi('⚠ ' + e.message, 'bad'); }
      btn.disabled = !st.photos.length;
    };

    function applyScan(f) {
      if (f.bill_no) { st.bill_no = String(f.bill_no).toUpperCase(); $('#billNo').value = st.bill_no; }
      if (f.date && /^\d{4}-\d{2}-\d{2}$/.test(f.date)) { st.bill_date = f.date; $('#billDate').value = f.date; }
      if (!st.party_id) {
        const g = String(f.supplier_gstin || f.vendor_gstin || '').replace(/\s/g, '').toUpperCase();
        const nm = String(f.supplier_name || f.vendor_name || '').trim().toUpperCase();
        const p = (g && parties.find(x => x.gstin === g)) || (nm && parties.find(x => x.name === nm || (nm.length > 4 && x.name.includes(nm))));
        if (p) { st.party_id = p.id; $('#partyIn').value = partyLabel(p); showPartyInfo(); }
      }
      if (Array.isArray(f.items) && f.items.length) {
        let rate = 3;
        if (f.taxable_value && (f.cgst || f.igst)) {
          const pct = f.igst ? (f.igst / f.taxable_value) * 100 : (f.cgst / f.taxable_value) * 200;
          rate = GST_RATES.reduce((a, b) => (Math.abs(b - pct) < Math.abs(a - pct) ? b : a));
        }
        st.items = f.items.map(it => {
          const net = val(it.net_wt ?? it.gross_wt);
          const amount = val(it.amount) || n2(net * val(it.rate));
          return {
            description: it.description || '', huid: it.huid || '', pcs: it.pcs ?? '', gross_wt: it.gross_wt ?? '', net_wt: it.net_wt ?? it.gross_wt ?? '',
            rate: it.rate ?? '', tax_pct: it.tax_pct != null && GST_RATES.includes(Number(it.tax_pct)) ? Number(it.tax_pct) : rate,
            amount: amount || '', manualAmt: !!val(it.amount) && Math.abs(amount - n2(net * val(it.rate))) > 0.01,
          };
        });
        drawItems();
      }
      if (f.cgst != null || f.sgst != null || f.igst != null) { st.cgst = val(f.cgst); st.sgst = val(f.sgst); st.igst = val(f.igst); st.gstManual = true; }
      if (f.round_off != null) st.round_off = val(f.round_off);
      if (f.tds != null) st.tds = val(f.tds);
      if (f.total_value != null) st.printed_total = val(f.total_value);
      recalc(); checkDup(); dirty();
    }

    // ── Save / delete ──
    function payload(extra) {
      return {
        firm: S.firm, party_id: st.party_id, kind: st.kind, bill_no: $('#billNo').value, bill_date: $('#billDate').value,
        items: st.items, other_charges: st.other_charges, cgst: st.cgst, sgst: st.sgst, igst: st.igst,
        round_off: st.round_off, tds: st.tds, photos: st.photos, notes: st.notes, verified: $('#verified').checked,
        ref_bill_id: st.ref_bill_id || null, issue_ids: st.kind === 'LABOUR' ? st.issue_ids : [], ...extra,
      };
    }
    async function save(andNew) {
      $('#edErr').innerHTML = '';
      const btns = view.querySelectorAll('#saveBill, #saveNew'); btns.forEach(b => (b.disabled = true));
      const send = (extra) => (isNew ? api('/bills', { method: 'POST', body: payload(extra) }) : api('/bills/' + bill.id, { method: 'PUT', body: payload(extra) }));
      try {
        let saved;
        try { saved = await send(); }
        catch (e) {
          if (!/already entered/.test(e.message)) throw e;
          const ok = await confirmBox({ title: 'Duplicate bill number', text: e.message + ' Save it anyway?', okText: 'Save anyway', danger: true });
          if (!ok) return;
          saved = await send({ allow_duplicate: true });
        }
        if (isNew) store.del(DRAFT);
        PP.setDirty(false);
        stopQr();
        toast(`Bill ${saved.bill_no} saved.`);
        if (andNew) { location.hash = '#/bills/new'; if (location.hash === '#/bills/new') viewEditor(view, 'new'); }
        else location.hash = '#/bills';
      } catch (e) {
        $('#edErr').innerHTML = `<div class="form-err">${esc(e.message)}</div>`;
        $('#edErr').scrollIntoView({ block: 'center', behavior: 'smooth' });
      } finally { btns.forEach(b => (b.disabled = false)); }
    }
    $('#saveBill').onclick = () => save(false);
    $('#saveNew')?.addEventListener('click', () => save(true));

    if (!isNew) {
      $('#delBill').onclick = async () => {
        const reason = await confirmBox({ title: `Delete bill ${bill.bill_no}?`, text: 'It moves to the Recycle Bin and can be restored any time.', okText: 'Delete', danger: true, reason: true });
        if (!reason) return;
        try { await api('/bills/' + bill.id, { method: 'DELETE', body: { reason } }); PP.setDirty(false); toast(`Bill ${bill.bill_no} moved to Recycle Bin.`); location.hash = '#/bills'; }
        catch (e) { toast(e.message, true); }
      };
      $('#histBtn').onclick = async () => {
        PP.openDrawer(`<div class="drawer-head"><div class="drawer-title">History · ${esc(bill.bill_no)}<button class="x-btn" id="hClose">×</button></div><div class="drawer-meta">Every change to this bill.</div></div><div class="drawer-body" id="hBody"><div class="dim">Loading…</div></div>`);
        $('#hClose').onclick = () => PP.hideDrawer();
        try { $('#hBody').innerHTML = PP.renderHistory(await api(`/audit?entity=bill&id=${bill.id}`)); }
        catch (e) { $('#hBody').innerHTML = `<div class="form-err">${esc(e.message)}</div>`; }
      };
    }
  }

  PP.views.bills = viewBills;
  PP.billKindLabel = KIND_LABEL;
})();
