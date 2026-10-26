// Restocking — shared by restock.html (daily view) and restock-setup.html (target setup).
// Tagging Excel parsing, the stock/target model, and the auto-calculated target ranges.
(function () {
  var MAX_BYTES = 15 * 1024 * 1024;
  // Saved item: [tagNo, product, printName, qty, weight, sold(0/1), soldOn, tagDate, supplier]
  var I = { TAG: 0, PRODUCT: 1, PRINT: 2, QTY: 3, WT: 4, SOLD: 5, SOLD_ON: 6, DATE: 7, SUPPLIER: 8 };
  var REQUIRED = ['Tag No', 'Product Group', 'Product', 'Gross Wt', 'Status'];
  var OPTIONAL = ['Tag Print Name', 'Qty', 'Sold On', 'Tag Date', 'Supplier'];

  // ── Helpers ──
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function toNum(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function fmtG(n) { return (Math.round(n * 1000) / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 }); }
  function fmtPlain(n) { return String(Math.round(n * 1000) / 1000); }
  function fmtInt(n) { return Number(n).toLocaleString('en-IN'); }
  function fmtWhen(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDay(t) { return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function dmyDate(s) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || ''));
    return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : null;
  }
  var byNatural = function (a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); };
  function rangeLabel(r) { return fmtG(r.min_wt) + '–' + fmtG(r.max_wt) + ' g'; }
  function dateStamp() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function api(url, opts) {
    var r = await fetch(url, opts);
    var body = await r.json().catch(function () { return null; });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('Session expired'); }
    if (!r.ok) throw new Error((body && body.error) || 'HTTP ' + r.status);
    return body;
  }
  function jsonOpts(method, data) {
    return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
  }

  // ── Excel → items per group ──
  function parseTagging(rows) {
    var hr = -1;
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
      var cells = rows[i].map(norm);
      if (cells.indexOf('tag no') !== -1 && cells.indexOf('product group') !== -1) { hr = i; break; }
    }
    if (hr === -1) return { error: 'Not a Tagging file — "Tag No" and "Product Group" headings not found.' };
    var heads = rows[hr].map(norm);
    var col = {};
    REQUIRED.concat(OPTIONAL).forEach(function (h) { col[h] = heads.indexOf(norm(h)); });
    var missing = REQUIRED.filter(function (h) { return col[h] === -1; });
    if (missing.length) return { error: 'Missing column(s): ' + missing.join(', ') + '.' };
    var get = function (row, h) { return col[h] === -1 ? '' : String(row[col[h]] == null ? '' : row[col[h]]).trim(); };

    var groups = {}, count = 0;
    for (var r = hr + 1; r < rows.length; r++) {
      var row = rows[r];
      var tag = get(row, 'Tag No');
      if (!tag || tag.toLowerCase() === 'total') continue;   // skip the export's Total row
      var g = get(row, 'Product Group') || '(No group)';
      var qty = Math.max(1, Math.round(toNum(get(row, 'Qty'))) || 1);
      (groups[g] = groups[g] || []).push([
        tag,
        get(row, 'Product') || '(No product)',
        get(row, 'Tag Print Name'),
        qty,
        toNum(get(row, 'Gross Wt')),
        get(row, 'Status').toUpperCase() === 'SOLD' ? 1 : 0,
        get(row, 'Sold On'),
        get(row, 'Tag Date'),
        get(row, 'Supplier')
      ]);
      count++;
    }
    if (!count) return { error: 'No tagged items found in this file.' };
    return { groups: groups, count: count };
  }

  // Read the chosen Tagging Excel, confirm, and save it (replaces those groups' stock).
  // Resolves to the list of group names saved, or null if nothing was saved.
  // setStatus(msg, ok) shows progress/errors.
  function importTagging(file, setStatus) {
    return new Promise(function (resolve) {
      if (!/\.(xlsx|xls)$/i.test(file.name)) { setStatus('Only .xlsx or .xls files are allowed.'); return resolve(null); }
      if (file.size > MAX_BYTES) { setStatus('File is larger than 15 MB.'); return resolve(null); }
      var reader = new FileReader();
      reader.onload = async function (e) {
        var parsed;
        try {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '', raw: false });
          parsed = parseTagging(rows);
        } catch (ex) {
          setStatus('Could not read this file. Make sure it is a valid Excel file.');
          return resolve(null);
        }
        if (parsed.error) { setStatus(parsed.error); return resolve(null); }
        var names = Object.keys(parsed.groups).sort(byNatural);
        if (!(await window.confirmModal('This file has ' + fmtInt(parsed.count) + ' tags in ' + names.length + ' group(s):\n\n' +
                     names.join(', ') + '\n\nStock data for these groups will be replaced. Other groups stay as they are.'))) return resolve(null);
        setStatus('Saving…', true);
        try {
          await api('/api/restock/upload', jsonOpts('POST', { file_name: file.name, groups: parsed.groups }));
          setStatus('Imported ' + file.name + ' — ' + names.length + ' group(s) updated.', true);
          resolve(names);
        } catch (err) {
          setStatus('Import failed: ' + err.message);
          resolve(null);
        }
      };
      reader.onerror = function () { setStatus('Could not read this file.'); resolve(null); };
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Model ──
  // Targets: how many to keep is set from sales, see suggest().
  var COVER_MONTHS = 1.5, RATE_DAYS = 180, MIN_WINDOW = 30, MAX_TARGET = 10, SPARE_FROM = 2;
  var DAY = 86400000, MONTH_DAYS = 365.25 / 12;
  var SALES_FROM = new Date(2026, 5, 14).getTime();   // first Sold On in the billing software
  var salesFrom = SALES_FROM;                          // earlier if an upload has older sales

  // stockGroups: [{ group_name, uploaded_at, items }], targets: [{ id, group_name, product, min_wt, max_wt, qty }]
  // → { [product]: model }
  function build(stockGroups, targets) {
    var products = {};
    salesFrom = SALES_FROM;
    function get(key, group) {
      return products[key] || (products[key] = { key: key, group: group, printNames: {}, suppliers: {}, lastSupplier: '', lastSupplierAt: null, stock: [], sold: [], ranges: [], asOf: null, firstTag: null });
    }
    stockGroups.forEach(function (sg) {
      var up = new Date(sg.uploaded_at), asOf = new Date(up.getFullYear(), up.getMonth(), up.getDate()).getTime();
      sg.items.forEach(function (it) {
        var p = get(it[I.PRODUCT], sg.group_name);
        if (p.asOf == null || asOf > p.asOf) p.asOf = asOf;
        var td = dmyDate(it[I.DATE]);
        if (td != null && (p.firstTag == null || td < p.firstTag)) p.firstTag = td;
        var so = it[I.SOLD] ? dmyDate(it[I.SOLD_ON]) : null;
        if (so != null && so < salesFrom) salesFrom = so;
        if (it[I.PRINT]) p.printNames[it[I.PRINT]] = 1;
        if (it[I.SUPPLIER]) {
          p.suppliers[it[I.SUPPLIER]] = 1;
          // The supplier it was most recently tagged from = who to reorder from
          var tk = td == null ? -1 : td;
          if (p.lastSupplierAt == null || tk >= p.lastSupplierAt) { p.lastSupplier = it[I.SUPPLIER]; p.lastSupplierAt = tk; }
        }
        var per = it[I.WT] / (it[I.QTY] || 1);
        for (var k = 0; k < (it[I.QTY] || 1); k++) {
          var piece = { tag: it[I.TAG], wt: per, soldOn: it[I.SOLD_ON], date: it[I.DATE], supplier: it[I.SUPPLIER] };
          (it[I.SOLD] ? p.sold : p.stock).push(piece);
        }
      });
    });
    targets.forEach(function (t) { get(t.product, t.group_name).ranges.push(t); });
    Object.keys(products).forEach(function (k) { compute(products[k]); });
    return products;
  }

  // Each in-stock piece fills the first range its weight falls in.
  function compute(p) {
    p.ranges.sort(function (a, b) { return a.min_wt - b.min_wt || a.max_wt - b.max_wt; });
    p.stock.sort(function (a, b) { return a.wt - b.wt; });
    p.sold.sort(function (a, b) { return a.wt - b.wt; });
    var have = p.ranges.map(function () { return 0; });
    p.outside = [];
    p.stock.forEach(function (s) {
      var w = Math.round(s.wt * 1000) / 1000;
      var i = p.ranges.findIndex(function (r) { return w >= r.min_wt && w <= r.max_wt; });
      if (i === -1) { p.outside.push(s); s.inRange = false; } else { have[i]++; s.inRange = true; }
    });
    p.rangeStats = p.ranges.map(function (r, i) { return { r: r, have: have[i], need: Math.max(0, r.qty - have[i]) }; });
    p.target = p.ranges.reduce(function (s, r) { return s + r.qty; }, 0);
    p.need = p.rangeStats.reduce(function (s, x) { return s + x.need; }, 0);
    p.state = !p.ranges.length ? 'none' : p.need > 0 ? 'need' : 'ok';
  }

  // ── Auto-calculate target ranges ──
  // How many to keep: pieces sold in the sales window → sales per month,
  // × COVER_MONTHS of stock, kept within 1..10. The window is the last 180 days
  // up to the upload date, but never before sales history starts (SALES_FROM),
  // nor before the product was first tagged (min MIN_WINDOW days). Days count inclusive.
  // Which weights: sold weights are grouped into ranges; each sale scores more
  // when it is recent (Sold On) and when it sold fast (Sold On − Tag Date),
  // and the total qty is shared across ranges by score.
  // Never sold → one piece around the in-stock weights.
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  function suggest(p) {
    var now = p.asOf != null ? p.asOf : Date.now();
    var sold = p.sold.filter(function (s) { return s.wt > 0; });
    var points, total, info;
    if (sold.length) {
      var from = Math.max(now - (RATE_DAYS - 1) * DAY, salesFrom), why = 'sales';
      if (from === now - (RATE_DAYS - 1) * DAY) why = 'cap';
      if (p.firstTag != null && p.firstTag > from) { from = p.firstTag; why = 'tagged'; }
      if (now - from < (MIN_WINDOW - 1) * DAY) { from = now - (MIN_WINDOW - 1) * DAY; why = 'min'; }
      var days = Math.round((now - from) / DAY) + 1;
      var recent = 0, speeds = [];
      points = sold.map(function (s) {
        var so = dmyDate(s.soldOn), td = dmyDate(s.date);
        var age = so != null ? (now - so) / DAY : null;
        var dts = so != null && td != null ? Math.max(0, (so - td) / DAY) : null;
        if (so != null && so >= from && so <= now) recent++;
        if (dts != null) speeds.push(dts);
        var rec = age == null ? 0.3 : age <= 90 ? 1 : age <= 180 ? 0.6 : age <= 365 ? 0.35 : 0.15;
        var spd = dts == null ? 1 : dts <= 15 ? 1.5 : dts <= 45 ? 1.2 : dts <= 90 ? 1 : 0.7;
        return { wt: s.wt, score: rec * spd };
      });
      var months = days / MONTH_DAYS, perMonth = recent / months;
      // Repeat sellers keep one spare: for a 2nd piece of the same model, or when one is damaged
      var base = Math.max(1, Math.round(perMonth * COVER_MONTHS)), spare = recent >= SPARE_FROM ? 1 : 0;
      total = Math.min(MAX_TARGET, base + spare);
      info = { basis: 'sold', sold: sold.length, recent: recent, from: from, to: now, days: days, months: months, why: why,
               perMonth: perMonth, medianDays: median(speeds), base: base, spare: spare, total: total };
    } else {
      points = p.stock.filter(function (s) { return s.wt > 0; }).map(function (s) { return { wt: s.wt, score: 1 }; });
      if (!points.length) return null;
      total = 1;
      info = { basis: 'stock', sold: 0, total: 1 };
    }
    points.sort(function (a, b) { return a.wt - b.wt; });

    // Group neighbouring weights; start a new range on a gap or when it gets too wide to order from
    var clusters = [[points[0]]];
    for (var i = 1; i < points.length; i++) {
      var prev = points[i - 1].wt, start = clusters[clusters.length - 1][0].wt, w = points[i].wt;
      if (w - prev > Math.max(6, prev * 0.07) || w - start > Math.max(10, start * 0.1)) clusters.push([]);
      clusters[clusters.length - 1].push(points[i]);
    }
    // Share `total` across ranges by score (largest remainder, so it adds up exactly)
    var cs = clusters.map(function (c) {
      return { lo: c[0].wt, hi: c[c.length - 1].wt, score: c.reduce(function (s, x) { return s + x.score; }, 0) };
    });
    var sum = cs.reduce(function (s, c) { return s + c.score; }, 0) || 1;
    cs.forEach(function (c) { var exact = c.score / sum * total; c.qty = Math.floor(exact); c.rem = exact - c.qty; });
    var left = total - cs.reduce(function (s, c) { return s + c.qty; }, 0);
    cs.slice().sort(function (a, b) { return b.rem - a.rem || b.score - a.score; }).slice(0, left).forEach(function (c) { c.qty++; });
    var out = cs.filter(function (c) { return c.qty > 0; });

    var ranges = out.map(function (c) { return { min_wt: Math.max(0, Math.floor(c.lo) - 2), max_wt: Math.ceil(c.hi) + 2, qty: c.qty, lo: c.lo, hi: c.hi }; });
    for (var k = 1; k < ranges.length; k++) {
      if (ranges[k].min_wt <= ranges[k - 1].max_wt) {
        var mid = Math.round((ranges[k - 1].hi + ranges[k].lo) / 2);
        ranges[k - 1].max_wt = mid;
        ranges[k].min_wt = mid + 1 <= ranges[k].lo ? mid + 1 : mid;
      }
    }
    return { info: info, ranges: ranges.map(function (r) { return { min_wt: r.min_wt, max_wt: r.max_wt, qty: r.qty }; }) };
  }

  function calcText(info) {
    if (!info) return 'No sold or in-stock weights to calculate from.';
    if (info.basis === 'stock') return 'Never sold in the uploaded data → keep 1 piece around the in-stock weight.';
    var exact = info.perMonth * COVER_MONTHS;
    var since = { sales: ' (sales history starts ' + fmtDay(info.from) + ')', tagged: ' (first tagged ' + fmtDay(info.from) + ')',
                  min: ' (new product — counted over at least ' + MIN_WINDOW + ' days)', cap: ' (last ' + RATE_DAYS + ' days)' }[info.why];
    var t = info.recent + ' sold from ' + fmtDay(info.from) + ' to ' + fmtDay(info.to) + since + ' = ' + info.days + ' days = ' +
            round1(info.months) + (round1(info.months) === 1 ? ' month → ' : ' months → ') + round1(info.perMonth) + ' per month × ' + COVER_MONTHS + ' months = ' +
            round1(exact) + ' → ' + info.base + (Math.round(exact) < 1 ? ' (min 1)' : '') +
            (info.spare ? ' + 1 spare' : '') + ' = <b>' + info.total + (info.total === 1 ? ' pc' : ' pcs') + '</b>' +
            (info.base + info.spare > MAX_TARGET ? ' (max ' + MAX_TARGET + ')' : '');
    if (info.medianDays != null) t += ' · usually sells in <b>' + Math.round(info.medianDays) + ' days</b>';
    t += ' · ' + info.sold + ' sold in total';
    return t;
  }

  // Fill ranges for every product that has none (and was never auto-filled),
  // or with replace=true recalculate the given products.
  async function autoFill(list, replace) {
    var items = [];
    list.forEach(function (p) {
      if (!replace && p.ranges.length) return;
      var s = suggest(p);
      if (s && s.ranges.length) items.push({ group_name: p.group, product: p.key, ranges: s.ranges });
    });
    if (!items.length) return 0;
    var res = await api('/api/restock/auto-fill', jsonOpts('POST', { replace: !!replace, items: items }));
    return res.filled;
  }

  window.RestockCore = {
    esc: esc, norm: norm, toNum: toNum, fmtG: fmtG, fmtPlain: fmtPlain, fmtInt: fmtInt, fmtWhen: fmtWhen,
    byNatural: byNatural, rangeLabel: rangeLabel, dateStamp: dateStamp,
    api: api, jsonOpts: jsonOpts, importTagging: importTagging,
    build: build, compute: compute, suggest: suggest, calcText: calcText, autoFill: autoFill
  };
})();
