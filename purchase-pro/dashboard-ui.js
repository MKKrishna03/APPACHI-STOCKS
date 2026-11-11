/* Purchase Pro — Dashboard + Checker. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, fmtWhen, S, rs, gm, fmtDate, loadingCard, errorCard } = PP;
  const KL = () => PP.billKindLabel || {};

  // ═══════════ Dashboard ═══════════
  async function viewDashboard(view) {
    view.innerHTML = loadingCard();
    let d;
    try { d = await api(`/dashboard?firm=${S.firm}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    const t = d.totals;
    const ageTotal = t.d30 + t.d60 + t.d60p || 1;
    const tile = (href, n, l, warn) => `<a class="card stat tile" href="${href}"><div class="stat-n" style="${warn ? 'color:var(--bad)' : ''}">${n}</div><div class="stat-l">${l}</div></a>`;
    const actionsCount = Object.values(d.pending).reduce((a, b) => a + b, 0);
    const confName = new Date(d.conf_month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long' });
    view.innerHTML = `
      <div class="stats">
        ${tile('#/ledger', rs(t.payable), 'We owe suppliers')}
        ${tile('#/ledger', rs(t.d60p), 'Unpaid over 60 days', t.d60p > 0)}
        ${tile('#/payments', rs(t.advance_given), 'Advance with suppliers')}
        ${tile('#/issues', gm(t.weight_out), 'Gold with workers')}
      </div>
      <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        ${tile('#/bills', `${t.bills_month} <small class="dim" style="font-size:15px">· ${rs(t.bills_month_value)}</small>`, 'Bills this month')}
        ${tile('#/payments', rs(t.paid_month), 'Paid this month')}
        ${tile('#/checker', actionsCount, 'Things to check', actionsCount > 0)}
        ${tile('#/checker', d.pending.not_confirmed, `Supplier statements not matched (${confName})`, d.pending.not_confirmed > 0)}
        ${tile('#/checker', d.pending.not_accounted, 'Bills not given to accountant', d.pending.not_accounted > 0)}
        ${tile('#/checker', t.tds_missed, 'Bills where TDS looks missed', t.tds_missed > 0)}
      </div>
      <div class="dash-grid">
        <div class="card dash-card">
          <div class="dc-head"><b>Unpaid bills by age</b><span class="dim">${rs(t.due)} due</span></div>
          <div class="age-bar">
            <span style="flex:${t.d30 / ageTotal};background:var(--ok)"></span><span style="flex:${t.d60 / ageTotal};background:var(--warn)"></span><span style="flex:${t.d60p / ageTotal};background:var(--bad)"></span>
          </div>
          <div class="age-legend"><div><i style="background:var(--ok)"></i>0–30 days<b>${rs(t.d30)}</b></div><div><i style="background:var(--warn)"></i>31–60 days<b>${rs(t.d60)}</b></div><div><i style="background:var(--bad)"></i>Over 60 days<b>${rs(t.d60p)}</b></div></div>
          <div class="dc-head" style="margin-top:20px"><b>Who we owe most</b><a href="#/ledger" class="dim">All suppliers →</a></div>
          <table class="grid compact"><tbody>${d.top_dues.length ? d.top_dues.map(x => `<tr data-href="#/ledger/${x.party_id}"><td class="cell-main">${esc(x.name)}</td><td class="dim" style="font-size:12px">${x.open_bills} bill(s)${x.oldest_due ? ' · since ' + esc(fmtDate(x.oldest_due)) : ''}</td><td class="mono cell-main" style="text-align:right">${rs(x.money)}</td><td style="text-align:right">${x.d60p > 0 ? `<span class="tag bad">${rs(x.d60p)} 60d+</span>` : ''}</td></tr>`).join('') : '<tr><td><div class="empty" style="padding:20px">Nothing owed. 🎉</div></td></tr>'}</tbody></table>
        </div>
        <div class="card dash-card">
          <div class="dc-head"><b>Gold with workers</b><a href="#/issues" class="dim">Issues →</a></div>
          <table class="grid compact"><tbody>${d.workers.length ? d.workers.map(w => `<tr data-href="#/ledger/${w.party_id}"><td class="cell-main">${esc(w.name)}</td><td class="dim" style="font-size:12px">${w.open_issues} open issue(s)</td><td class="mono cell-main" style="text-align:right">${gm(w.weight)}</td></tr>`).join('') : '<tr><td><div class="empty" style="padding:20px">No gold out with workers.</div></td></tr>'}</tbody></table>
          <div class="dc-head" style="margin-top:20px"><b>Recent changes</b><a href="#/history" class="dim">All →</a></div>
          <div class="recent">${d.recent.map(r => { let title = ''; try { const o = JSON.parse(r.after_json || r.before_json || '{}') || {}; title = o.title || o.name || o.bill_no || ''; } catch {} return `<div><span class="act ${esc(r.action)}">${esc(r.action)}</span> ${esc(PP.entityName(r.entity))} <b>${esc(title)}</b><span class="dim"> · ${esc(r.user_name || '')} · ${esc(fmtWhen(r.at))}</span></div>`; }).join('') || '<div class="dim">No changes yet.</div>'}</div>
        </div>
      </div>`;
    view.onclick = (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href; };
  }

  // ═══════════ Checker ═══════════
  const cu = { tab: store.get('pp_chk_tab', 'no_bill'), hide: store.get('pp_chk_hide', true) };
  const TABS = {
    no_bill: { label: 'Payments without bill', entity: 'payment', hint: 'Paid 7+ days ago but no bill matched yet — collect the bill.' },
    open_issues: { label: 'Gold not received back', entity: 'issue', hint: 'Issue vouchers not yet closed by a labour bill — collect the labour bill and link these issues in it.' },
    no_photo: { label: 'Bills without photo', entity: 'bill_photo', hint: 'Attach the bill photo.' },
    not_accounted: { label: 'Not given to accountant', entity: 'bill_acc', hint: 'Bill photo is there but not marked Accounted — hand it over on the Photos page.' },
    not_confirmed: { label: 'Statements not matched', entity: 'confirm', hint: "Compare the supplier's own statement with our ledger, then click Confirm balance in Supplier Ledger. A bill we never entered only shows up here." },
    tds_missed: { label: 'TDS looks missed', entity: 'bill_tds', hint: 'Supplier is set to Always deduct TDS, but these bills have no TDS.' },
  };

  async function viewChecker(view) {
    view.innerHTML = loadingCard();
    let d;
    try { d = await api(`/checker?firm=${S.firm}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    const pending = (k) => d[k].filter(x => !x.check).length;
    view.innerHTML = `
      <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${Object.entries(TABS).map(([k, t]) => `<a class="card stat tile ${cu.tab === k ? 'tile-on' : ''}" data-tab="${k}"><div class="stat-n" style="${pending(k) ? 'color:var(--bad)' : 'color:var(--ok)'}">${pending(k)}</div><div class="stat-l">${t.label}</div></a>`).join('')}</div>
      <div class="toolbar"><div class="dim" style="font-size:13px">${esc(TABS[cu.tab].hint)}</div><div class="spacer"></div>
        <label class="mini-check"><input type="checkbox" id="hideV" ${cu.hide ? 'checked' : ''}/> Hide verified</label></div>
      <div class="card table-wrap"><table class="grid" id="chkTable"></table></div>`;

    const draw = () => {
      const rows = d[cu.tab].filter(x => !cu.hide || !x.check);
      const vcell = (x) => `<td style="text-align:right;white-space:nowrap"><label class="mini-check" title="Mark as checked"><input type="checkbox" data-ver="${x.id}" ${x.check ? 'checked' : ''}/> ${x.check ? `<span class="dim">${esc(x.check.by_name || '')} · ${esc(fmtDate(x.check.at))}</span>` : 'Verified'}</label></td>`;
      const head = {
        no_bill: '<th>Paid on</th><th>Supplier</th><th style="text-align:right">Amount</th><th style="text-align:right">No bill for</th><th style="text-align:right">Days</th><th></th>',
        open_issues: '<th>Issued on</th><th>Issue no</th><th>Worker</th><th style="text-align:right">Issued</th><th style="text-align:right">Pending</th><th style="text-align:right">Days</th><th></th>',
        not_accounted: '<th>Bill date</th><th>Bill no</th><th>Supplier</th><th>Type</th><th style="text-align:right">Net</th><th style="text-align:right">Days</th><th></th>',
        not_confirmed: '<th>Supplier</th><th>Month</th><th style="text-align:right">Balance at month end</th><th style="text-align:right">Gold</th><th>Last confirmed</th><th></th>',
        no_photo: '<th>Bill date</th><th>Bill no</th><th>Supplier</th><th>Type</th><th style="text-align:right">Net</th><th style="text-align:right">Days</th><th></th>',
        tds_missed: '<th>Bill date</th><th>Bill no</th><th>Supplier</th><th style="text-align:right">Amount</th><th style="text-align:right">TDS due</th><th>Why</th><th></th>',
      }[cu.tab];
      const row = {
        no_bill: (x) => `<tr data-href="#/payments/${x.id}"><td>${esc(fmtDate(x.date))}</td><td class="cell-main">${esc(x.party_name)}</td><td class="mono" style="text-align:right">${rs(x.amount)}</td><td class="mono cell-main" style="text-align:right">${rs(x.unused)}</td><td class="mono" style="text-align:right">${x.days}</td>${vcell(x)}</tr>`,
        open_issues: (x) => `<tr data-href="#/issues"><td>${esc(fmtDate(x.date))}</td><td class="mono cell-main">${esc(x.issue_no)}</td><td class="cell-main">${esc(x.party_name)}</td><td class="mono" style="text-align:right">${gm(x.net_wt)}</td><td class="mono cell-main" style="text-align:right">${gm(x.remaining)}</td><td class="mono" style="text-align:right;${x.days > 15 ? 'color:var(--bad);font-weight:700' : ''}">${x.days}</td>${vcell(x)}</tr>`,
        not_accounted: (x) => `<tr data-href="#/photos"><td>${esc(fmtDate(x.date))}</td><td class="mono cell-main">${esc(x.bill_no)}</td><td class="cell-main">${esc(x.party_name)}</td><td>${esc(KL()[x.kind] || x.kind)}</td><td class="mono" style="text-align:right">${rs(x.net)}</td><td class="mono" style="text-align:right">${x.days}</td>${vcell(x)}</tr>`,
        not_confirmed: (x) => `<tr data-href="#/ledger/${x.party_id}"><td class="cell-main">${esc(x.party_name)}</td><td>${esc(new Date(x.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</td><td class="mono cell-main" style="text-align:right">${x.money > 0.005 ? 'We owe ' + rs(x.money) : x.money < -0.005 ? 'Advance ' + rs(-x.money) : 'Settled'}</td><td class="mono" style="text-align:right">${Math.abs(x.weight) > 0.0005 ? gm(x.weight) : '—'}</td><td class="dim">${x.last ? esc(fmtDate(x.last)) : 'Never'}</td>${vcell(x)}</tr>`,
        no_photo: (x) => `<tr data-href="#/bills/${x.id}"><td>${esc(fmtDate(x.date))}</td><td class="mono cell-main">${esc(x.bill_no)}</td><td class="cell-main">${esc(x.party_name)}</td><td>${esc(KL()[x.kind] || x.kind)}</td><td class="mono" style="text-align:right">${rs(x.net)}</td><td class="mono" style="text-align:right">${x.days}</td>${vcell(x)}</tr>`,
        tds_missed: (x) => `<tr data-href="#/bills/${x.id}"><td>${esc(fmtDate(x.date))}</td><td class="mono cell-main">${esc(x.bill_no)}</td><td class="cell-main">${esc(x.party_name)}</td><td class="mono" style="text-align:right">${rs(x.amount)}</td><td class="mono cell-main" style="text-align:right;color:var(--bad)">${rs(x.suggested)}</td><td class="dim" style="font-size:12px">${esc(x.reason)}</td>${vcell(x)}</tr>`,
      }[cu.tab];
      $('#chkTable').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${rows.length ? rows.map(row).join('') : `<tr><td colspan="7"><div class="empty"><b>All clear</b>Nothing to check here.</div></td></tr>`}</tbody>`;
    };
    draw();
    view.onclick = async (e) => {
      const tile = e.target.closest('[data-tab]');
      if (tile) { cu.tab = tile.dataset.tab; store.set('pp_chk_tab', cu.tab); viewChecker(view); return; }
      if (e.target.closest('label.mini-check')) return;
      const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href;
    };
    view.onchange = async (e) => {
      if (e.target.id === 'hideV') { cu.hide = e.target.checked; store.set('pp_chk_hide', cu.hide); draw(); return; }
      const cb = e.target.closest('[data-ver]'); if (!cb) return;
      try { await api('/checks', { method: 'POST', body: { entity: TABS[cu.tab].entity, entity_id: cb.dataset.ver, checked: cb.checked } }); toast(cb.checked ? 'Marked verified.' : 'Verified tick removed.'); viewChecker(view); }
      catch (err) { toast(err.message, true); cb.checked = !cb.checked; }
    };
  }

  PP.views.dashboard = viewDashboard;
  PP.views.checker = viewChecker;
})();
