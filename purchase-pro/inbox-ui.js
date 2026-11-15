/* Purchase Pro — Inbox: bill photos snapped on the phone any time (capture.html), waiting to be
   entered. "Enter bill" opens a new bill with the photo (AI reads it); "Batch" sends several photos
   of one supplier to Batch bills. A photo leaves the Inbox by itself when its bill is saved. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, api, toast, confirmBox, store, S, fmtWhen, loadingCard, errorCard } = PP;
  const KL = () => PP.billKindLabel || {};
  const isPdf = (u) => /\.pdf($|\?)/i.test(u);
  const CAPTURE = () => location.origin + '/purchase-pro/capture.html';

  const ui = { tab: 'new' };
  let rows = [], sel = new Set();

  async function viewInbox(view) {
    view.innerHTML = loadingCard('Loading Inbox…');
    try { rows = await api(`/inbox?firm=${S.firm}&status=${ui.tab}`); } catch (e) { view.innerHTML = errorCard(e); return; }
    sel = new Set([...sel].filter(id => rows.some(r => r.id === id)));
    const ageDays = (r) => Math.floor((Date.now() - Date.parse(r.created_at)) / 864e5);
    const old = ui.tab === 'new' ? rows.filter(r => ageDays(r) >= 3).length : 0;

    view.innerHTML = `
      <div class="stats">
        <div class="card stat"><div class="stat-n" style="color:${ui.tab === 'new' && rows.length ? 'var(--warn)' : 'inherit'}">${ui.tab === 'new' ? rows.length : '—'}</div><div class="stat-l">Waiting to be entered</div></div>
        <div class="card stat"><div class="stat-n" style="color:${old ? 'var(--bad)' : 'inherit'}">${ui.tab === 'new' ? old : '—'}</div><div class="stat-l">Waiting 3 days or more</div></div>
      </div>
      <div class="card ib-phone">
        <div id="ibQr" class="ib-qr"></div>
        <div>
          <b>Snap bills on the phone any time</b>
          <div class="dim">Scan this once on the phone and add it to the home screen. Every photo lands here until its bill is entered.</div>
          <div class="ib-link"><span class="mono">${esc(CAPTURE())}</span> <button type="button" class="btn sm" id="ibCopy">Copy link</button></div>
        </div>
      </div>
      <div class="toolbar">
        <div class="chips" id="ibTabs">${[['new', 'Waiting'], ['done', 'Entered']].map(([k, l]) => `<button type="button" class="chip ${ui.tab === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
        <div class="spacer"></div>
        ${ui.tab === 'new' ? `<span class="dim" id="ibSelN"></span>
          <button type="button" class="btn" id="ibBatch" disabled title="Several bills of one supplier — AI reads them all, check and save at once">Send to Batch bills</button>` : ''}
      </div>
      <div class="ib-grid" id="ibGrid">${rows.length ? rows.map(r => card(r, ageDays(r))).join('')
        : `<div class="card empty" style="grid-column:1/-1"><b>${ui.tab === 'new' ? 'Inbox is empty' : 'Nothing entered from the Inbox yet'}</b>${ui.tab === 'new' ? 'Every snapped bill has been entered. 👍' : ''}</div>`}</div>`;

    loadQr();
    $('#ibCopy').onclick = async () => { try { await navigator.clipboard.writeText(CAPTURE()); toast('Link copied'); } catch { toast(CAPTURE()); } };
    $('#ibTabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; ui.tab = b.dataset.t; sel = new Set(); viewInbox(view); };
    const drawSel = () => {
      if (ui.tab !== 'new') return;
      $('#ibSelN').textContent = sel.size ? `${sel.size} selected` : 'Tick photos of one supplier to batch them';
      $('#ibBatch').disabled = !sel.size;
      view.querySelectorAll('[data-pick]').forEach(c => { const on = sel.has(Number(c.dataset.pick)); c.checked = on; c.closest('.ib-card').classList.toggle('on', on); });
    };
    drawSel();
    $('#ibBatch')?.addEventListener('click', () => {
      const urls = rows.filter(r => sel.has(r.id)).map(r => r.url);
      store.set('pp_inbox_batch', urls);
      location.hash = '#/batch';
    });
    $('#ibGrid').onchange = (e) => {
      const c = e.target.closest('[data-pick]');
      if (c) { const id = Number(c.dataset.pick); c.checked ? sel.add(id) : sel.delete(id); drawSel(); return; }
      const n = e.target.closest('[data-note]');
      if (n) api('/inbox/' + n.dataset.note, { method: 'PATCH', body: { note: n.value } }).then(() => toast('Note saved')).catch(err => toast(err.message, true));
    };
    $('#ibGrid').onclick = async (e) => {
      const en = e.target.closest('[data-enter]');
      if (en) {
        const r = rows.find(x => x.id === Number(en.dataset.enter));
        store.set('pp_inbox_pick', { urls: [r.url], note: r.note || '' });
        location.hash = '#/bills/new';
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!(await confirmBox({ title: 'Remove this photo?', text: 'Only for a photo that is not a bill (blurry, a duplicate…). It is thrown away.', okText: 'Remove', danger: true }))) return;
        try { await api('/inbox/' + del.dataset.del, { method: 'DELETE' }); toast('Removed'); viewInbox(view); badge(); } catch (err) { toast(err.message, true); }
        return;
      }
      const v = e.target.closest('[data-view]');
      if (v) window.open(v.dataset.view, '_blank', 'noopener');
    };
  }

  function card(r, age) {
    const img = isPdf(r.url) ? '<span class="ph-pdf">PDF</span>' : `<img loading="lazy" src="${esc(r.done_url ? r.done_url.replace('/image/upload/', '/image/upload/w_440,h_440,c_limit,q_auto,f_jpg/') : r.url)}" alt="" />`;
    const when = `${esc(fmtWhen(r.created_at))}${r.created_by_name ? ' · ' + esc(r.created_by_name) : ''}`;
    if (ui.tab === 'done') {
      return `<div class="card ib-card">
        <div class="ib-img" data-view="${esc(r.done_url || r.url)}" title="Open full size">${img}</div>
        <div class="ib-meta">
          ${r.bill_id ? `<a class="cell-main" href="#/bills/${r.bill_id}">${esc(r.bill_no)}</a> <span class="ph-kind">${esc(KL()[r.kind] || r.kind || '')}</span><div>${esc(r.party_name || '')}</div>` : '<span class="dim">Bill deleted later</span>'}
          <div class="dim ib-when">Snapped ${when}</div>
        </div></div>`;
    }
    return `<div class="card ib-card">
      <label class="ib-tick"><input type="checkbox" data-pick="${r.id}" /></label>
      ${age >= 3 ? `<span class="ib-age">${age} days</span>` : ''}
      <div class="ib-img" data-view="${esc(r.url)}" title="Open full size">${img}</div>
      <div class="ib-meta">
        <input class="input ib-note" data-note="${r.id}" value="${esc(r.note || '')}" placeholder="Note…" maxlength="200" />
        <div class="dim ib-when">${when}</div>
        <div class="ib-act">
          <button type="button" class="btn sm primary" data-enter="${r.id}">Enter bill</button>
          <button type="button" class="btn sm" data-del="${r.id}" title="Not a bill — throw away">Remove</button>
        </div>
      </div></div>`;
  }

  async function loadQr() {
    try {
      await PP.loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
      const box = $('#ibQr'); if (!box) return;
      box.innerHTML = '';
      new window.QRCode(box, { text: CAPTURE(), width: 112, height: 112 });
    } catch {}
  }

  // Waiting count next to "Inbox" in the menu
  async function badge() {
    try {
      const { n } = await api(`/inbox/count?firm=${S.firm}`);
      const a = document.querySelector('#nav a[href="#/inbox"]'); if (!a) return;
      a.querySelector('.ib-badge')?.remove();
      if (n) a.insertAdjacentHTML('beforeend', `<span class="ib-badge">${n}</span>`);
    } catch {}
  }
  window.addEventListener('hashchange', () => setTimeout(badge, 300));
  setTimeout(badge, 1200);
  setInterval(badge, 120000);

  PP.views.inbox = viewInbox;
  PP.inboxBadge = badge;
})();
