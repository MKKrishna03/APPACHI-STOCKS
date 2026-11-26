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
      <div class="stats" style="grid-template-columns:repeat(6,1fr)">
        ${tile('#/ledger', rs(t.payable), 'We owe suppliers')}
        ${tile('#/ledger', rs(t.d60p), 'Unpaid over 60 days', t.d60p > 0)}
        ${tile('#/payments', rs(t.advance_given), 'Advance with suppliers')}
        ${tile('#/issues', gm(t.gold_out || 0), 'Gold with workers')}
        ${tile('#/issues', gm(t.silver_out || 0), 'Silver with workers')}
        ${tile('#/mc', rs(t.mc_payable || 0), `MC ledgers due${t.mc_count ? ' · ' + t.mc_count : ''}`)}
      </div>
      <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        ${tile('#/bills', `${t.bills_month} <small class="stat-sub">${rs(t.bills_month_value)}</small>`, 'Bills this month')}
        ${tile('#/payments', rs(t.paid_month), 'Paid this month')}
        ${tile('#/checker', actionsCount, 'Things to check', actionsCount > 0)}
        ${tile('#/checker', d.pending.not_confirmed, `Supplier statements not matched (${confName})`, d.pending.not_confirmed > 0)}
        ${tile('#/checker', d.pending.not_accounted, 'Bills not given to accountant', d.pending.not_accounted > 0)}
        ${tile('#/checker', t.tds_missed, 'Bills where TDS looks missed', t.tds_missed > 0)}
      </div>
      <div class="card dash-card ai-sum" id="aiSum"><div class="dc-head"><b>This month</b><span class="dim">Loading…</span></div></div>
      <div class="dash-grid">
        <div class="card dash-card">
          <div class="dc-head"><b>Unpaid bills by age</b><span class="dim">${rs(t.due)} due</span></div>
          <div class="age-bar">
            <span style="flex:${t.d30 / ageTotal};background:var(--ok)"></span><span style="flex:${t.d60 / ageTotal};background:var(--warn)"></span><span style="flex:${t.d60p / ageTotal};background:var(--bad)"></span>
          </div>
          <div class="age-legend"><div><i style="background:var(--ok)"></i>0–30 days<b>${rs(t.d30)}</b></div><div><i style="background:var(--warn)"></i>31–60 days<b>${rs(t.d60)}</b></div><div><i style="background:var(--bad)"></i>Over 60 days<b>${rs(t.d60p)}</b></div></div>
          <div class="owe-box" style="margin-top:20px">
            <div class="dc-head"><b>What we owe</b><span class="dim">${d.top_dues.length} supplier(s) · ${rs(d.top_dues.reduce((s, x) => s + x.money, 0))}</span></div>
            <div class="owe-scroll"><table class="grid compact"><tbody>${d.top_dues.length ? d.top_dues.map(x => `<tr data-href="#/ledger/${x.party_id}"><td class="cell-main">${esc(x.name)}</td><td class="dim" style="font-size:12px">${x.open_bills} bill(s)${x.oldest_due ? ' · since ' + esc(fmtDate(x.oldest_due)) : ''}</td><td class="mono cell-main" style="text-align:right">${rs(x.money)}</td><td style="text-align:right">${x.d60p > 0 ? `<span class="tag bad">${rs(x.d60p)} 60d+</span>` : ''}</td></tr>`).join('') : '<tr><td><div class="empty" style="padding:20px">Nothing owed. 🎉</div></td></tr>'}</tbody></table></div>
            <a href="#/ledger" class="dim" style="display:inline-block;margin-top:8px;font-size:12.5px">Open Supplier Ledger →</a>
          </div>
        </div>
        <div class="card dash-card">
          ${['GOLD', 'SILVER'].map((metal, k) => {
            const list = d.workers.filter(w => (w.metal || 'GOLD') === metal);
            const name = metal === 'GOLD' ? 'Gold' : 'Silver';
            return `<div class="dc-head"${k ? ' style="margin-top:20px"' : ''}><b>${name} with workers</b>${k ? '' : '<a href="#/issues" class="dim">Issues →</a>'}</div>
          <table class="grid compact"><tbody>${list.length ? list.map(w => `<tr data-href="#/ledger/${w.party_id}"><td class="cell-main">${esc(w.name)}</td><td class="dim" style="font-size:12px">${w.open_issues} open issue(s)</td><td class="mono cell-main" style="text-align:right">${gm(w.weight)}</td></tr>`).join('') : `<tr><td><div class="empty" style="padding:14px">No ${name.toLowerCase()} out with workers.</div></td></tr>`}</tbody></table>`;
          }).join('')}
          <div class="dc-head" style="margin-top:20px"><b>Recent changes</b><a href="#/history" class="dim">All →</a></div>
          <div class="recent">${d.recent.map(r => { let title = ''; try { const o = JSON.parse(r.after_json || r.before_json || '{}') || {}; title = o.title || o.name || o.bill_no || ''; } catch {} return `<div><span class="act ${esc(r.action)}">${esc(r.action)}</span> ${esc(PP.entityName(r.entity))} <b>${esc(title)}</b><span class="dim"> · ${esc(r.user_name || '')} · ${esc(fmtWhen(r.at))}</span></div>`; }).join('') || '<div class="dim">No changes yet.</div>'}</div>
        </div>
      </div>
      ${d.mc_dues?.length ? `<div class="card dash-card" style="margin-top:18px">
        <div class="dc-head"><b>MC ledgers</b><span class="dim">${rs(t.mc_payable)} due · not in the supplier totals above</span></div>
        <table class="grid compact"><tbody>${d.mc_dues.map(x => `<tr data-href="#/ledger/${x.party_id}"><td class="cell-main">${esc(x.name)}</td><td class="dim" style="font-size:12px">${x.open_bills} bill(s)${x.oldest_due ? ' · since ' + esc(fmtDate(x.oldest_due)) : ''}</td><td class="mono cell-main" style="text-align:right">${rs(x.money)}</td><td style="text-align:right">${x.d60p > 0 ? `<span class="tag bad">${rs(x.d60p)} 60d+</span>` : ''}</td></tr>`).join('')}</tbody></table>
      </div>` : ''}`;
    view.onclick = (e) => {
      const sb = e.target.closest('[data-sum]');
      if (sb) { loadSummary(sb.dataset.sum, sb.dataset.fresh === '1'); return; }
      const job = e.target.closest('[data-job]');   // open Checker on that list
      if (job) { cu.tab = job.dataset.job; store.set('pp_chk_tab', cu.tab); location.hash = '#/checker'; return; }
      const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href;
    };
    loadSummary(sumMonth);
  }

  // Monthly summary card: the month just gone (or this month so far). Facts in code, AI writes the note.
  let sumMonth = '';
  async function loadSummary(month, fresh) {
    const box = $('#aiSum'); if (!box) return;
    box.style.opacity = '.55'; // loading
    let d;
    try { d = await api(`/ai/summary?firm=${S.firm}${month ? '&month=' + month : ''}${fresh ? '&fresh=1' : ''}`); }
    catch (e) {
      const el = $('#aiSum');
      if (el) { el.style.opacity = ''; el.innerHTML = `<div class="dc-head"><b>Monthly summary</b><span class="dim">${esc(e.message)}</span></div>`; }
      return;
    }
    sumMonth = d.month;
    const el = $('#aiSum'); if (!el) return;
    el.style.opacity = '';
    const head = `<div class="dc-head"><b>${esc(d.title)}${d.current ? ' <span class="dim" style="font-weight:400">so far</span>' : ''}</b>
        <span class="ai-sum-nav"><button class="btn sm" data-sum="${d.prev}" title="Previous month">‹</button>${d.next ? `<button class="btn sm" data-sum="${d.next}" title="Next month">›</button>` : ''}</span></div>`;
    if (d.empty) { el.innerHTML = head + '<div class="dim" style="padding:6px 0">Nothing entered this month.</div>'; return; }
    const n = d.nums, gap = n.paid - n.billed;
    el.innerHTML = head + `
      <div class="ms-nums">
        <div><span>Bills</span><b>${rs(n.billed)}</b><i>${n.bills} bill${n.bills === 1 ? '' : 's'}</i></div>
        <div><span>Paid</span><b>${rs(n.paid)}</b></div>
        ${Math.abs(gap) >= 1 ? `<div class="${gap > 0 ? 'ms-warn' : ''}"><span>${gap > 0 ? 'Paid more than bills' : 'Bills not paid yet'}</span><b>${rs(Math.abs(gap))}</b>${gap > 0 ? '<i>bills missing?</i>' : ''}</div>` : ''}
      </div>
      <div class="ms-todo-h">${d.todo.length ? 'Do this now' : ''}</div>
      ${d.todo.length ? d.todo.map(x => { const j = JOBS[x.key] || [x.key, '']; return `<a class="ms-job" data-job="${x.key}"><b>${x.n}</b><span>${esc(j[0])}<small>${esc(j[1])}</small></span><em>›</em></a>`; }).join('') : '<div class="ms-done">✓ Nothing pending</div>'}`;
  }
  // job wording: what to do · what it is (one short line each)
  const JOBS = {
    no_bill: ['Collect the bill', 'payments with no bill'],
    open_issues: ['Collect gold / silver back', 'issue vouchers still with worker'],
    no_photo: ['Take bill photo', 'bills with no photo'],
    not_accounted: ['Give bills to accountant', 'bills not handed over'],
    not_confirmed: ['Match supplier statement', 'suppliers not matched'],
    tds_missed: ['Check TDS', 'bills with no TDS'],
    unusual: ['Check the entry', 'entries look wrong'],
  };

  // ═══════════ Checker ═══════════
  const cu = { tab: store.get('pp_chk_tab', 'no_bill'), hide: store.get('pp_chk_hide', true), metal: store.get('pp_chk_metal', '') };
  const TABS = {
    no_bill: { label: 'Payments without bill', entity: 'payment', hint: 'Paid 7+ days ago but no bill matched yet — collect the bill.' },
    open_issues: { label: 'Gold / Silver not received back', entity: 'issue', hint: 'Issue vouchers not yet closed by a labour bill — collect the labour bill and link these issues in it.' },
    no_photo: { label: 'Bills without photo', entity: 'bill_photo', hint: 'Attach the bill photo.' },
    not_accounted: { label: 'Not given to accountant', entity: 'bill_acc', hint: 'Bill photo is there but not marked Accounted — hand it over on the Photos page.' },
    not_confirmed: { label: 'Statements not matched', entity: 'confirm', hint: 'Click a supplier → add their statement (photos, PDF or Excel) → AI checks every bill and payment.' },
    tds_missed: { label: 'TDS looks missed', entity: 'bill_tds', hint: 'Supplier is set to Always deduct TDS, but these bills have no TDS.' },
    unusual: { label: 'Looks unusual', entity: 'unusual', hint: 'Possible duplicates or typing mistakes — open and fix, or tick Verified if it is correct.' },
  };

  async function viewChecker(view) {
    view.innerHTML = loadingCard();
    let d;
    try { d = await api(`/checker?firm=${S.firm}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    const pending = (k) => d[k].filter(x => !x.check).length;
    view.innerHTML = `
      <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${Object.entries(TABS).map(([k, t]) => `<a class="card stat tile ${cu.tab === k ? 'tile-on' : ''}" data-tab="${k}"><div class="stat-n" style="${pending(k) ? 'color:var(--bad)' : 'color:var(--ok)'}">${pending(k)}</div><div class="stat-l">${t.label}</div></a>`).join('')}</div>
      <div class="toolbar"><div class="dim" style="font-size:13px">${esc(TABS[cu.tab].hint)}</div><div class="spacer"></div>
        ${cu.tab === 'open_issues' ? `<select class="select" id="metalF" style="width:150px" title="Metal"><option value="">Gold + Silver</option><option value="GOLD" ${cu.metal === 'GOLD' ? 'selected' : ''}>Gold only</option><option value="SILVER" ${cu.metal === 'SILVER' ? 'selected' : ''}>Silver only</option></select>` : ''}
        <label class="mini-check"><input type="checkbox" id="hideV" ${cu.hide ? 'checked' : ''}/> Hide verified</label></div>
      <div class="card table-wrap"><table class="grid" id="chkTable"></table></div>`;

    const draw = () => {
      const rows = d[cu.tab].filter(x => (!cu.hide || !x.check) && (cu.tab !== 'open_issues' || !cu.metal || x.metal === cu.metal));
      const vcell = (x) => `<td style="text-align:right;white-space:nowrap"><label class="mini-check" title="Mark as checked"><input type="checkbox" data-ver="${x.id}" ${x.check ? 'checked' : ''}/> ${x.check ? `<span class="dim">${esc(x.check.by_name || '')} · ${esc(fmtDate(x.check.at))}</span>` : 'Verified'}</label></td>`;
      const head = {
        no_bill: '<th>Paid on</th><th>Supplier</th><th style="text-align:right">Amount</th><th style="text-align:right">No bill for</th><th style="text-align:right">Days</th><th></th>',
        open_issues: '<th>Issued on</th><th>Issue no</th><th>Metal</th><th>Worker</th><th style="text-align:right">Issued</th><th style="text-align:right">Pending</th><th style="text-align:right">Days</th><th></th>',
        not_accounted: '<th>Bill date</th><th>Bill no</th><th>Supplier</th><th>Type</th><th style="text-align:right">Net</th><th style="text-align:right">Days</th><th></th>',
        not_confirmed: '<th>Supplier</th><th>Month</th><th style="text-align:right">Balance at month end</th><th style="text-align:right">Gold</th><th>Last confirmed</th><th></th>',
        no_photo: '<th>Bill date</th><th>Bill no</th><th>Supplier</th><th>Type</th><th style="text-align:right">Net</th><th style="text-align:right">Days</th><th></th>',
        tds_missed: '<th>Bill date</th><th>Bill no</th><th>Supplier</th><th style="text-align:right">Amount</th><th style="text-align:right">TDS due</th><th>Why</th><th></th>',
        unusual: '<th>Date</th><th>What</th><th>Supplier</th><th>Details</th><th></th>',
      }[cu.tab];
      const row = {
        no_bill: (x) => `<tr data-href="#/payments/${x.id}"><td>${esc(fmtDate(x.date))}</td><td class="cell-main">${esc(x.party_name)}</td><td class="mono" style="text-align:right">${rs(x.amount)}</td><td class="mono cell-main" style="text-align:right">${rs(x.unused)}</td><td class="mono" style="text-align:right">${x.days}</td>${vcell(x)}</tr>`,
        open_issues: (x) => `<tr data-href="#/issues"><td>${esc(fmtDate(x.date))}</td><td class="mono cell-main">${esc(x.issue_no)}</td><td>${x.metal === 'SILVER' ? 'Silver' : 'Gold'}</td><td class="cell-main">${esc(x.party_name)}</td><td class="mono" style="text-align:right">${gm(x.net_wt)}</td><td class="mono cell-main" style="text-align:right">${gm(x.remaining)}</td><td class="mono" style="text-align:right;${x.days > 15 ? 'color:var(--bad);font-weight:700' : ''}">${x.days}</td>${vcell(x)}</tr>`,
        not_accounted: (x) => `<tr data-href="#/photos"><td>${esc(fmtDate(x.date))}</td><td class="mono cell-main">${esc(x.bill_no)}</td><td class="cell-main">${esc(x.party_name)}</td><td>${esc(KL()[x.kind] || x.kind)}</td><td class="mono" style="text-align:right">${rs(x.net)}</td><td class="mono" style="text-align:right">${x.days}</td>${vcell(x)}</tr>`,
        not_confirmed: (x) => `<tr data-href="#/ledger/${x.party_id}/statement?m=${x.month}"><td class="cell-main">${esc(x.party_name)}</td><td>${esc(new Date(x.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</td><td class="mono cell-main" style="text-align:right">${x.money > 0.005 ? 'We owe ' + rs(x.money) : x.money < -0.005 ? 'Advance ' + rs(-x.money) : 'Settled'}</td><td class="mono" style="text-align:right">${Math.abs(x.weight) > 0.0005 ? gm(x.weight) : '—'}</td><td class="dim">${x.last ? esc(fmtDate(x.last)) : 'Never'}</td>${vcell(x)}</tr>`,
        no_photo: (x) => `<tr data-href="#/bills/${x.id}"><td>${esc(fmtDate(x.date))}</td><td class="mono cell-main">${esc(x.bill_no)}</td><td class="cell-main">${esc(x.party_name)}</td><td>${esc(KL()[x.kind] || x.kind)}</td><td class="mono" style="text-align:right">${rs(x.net)}</td><td class="mono" style="text-align:right">${x.days}</td>${vcell(x)}</tr>`,
        tds_missed: (x) => `<tr data-href="#/bills/${x.id}"><td>${esc(fmtDate(x.date))}</td><td class="mono cell-main">${esc(x.bill_no)}</td><td class="cell-main">${esc(x.party_name)}</td><td class="mono" style="text-align:right">${rs(x.amount)}</td><td class="mono cell-main" style="text-align:right;color:var(--bad)">${rs(x.suggested)}</td><td class="dim" style="font-size:12px">${esc(x.reason)}</td>${vcell(x)}</tr>`,
        unusual: (x) => `<tr data-href="${esc(x.href)}"><td>${esc(fmtDate(x.date))}</td><td class="cell-main" style="color:var(--warn)">${esc(x.what)}</td><td class="cell-main">${esc(x.party_name)}</td><td style="font-size:13px">${esc(x.detail)}</td>${vcell(x)}</tr>`,
      }[cu.tab];
      $('#chkTable').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${rows.length ? rows.map(row).join('') : `<tr><td colspan="8"><div class="empty"><b>All clear</b>Nothing to check here.</div></td></tr>`}</tbody>`;
    };
    draw();
    view.onclick = async (e) => {
      const tile = e.target.closest('[data-tab]');
      if (tile) { cu.tab = tile.dataset.tab; store.set('pp_chk_tab', cu.tab); viewChecker(view); return; }
      if (e.target.closest('label.mini-check')) return;
      const tr = e.target.closest('tr[data-href]'); if (tr) location.hash = tr.dataset.href;
    };
    view.onchange = async (e) => {
      if (e.target.id === 'metalF') { cu.metal = e.target.value; store.set('pp_chk_metal', cu.metal); draw(); return; }
      if (e.target.id === 'hideV') { cu.hide = e.target.checked; store.set('pp_chk_hide', cu.hide); draw(); return; }
      const cb = e.target.closest('[data-ver]'); if (!cb) return;
      try { await api('/checks', { method: 'POST', body: { entity: TABS[cu.tab].entity, entity_id: cb.dataset.ver, checked: cb.checked } }); toast(cb.checked ? 'Marked verified.' : 'Verified tick removed.'); viewChecker(view); }
      catch (err) { toast(err.message, true); cb.checked = !cb.checked; }
    };
  }

  PP.views.dashboard = viewDashboard;
  PP.views.checker = viewChecker;
})();
