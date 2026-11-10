/* Purchase Pro — Photos: every bill photo in one place. Filter, view, download (JPG / one PDF) and mark Accounted. */
(function () {
  'use strict';
  const PP = window.PP;
  const { $, esc, store, api, toast, S, rs, fmtDate, today, loadingCard, errorCard } = PP;
  const KL = () => PP.billKindLabel || {};

  const isPdf = (u) => /\.pdf($|\?)/i.test(u) || u.includes('/raw/');
  // Cloudinary images can be resized on the fly: small JPG for the grid, full JPG for download / PDF
  const tUrl = (u) => (u.includes('/image/upload/') ? u.replace('/image/upload/', '/image/upload/w_440,h_440,c_limit,q_auto,f_jpg/') : u);
  const jUrl = (u) => (u.includes('/image/upload/') ? u.replace('/image/upload/', '/image/upload/q_auto:good,f_jpg/') : u);
  const safe = (s) => String(s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  const ui = Object.assign({ party: '', kind: '', acc: 'no', q: '', markOnDl: true }, store.get('pp_photos_ui', {}));
  if (!ui.range) ui.range = { preset: 'tm', from: '', to: '' };
  const save = () => store.set('pp_photos_ui', ui);
  let all = [], shown = [], sel = new Set(), lb = null;
  const range = () => PP.resolveRange(ui.range);

  async function viewPhotos(view) {
    view.innerHTML = loadingCard('Loading photos…');
    const [from, to] = range();
    try {
      all = await api(`/bills?firm=${S.firm}` + (from ? `&from=${from}` : '') + (to ? `&to=${to}` : ''));
    } catch (e) { view.innerHTML = errorCard(e); return; }
    sel = new Set();
    const parties = [...new Map(all.map(b => [b.party_id, b.party_name || '—'])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const kinds = [...new Set(all.map(b => b.kind))];
    if (ui.party && !parties.some(p => String(p[0]) === ui.party)) ui.party = '';
    const noPhoto = all.filter(b => !b.photos.length).length;

    view.innerHTML = `
      <div class="toolbar ph-bar">
        <div id="phRange"></div>
        <div class="search">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" id="phQ" placeholder="Bill no or supplier…" value="${esc(ui.q)}" />
        </div>
        <select class="select ph-sel" id="phParty"><option value="">All suppliers</option>${parties.map(([id, n]) => `<option value="${id}" ${String(id) === ui.party ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <select class="select ph-sel" id="phKind"><option value="">All bill types</option>${kinds.map(k => `<option value="${k}" ${k === ui.kind ? 'selected' : ''}>${esc(KL()[k] || k)}</option>`).join('')}</select>
        <div class="chips" id="phAcc">${[['no', 'Not accounted'], ['yes', 'Accounted'], ['', 'All']].map(([k, l]) => `<button type="button" class="chip ${ui.acc === k ? 'on' : ''}" data-acc="${k}">${l}</button>`).join('')}</div>
      </div>
      <div class="card ph-act">
        <span class="ph-count" id="phCount"></span>
        ${noPhoto ? `<a class="ph-miss" href="#/checker" title="Bills saved without a photo — see the Checker">${noPhoto} ${noPhoto === 1 ? 'bill' : 'bills'} without photo</a>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn sm" id="phAll">Select all</button>
        <label class="ph-chk"><input type="checkbox" id="phMark" ${ui.markOnDl ? 'checked' : ''} /> Mark Accounted on download</label>
        <button type="button" class="btn sm" id="phJpg" disabled>Download JPG</button>
        <button type="button" class="btn sm" id="phPdf" disabled>Download PDF</button>
        <button type="button" class="btn sm" id="phAccBtn" disabled>Mark Accounted</button>
        <button type="button" class="btn sm" id="phUnacc" disabled>Remove mark</button>
      </div>
      <div class="ph-grid" id="phGrid"></div>`;

    const reload = () => viewPhotos(view);
    PP.dateRange($('#phRange'), ui.range, (r) => { ui.range = r; save(); reload(); });
    $('#phQ').oninput = () => { ui.q = $('#phQ').value; save(); draw(); };
    $('#phParty').onchange = () => { ui.party = $('#phParty').value; save(); draw(); };
    $('#phKind').onchange = () => { ui.kind = $('#phKind').value; save(); draw(); };
    $('#phAcc').onclick = (e) => { const b = e.target.closest('[data-acc]'); if (!b) return; ui.acc = b.dataset.acc; save(); $('#phAcc').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b)); draw(); };
    $('#phMark').onchange = () => { ui.markOnDl = $('#phMark').checked; save(); };
    $('#phAll').onclick = () => {
      const ids = shown.map(b => b.id), every = ids.length && ids.every(id => sel.has(id));
      ids.forEach(id => (every ? sel.delete(id) : sel.add(id)));
      draw();
    };
    $('#phJpg').onclick = () => download('jpg');
    $('#phPdf').onclick = () => download('pdf');
    $('#phAccBtn').onclick = () => markAcc(chosen(), true);
    $('#phUnacc').onclick = () => markAcc(chosen(), false);
    $('#phGrid').onclick = (e) => {
      const c = e.target.closest('[data-sel]');
      if (c) { e.stopPropagation(); const id = Number(c.dataset.sel); sel.has(id) ? sel.delete(id) : sel.add(id); draw(); return; }
      const card = e.target.closest('[data-bill]');
      if (card) openLb(Number(card.dataset.bill), 0);
    };
    draw();
  }

  const chosen = () => shown.filter(b => sel.has(b.id));

  function draw() {
    const q = ui.q.trim().toLowerCase();
    shown = all.filter(b => b.photos.length &&
      (!ui.party || String(b.party_id) === ui.party) && (!ui.kind || b.kind === ui.kind) &&
      (!ui.acc || (ui.acc === 'yes') === !!b.accounted_at) &&
      (!q || `${b.bill_no} ${b.party_name || ''}`.toLowerCase().includes(q)));
    for (const id of [...sel]) if (!shown.some(b => b.id === id)) sel.delete(id);
    const nPh = shown.reduce((t, b) => t + b.photos.length, 0), ch = chosen();
    $('#phCount').innerHTML = `<b>${shown.length}</b> ${shown.length === 1 ? 'bill' : 'bills'} · ${nPh} ${nPh === 1 ? 'photo' : 'photos'}` +
      (ch.length ? ` · <span class="ph-selpill">${ch.length} selected</span>` : '');
    $('#phAll').textContent = shown.length && shown.every(b => sel.has(b.id)) ? 'Clear selection' : 'Select all';
    ['#phJpg', '#phPdf', '#phAccBtn', '#phUnacc'].forEach(id => { $(id).disabled = !ch.length; });
    $('#phGrid').innerHTML = shown.map(b => {
      const p = b.photos[0], on = sel.has(b.id);
      return `<div class="ph-card ${on ? 'on' : ''}" data-bill="${b.id}" title="Click to view">
        <div class="ph-img">${isPdf(p) ? '<span class="ph-pdf">PDF</span>' : `<img loading="lazy" src="${esc(tUrl(p))}" alt="" />`}
          <button type="button" class="ph-tick" data-sel="${b.id}" aria-label="Select" title="Select">${on ? '✓' : ''}</button>
          ${b.photos.length > 1 ? `<span class="ph-n">${b.photos.length} photos</span>` : ''}
          ${b.accounted_at ? `<span class="ph-acc" title="Accounted ${esc(fmtDate(b.accounted_at))}${b.accounted_by_name ? ' by ' + esc(b.accounted_by_name) : ''}">✓ ACCOUNTED</span>` : ''}
        </div>
        <div class="ph-meta">
          <div class="ph-no">${esc(b.bill_no)} <span class="ph-kind">${esc(KL()[b.kind] || b.kind)}</span></div>
          <div class="ph-party">${esc(b.party_name || '—')}</div>
          <div class="ph-row"><span>${esc(fmtDate(b.bill_date))}</span><b>${rs(b.total)}</b></div>
        </div>
      </div>`;
    }).join('') || `<div class="card empty" style="grid-column:1/-1"><b>No photos here</b>${ui.acc === 'no' ? 'Every bill photo in this period is Accounted — or change the filters above.' : 'Change the filters above.'}</div>`;
  }

  // ── Accounted mark ──
  async function markAcc(list, on) {
    if (!list.length) return;
    try {
      const r = await api('/bills/accounted', { method: 'POST', body: { ids: list.map(b => b.id), accounted: on } });
      list.forEach(b => { b.accounted_at = r.accounted_at; b.accounted_by_name = r.accounted_by_name; });
      toast(`${list.length} ${list.length === 1 ? 'bill' : 'bills'} ${on ? 'marked Accounted' : 'unmarked'}`);
      sel = new Set();
      if (lb) drawLb();
      if ($('#phGrid')) draw();
    } catch (e) { toast(e.message, true); }
  }

  // ── Download ──
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const fileBase = (b) => [safe(b.bill_no), safe(b.party_name), b.bill_date].filter(Boolean).join('_');
  async function fetchBlob(u) {
    const res = await fetch(u, { mode: 'cors' });
    if (!res.ok) throw new Error('Could not download a photo (' + res.status + ')');
    return res.blob();
  }
  let jsPdfP = null;
  function loadJsPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    return jsPdfP || (jsPdfP = new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = () => ok(window.jspdf);
      s.onerror = () => { jsPdfP = null; bad(new Error('Could not load the PDF maker — check the internet.')); };
      document.head.appendChild(s);
    }));
  }
  const imgOf = (blob) => new Promise((ok, bad) => {
    const url = URL.createObjectURL(blob), im = new Image();
    im.onload = () => { ok({ im, url }); };
    im.onerror = () => { URL.revokeObjectURL(url); bad(new Error('A photo could not be read')); };
    im.src = url;
  });

  async function download(kind, list) {
    list = list || chosen();
    if (!list.length) return;
    const btns = ['#phJpg', '#phPdf'].map(id => $(id)).filter(Boolean);
    btns.forEach(b => { b.disabled = true; });
    const busy = toastBusy(kind === 'pdf' ? 'Making PDF…' : 'Downloading…');
    try {
      if (kind === 'jpg') {
        for (const b of list) {
          for (let i = 0; i < b.photos.length; i++) {
            const u = b.photos[i], pdf = isPdf(u), sfx = b.photos.length > 1 ? `_${i + 1}` : '';
            saveBlob(await fetchBlob(pdf ? u : jUrl(u)), fileBase(b) + sfx + (pdf ? '.pdf' : '.jpg'));
          }
        }
      } else {
        const { jsPDF } = await loadJsPdf();
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        let pages = 0, skipped = 0;
        for (const b of list) {
          for (const u of b.photos) {
            if (isPdf(u)) { skipped++; continue; }
            const { im, url } = await imgOf(await fetchBlob(jUrl(u)));
            const W = 210, H = 297, M = 8, head = 8;
            const r = Math.min((W - 2 * M) / im.naturalWidth, (H - 2 * M - head) / im.naturalHeight);
            const w = im.naturalWidth * r, h = im.naturalHeight * r;
            if (pages++) doc.addPage();
            doc.setFontSize(9);
            doc.text(`${b.bill_no} · ${b.party_name || ''} · ${fmtDate(b.bill_date)} · ${rs(b.total).replace('₹', 'Rs ')}`, M, M + 3);
            doc.addImage(im, 'JPEG', (W - w) / 2, M + head, w, h);
            URL.revokeObjectURL(url);
          }
        }
        if (!pages) throw new Error('The chosen bills only have PDF files — use Download JPG to get them.');
        const name = list.length === 1 ? fileBase(list[0]) : `Bill-photos_${list.length}-bills_${today()}`;
        saveBlob(doc.output('blob'), name + '.pdf');
        if (skipped) toast(`${skipped} PDF ${skipped === 1 ? 'file was' : 'files were'} left out of the PDF — use Download JPG for those.`);
      }
      if (ui.markOnDl) await markAcc(list.filter(b => !b.accounted_at), true);
    } catch (e) { toast(e.message, true); }
    finally { busy(); btns.forEach(b => { b.disabled = !chosen().length; }); }
  }
  function toastBusy(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toasts').appendChild(el);
    return () => el.remove();
  }

  // ── Viewer ──
  function openLb(billId, i) {
    const b = shown.find(x => x.id === billId);
    if (!b) return;
    lb = { b, i };
    let el = $('#phLb');
    if (!el) {
      el = document.createElement('div');
      el.id = 'phLb';
      el.className = 'ph-lb';
      document.body.appendChild(el);
      el.addEventListener('click', onLbClick);
    }
    el.hidden = false;
    document.addEventListener('keydown', onLbKey);
    drawLb();
  }
  function closeLb() {
    lb = null;
    const el = $('#phLb');
    if (el) { el.hidden = true; el.innerHTML = ''; }
    document.removeEventListener('keydown', onLbKey);
  }
  function step(d) {
    if (!lb) return;
    const { b } = lb;
    let i = lb.i + d;
    if (i >= 0 && i < b.photos.length) { lb.i = i; return drawLb(); }
    const k = shown.indexOf(b) + d;
    if (k < 0 || k >= shown.length) return;
    lb.b = shown[k];
    lb.i = d > 0 ? 0 : lb.b.photos.length - 1;
    drawLb();
  }
  function drawLb() {
    const { b, i } = lb, u = b.photos[i], k = shown.indexOf(b);
    $('#phLb').innerHTML = `
      <div class="ph-lb-top">
        <div class="ph-lb-t"><b>${esc(b.bill_no)}</b> · ${esc(b.party_name || '')} · ${esc(fmtDate(b.bill_date))} · ${rs(b.total)}
          ${b.accounted_at ? '<span class="ph-acc static">✓ ACCOUNTED</span>' : ''}
          <span class="dim">· photo ${i + 1} of ${b.photos.length} · bill ${k + 1} of ${shown.length}</span></div>
        <div class="ph-lb-btns">
          <a class="btn sm" href="#/bills/${b.id}" data-lb="open">Open bill</a>
          <button type="button" class="btn sm" data-lb="jpg">Download</button>
          <button type="button" class="btn sm" data-lb="acc">${b.accounted_at ? 'Remove Accounted' : 'Mark Accounted'}</button>
          <button type="button" class="btn sm" data-lb="x" aria-label="Close">✕</button>
        </div>
      </div>
      <button type="button" class="ph-lb-nav l" data-lb="prev" aria-label="Previous" ${k === 0 && i === 0 ? 'disabled' : ''}>‹</button>
      <div class="ph-lb-img">${isPdf(u) ? `<iframe src="${esc(u)}" title="Bill PDF"></iframe>` : `<img src="${esc(jUrl(u))}" alt="Bill photo" />`}</div>
      <button type="button" class="ph-lb-nav r" data-lb="next" aria-label="Next" ${k === shown.length - 1 && i === b.photos.length - 1 ? 'disabled' : ''}>›</button>`;
  }
  function onLbClick(e) {
    const a = e.target.closest('[data-lb]');
    if (!a) { if (e.target.id === 'phLb' || e.target.classList.contains('ph-lb-img')) closeLb(); return; }
    const k = a.dataset.lb;
    if (k === 'x' || k === 'open') return closeLb();
    if (k === 'prev') return step(-1);
    if (k === 'next') return step(1);
    if (k === 'jpg') return download('jpg', [lb.b]);
    if (k === 'acc') return markAcc([lb.b], !lb.b.accounted_at);
  }
  function onLbKey(e) {
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  }
  window.addEventListener('hashchange', closeLb);

  PP.views.photos = viewPhotos;
})();
