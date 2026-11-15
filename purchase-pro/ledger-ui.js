/* Purchase Pro — Supplier Ledger: running money + weight statement per supplier. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, modal, closeModal, fmtWhen, S, rs, gm, n2, n3, val, today, fmtDate, loadingCard, errorCard, firmShort } = PP;

  // supplier types shown in the list (dropdown with tick boxes); empty = all
  const LED_TYPES = [['PURCHASE', 'Purchase'], ['LABOUR', 'Labour'], ['HALLMARK', 'Hallmark'], ['EXPENSE', 'Expense']];
  const ui = { q: '', types: store.get('pp_led_types', []), onlyBal: store.get('pp_led_onlybal', true), range: { preset: 'all', from: '', to: '' }, from: '', to: '' };

  async function viewLedger(view, parts) {
    view.innerHTML = loadingCard();
    let acc;
    try { acc = await api(`/accounts?firm=${S.firm}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    const sel = Number(parts[0]) || null;

    view.innerHTML = `<div class="led">
      <div class="card led-list">
        <div class="led-list-head">
          <input class="input" id="ledQ" placeholder="Search supplier…" value="${esc(ui.q)}" />
          <div class="led-filters">
            <div class="ms" id="ledTypes">
              <button type="button" class="ms-btn" id="ledTypesBtn"><span id="ledTypesLbl"></span><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
              <div class="ms-pop" hidden>${LED_TYPES.map(([k, l]) => `<label class="ms-opt"><input type="checkbox" value="${k}" ${ui.types.includes(k) ? 'checked' : ''}/> ${l}</label>`).join('')}
                <div class="ms-acts"><button type="button" class="ghost-btn" data-ms="all">All</button><button type="button" class="ghost-btn" data-ms="close">Done</button></div></div>
            </div>
            <label class="mini-check"><input type="checkbox" id="onlyBal" ${ui.onlyBal ? 'checked' : ''}/> Only with balance</label>
          </div>
        </div>
        <div class="led-items" id="ledItems"></div>
      </div>
      <div class="led-main" id="ledMain">${sel ? loadingCard() : '<div class="card soon-card"><b>Pick a supplier</b><p>Their full statement — bills, payments, issues and receipts — with running balances.</p></div>'}</div>
    </div>`;

    const drawList = () => {
      const q = ui.q.trim().toUpperCase();
      const rows = acc.filter(a => (!ui.types.length || (a.types || []).some(t => ui.types.includes(t)) || a.party_id === sel) && (!ui.onlyBal || Math.abs(a.money) > 0.005 || Math.abs(a.weight) > 0.0005 || a.party_id === sel) && (!q || a.name.toUpperCase().includes(q)) && (!a.deleted || a.active));
      $('#ledItems').innerHTML = rows.length ? rows.map(a => `<a class="led-item ${a.party_id === sel ? 'on' : ''}" href="#/ledger/${a.party_id}">
        <span class="li-name">${esc(a.name)}</span>
        <span class="li-bal">${Math.abs(a.money) > 0.005 ? `<b class="${a.money > 0 ? 'owe-t' : 'adv-t'}">${rs(Math.abs(a.money))}</b><small>${a.money > 0 ? 'we owe' : 'advance'}</small>` : '<small class="dim">settled</small>'}
        ${Math.abs(a.weight) > 0.0005 ? `<small class="mono">${gm(a.weight)} ${a.weight > 0 ? 'with them' : 'extra'}</small>` : ''}</span></a>`).join('')
        : '<div class="empty" style="padding:30px 10px">Nothing to show.</div>';
    };
    // type dropdown with tick boxes
    const typeLbl = () => { $('#ledTypesLbl').textContent = !ui.types.length || ui.types.length === LED_TYPES.length ? 'All types' : LED_TYPES.filter(([k]) => ui.types.includes(k)).map(([, l]) => l).join(', '); };
    typeLbl();
    const pop = $('#ledTypes .ms-pop');
    const outside = (e) => { if (!$('#ledTypes')?.contains(e.target)) { pop.hidden = true; document.removeEventListener('mousedown', outside); } };
    $('#ledTypesBtn').onclick = () => { pop.hidden = !pop.hidden; if (!pop.hidden) setTimeout(() => document.addEventListener('mousedown', outside), 0); };
    pop.onchange = () => { ui.types = [...pop.querySelectorAll('input:checked')].map(i => i.value); store.set('pp_led_types', ui.types); typeLbl(); drawList(); };
    pop.onclick = (e) => {
      const b = e.target.closest('[data-ms]'); if (!b) return;
      if (b.dataset.ms === 'all') { pop.querySelectorAll('input').forEach(i => { i.checked = false; }); ui.types = []; store.set('pp_led_types', []); typeLbl(); drawList(); }
      else pop.hidden = true;
    };
    drawList();
    $('#ledQ').oninput = (e) => { ui.q = e.target.value; drawList(); };
    $('#onlyBal').onchange = (e) => { ui.onlyBal = e.target.checked; store.set('pp_led_onlybal', ui.onlyBal); drawList(); };
    if (sel) drawStatement(sel);
  }

  // ── Match check: which payment paid which bill, and what is short / extra / missing, in plain words ──
  const ROUND_LIMIT = 100; // a difference up to ₹100 looks like round off
  function drawMatch(a, pid) {
    const box = $('#lMatch'); if (!box) return;
    const bills = a.bills.filter(b => b.sign > 0).sort((x, y) => (x.bill_date < y.bill_date ? -1 : x.bill_date > y.bill_date ? 1 : x.id - y.id));
    const notes = a.bills.filter(b => b.sign < 0);
    const pays = a.payments.filter(p => p.direction === 'PAID');
    const billTotal = n2(bills.reduce((t, b) => t + b.net, 0)), paidTotal = n2(pays.reduce((t, p) => t + p.total, 0)) + n2(notes.reduce((t, b) => t + b.net, 0));
    const payById = (key) => pays.find(p => 'p' + p.id === key);
    const find = [];   // { lvl: bad | warn | ok, html, fix? }
    // 1) bills not fully paid
    for (const b of bills) {
      if (b.due <= 0.005) continue;
      const lastPay = b.links.map(l => payById(l.key)).filter(Boolean).sort((x, y) => (x.pay_date < y.pay_date ? 1 : -1))[0];
      if (b.due <= ROUND_LIMIT && b.paid > 0) {
        find.push({ lvl: 'warn', html: `Bill <b>${esc(b.bill_no)}</b> (${esc(fmtDate(b.bill_date))}) is short by <b>${rs(b.due)}</b> — paid ${rs(b.paid)} of ${rs(b.net)}. This looks like <b>round off</b> (the payment was a round figure).`,
          fix: lastPay ? { label: `Settle ${rs(b.due)} as round off on the ${fmtDate(lastPay.pay_date)} payment`, pay: lastPay.id, add: b.due } : null });
      } else {
        find.push({ lvl: b.days > 30 ? 'bad' : 'warn', html: `Bill <b>${esc(b.bill_no)}</b> (${esc(fmtDate(b.bill_date))}, ${b.days} days): <b>${rs(b.due)}</b> still to pay${b.paid > 0 ? ` (${rs(b.paid)} paid)` : ' — nothing paid yet'}.` });
      }
    }
    // 2) money paid that no bill uses → a bill may be missing
    for (const p of pays) if (p.unused > 1) find.push({ lvl: p.days >= 7 ? 'bad' : 'warn', html: `Payment of <b>${rs(p.total)}</b> on ${esc(fmtDate(p.pay_date))}: <b>${rs(p.unused)}</b> is not matched to any bill — kept as advance. ${p.days >= 7 ? 'A bill may be missing — ask the supplier.' : ''}` });
    for (const p of pays) if (p.unused > 0.005 && p.unused <= 1) find.push({ lvl: 'warn', html: `Payment on ${esc(fmtDate(p.pay_date))} is ${rs(p.unused)} more than the bills — paise difference.` });
    // 3) gold / silver not back
    for (const i of a.issues) if (i.remaining > 0.0005) find.push({ lvl: i.days > 15 ? 'bad' : 'warn', html: `Issue <b>${esc(i.issue_no)}</b> (${esc(fmtDate(i.issue_date))}, ${i.days} days): <b>${n3(i.remaining).toFixed(3)} g</b> not received back yet${i.received > 0 ? ` (${n3(i.received).toFixed(3)} g received)` : ''}.` });
    for (const x of a.receipts) if (x.extra > 0.0005) find.push({ lvl: 'warn', html: `Receipt ${esc(x.receipt_no || fmtDate(x.receipt_date))}: <b>${n3(x.extra).toFixed(3)} g</b> more than was issued.` });

    // bill-by-bill: who paid it
    const rows = bills.map(b => {
      const by = b.links.map(l => { const p = payById(l.key); return p ? `<span class="mt-pay" title="Payment of ${rs(p.total)}">${esc(fmtDate(p.pay_date))} · ${rs(l.amount)}${Math.abs(l.amount - p.total) > 0.005 ? ` <i>of ${rs(p.total)}</i>` : ''}</span>` : `<span class="mt-pay">${esc(l.to)} · ${rs(l.amount)}</span>`; }).join('');
      const exact = b.links.length === 1 && payById(b.links[0].key) && Math.abs(payById(b.links[0].key).total - b.net) <= 0.005;
      const st = b.due <= 0.005 ? `<span class="mt-ok">✓ Paid${exact ? ' · exact' : ''}</span>` : b.due <= ROUND_LIMIT && b.paid > 0 ? `<span class="mt-warn">Short ${rs(b.due)}</span>` : `<span class="mt-bad">${rs(b.due)} due</span>`;
      return `<tr><td class="mono">${esc(fmtDate(b.bill_date))}</td><td class="cell-main">${esc(b.bill_no)}</td><td class="mono" style="text-align:right">${rs(b.net)}</td><td>${by || '<span class="dim">—</span>'}</td><td style="text-align:right">${st}</td></tr>`;
    }).join('');
    const diff = n2(billTotal - paidTotal - (a.opening?.money || 0) * 0);
    const clean = !find.length;
    box.innerHTML = `<div class="mt ${clean ? 'clean' : ''}">
      <div class="mt-head"><b>${clean ? '✓ Match check — everything matches' : `Match check — ${find.length} thing${find.length === 1 ? '' : 's'} to look at`}</b>
        <span class="dim">Bills ${rs(billTotal)} · Paid ${rs(paidTotal)}${Math.abs(a.money) > 0.005 ? ` · <b>${a.money > 0 ? 'we owe' : 'advance'} ${rs(Math.abs(a.money))}</b>` : ''}</span></div>
      ${find.length ? `<div class="mt-list">${find.map((x, i) => `<div class="mt-item ${x.lvl}"><span>${x.html}</span>${x.fix ? `<button type="button" class="btn sm" data-fix="${i}">${esc(x.fix.label)}</button>` : ''}</div>`).join('')}</div>` : ''}
      ${bills.length ? `<details class="mt-more" ${find.length ? 'open' : ''}><summary>Bill by bill — which payment paid it</summary>
        <div class="table-wrap"><table class="grid compact mt-table"><thead><tr><th>Bill date</th><th>Bill</th><th style="text-align:right">Amount</th><th>Paid by</th><th style="text-align:right">Status</th></tr></thead><tbody>${rows}</tbody></table></div></details>` : ''}
    </div>`;
    box.querySelectorAll('[data-fix]').forEach(btn => btn.onclick = async () => {
      const fx = find[Number(btn.dataset.fix)].fix;
      try {
        const p = await api('/payments/' + fx.pay);
        const add = n2(fx.add);
        if (!confirm(`Add ${rs(add)} round off to the ${fmtDate(p.pay_date)} payment of ${rs(p.amount)}? The bill then shows as fully paid.`)) return;
        const body = { ...p, firm: S.firm, round_off: n2(val(p.round_off) + add) };
        await api('/payments/' + p.id, { method: 'PUT', body });
        toast(`${rs(add)} settled as round off.`);
        drawStatement(pid);
      } catch (e) { toast(e.message, true); }
    });
  }

  async function drawStatement(pid) {
    const main = $('#ledMain');
    let a;
    try { a = await api(`/accounts/${pid}?firm=${S.firm}${ui.from ? '&from=' + ui.from : ''}${ui.to ? '&to=' + ui.to : ''}`); }
    catch (e) { main.innerHTML = errorCard(e); return; }
    const p = a.party;
    const conf = a.last_confirmation;
    main.innerHTML = `
      <div class="card led-card printable">
        <div class="led-head">
          <div>
            <div class="print-only print-firm">${esc((S.ref.firms.find(f => f.id === S.firm) || {}).name || '')} — Supplier statement</div>
            <div class="ed-title" style="margin:0">${esc(p.name)}</div>
            <div class="ed-meta">${esc([p.city, p.gstin, p.phone].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="led-bals">
            <div class="lb ${a.money > 0.005 ? 'owe' : a.money < -0.005 ? 'adv' : ''}"><small>${a.money > 0.005 ? 'We owe' : a.money < -0.005 ? 'Advance with them' : 'Money'}</small><b>${Math.abs(a.money) > 0.005 ? rs(Math.abs(a.money)) : 'Settled'}</b></div>
            <div class="lb"><small>${a.weight > 0.0005 ? 'Gold with them' : a.weight < -0.0005 ? 'Extra received' : 'Weight'}</small><b>${Math.abs(a.weight) > 0.0005 ? gm(Math.abs(a.weight)) : 'Settled'}</b></div>
          </div>
        </div>
        <div class="led-sub no-print">
          <span>${conf ? `<span class="tag HALLMARK">Confirmed</span> with supplier as of ${esc(fmtDate(conf.as_of))} (${rs(conf.money)}, ${gm(conf.weight)}) by ${esc(conf.by_name || '')}` : '<span class="tag bad">Not confirmed</span> with supplier yet'}</span>
          <span>Unpaid bills: <b>${a.open_bills}</b> (${rs(a.due)})${a.oldest_due ? ` · oldest ${esc(fmtDate(a.oldest_due))}` : ''}</span>
        </div>
        <div class="toolbar no-print" style="margin:14px 0 10px">
          <div id="lRange"></div>
          <div class="spacer"></div>
          <button class="btn sm" id="lOpen">${a.opening ? 'Opening balance' : '+ Opening balance'}</button>
          <button class="btn sm" id="lStmt" title="Tick the supplier's monthly statement off against the bills entered here">Check monthly statement</button>
          <button class="btn sm" id="lConf">Confirm balance</button>
          <button class="btn sm" id="lWa">WhatsApp</button>
          <button class="btn sm" id="lPrint">Print</button>
          <a class="btn sm primary" href="#/payments/new?party=${p.id}">+ Payment</a>
        </div>
        <div id="lMatch" class="no-print"></div>
        ${ui.from || ui.to ? `<div class="print-only">Period: ${esc(ui.from ? fmtDate(ui.from) : 'start')} to ${esc(ui.to ? fmtDate(ui.to) : 'today')}</div>` : ''}
        <div class="table-wrap"><table class="grid led-table">
          <thead><tr><th>Date</th><th>Particulars</th><th style="text-align:right">Bill (+)</th><th style="text-align:right">Paid (−)</th><th style="text-align:right">Balance</th><th style="text-align:right">Gold out</th><th style="text-align:right">Gold in</th><th style="text-align:right">Gold bal</th></tr></thead>
          <tbody>${a.ledger.length ? a.ledger.map(r => {
            const link = r.type === 'BILL' ? `#/bills/${r.id}` : (r.type === 'PAYMENT' || r.type === 'RECEIVED' || r.type === 'ROUNDOFF') ? `#/payments/${r.id}` : r.type === 'ISSUE' || r.type === 'RECEIPT' ? '#/issues' : '';
            return `<tr ${link ? `data-href="${link}"` : 'style="cursor:default"'} class="${r.type === 'BF' || r.type === 'OPENING' ? 'bf-row' : ''}">
              <td class="mono">${esc(fmtDate(r.date))}</td><td><div class="cell-main">${esc(r.ref)}${r.status === 'PARTIAL' ? ' <span class="tag EXPENSE no-print">part paid</span>' : r.status === 'UNPAID' ? ' <span class="tag bad no-print">unpaid</span>' : ''}</div>${r.note ? `<div class="cell-sub">${esc(r.note)}</div>` : ''}</td>
              <td class="mono" style="text-align:right">${r.debit ? rs(r.debit) : ''}</td><td class="mono" style="text-align:right">${r.credit ? rs(r.credit) : ''}</td>
              <td class="mono cell-main" style="text-align:right">${rs(r.balance)}</td>
              <td class="mono" style="text-align:right">${r.w_out ? n3(r.w_out).toFixed(3) : ''}</td><td class="mono" style="text-align:right">${r.w_in ? n3(r.w_in).toFixed(3) : ''}</td>
              <td class="mono" style="text-align:right">${n3(r.w_balance).toFixed(3)}</td></tr>`; }).join('')
            : '<tr><td colspan="8"><div class="empty"><b>No entries</b>Nothing for this supplier in this firm yet.</div></td></tr>'}</tbody>
        </table></div>
        <div class="print-only" style="margin-top:14px">Balance: ${a.money >= 0 ? 'Payable' : 'Advance'} ${rs(Math.abs(a.money))} · Gold: ${gm(a.weight)} · Printed ${esc(fmtDate(today()))}</div>
      </div>`;

    main.querySelector('.led-table tbody').onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
    drawMatch(a, pid);
    PP.dateRange($('#lRange'), ui.range, (rg) => { ui.range = rg; [ui.from, ui.to] = PP.resolveRange(rg); drawStatement(pid); });
    $('#lPrint').onclick = () => window.print();
    $('#lStmt').onclick = () => drawStmtCheck(pid, p);
    $('#lWa').onclick = () => {
      const firm = (S.ref.firms.find(f => f.id === S.firm) || {}).name || 'APPACHI';
      const last = a.ledger.slice(-12).map(r => `${fmtDate(r.date)}  ${r.ref}  ${r.debit ? '+' + n2(r.debit) : r.credit ? '-' + n2(r.credit) : ''}${r.w_out ? ' out ' + n3(r.w_out) + 'g' : ''}${r.w_in ? ' in ' + n3(r.w_in) + 'g' : ''}`).join('\n');
      const text = `*${firm}*\nStatement for ${p.name} as of ${fmtDate(today())}\n\n${last}\n\n*Balance:* ${a.money > 0.005 ? 'We owe you ' + rs(a.money) : a.money < -0.005 ? 'Advance with you ' + rs(-a.money) : 'Settled'}\n*Gold:* ${Math.abs(a.weight) > 0.0005 ? gm(a.weight) + (a.weight > 0 ? ' with you' : ' extra received') : 'Settled'}\n\nPlease confirm the balance.`;
      const ph = String(p.phone || '').replace(/\D/g, '');
      const to = ph.length === 10 ? '91' + ph : ph;
      window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };
    $('#lConf').onclick = () => {
      modal(`<h2>Confirm balance with ${esc(p.name)}</h2>
        <p>Record that the supplier agreed with this balance. It is kept with your name and the time.</p>
        <div class="derived" style="margin:0 0 12px"><div>Money<b>${a.money >= 0 ? 'We owe ' : 'Advance '}${rs(Math.abs(a.money))}</b></div><div>Gold<b>${gm(a.weight)}</b></div></div>
        <div class="field"><label>As of</label><input class="input" type="date" id="cAsOf" value="${today()}" max="${today()}" /></div>
        <div class="field" style="margin-top:10px"><label>Note</label><input class="input" id="cNote" placeholder="e.g. Confirmed on phone with Ravi" /></div>
        <div class="modal-actions"><button class="btn" id="cNo">Cancel</button><button class="btn primary" id="cOk">Confirm</button></div>`);
      $('#cNo').onclick = closeModal;
      $('#cOk').onclick = async () => {
        try { await api('/confirmations', { method: 'POST', body: { firm: S.firm, party_id: p.id, as_of: $('#cAsOf').value, money: a.money, weight: a.weight, note: $('#cNote').value } }); closeModal(); toast('Balance confirmation saved.'); drawStatement(pid); }
        catch (e) { toast(e.message, true); }
      };
    };
    $('#lOpen').onclick = () => {
      const o = a.opening;
      modal(`<h2>Opening balance — ${esc(p.name)}</h2>
        <p>The balance on your start date, before any entry in this system. <b>Money:</b> positive = we owe them, negative = advance with them. <b>Gold:</b> positive = our gold with them.</p>
        <div class="fgrid">
          <div class="field"><label>As of</label><input class="input" type="date" id="oAsOf" value="${esc(o?.as_of || today())}" /></div>
          <div class="field"><label>Money (₹)</label><input class="input mono" type="number" step="0.01" id="oMoney" value="${o?.money ?? ''}" /></div>
          <div class="field"><label>Gold (g)</label><input class="input mono" type="number" step="0.001" id="oWt" value="${o?.weight ?? ''}" /></div>
          <div class="field"><label>Note</label><input class="input" id="oNote" value="${esc(o?.notes || '')}" /></div>
        </div>
        <div id="oErr" style="margin-top:10px"></div>
        <div class="modal-actions">${o ? '<button class="btn danger" id="oDel" style="margin-right:auto">Remove</button>' : ''}<button class="btn" id="oNo">Cancel</button><button class="btn primary" id="oOk">Save</button></div>`);
      $('#oNo').onclick = closeModal;
      $('#oOk').onclick = async () => {
        const body = { firm: S.firm, party_id: p.id, as_of: $('#oAsOf').value, money: $('#oMoney').value, weight: $('#oWt').value, notes: $('#oNote').value };
        try { o ? await api('/openings/' + o.id, { method: 'PUT', body }) : await api('/openings', { method: 'POST', body }); closeModal(); toast('Opening balance saved.'); viewLedger($('#view'), [String(pid)]); }
        catch (e) { $('#oErr').innerHTML = `<div class="form-err">${esc(e.message)}</div>`; }
      };
      $('#oDel')?.addEventListener('click', async () => {
        try { await api('/openings/' + o.id, { method: 'DELETE', body: { reason: 'Removed from ledger' } }); closeModal(); toast('Opening balance removed (in Recycle Bin).'); viewLedger($('#view'), [String(pid)]); }
        catch (e) { $('#oErr').innerHTML = `<div class="form-err">${esc(e.message)}</div>`; }
      });
    };
  }

  // ── Monthly statement check ───────────────────────────────────────────
  // The supplier's month-end "Statement of Account" (photo) → AI reads every invoice row →
  // each row is ticked off against the bills entered here. Clean → confirm the month.
  const normNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prevMonth = () => { const d = new Date(today() + 'T00:00:00'); d.setDate(0); return d.toISOString().slice(0, 7); };
  function loadScript(src) {
    return new Promise((ok, bad) => {
      if ([...document.scripts].some(s => s.src === src)) return ok();
      const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src)); document.head.appendChild(s);
    });
  }
  let stmtPoll = null;

  async function drawStmtCheck(pid, p) {
    clearInterval(stmtPoll);
    const key = `pp_stmt_${S.firm}_${pid}`;
    const st = Object.assign({ month: prevMonth(), url: '', rows: null, total: null, credit_note: null, net: null }, store.get(key, {}));
    const save = () => store.set(key, st);
    const main = $('#ledMain');
    let bills = [];
    try { bills = await api(`/bills?firm=${S.firm}&party_id=${pid}`); } catch (e) { main.innerHTML = errorCard(e); return; }

    function compare() {
      const from = st.month + '-01', to = PP.monthEnd(st.month);
      const real = bills.filter(b => b.sign > 0);
      const used = new Set();
      const rows = (st.rows || []).map(r => {
        const n = normNo(r.invoice_no);
        let b = n && real.find(x => !used.has(x.id) && normNo(x.bill_no) === n);
        let how = 'no';
        if (!b && r.amount && r.date) { b = real.find(x => !used.has(x.id) && x.bill_date === r.date && Math.abs(x.total - r.amount) <= 1); if (b) how = 'amt'; }
        if (b) used.add(b.id);
        let status = 'missing';
        if (b) status = Math.abs(b.total - (r.amount || 0)) <= 1 ? (how === 'amt' ? 'numdiff' : 'ok') : 'amtdiff';
        return { ...r, bill: b || null, status };
      });
      const extra = real.filter(b => !used.has(b.id) && b.bill_date >= from && b.bill_date <= to);
      const notes = bills.filter(b => b.sign < 0 && b.bill_date >= from && b.bill_date <= to);
      const notesTotal = n2(notes.reduce((s, b) => s + b.total, 0));
      const c = { ok: 0, missing: 0, amtdiff: 0, numdiff: 0 };
      rows.forEach(r => { c[r.status]++; });
      const sum = n2((st.rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
      const totalOk = st.total == null || Math.abs(sum - st.total) < 1;
      const noteOk = !st.credit_note || Math.abs(notesTotal - st.credit_note) <= 1;
      const clean = rows.length > 0 && !c.missing && !c.amtdiff && !extra.length && totalOk && noteOk;
      return { rows, extra, notes, notesTotal, c, sum, totalOk, noteOk, clean };
    }

    function draw() {
      const cmp = st.rows ? compare() : null;
      const tag = { ok: '<span class="tag HALLMARK">✓ Received</span>', missing: '<span class="tag bad">✗ Missing — not entered</span>', amtdiff: '<span class="tag EXPENSE">⚠ Amount differs</span>', numdiff: '<span class="tag EXPENSE">⚠ Bill no differs</span>' };
      main.innerHTML = `
      <div class="card led-card">
        <div class="led-head">
          <div><div class="ed-title" style="margin:0">Monthly statement — ${esc(p.name)}</div>
            <div class="ed-meta">Photo of the supplier's statement → every invoice on it is checked against the bills entered here.</div></div>
          <button class="btn sm" id="sBack">← Back to ledger</button>
        </div>
        <div class="toolbar" style="margin:14px 0">
          <label class="dim" style="font-size:12px">Month</label><input class="input" type="month" id="sMonth" value="${esc(st.month)}" max="${today().slice(0, 7)}" style="width:170px" />
          <label class="btn sm" for="sFile">${st.url ? 'Change photo' : 'Upload photo'}</label><input type="file" id="sFile" accept="image/*" hidden />
          <button class="btn sm" id="sQr" type="button">Use phone (QR)</button>
          <button class="btn sm primary" id="sRead" ${st.url ? '' : 'disabled'}>${st.rows ? 'Read again' : 'Read statement'}</button>
          <span class="dim" id="sMsg" style="font-size:12.5px"></span>
        </div>
        <div class="qr-box hidden" id="sQrBox" style="max-width:260px"><div id="sQrCode"></div><div class="dim" style="margin-top:8px">Scan with the phone camera and take the photo. It appears here automatically.</div><button class="ghost-btn" id="sQrStop" style="margin-top:8px">Close</button></div>
        ${st.url ? `<a href="${esc(st.url)}" target="_blank" rel="noopener" class="stmt-thumb" title="Open the photo"><img src="${esc(st.url)}" alt="Statement photo" /></a>` : ''}
        ${cmp ? `
        <div class="stmt-sum ${cmp.clean ? 'ok' : 'bad'}">
          <div><b>${cmp.c.ok + cmp.c.numdiff}</b> of ${cmp.rows.length} received</div>
          ${cmp.c.missing ? `<div class="bad-t"><b>${cmp.c.missing}</b> missing</div>` : ''}
          ${cmp.c.amtdiff ? `<div class="warn-t"><b>${cmp.c.amtdiff}</b> amount differs</div>` : ''}
          ${cmp.extra.length ? `<div class="warn-t"><b>${cmp.extra.length}</b> entered but not on statement</div>` : ''}
          <div>Statement total <b>${st.total != null ? rs(st.total) : '—'}</b> · rows add up to <b class="${cmp.totalOk ? 'ok-t' : 'bad-t'}">${rs(cmp.sum)}</b>${cmp.totalOk ? '' : ' — fix the rows below'}</div>
          ${st.credit_note ? `<div>Credit note <b>${rs(st.credit_note)}</b> · entered <b class="${cmp.noteOk ? 'ok-t' : 'bad-t'}">${rs(cmp.notesTotal)}</b></div>` : ''}
          ${st.net != null ? `<div>Net <b>${rs(st.net)}</b></div>` : ''}
        </div>
        <div class="table-wrap"><table class="grid stmt-table">
          <thead><tr><th>#</th><th>Invoice no</th><th>Date</th><th style="text-align:right">Amount</th><th>Result</th><th>Our bill</th><th></th></tr></thead>
          <tbody>${cmp.rows.map((r, i) => `<tr class="st-${r.status}">
            <td class="dim">${i + 1}</td>
            <td><input class="cin mono" data-i="${i}" data-f="invoice_no" value="${esc(r.invoice_no)}" /></td>
            <td><input class="cin mono" type="date" data-i="${i}" data-f="date" value="${esc(r.date || '')}" /></td>
            <td><input class="cin mono" type="number" step="0.01" data-i="${i}" data-f="amount" value="${r.amount ?? ''}" style="text-align:right" />${r.row_ok === false ? '<div class="bad-t" style="font-size:11px">check this row</div>' : ''}</td>
            <td>${tag[r.status]}</td>
            <td>${r.bill ? `<a href="#/bills/${r.bill.id}">${esc(r.bill.bill_no)}</a> <span class="dim">${esc(fmtDate(r.bill.bill_date))} · ${rs(r.bill.total)}</span>` : `<a class="dim" href="#/bills/new">+ Enter bill</a>`}</td>
            <td><button class="ghost-btn" data-del="${i}" title="Remove this row">×</button></td></tr>`).join('')}
            <tr><td></td><td colspan="6"><button class="ghost-btn" id="sAdd">+ Add a row the AI missed</button></td></tr>
          </tbody></table></div>
        ${cmp.extra.length ? `<div style="margin-top:16px"><b>Entered here but not on the statement</b>
          <table class="grid compact" style="margin-top:6px"><tbody>${cmp.extra.map(b => `<tr data-href="#/bills/${b.id}"><td><a href="#/bills/${b.id}">${esc(b.bill_no)}</a></td><td class="dim">${esc(fmtDate(b.bill_date))}</td><td class="mono" style="text-align:right">${rs(b.total)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="toolbar" style="margin-top:16px">
          <div class="spacer"></div>
          ${cmp.clean ? '' : '<span class="dim" style="font-size:12.5px">Fix every ✗ / ⚠ first (enter the missing bills, correct amounts).</span>'}
          <button class="btn primary" id="sConf" ${cmp.clean ? '' : 'disabled'}>Confirm ${esc(monthLabel(st.month))} statement</button>
        </div>` : '<div class="empty" style="padding:30px"><b>Upload the statement photo, then press Read statement.</b>Take it flat and straight so every row is readable.</div>'}
      </div>`;
      bind(cmp);
    }

    const monthLabel = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const msg = (t, cls) => { const el = $('#sMsg'); if (el) { el.textContent = t; el.className = cls || 'dim'; } };
    function setPhoto(url) { st.url = url; st.rows = null; st.total = st.credit_note = st.net = null; save(); stopQr(); draw(); }
    function stopQr() { clearInterval(stmtPoll); stmtPoll = null; $('#sQrBox')?.classList.add('hidden'); }

    function bind(cmp) {
      $('#sBack').onclick = () => { stopQr(); drawStatement(pid); };
      $('#sMonth').onchange = (e) => { st.month = e.target.value || prevMonth(); save(); draw(); };
      $('#sFile').onchange = async (e) => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        msg('Uploading…');
        const fd = new FormData(); fd.append('firm', S.firm); fd.append('photo', f);
        try {
          const r = await fetch('/purchase-pro/api/photos', { method: 'POST', body: fd, credentials: 'same-origin' });
          const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed');
          setPhoto(d.url);
        } catch (err) { msg('⚠ ' + err.message, 'bad-t'); }
      };
      $('#sQr').onclick = async () => {
        try {
          await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
          const s = await api('/upload-sessions', { method: 'POST', body: { firm: S.firm, label: `${p.name} statement` } });
          $('#sQrCode').innerHTML = '';
          new window.QRCode($('#sQrCode'), { text: location.origin + s.url, width: 180, height: 180 });
          $('#sQrBox').classList.remove('hidden');
          clearInterval(stmtPoll);
          stmtPoll = setInterval(async () => {
            if (!document.body.contains($('#sQrBox'))) { clearInterval(stmtPoll); return; }
            try { const r = await api('/upload-sessions/' + s.token); if (r.urls && r.urls.length) setPhoto(r.urls[r.urls.length - 1]); else if (r.expired) stopQr(); } catch {}
          }, 2000);
        } catch (e) { toast(e.message, true); }
      };
      $('#sQrStop').onclick = stopQr;
      $('#sRead').onclick = async () => {
        const b = $('#sRead'); b.disabled = true;
        msg('AI is reading every row… about a minute.');
        try {
          const d = await api('/scan-statement', { method: 'POST', body: { image_url: st.url } });
          Object.assign(st, { rows: d.rows, total: d.total, credit_note: d.credit_note, net: d.net });
          save(); draw();
          toast(`${d.rows.length} rows read${d.total_ok === false ? ' — they do not add up to the total, check them' : ''}.`, d.total_ok === false);
        } catch (e) { msg('⚠ ' + e.message, 'bad-t'); b.disabled = false; }
      };
      if (!cmp) return;
      main.querySelector('.stmt-table').addEventListener('change', (e) => {
        const el = e.target.closest('[data-f]'); if (!el) return;
        const r = st.rows[Number(el.dataset.i)];
        const f = el.dataset.f;
        r[f] = f === 'amount' ? (el.value === '' ? null : Number(el.value)) : f === 'invoice_no' ? el.value.trim().toUpperCase() : el.value;
        delete r.row_ok; save(); draw();
      });
      main.querySelector('.stmt-table').addEventListener('click', (e) => {
        const d = e.target.closest('[data-del]');
        if (d) { st.rows.splice(Number(d.dataset.del), 1); save(); draw(); }
        if (e.target.id === 'sAdd') { st.rows.push({ invoice_no: '', date: '', amount: null }); save(); draw(); }
      });
      main.querySelectorAll('tr[data-href]').forEach(tr => { tr.onclick = (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }; });
      $('#sConf').onclick = async () => {
        try {
          const end = PP.monthEnd(st.month);
          const a = await api(`/accounts/${pid}?firm=${S.firm}&to=${end}`);
          const last = a.ledger.length ? a.ledger[a.ledger.length - 1] : null;
          const money = last ? last.balance : 0, weight = last ? last.w_balance : 0;
          const note = `Monthly statement ${monthLabel(st.month)} checked: ${cmp.rows.length} bills received${st.total != null ? `, total ${rs(st.total)}` : ''}${st.credit_note ? `, credit note ${rs(st.credit_note)}` : ''}${st.net != null ? `, net ${rs(st.net)}` : ''}.`;
          await api('/confirmations', { method: 'POST', body: { firm: S.firm, party_id: pid, as_of: end, money, weight, note } });
          store.del(key);
          toast(`${monthLabel(st.month)} statement confirmed.`);
          drawStatement(pid);
        } catch (e) { toast(e.message, true); }
      };
    }
    draw();
  }

  PP.views.ledger = viewLedger;
})();
