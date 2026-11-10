/* Purchase Pro — client. Plain JS, hash routing (#/suppliers etc). */
(function () {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const fmtWhen = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  async function api(path, opts = {}) {
    const res = await fetch('/purchase-pro/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) { location.href = '/login.html'; throw new Error('Not signed in'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  function toast(msg, isErr) {
    const el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' err' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), isErr ? 6000 : 3200);
  }

  // ── Modal ─────────────────────────────────────────────────────────────
  function modal(html) {
    $('#modal').innerHTML = html;
    $('#modalBackdrop').classList.add('open');
  }
  function closeModal() { $('#modalBackdrop').classList.remove('open'); }
  function confirmBox({ title, text, okText = 'OK', danger, reason }) {
    return new Promise((resolve) => {
      modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
        ${reason ? `<div class="field"><label>Reason <span class="req">*</span></label><input class="input" id="mReason" placeholder="Why?" /></div>` : ''}
        <div class="modal-actions"><button class="btn" id="mNo">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="mOk">${esc(okText)}</button></div>`);
      const done = (v) => { closeModal(); resolve(v); };
      $('#mNo').onclick = () => done(null);
      $('#mOk').onclick = () => {
        if (reason) {
          const r = $('#mReason').value.trim();
          if (!r) { $('#mReason').classList.add('err'); $('#mReason').focus(); return; }
          return done(r);
        }
        done(true);
      };
      setTimeout(() => (reason ? $('#mReason') : $('#mOk')).focus(), 30);
    });
  }

  // ── State ─────────────────────────────────────────────────────────────
  const S = {
    ref: null,               // /me payload
    firm: store.get('pp_firm', 2),
    parties: null,
  };

  const ICONS = {
    dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    suppliers: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    bills: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    payments: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    issues: '<path d="M7 7h10v10M7 17 17 7"/>',
    checker: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    ledger: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    reports: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    photos: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
    bin: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };

  const ROUTES = [
    { group: 'Overview' },
    { id: 'dashboard', label: 'Dashboard', sub: 'What we owe, what is overdue and what needs checking' },
    { group: 'Entries' },
    { id: 'bills', label: 'Bills', sub: 'Purchase, expense, hallmark and labour bills with photos' },
    { id: 'payments', label: 'Payments', sub: 'Payments and receipts, matched to bills automatically' },
    { id: 'issues', label: 'Issue & Receipt', sub: 'Weight given to workers and received back' },
    { id: 'photos', label: 'Photos', sub: 'Every bill photo — view, download and mark Accounted' },
    { group: 'Control' },
    { id: 'checker', label: 'Checker', sub: 'Missing bills, missing receipts and missing photos' },
    { id: 'ledger', label: 'Supplier Ledger', sub: 'Running money and weight balance per supplier' },
    { id: 'reports', label: 'Reports', sub: 'Balances, TDS, GST, month close and backup' },
    { group: 'Masters' },
    { id: 'suppliers', label: 'Suppliers', sub: 'Suppliers, workers and expense parties' },
    { id: 'bin', label: 'Recycle Bin', sub: 'Deleted entries — restore anything from here' },
    { id: 'history', label: 'Edit History', sub: 'Every change, who made it and when' },
  ];

  function renderNav(active) {
    $('#nav').innerHTML = ROUTES.map(r => r.group
      ? `<div class="nav-group">${esc(r.group)}</div>`
      : `<a href="#/${r.id}" class="${r.id === active ? 'active' : ''}">
           <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">${ICONS[r.id]}</svg>
           ${esc(r.label)}${r.soon ? '<span class="soon">Soon</span>' : ''}</a>`).join('');
  }

  function renderFirmSwitch() {
    $('#firmSwitch').innerHTML = S.ref.firms.map(f =>
      `<button type="button" class="${f.id === S.firm ? 'on' : ''}" data-firm="${f.id}"><b>${esc(f.short)}</b><span>${esc(f.sub)}</span></button>`).join('');
    $('#firmSwitch').onclick = async (e) => {
      const b = e.target.closest('button[data-firm]');
      if (!b || Number(b.dataset.firm) === S.firm) return;
      if (PP.isDirty()) {
        const ok = await confirmBox({ title: 'Switch firm without saving?', text: 'You have unsaved changes on this page.', okText: 'Switch', danger: true });
        if (!ok) return;
        PP.setDirty(false);
      }
      // An open bill belongs to one firm — switching firm goes back to the list.
      const open = location.hash.match(/^#\/(bills|payments)\/\d+/);
      if (open) location.hash = '#/' + open[1];
      S.firm = Number(b.dataset.firm);
      store.set('pp_firm', S.firm);
      renderFirmSwitch();
      route();
    };
  }

  // ── Router ────────────────────────────────────────────────────────────
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
    const id = parts[0] || 'dashboard';
    const r = ROUTES.find(x => x.id === id) || ROUTES.find(x => x.id === 'dashboard');
    renderNav(r.id);
    $('#pageTitle').textContent = r.label;
    $('#pageSub').textContent = r.sub || '';
    document.title = `${r.label} · Purchase · APPACHI`;
    const view = $('#view');
    view.onclick = null; view.onchange = null;
    const fn = ({ suppliers: viewSuppliers, bin: viewBin, history: viewHistory })[r.id] || PP.views[r.id];
    fn(view, parts.slice(1));
  }

  // ── Suppliers ─────────────────────────────────────────────────────────
  const TYPE_LABEL = { PURCHASE: 'Purchase', LABOUR: 'Labour', HALLMARK: 'Hallmark', EXPENSE: 'Expense' };
  const TDS_LABEL = { AUTO: 'Auto', ALWAYS: 'Always deduct', NEVER: 'Never deduct' };
  const supUi = { q: store.get('pp_sup_q', ''), type: store.get('pp_sup_type', 'ALL') };

  async function loadParties(force) {
    if (!S.parties || force) S.parties = await api('/parties');
    return S.parties;
  }

  async function viewSuppliers(view) {
    view.innerHTML = '<div class="card empty">Loading suppliers…</div>';
    let list;
    try { list = await loadParties(true); } catch (e) { view.innerHTML = `<div class="card empty"><b>Could not load suppliers</b>${esc(e.message)}</div>`; return; }

    const counts = { ALL: list.length };
    for (const t of S.ref.partyTypes) counts[t] = list.filter(p => p.types.includes(t)).length;
    const withGst = list.filter(p => p.gstin).length;
    const igst = list.filter(p => p.gst_type === 'IGST').length;

    view.innerHTML = `
      <div class="stats">
        <div class="card stat"><div class="stat-n">${list.length}</div><div class="stat-l">Suppliers</div></div>
        <div class="card stat"><div class="stat-n">${withGst}</div><div class="stat-l">With GSTIN</div></div>
        <div class="card stat"><div class="stat-n">${list.length - withGst}</div><div class="stat-l">Without GSTIN</div></div>
        <div class="card stat"><div class="stat-n">${igst}</div><div class="stat-l">Other state (IGST)</div></div>
      </div>
      <div class="toolbar">
        <div class="search">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" id="supQ" placeholder="Search name, GSTIN, PAN, city, phone…" value="${esc(supUi.q)}" />
        </div>
        <div class="chips" id="supChips">
          ${['ALL', ...S.ref.partyTypes].map(t => `<button class="chip ${supUi.type === t ? 'on' : ''}" data-t="${t}">${t === 'ALL' ? 'All' : TYPE_LABEL[t]}<span class="n">${counts[t]}</span></button>`).join('')}
        </div>
        <div class="spacer"></div>
        <button class="btn" id="importBtn" type="button">Import from old Purchase</button>
        <button class="btn primary" id="newSupBtn" type="button">+ New supplier</button>
      </div>
      <div class="card table-wrap"><table class="grid">
        <thead><tr><th>Supplier</th><th>Type</th><th>GSTIN</th><th>State</th><th>PAN / Entity</th><th>TDS</th><th>Phone</th></tr></thead>
        <tbody id="supRows"></tbody>
      </table></div>`;

    const draw = () => {
      const q = supUi.q.trim().toUpperCase();
      const rows = list.filter(p =>
        (supUi.type === 'ALL' || p.types.includes(supUi.type)) &&
        (!q || [p.name, p.alias, p.gstin, p.pan, p.city, p.phone, p.phone2].some(v => v && String(v).toUpperCase().includes(q))));
      $('#supRows').innerHTML = rows.length ? rows.map(p => `
        <tr data-id="${p.id}">
          <td><div class="cell-main">${esc(p.name)}</div><div class="cell-sub">${esc([p.alias, p.city].filter(Boolean).join(' · ')) || '&nbsp;'}</div></td>
          <td>${p.types.map(t => `<span class="tag ${t}">${TYPE_LABEL[t]}</span>`).join('')}</td>
          <td class="mono">${p.gstin ? esc(p.gstin) : '<span class="tag bad">No GSTIN</span>'}</td>
          <td><div>${esc(p.state || '—')}</div><div class="cell-sub">${p.gst_type}</div></td>
          <td><div class="mono">${esc(p.pan || '—')}</div><div class="cell-sub">${esc(p.entity_type)}</div></td>
          <td>${esc(TDS_LABEL[p.tds_mode] || p.tds_mode)}</td>
          <td class="mono">${esc(p.phone || '—')}</td>
        </tr>`).join('')
        : `<tr><td colspan="7"><div class="empty"><b>${list.length ? 'No supplier matches' : 'No suppliers yet'}</b>${list.length ? 'Try a different search or type.' : 'Add one, or import the list from the old Purchase.'}</div></td></tr>`;
    };
    draw();

    $('#supQ').oninput = (e) => { supUi.q = e.target.value; store.set('pp_sup_q', supUi.q); draw(); };
    $('#supChips').onclick = (e) => {
      const b = e.target.closest('.chip'); if (!b) return;
      supUi.type = b.dataset.t; store.set('pp_sup_type', supUi.type);
      view.querySelectorAll('#supChips .chip').forEach(c => c.classList.toggle('on', c === b));
      draw();
    };
    $('#supRows').onclick = (e) => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      openSupplier(list.find(p => p.id === Number(tr.dataset.id)));
    };
    $('#newSupBtn').onclick = () => openSupplier(null);
    $('#importBtn').onclick = importOld;
  }

  async function importOld() {
    let info;
    try { info = await api('/import/old-suppliers'); } catch (e) { toast(e.message, true); return; }
    if (!info.toAdd) { toast(`All ${info.total} old suppliers are already here.`); return; }
    const ok = await confirmBox({
      title: 'Import suppliers',
      text: `${info.toAdd} supplier(s) from the old Purchase will be added (${info.already} already here). The old Purchase is only read, never changed.`,
      okText: `Import ${info.toAdd}`,
    });
    if (!ok) return;
    try {
      const r = await api('/import/old-suppliers', { method: 'POST' });
      toast(`Imported ${r.added} supplier(s).`);
      if (r.problems?.length) toast(`${r.problems.length} skipped: ${r.problems.slice(0, 2).join('; ')}`, true);
      route();
    } catch (e) { toast(e.message, true); }
  }

  // ── Supplier drawer ───────────────────────────────────────────────────
  const DRAFT_KEY = 'pp_draft_new_supplier';
  let drawerDirty = false;

  function openDrawer(html) {
    $('#drawer').innerHTML = html;
    $('#drawer').classList.add('open');
    $('#drawerBackdrop').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
  }
  async function closeDrawer(force) {
    if (!force && drawerDirty) {
      const ok = await confirmBox({ title: 'Discard changes?', text: 'You have unsaved changes in this form.', okText: 'Discard', danger: true });
      if (!ok) return;
    }
    drawerDirty = false;
    $('#drawer').classList.remove('open');
    $('#drawerBackdrop').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
  }
  $('#drawerBackdrop').onclick = () => closeDrawer();
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#modalBackdrop').classList.contains('open')) closeModal();
    else if ($('#drawer').classList.contains('open')) closeDrawer();
  });

  function field(name, label, val, opts = {}) {
    return `<div class="field ${opts.full ? 'full' : ''}"><label>${esc(label)}${opts.req ? ' <span class="req">*</span>' : ''}</label>
      ${opts.area ? `<textarea class="textarea" name="${name}">${esc(val)}</textarea>`
        : `<input class="input ${opts.mono ? 'mono' : ''}" name="${name}" value="${esc(val)}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''} ${opts.max ? `maxlength="${opts.max}"` : ''} />`}
      ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}</div>`;
  }

  function openSupplier(p) {
    const isNew = !p;
    const draft = isNew ? store.get(DRAFT_KEY, null) : null;
    const v = p || draft || { types: ['PURCHASE'], tds_mode: 'AUTO' };
    drawerDirty = false;

    openDrawer(`
      <div class="drawer-head">
        <div class="drawer-title">${isNew ? 'New supplier' : esc(p.name)}<button class="x-btn" id="dClose" title="Close">×</button></div>
        <div class="drawer-meta">${isNew ? 'Fill the details and save.' : `Added ${esc(fmtWhen(p.created_at))}${p.created_by_name ? ' by ' + esc(p.created_by_name) : ''}${p.updated_at ? ` · Last edited ${esc(fmtWhen(p.updated_at))}${p.updated_by_name ? ' by ' + esc(p.updated_by_name) : ''}` : ''}`}</div>
        ${isNew ? '' : '<div class="tabs"><button class="on" data-tab="details">Details</button><button data-tab="history">Edit history</button></div>'}
      </div>
      <div class="drawer-body" id="dBody">
        <form id="supForm" autocomplete="off">
          ${draft ? '<div class="draft-note">Restored your unsaved draft. <button type="button" class="ghost-btn" id="clearDraft">Start fresh</button></div>' : ''}
          <div id="formErr"></div>
          <div class="form-sec"><h3>Basic</h3><div class="fgrid">
            ${field('name', 'Supplier name', v.name, { req: true, full: true, ph: 'As printed on the bill' })}
            ${field('alias', 'Short name', v.alias, { ph: 'Optional' })}
            <div class="field"><label>Type <span class="req">*</span></label><div class="checks">
              ${S.ref.partyTypes.map(t => `<label><input type="checkbox" name="types" value="${t}" ${(v.types || []).includes(t) ? 'checked' : ''}/>${TYPE_LABEL[t]}</label>`).join('')}
            </div></div>
          </div></div>
          <div class="form-sec"><h3>GST &amp; PAN</h3><div class="fgrid">
            ${field('gstin', 'GSTIN', v.gstin, { mono: true, max: 15, ph: '33ABCDE1234F1Z5', hint: 'PAN and state code fill in from the GSTIN.' })}
            ${field('pan', 'PAN', v.pan, { mono: true, max: 10, ph: 'ABCDE1234F' })}
            ${field('state', 'State', v.state, { ph: 'TAMIL NADU' })}
            ${field('state_code', 'State code', v.state_code, { mono: true, max: 2, ph: '33' })}
          </div><div class="derived" id="derived"></div></div>
          <div class="form-sec"><h3>TDS</h3>
            <div class="checks" id="tdsModes">
              ${S.ref.tdsModes.map(m => `<label><input type="radio" name="tds_mode" value="${m}" ${(v.tds_mode || 'AUTO') === m ? 'checked' : ''}/>${TDS_LABEL[m]}</label>`).join('')}
            </div>
            <div class="hint" style="margin-top:6px;color:var(--ink-3);font-size:11.5px;">Auto = deduct only after this supplier crosses the yearly limit.</div>
          </div>
          <div class="form-sec"><h3>Contact</h3><div class="fgrid">
            ${field('phone', 'Phone', v.phone, { mono: true })}
            ${field('phone2', 'Phone 2', v.phone2, { mono: true })}
            ${field('email', 'Email', v.email, { full: true })}
            ${field('address', 'Address', v.address, { full: true })}
            ${field('city', 'City', v.city)}
            ${field('pincode', 'Pincode', v.pincode, { mono: true, max: 6 })}
          </div></div>
          <div class="form-sec"><h3>Bank</h3><div class="fgrid">
            ${field('bank_holder', 'Account holder', v.bank_holder, { full: true })}
            ${field('bank_name', 'Bank', v.bank_name)}
            ${field('bank_branch', 'Branch', v.bank_branch)}
            ${field('bank_account', 'Account number', v.bank_account, { mono: true })}
            ${field('bank_ifsc', 'IFSC', v.bank_ifsc, { mono: true, max: 11 })}
          </div></div>
          <div class="form-sec"><h3>Notes</h3>${field('notes', 'Notes', v.notes, { area: true, full: true })}</div>
        </form>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="supSave" type="button">${isNew ? 'Save supplier' : 'Save changes'}</button>
        <button class="btn" id="supCancel" type="button">Cancel</button>
        <div class="spacer"></div>
        ${isNew ? '' : '<button class="btn danger" id="supDel" type="button">Delete</button>'}
      </div>`);

    const form = $('#supForm');
    const read = () => {
      const fd = new FormData(form);
      const o = {};
      for (const [k, val] of fd.entries()) if (k !== 'types') o[k] = val;
      o.types = fd.getAll('types');
      return o;
    };
    const showDerived = () => {
      const o = read();
      const g = (o.gstin || '').trim().toUpperCase();
      const pan = (o.pan || '').trim().toUpperCase() || (g.length >= 12 ? g.slice(2, 12) : '');
      const sc = g.length >= 2 ? g.slice(0, 2) : (o.state_code || '').trim();
      const gst = sc && sc !== S.ref.homeStateCode ? 'IGST' : 'CGST + SGST';
      const ent = pan.length >= 4 ? (S.ref.panEntity[pan[3]] || 'Unknown') : 'No PAN';
      $('#derived').innerHTML = `<div>GST on bills<b>${gst}</b></div><div>Entity (from PAN)<b>${esc(ent)}</b></div>`;
    };
    showDerived();

    form.addEventListener('input', () => {
      drawerDirty = true;
      showDerived();
      if (isNew) store.set(DRAFT_KEY, read());
    });
    $('#clearDraft')?.addEventListener('click', () => { store.del(DRAFT_KEY); drawerDirty = false; openSupplier(null); });
    $('#dClose').onclick = () => closeDrawer();
    $('#supCancel').onclick = () => closeDrawer();

    $('#supSave').onclick = async () => {
      const btn = $('#supSave');
      btn.disabled = true;
      $('#formErr').innerHTML = '';
      try {
        const body = read();
        const saved = isNew ? await api('/parties', { method: 'POST', body }) : await api(`/parties/${p.id}`, { method: 'PUT', body });
        if (isNew) store.del(DRAFT_KEY);
        drawerDirty = false;
        toast(isNew ? `Supplier ${saved.name} added.` : 'Changes saved.');
        closeDrawer(true);
        route();
      } catch (e) {
        $('#formErr').innerHTML = `<div class="form-err">${esc(e.message)}</div>`;
        $('#dBody').scrollTop = 0;
      } finally { btn.disabled = false; }
    };

    if (!isNew) {
      $('#supDel').onclick = async () => {
        const reason = await confirmBox({ title: `Delete ${p.name}?`, text: 'It moves to the Recycle Bin and can be restored any time.', okText: 'Delete', danger: true, reason: true });
        if (!reason) return;
        try {
          await api(`/parties/${p.id}`, { method: 'DELETE', body: { reason } });
          toast(`${p.name} moved to Recycle Bin.`);
          closeDrawer(true);
          route();
        } catch (e) { toast(e.message, true); }
      };
      $('#drawer .tabs').onclick = async (e) => {
        const b = e.target.closest('button[data-tab]'); if (!b) return;
        $('#drawer .tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        const showForm = b.dataset.tab === 'details';
        form.classList.toggle('hidden', !showForm);
        $('#drawer .drawer-foot').classList.toggle('hidden', !showForm);
        let h = $('#histBox');
        if (!h) { h = document.createElement('div'); h.id = 'histBox'; $('#dBody').appendChild(h); }
        h.classList.toggle('hidden', showForm);
        if (!showForm) {
          h.innerHTML = '<div class="dim">Loading…</div>';
          try { h.innerHTML = renderHistory(await api(`/audit?entity=party&id=${p.id}`)); } catch (err) { h.innerHTML = `<div class="form-err">${esc(err.message)}</div>`; }
        }
      };
    }
  }

  // ── History rendering ─────────────────────────────────────────────────
  const FIELD_LABEL = {
    name: 'Name', alias: 'Short name', types: 'Type', gstin: 'GSTIN', pan: 'PAN', state: 'State', state_code: 'State code',
    address: 'Address', city: 'City', pincode: 'Pincode', phone: 'Phone', phone2: 'Phone 2', email: 'Email',
    bank_holder: 'Account holder', bank_name: 'Bank', bank_account: 'Account no.', bank_ifsc: 'IFSC', bank_branch: 'Branch',
    tds_mode: 'TDS', notes: 'Notes',
    // bills
    kind: 'Bill type', party_id: 'Supplier (id)', bill_no: 'Bill no', bill_date: 'Bill date', taxable: 'Taxable',
    other_charges: 'Other charges', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', round_off: 'Round off', total: 'Total',
    tds: 'TDS', net: 'Net payable', pcs: 'Pcs', gross_wt: 'Gross wt', net_wt: 'Net wt', photos: 'Photos', items: 'Item lines', accounted_at: 'Accounted',
    // payments / issues / receipts / openings
    direction: 'Direction', pay_date: 'Date', amount: 'Amount', mode: 'Paid by', reference: 'Reference', bill_ids: 'Linked bills',
    issue_no: 'Issue no', issue_date: 'Issue date', item_type: 'Item type', description: 'Description',
    receipt_no: 'Receipt no', receipt_date: 'Receipt date', issue_ids: 'Linked issues', bill_id: 'Labour bill',
    as_of: 'As of', money: 'Money', weight: 'Gold',
  };
  const ENTITY_NAME = { party: 'Supplier', bill: 'Bill', payment: 'Payment', issue: 'Issue voucher', receipt: 'Receipt voucher', opening: 'Opening balance', confirmation: 'Confirmation', month: 'Month', check: 'Checker' };
  const entityName = (e) => ENTITY_NAME[e] || e;
  const ENTITY_LINK = { bill: (id) => `#/bills/${id}`, payment: (id) => `#/payments/${id}`, issue: () => '#/issues', receipt: () => '#/issues' };
  const showVal = (v) => {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.length ? `${v.length} item(s)` : '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  function diff(beforeJ, afterJ) {
    let b = {}, a = {};
    try { b = JSON.parse(beforeJ || '{}') || {}; } catch {}
    try { a = JSON.parse(afterJ || '{}') || {}; } catch {}
    const norm = (v) => (typeof v === 'string' && /^\[|^\{/.test(v) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);
    const same = (x, y) => JSON.stringify(norm(x) ?? '') === JSON.stringify(norm(y) ?? '');
    return Object.keys(FIELD_LABEL).filter(k => k in a && !same(b[k], a[k])).map(k => {
      const from = norm(b[k]), to = norm(a[k]);
      if (k === 'items') return { k, from: '', to: 'changed' };
      return { k, from: showVal(from), to: showVal(to) };
    });
  }
  function renderHistory(rows, showEntity) {
    if (!rows.length) return '<div class="empty"><b>No history yet</b></div>';
    return `<div class="hist">${rows.map(r => {
      const changes = r.action === 'UPDATE' ? diff(r.before_json, r.after_json) : [];
      let label = '';
      if (showEntity) { try { const o = JSON.parse(r.after_json || r.before_json || '{}') || {}; label = o.title || o.name || o.bill_no || ''; } catch {} }
      const link = ENTITY_LINK[r.entity] && r.entity_id ? ENTITY_LINK[r.entity](r.entity_id) : null;
      return `<div class="hist-item">
        <div class="hist-head"><span class="act ${esc(r.action)}">${esc(r.action)}</span>
          ${showEntity ? `<b>${esc(entityName(r.entity))}</b> ${link ? `<a href="${link}">${esc(label)}</a>` : esc(label)}` : ''}
          <span>by <b>${esc(r.user_name || 'Unknown')}</b></span><span class="when">${esc(fmtWhen(r.at))}</span></div>
        ${r.note ? `<div class="cell-sub" style="margin-top:6px;">${esc(r.note)}</div>` : ''}
        ${changes.length ? `<div class="hist-changes">${changes.map(c => `<div class="k">${esc(FIELD_LABEL[c.k])}</div><div>${c.from != null && c.from !== '' ? `<s>${esc(c.from)}</s> → ` : ''}<ins>${esc(c.to ?? '(empty)')}</ins></div>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  // ── Recycle Bin ───────────────────────────────────────────────────────
  async function viewBin(view) {
    view.innerHTML = '<div class="card empty">Loading…</div>';
    let rows;
    try {
      const f = `deleted=1&firm=${S.firm}`;
      const [ps, bs, pays, ivs, rcs, ops] = await Promise.all([api('/parties?deleted=1'), api(`/bills?${f}`), api(`/payments?${f}`), api(`/issues?${f}`), api(`/receipts?${f}`), api(`/openings?${f}`)]);
      const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
      const common = (x) => ({ id: x.id, at: x.deleted_at, by: x.deleted_by_name, reason: x.delete_reason });
      rows = [
        ...ps.map(p => ({ ...common(p), kind: 'parties', title: p.name, sub: p.gstin || '', tag: 'Supplier' })),
        ...bs.map(b => ({ ...common(b), kind: 'bills', title: `${b.bill_no} — ${b.party_name || ''}`, sub: `${b.bill_date} · ${inr(b.net)}`, tag: 'Bill' })),
        ...pays.map(p => ({ ...common(p), kind: 'payments', title: `${inr(p.amount)} — ${p.party_name || ''}`, sub: `${p.pay_date} · ${p.mode || ''}`, tag: 'Payment' })),
        ...ivs.map(i => ({ ...common(i), kind: 'issues', title: `${i.issue_no} — ${i.party_name || ''}`, sub: `${i.issue_date} · ${i.net_wt} g`, tag: 'Issue voucher' })),
        ...rcs.map(r => ({ ...common(r), kind: 'receipts', title: `${r.receipt_no || 'Receipt'} — ${r.party_name || ''}`, sub: `${r.receipt_date} · ${r.net_wt} g`, tag: 'Receipt voucher' })),
        ...ops.map(o => ({ ...common(o), kind: 'openings', title: `Opening — ${o.party_name || ''}`, sub: `${o.as_of} · ${inr(o.money)} · ${o.weight} g`, tag: 'Opening balance' })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    } catch (e) { view.innerHTML = `<div class="card empty"><b>Could not load</b>${esc(e.message)}</div>`; return; }
    view.innerHTML = `<div class="card table-wrap"><table class="grid">
      <thead><tr><th>Item</th><th>Kind</th><th>Deleted</th><th>Reason</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr style="cursor:default">
        <td><div class="cell-main">${esc(r.title)}</div><div class="cell-sub mono">${esc(r.sub)}</div></td>
        <td><span class="tag plain">${esc(r.tag)}</span></td>
        <td><div>${esc(fmtWhen(r.at))}</div><div class="cell-sub">by ${esc(r.by || 'Unknown')}</div></td>
        <td>${esc(r.reason || '')}</td>
        <td style="text-align:right"><button class="btn sm" data-restore="${r.kind}/${r.id}">Restore</button></td></tr>`).join('')
        : '<tr><td colspan="5"><div class="empty"><b>Recycle Bin is empty</b>Deleted entries show up here. Entries are shown for the firm selected at the top.</div></td></tr>'}
      </tbody></table></div>`;
    view.onclick = async (e) => {
      const b = e.target.closest('button[data-restore]'); if (!b) return;
      b.disabled = true;
      try { await api(`/${b.dataset.restore}/restore`, { method: 'POST' }); toast('Restored.'); viewBin(view); }
      catch (err) { toast(err.message, true); b.disabled = false; }
    };
  }

  // ── Edit history (all) ────────────────────────────────────────────────
  async function viewHistory(view) {
    view.onclick = null;
    view.innerHTML = '<div class="card empty">Loading…</div>';
    try { view.innerHTML = renderHistory(await api('/audit'), true); }
    catch (e) { view.innerHTML = `<div class="card empty"><b>Could not load</b>${esc(e.message)}</div>`; }
  }

  // ── Shared with the other screen files (bills-ui.js …) ────────────────
  // pageDirty = unsaved changes on a full-page form (e.g. the bill editor).
  let pageDirty = false;
  function hideDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawerBackdrop').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
  }
  async function showHistory(entity, id, title) {
    openDrawer(`<div class="drawer-head"><div class="drawer-title">History · ${esc(title)}<button class="x-btn" id="hClose">×</button></div><div class="drawer-meta">Every change, who made it and when.</div></div><div class="drawer-body" id="hBody"><div class="dim">Loading…</div></div>`);
    $('#hClose').onclick = () => hideDrawer();
    try { $('#hBody').innerHTML = renderHistory(await api(`/audit?entity=${entity}&id=${id}`)); }
    catch (e) { $('#hBody').innerHTML = `<div class="form-err">${esc(e.message)}</div>`; }
  }
  const PP = window.PP = {
    $, esc, store, api, toast, modal, closeModal, confirmBox, fmtWhen, S, views: {},
    openDrawer, closeDrawer, hideDrawer, renderHistory, showHistory, loadParties, route, entityName,
    setDirty(v) { pageDirty = !!v; }, isDirty() { return pageDirty; },
    markDrawerDirty() { drawerDirty = true; },
  };

  // ── Boot ──────────────────────────────────────────────────────────────
  $('#themeBtn').onclick = () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('aj_theme', t); } catch {}
  };
  window.addEventListener('beforeunload', (e) => { if (drawerDirty || pageDirty) { e.preventDefault(); e.returnValue = ''; } });

  (async () => {
    try { S.ref = await api('/me'); } catch (e) { $('#view').innerHTML = `<div class="card empty"><b>Could not start</b>${esc(e.message)}</div>`; return; }
    if (!S.ref.firms.some(f => f.id === S.firm)) S.firm = S.ref.firms[0].id;
    $('#me').textContent = S.ref.user.name || '';
    renderFirmSwitch();
    // Leaving a page with unsaved changes asks first; "Cancel" puts the old address back.
    let lastHash = location.hash, skipNext = false;
    window.addEventListener('hashchange', async () => {
      if (skipNext) { skipNext = false; return; }
      if (pageDirty) {
        const ok = await confirmBox({ title: 'Leave without saving?', text: 'You have unsaved changes on this page.', okText: 'Leave', danger: true });
        if (!ok) { skipNext = true; location.hash = lastHash; return; }
        pageDirty = false;
      }
      lastHash = location.hash;
      hideDrawer();
      $('#view').onclick = null;
      route();
    });
    route();
  })();
})();
