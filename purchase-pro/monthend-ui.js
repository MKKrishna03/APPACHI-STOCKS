/* Purchase Pro — Month end: every supplier with every check for the month (bills have photos,
   given to accountant, gold back, payments matched to bills, TDS, statement matched) and the
   balance at month end. All green → close the month. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, api, toast, confirmBox, S, fmtWhen, loadingCard, errorCard } = PP;
  const { rs, gm, today } = PP;

  const prev = (m) => { let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1; if (!mo) { mo = 12; y--; } return `${y}-${String(mo).padStart(2, '0')}`; };
  // month end work is done for the month just gone
  const ui = { month: prev(today().slice(0, 7)) };
  const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // column: key, heading, what a pending count means, where to fix it
  const COLS = [
    ['no_photo', 'Photos', 'bills without photo', () => '#/checker'],
    ['not_accounted', 'To accountant', 'bills not given to accountant', () => '#/photos'],
    ['open_issues', 'Gold back', 'issue vouchers not received back', () => '#/issues'],
    ['no_bill', 'Payments', 'payments without a bill', () => '#/checker'],
    ['tds_missed', 'TDS', 'bills where TDS looks missed', () => '#/checker'],
    ['not_confirmed', 'Statement', 'statement not matched for the month', (r) => `#/ledger/${r.party_id}`],
  ];

  async function viewMonthEnd(view) {
    view.innerHTML = loadingCard('Checking the month…');
    let d;
    try { d = await api(`/month-checklist?firm=${S.firm}&month=${ui.month}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    const ready = d.rows.filter(r => !r.pending).length, total = d.rows.length;
    const allOk = total > 0 && ready === total && !d.inbox;
    const sum = Object.fromEntries(COLS.map(([k]) => [k, d.rows.reduce((s, r) => s + r[k], 0)]));
    const owner = S.ref.isOwner;
    const pct = total ? Math.round((ready / total) * 100) : 100;

    view.innerHTML = `
      <div class="toolbar">
        <input class="input" type="month" id="meMonth" value="${esc(ui.month)}" max="${today().slice(0, 7)}" style="width:190px" required />
        <div class="spacer"></div>
        ${d.locked ? `<span class="tag plain">🔒 Closed by ${esc(d.locked.locked_by_name || '')} · ${esc(fmtWhen(d.locked.locked_at))}</span>` : ''}
        ${owner ? `<button type="button" class="btn ${d.locked ? '' : allOk ? 'primary' : ''}" id="meLock">${d.locked ? 'Reopen month' : 'Close month'}</button>` : ''}
      </div>
      <div class="card me-head ${allOk ? 'ok' : ''}">
        <div class="me-big">${allOk ? '✓' : `${ready}<small>/${total}</small>`}</div>
        <div style="flex:1">
          <b>${allOk ? `${esc(monthName(ui.month))} is clean — ready to close` : `${ready} of ${total} suppliers ready for ${esc(monthName(ui.month))}`}</b>
          <div class="me-bar"><span style="width:${pct}%"></span></div>
          <div class="me-sum">${COLS.map(([k, l]) => `<span class="${sum[k] ? 'bad' : 'ok'}">${sum[k] ? `✗ ${sum[k]}` : '✓'} ${esc(l)}</span>`).join('')}
            <span class="${d.inbox ? 'bad' : 'ok'}">${d.inbox ? `✗ ${d.inbox}` : '✓'} <a href="#/inbox">Inbox</a></span></div>
        </div>
      </div>
      ${d.inbox ? `<div class="card me-warn">📥 <b>${d.inbox}</b> photo${d.inbox === 1 ? '' : 's'} snapped by month end still waiting in the <a href="#/inbox">Inbox</a> — enter them first, they may be bills of this month.</div>` : ''}
      <div class="card table-wrap"><table class="grid me-table">
        <thead><tr><th>Supplier</th><th style="text-align:right">Bills in month</th><th style="text-align:right">Paid in month</th>
          ${COLS.map(([, l]) => `<th style="text-align:center">${esc(l)}</th>`).join('')}
          <th style="text-align:right">Balance at month end</th></tr></thead>
        <tbody>${d.rows.map(r => `
          <tr class="${r.pending ? '' : 'me-ok'}" data-href="#/ledger/${r.party_id}">
            <td class="cell-main">${r.pending ? '' : '<span class="me-tick">✓</span> '}${esc(r.name)}</td>
            <td class="mono" style="text-align:right" data-sort="${r.bills_value}">${r.bills ? `${r.bills} · ${rs(r.bills_value)}` : '—'}</td>
            <td class="mono" style="text-align:right" data-sort="${r.paid}">${r.paid ? rs(r.paid) : '—'}</td>
            ${COLS.map(([k, , what, href]) => `<td style="text-align:center" data-sort="${r[k]}">${r[k]
              ? `<a class="me-x" href="${href(r)}" title="${r[k]} ${esc(what)} — click to fix">✗ ${r[k]}</a>`
              : '<span class="me-y" title="OK">✓</span>'}</td>`).join('')}
            <td class="mono" style="text-align:right" data-sort="${r.money}">${Math.abs(r.money) > 0.004 ? `${r.money < 0 ? 'Adv ' : ''}${rs(Math.abs(r.money))}` : '—'}${Math.abs(r.weight) > 0.0005 ? `<div class="dim">${gm(r.weight)}</div>` : ''}</td>
          </tr>`).join('') || `<tr><td colspan="${COLS.length + 4}"><div class="empty"><b>No supplier activity in ${esc(monthName(ui.month))}</b></div></td></tr>`}</tbody>
      </table></div>
      <div class="dim" style="font-size:12px;margin-top:10px">Statement ✓ = the supplier's balance was confirmed for this month end (Supplier Ledger → Check monthly statement or Confirm balance). Items ticked Verified in Checker count as done.</div>`;

    $('#meMonth').onchange = (e) => { if (!e.target.value) return; ui.month = e.target.value; viewMonthEnd(view); };
    view.querySelector('.me-table tbody').onclick = (e) => {
      if (e.target.closest('a')) return;
      const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href;
    };
    $('#meLock')?.addEventListener('click', async () => {
      const lock = !d.locked, pending = d.rows.reduce((s, r) => s + r.pending, 0) + d.inbox;
      const ok = await confirmBox({
        title: lock ? (pending ? 'Pending items — close anyway?' : `Close ${monthName(ui.month)}?`) : `Reopen ${monthName(ui.month)}?`,
        text: lock ? (pending ? `${pending} item(s) are still pending. Staff will not be able to add or change entries dated in this month.` : 'Everything is clean. Staff will not be able to add or change entries dated in this month.') : 'Staff will be able to change entries in this month again.',
        okText: lock ? (pending ? 'Close anyway' : 'Close month') : 'Reopen', danger: !lock || !!pending,
      });
      if (!ok) return;
      try { await api('/locks', { method: 'POST', body: { firm: S.firm, month: ui.month, lock, force: !!pending } }); toast(lock ? 'Month closed.' : 'Month reopened.'); viewMonthEnd(view); }
      catch (err) { toast(err.message, true); }
    });
  }

  PP.views.monthend = viewMonthEnd;
})();
