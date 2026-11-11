/* Purchase Pro — Payments (list + editor with live matching preview). */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, confirmBox, fmtWhen, S, rs, n2, val, today, fmtDate, monthEnd, partyField, bindParty, loadingCard, errorCard, firmShort } = PP;
  const MODE_LABEL = { CASH: 'Cash', 'NEFT/RTGS': 'NEFT / RTGS', UPI: 'UPI', CHEQUE: 'Cheque', OTHER: 'Other' };
  const ROUND_HINT = 10; // offer round-off when a bill is left short by ₹10 or less

  const ui = { q: '', month: store.get('pp_pay_month', today().slice(0, 7)) };

  async function viewPayments(view, parts) {
    if (parts[0]) return viewEditor(view, parts[0]);
    view.innerHTML = loadingCard();
    let list, acc;
    try {
      const q = ui.month ? `&from=${ui.month}-01&to=${monthEnd(ui.month)}` : '';
      [list, acc] = await Promise.all([api(`/payments?firm=${S.firm}${q}`), api(`/accounts?firm=${S.firm}`)]);
    } catch (e) { view.innerHTML = errorCard(e); return; }
    // usage per payment comes from each supplier's account
    const usage = {};
    const partyIds = [...new Set(list.map(p => p.party_id))];
    await Promise.all(partyIds.map(async pid => {
      try { const a = await api(`/accounts/${pid}?firm=${S.firm}`); a.payments.forEach(p => (usage[p.id] = p)); } catch {}
    }));

    view.innerHTML = `
      <div class="stats" id="payStats"></div>
      <div class="toolbar">
        <div class="search"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" id="payQ" placeholder="Search supplier, reference…" value="${esc(ui.q)}" /></div>
        <input class="input" type="month" id="payMonth" value="${esc(ui.month)}" style="width:170px" title="Month (clear for all)" />
        <div class="spacer"></div>
        <button class="btn primary" id="newPay">+ New payment</button>
      </div>
      <div class="card table-wrap"><table class="grid">
        <thead><tr><th>Date</th><th>Supplier</th><th>Mode</th><th style="text-align:right">Amount</th><th>Matched to</th><th style="text-align:right">Not matched yet</th></tr></thead>
        <tbody id="payRows"></tbody></table></div>`;

    const draw = () => {
      const q = ui.q.trim().toUpperCase();
      const rows = list.filter(p => !q || [p.party_name, p.reference, p.notes].some(v => v && String(v).toUpperCase().includes(q)));
      const paid = rows.filter(p => p.direction === 'PAID').reduce((s, p) => s + p.amount, 0);
      const recd = rows.filter(p => p.direction === 'RECEIVED').reduce((s, p) => s + p.amount, 0);
      const unmatched = rows.reduce((s, p) => s + (usage[p.id]?.unused || 0), 0);
      const totalAdv = acc.reduce((s, a) => s + (a.money < 0 ? -a.money : 0), 0);
      $('#payStats').innerHTML = `
        <div class="card stat"><div class="stat-n">${rows.length}</div><div class="stat-l">Payments${ui.month ? ' this month' : ''}</div></div>
        <div class="card stat"><div class="stat-n">${rs(paid)}</div><div class="stat-l">Paid out</div></div>
        <div class="card stat"><div class="stat-n">${rs(recd)}</div><div class="stat-l">Received back</div></div>
        <div class="card stat"><div class="stat-n" style="color:${totalAdv > 0 ? 'var(--warn)' : 'inherit'}">${rs(totalAdv)}</div><div class="stat-l">Advance with suppliers (all time)</div></div>`;
      $('#payRows').innerHTML = rows.length ? rows.map(p => {
        const u = usage[p.id] || {};
        const links = (u.links || []).map(l => `${esc(l.to)} <span class="dim">${rs(l.amount)}</span>`).join('<br>');
        return `<tr data-id="${p.id}">
          <td>${esc(fmtDate(p.pay_date))}</td>
          <td><div class="cell-main">${esc(p.party_name || '—')}</div>${p.direction === 'RECEIVED' ? '<div class="cell-sub" style="color:var(--info)">Money received from supplier</div>' : ''}</td>
          <td>${p.parts?.length > 1 ? p.parts.map(x => `<div>${esc(MODE_LABEL[x.mode] || x.mode)} <span class="mono dim">${rs(x.amount)}</span></div>`).join('') : `<div>${esc(MODE_LABEL[p.mode] || p.mode || '')}</div>`}<div class="cell-sub mono">${esc(p.reference || '')}</div></td>
          <td class="mono cell-main" style="text-align:right">${rs(p.amount)}${p.round_off ? `<div class="cell-sub">${p.round_off > 0 ? '+' : '−'} ${rs(Math.abs(p.round_off))} round off</div>` : ''}</td>
          <td style="font-size:12.5px">${links || (p.direction === 'RECEIVED' ? '—' : '<span class="dim">No bill yet</span>')}</td>
          <td class="mono" style="text-align:right">${u.unused > 0.005 ? `<span class="tag EXPENSE">${rs(u.unused)} advance</span>` : '—'}</td></tr>`;
      }).join('') : `<tr><td colspan="6"><div class="empty"><b>No payments ${ui.month ? 'this month' : 'yet'}</b>Click "+ New payment" to enter one for ${esc(firmShort())}.</div></td></tr>`;
    };
    draw();
    $('#payQ').oninput = (e) => { ui.q = e.target.value; draw(); };
    $('#payMonth').onchange = (e) => { ui.month = e.target.value; store.set('pp_pay_month', ui.month); viewPayments(view, []); };
    $('#payRows').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/payments/' + tr.dataset.id; };
    $('#newPay').onclick = () => { location.hash = '#/payments/new'; };
  }

  // ── Editor ──
  async function viewEditor(view, idPart) {
    const isNew = idPart === 'new';
    view.innerHTML = loadingCard();
    let pay = null, parties;
    try { [parties, pay] = await Promise.all([PP.loadParties(true), isNew ? null : api('/payments/' + Number(idPart))]); }
    catch (e) { view.innerHTML = errorCard(e); return; }
    if (pay && pay.firm !== S.firm) { view.innerHTML = `<div class="card empty"><b>This payment belongs to the other firm</b>Switch firm at the top to open it.</div>`; return; }

    const pre = new URLSearchParams(location.hash.split('?')[1] || '');
    const st = pay ? { ...pay, bill_ids: pay.bill_ids.slice() } : {
      direction: 'PAID', party_id: Number(pre.get('party')) || null, pay_date: today(), amount: '', round_off: 0,
      mode: store.get('pp_last_mode', 'NEFT/RTGS'), reference: '', notes: '', bill_ids: [],
    };
    // second part of a split payment (e.g. bank + cash)
    const p2 = pay?.parts?.length > 1 ? pay.parts : null;
    if (p2) { st.amount = p2[0].amount; st.mode = p2[0].mode; st.reference = p2[0].reference || ''; }
    Object.assign(st, { split: !!p2, amount2: p2 ? p2[1].amount : '', mode2: p2 ? p2[1].mode : 'CASH', ref2: p2 ? p2[1].reference || '' : '' });
    const total = () => n2(val(st.amount) + (st.split ? val(st.amount2) : 0));
    let acct = null;
    PP.setDirty(false);
    const dirty = () => PP.setDirty(true);

    view.innerHTML = `
      <div class="bill-ed">
        <div class="bill-left"><div class="card bill-card">
          <div class="ed-head"><a href="#/payments" class="back-link">← Payments</a>
            <div class="ed-title">${isNew ? 'New payment' : 'Payment'} <span class="tag plain">${esc(firmShort())}</span></div>
            ${pay ? `<div class="ed-meta">Entered ${esc(fmtWhen(pay.created_at))}${pay.created_by_name ? ' by ' + esc(pay.created_by_name) : ''}${pay.updated_at ? ` · Edited ${esc(fmtWhen(pay.updated_at))}${pay.updated_by_name ? ' by ' + esc(pay.updated_by_name) : ''}` : ''}</div>` : ''}
          </div>
          <div id="edErr"></div>
          <div class="field" style="margin-bottom:14px"><label>Type</label><div class="checks" id="dirChecks">
            <label><input type="radio" name="dir" value="PAID" ${st.direction === 'PAID' ? 'checked' : ''}/>We paid the supplier</label>
            <label><input type="radio" name="dir" value="RECEIVED" ${st.direction === 'RECEIVED' ? 'checked' : ''}/>Supplier paid us back</label>
          </div></div>
          <div class="ed-row">
            <div style="flex:2">${partyField('payParty', parties, st.party_id)}</div>
            <div class="field" style="flex:1"><label>Date <span class="req">*</span></label><input class="input" type="date" id="payDate" value="${esc(st.pay_date)}" max="${today()}" /></div>
          </div>
          <div class="ed-row">
            <div class="field" style="flex:1"><label>Amount <span class="req">*</span></label><input class="input mono big-in" type="number" step="0.01" min="0" id="payAmt" value="${st.amount}" placeholder="0.00" /></div>
            <div class="field" style="flex:1"><label>Round off</label><input class="input mono" type="number" step="0.01" id="payRound" value="${st.round_off || ''}" placeholder="0.00" /><div class="hint">Small difference written off to settle a bill.</div></div>
          </div>
          <div class="field" style="margin-bottom:14px"><label>Paid by <span class="req">*</span></label><div class="checks" id="modeChecks">
            ${S.ref.payModes.map(m => `<label><input type="radio" name="mode" value="${m}" ${st.mode === m ? 'checked' : ''}/>${MODE_LABEL[m]}</label>`).join('')}
          </div></div>
          <div class="ed-row">
            <div class="field" style="flex:1"><label>Reference</label><input class="input mono" id="payRef" value="${esc(st.reference || '')}" placeholder="UTR / cheque no." /></div>
            <div class="field" style="flex:1.4"><label>Notes</label><input class="input" id="payNotes" value="${esc(st.notes || '')}" placeholder="Optional" /></div>
          </div>
          <div id="splitBox" style="margin-bottom:14px"></div>
          <div class="ed-actions">
            <button class="btn primary" id="savePay">${isNew ? 'Save payment' : 'Save changes'}</button>
            ${isNew ? '<button class="btn" id="saveNewPay">Save &amp; new</button>' : ''}
            <a class="btn" href="#/payments">Cancel</a><div class="spacer"></div>
            ${pay ? '<button class="btn" id="histPay">Edit history</button><button class="btn danger" id="delPay">Delete</button>' : ''}
          </div>
        </div></div>
        <div class="bill-right"><div class="card photo-card" id="matchCard"></div></div>
      </div>`;

    // Preview: how this payment will be matched (mirrors the server rule).
    function drawMatch() {
      const box = $('#matchCard');
      if (!st.party_id) { box.innerHTML = '<div class="photo-empty"><b>Pick a supplier</b>Their unpaid bills show here.</div>'; return; }
      if (!acct) { box.innerHTML = '<div class="dim">Loading supplier account…</div>'; return; }
      if (st.direction === 'RECEIVED') {
        box.innerHTML = `<div class="photo-head"><b>${esc(acct.party.name)}</b></div>${balanceLine(acct.money)}<p class="dim" style="margin-top:10px;font-size:12.5px">Money received from the supplier adds back to their account (e.g. refund of an advance).</p>`;
        return;
      }
      // Dues excluding this payment's own effect (when editing).
      const mine = pay ? (acct.payments.find(p => p.id === pay.id)?.links || []) : [];
      const bills = acct.bills.filter(b => b.sign > 0).map(b => {
        const back = mine.filter(l => l.key === 'b' + b.id).reduce((s, l) => s + l.amount, 0);
        return { ...b, open: n2(b.due + back) };
      }).filter(b => b.open > 0.005).sort((a, b) => (a.bill_date < b.bill_date ? -1 : a.bill_date > b.bill_date ? 1 : a.id - b.id));
      let left = n2(total() + val(st.round_off));
      // Bills (or two bills) whose due matches what the ticked bills don't cover — exact first, then within ₹10.
      const extraAmt = n2(left - bills.filter(b => st.bill_ids.includes(b.id)).reduce((s, b) => s + b.open, 0));
      const free = bills.filter(b => !st.bill_ids.includes(b.id));
      let sugg = [];
      if (val(st.amount) && extraAmt > 0.005) {
        free.forEach((a, i) => { sugg.push({ ids: [a.id], sum: a.open }); free.slice(i + 1).forEach(b => sugg.push({ ids: [a.id, b.id], sum: n2(a.open + b.open) })); });
        sugg = sugg.map(s => ({ ...s, diff: n2(s.sum - extraAmt) })).filter(s => Math.abs(s.diff) <= ROUND_HINT)
          .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff) || a.ids.length - b.ids.length).slice(0, 4);
      }
      const billNo = (id) => bills.find(b => b.id === id)?.bill_no;
      const take = {};
      const pinned = bills.filter(b => st.bill_ids.includes(b.id));
      for (const b of [...pinned, ...bills]) {
        if (left <= 0.005) break;
        const t = Math.min(left, b.open - (take[b.id] || 0));
        if (t > 0.005) { take[b.id] = n2((take[b.id] || 0) + t); left = n2(left - t); }
      }
      let roundHint = null;
      const rows = bills.map(b => {
        const t = take[b.id] || 0;
        const after = n2(b.open - t);
        if (t > 0 && after > 0.005 && after <= ROUND_HINT && left <= 0.005) roundHint = { bill: b, after };
        return `<label class="mrow ${t > 0 ? 'hit' : ''}">
          <input type="checkbox" data-bid="${b.id}" ${st.bill_ids.includes(b.id) ? 'checked' : ''} title="Tick to pay this bill first" />
          <span class="mrow-main"><b class="mono">${esc(b.bill_no)}</b> <span class="dim">${esc(fmtDate(b.bill_date))} · ${b.days}d</span><br><span class="dim">Due ${rs(b.open)}</span></span>
          <span class="mrow-res">${t > 0 ? (after <= 0.005 ? `<span class="ok-t">${rs(t)} · settled</span>` : `<span>${rs(t)}</span><br><span class="warn-t">${rs(after)} still due</span>`) : '<span class="dim">—</span>'}</span></label>`;
      }).join('');
      box.innerHTML = `
        <div class="photo-head"><b>${esc(acct.party.name)}</b><span class="dim">${bills.length} unpaid bill(s)</span></div>
        ${balanceLine(acct.money)}
        <div class="dim" style="font-size:12px;margin:10px 0 6px">Payment goes to the oldest bill first. Tick a bill to pay it first.</div>
        <div class="mlist">${rows || '<div class="photo-empty" style="padding:24px"><b>No unpaid bills</b>This payment will be kept as an advance for the next bill.</div>'}</div>
        ${sugg.length ? `<div style="margin-top:10px"><b>Matching bills — tap to pay them:</b><div class="chips" style="margin-top:6px">${sugg.map((s, i) => `<button type="button" class="chip" data-sg="${i}">${s.ids.map(id => esc(billNo(id))).join(' + ')} · ${rs(s.sum)}${s.diff ? ` <span class="dim">(${s.diff > 0 ? 'short' : 'extra'} ${rs(Math.abs(s.diff))} → round off)</span>` : ''}</button>`).join('')}</div></div>` : ''}
        ${left > 0.005 && val(st.amount) ? `<div class="m-adv">${rs(left)} will be kept as <b>advance</b> — the next bill uses it automatically.</div>` : ''}
        ${left > 0.005 && left <= ROUND_HINT && Object.keys(take).length ? `<div class="t-warn" style="margin-top:10px">Only ${rs(left)} extra. <button class="ghost-btn" id="extraRound">Treat as round off</button></div>` : ''}
        ${roundHint ? `<div class="t-warn" style="margin-top:10px">Bill ${esc(roundHint.bill.bill_no)} is short by only ${rs(roundHint.after)}. <button class="ghost-btn" id="useRound">Settle with round off</button></div>` : ''}`;
      const setRound = (v) => { st.round_off = n2(v); $('#payRound').value = st.round_off || ''; drawMatch(); dirty(); };
      $('#useRound')?.addEventListener('click', () => setRound(val(st.round_off) + roundHint.after));
      $('#extraRound')?.addEventListener('click', () => setRound(val(st.round_off) - left));
      box.querySelectorAll('[data-sg]').forEach(btn => btn.addEventListener('click', () => {
        const s = sugg[Number(btn.dataset.sg)];
        st.bill_ids = [...st.bill_ids, ...s.ids.filter(id => !st.bill_ids.includes(id))];
        setRound(val(st.round_off) + s.diff);
      }));
    }
    function drawSplit() {
      const box = $('#splitBox');
      if (!st.split) { box.innerHTML = '<button type="button" class="ghost-btn" id="addSplit">+ Paid by two modes (e.g. bank + cash)</button>'; $('#addSplit').onclick = () => { st.split = true; drawSplit(); drawMatch(); }; return; }
      box.innerHTML = `<div class="card" style="padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b>Second part</b><button type="button" class="ghost-btn" id="rmSplit">Remove</button></div>
        <div class="ed-row">
          <div class="field" style="flex:1"><label>Amount</label><input class="input mono big-in" type="number" step="0.01" min="0" id="payAmt2" value="${st.amount2}" placeholder="0.00" /></div>
          <div class="field" style="flex:1"><label>Paid by</label><select class="select" id="payMode2">${S.ref.payModes.map(m => `<option value="${m}" ${st.mode2 === m ? 'selected' : ''}>${MODE_LABEL[m]}</option>`).join('')}</select></div>
          <div class="field" style="flex:1"><label>Reference</label><input class="input mono" id="payRef2" value="${esc(st.ref2)}" placeholder="Optional" /></div>
        </div>
        <div style="font-size:18px;margin-top:6px">Total paid: <b class="mono" id="payTotal">${rs(total())}</b></div></div>`;
      $('#rmSplit').onclick = () => { st.split = false; st.amount2 = ''; drawSplit(); drawMatch(); dirty(); };
      $('#payAmt2').oninput = (e) => { st.amount2 = e.target.value; $('#payTotal').textContent = rs(total()); drawMatch(); dirty(); };
      $('#payMode2').onchange = (e) => { st.mode2 = e.target.value; dirty(); };
      $('#payRef2').oninput = (e) => { st.ref2 = e.target.value; dirty(); };
    }
    drawSplit();
    const balanceLine = (m) => `<div class="bal-line ${m > 0.005 ? 'owe' : m < -0.005 ? 'adv' : ''}">${m > 0.005 ? `We owe <b>${rs(m)}</b>` : m < -0.005 ? `Advance with them <b>${rs(-m)}</b>` : 'Account is <b>settled</b>'}<span class="dim"> (before this payment${pay ? ' change' : ''})</span></div>`;
    $('#matchCard').addEventListener('change', (e) => {
      const cb = e.target.closest('[data-bid]'); if (!cb) return;
      const id = Number(cb.dataset.bid);
      st.bill_ids = cb.checked ? [...st.bill_ids, id] : st.bill_ids.filter(x => x !== id);
      drawMatch(); dirty();
    });

    async function loadAcct() {
      acct = null; drawMatch();
      if (!st.party_id) return;
      try { acct = await api(`/accounts/${st.party_id}?firm=${S.firm}`); } catch (e) { toast(e.message, true); }
      drawMatch();
    }
    bindParty($('#payParty'), parties, (id) => { if (id !== st.party_id) { st.party_id = id; st.bill_ids = []; loadAcct(); dirty(); } });
    loadAcct();
    $('#dirChecks').onchange = (e) => { st.direction = e.target.value; drawMatch(); dirty(); };
    $('#modeChecks').onchange = (e) => { st.mode = e.target.value; store.set('pp_last_mode', st.mode); dirty(); };
    $('#payAmt').oninput = (e) => { st.amount = e.target.value; if ($('#payTotal')) $('#payTotal').textContent = rs(total()); drawMatch(); dirty(); };
    $('#payRound').oninput = (e) => { st.round_off = e.target.value; drawMatch(); dirty(); };
    $('#payDate').oninput = (e) => { st.pay_date = e.target.value; dirty(); };
    $('#payRef').oninput = (e) => { st.reference = e.target.value; dirty(); };
    $('#payNotes').oninput = (e) => { st.notes = e.target.value; dirty(); };

    async function save(andNew) {
      $('#edErr').innerHTML = '';
      const body = { ...st, firm: S.firm, bill_ids: st.direction === 'PAID' ? st.bill_ids : [] };
      body.parts = st.split && val(st.amount2) > 0
        ? [{ mode: st.mode, amount: st.amount, reference: st.reference }, { mode: st.mode2, amount: st.amount2, reference: st.ref2 }] : [];
      try {
        const saved = isNew ? await api('/payments', { method: 'POST', body }) : await api('/payments/' + pay.id, { method: 'PUT', body });
        PP.setDirty(false);
        toast(`Payment of ${rs(saved.amount)} saved.`);
        if (andNew) { if (location.hash === '#/payments/new') viewEditor(view, 'new'); else location.hash = '#/payments/new'; }
        else location.hash = '#/payments';
      } catch (e) { $('#edErr').innerHTML = `<div class="form-err">${esc(e.message)}</div>`; }
    }
    $('#savePay').onclick = () => save(false);
    $('#saveNewPay')?.addEventListener('click', () => save(true));
    if (pay) {
      $('#delPay').onclick = async () => {
        const reason = await confirmBox({ title: 'Delete this payment?', text: 'It moves to the Recycle Bin and can be restored any time. Bills it was matched to become unpaid again.', okText: 'Delete', danger: true, reason: true });
        if (!reason) return;
        try { await api('/payments/' + pay.id, { method: 'DELETE', body: { reason } }); PP.setDirty(false); toast('Payment moved to Recycle Bin.'); location.hash = '#/payments'; }
        catch (e) { toast(e.message, true); }
      };
      $('#histPay').onclick = () => PP.showHistory('payment', pay.id, 'Payment');
    }
  }

  PP.views.payments = viewPayments;
})();
