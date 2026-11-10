/* Purchase Pro — Supplier Ledger: running money + weight statement per supplier. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, modal, closeModal, fmtWhen, S, rs, gm, n2, n3, val, today, fmtDate, loadingCard, errorCard, firmShort } = PP;

  const ui = { q: '', onlyBal: store.get('pp_led_onlybal', true), from: '', to: '' };

  async function viewLedger(view, parts) {
    view.innerHTML = loadingCard();
    let acc;
    try { acc = await api(`/accounts?firm=${S.firm}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    const sel = Number(parts[0]) || null;

    view.innerHTML = `<div class="led">
      <div class="card led-list">
        <div class="led-list-head">
          <input class="input" id="ledQ" placeholder="Search supplier…" value="${esc(ui.q)}" />
          <label class="mini-check"><input type="checkbox" id="onlyBal" ${ui.onlyBal ? 'checked' : ''}/> Only with balance</label>
        </div>
        <div class="led-items" id="ledItems"></div>
      </div>
      <div class="led-main" id="ledMain">${sel ? loadingCard() : '<div class="card soon-card"><b>Pick a supplier</b><p>Their full statement — bills, payments, issues and receipts — with running balances.</p></div>'}</div>
    </div>`;

    const drawList = () => {
      const q = ui.q.trim().toUpperCase();
      const rows = acc.filter(a => (!ui.onlyBal || Math.abs(a.money) > 0.005 || Math.abs(a.weight) > 0.0005 || a.party_id === sel) && (!q || a.name.toUpperCase().includes(q)) && (!a.deleted || a.active));
      $('#ledItems').innerHTML = rows.length ? rows.map(a => `<a class="led-item ${a.party_id === sel ? 'on' : ''}" href="#/ledger/${a.party_id}">
        <span class="li-name">${esc(a.name)}</span>
        <span class="li-bal">${Math.abs(a.money) > 0.005 ? `<b class="${a.money > 0 ? 'owe-t' : 'adv-t'}">${rs(Math.abs(a.money))}</b><small>${a.money > 0 ? 'we owe' : 'advance'}</small>` : '<small class="dim">settled</small>'}
        ${Math.abs(a.weight) > 0.0005 ? `<small class="mono">${gm(a.weight)} ${a.weight > 0 ? 'with them' : 'extra'}</small>` : ''}</span></a>`).join('')
        : '<div class="empty" style="padding:30px 10px">Nothing to show.</div>';
    };
    drawList();
    $('#ledQ').oninput = (e) => { ui.q = e.target.value; drawList(); };
    $('#onlyBal').onchange = (e) => { ui.onlyBal = e.target.checked; store.set('pp_led_onlybal', ui.onlyBal); drawList(); };
    if (sel) drawStatement(sel);
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
          <label class="dim" style="font-size:12px">From</label><input class="input" type="date" id="lFrom" value="${esc(ui.from)}" style="width:160px" />
          <label class="dim" style="font-size:12px">To</label><input class="input" type="date" id="lTo" value="${esc(ui.to)}" style="width:160px" />
          <div class="spacer"></div>
          <button class="btn sm" id="lOpen">${a.opening ? 'Opening balance' : '+ Opening balance'}</button>
          <button class="btn sm" id="lConf">Confirm balance</button>
          <button class="btn sm" id="lWa">WhatsApp</button>
          <button class="btn sm" id="lPrint">Print</button>
          <a class="btn sm primary" href="#/payments/new?party=${p.id}">+ Payment</a>
        </div>
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
    $('#lFrom').onchange = (e) => { ui.from = e.target.value; drawStatement(pid); };
    $('#lTo').onchange = (e) => { ui.to = e.target.value; drawStatement(pid); };
    $('#lPrint').onclick = () => window.print();
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

  PP.views.ledger = viewLedger;
})();
