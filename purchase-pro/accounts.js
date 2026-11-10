// Purchase Pro — supplier accounts (money + weight), matching, ledger,
// dashboard and checker. Nothing here is stored: every number is worked out
// fresh from the live entries, so editing / deleting an entry can never leave
// a stale match behind.
//
// Matching rule (same for money and weight):
//   1. a payment / receipt first goes to the bills / issues it was linked to,
//   2. whatever is left goes to the OLDEST open bill / issue first,
//   3. anything still left is an advance (money) or excess (weight) that the
//      next bill / issue will use up automatically.

const EPS_M = 0.005, EPS_W = 0.0005;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
const parseIds = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.map(Number) : []; } catch { return []; } };
const SIGN = { PURCHASE: 1, EXPENSE: 1, HALLMARK: 1, LABOUR: 1, CREDIT_NOTE: -1, DEBIT_NOTE: -1 };

// debits / credits: [{ key, date, seq, amount, pins? }]
function allocate(debits, credits, eps) {
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq);
  debits = debits.slice().sort(byDate);
  credits = credits.slice().sort(byDate);
  const dRem = new Map(debits.map(d => [d.key, d.amount]));
  const cRem = new Map(credits.map(c => [c.key, c.amount]));
  const links = [];
  const take = (c, dKey) => {
    const amt = Math.min(cRem.get(c.key), dRem.get(dKey) || 0);
    if (amt <= eps) return;
    cRem.set(c.key, cRem.get(c.key) - amt);
    dRem.set(dKey, dRem.get(dKey) - amt);
    links.push({ c: c.key, d: dKey, amount: amt });
  };
  for (const c of credits) for (const k of c.pins || []) if (dRem.has(k) && cRem.get(c.key) > eps) take(c, k);
  for (const c of credits) for (const d of debits) { if (cRem.get(c.key) <= eps) break; take(c, d.key); }
  return { dRem, cRem, links };
}

function computeParty(e, today) {
  // ── Money ──
  const md = [], mc = [];
  const op = e.opening;
  if (op && op.money > 0) md.push({ key: 'o', date: op.as_of, seq: 0, amount: op.money });
  if (op && op.money < 0) mc.push({ key: 'o', date: op.as_of, seq: 0, amount: -op.money });
  for (const b of e.bills) {
    if (SIGN[b.kind] > 0) md.push({ key: 'b' + b.id, date: b.bill_date, seq: b.id, amount: b.net });
    else mc.push({ key: 'b' + b.id, date: b.bill_date, seq: b.id, amount: b.net, pins: b.ref_bill_id ? ['b' + b.ref_bill_id] : [] });
  }
  for (const p of e.payments) {
    if (p.direction === 'RECEIVED') md.push({ key: 'p' + p.id, date: p.pay_date, seq: p.id, amount: p.amount });
    else mc.push({ key: 'p' + p.id, date: p.pay_date, seq: p.id, amount: r2(p.amount + p.round_off), pins: parseIds(p.bill_ids).map(id => 'b' + id) });
  }
  const m = allocate(md, mc, EPS_M);
  const money = r2(md.reduce((s, x) => s + x.amount, 0) - mc.reduce((s, x) => s + x.amount, 0));

  // ── Weight ──
  const wd = [], wc = [];
  if (op && op.weight > 0) wd.push({ key: 'o', date: op.as_of, seq: 0, amount: op.weight });
  if (op && op.weight < 0) wc.push({ key: 'o', date: op.as_of, seq: 0, amount: -op.weight });
  for (const i of e.issues) wd.push({ key: 'i' + i.id, date: i.issue_date, seq: i.id, amount: i.net_wt });
  for (const r of e.receipts) wc.push({ key: 'r' + r.id, date: r.receipt_date, seq: r.id, amount: r.net_wt, pins: parseIds(r.issue_ids).map(id => 'i' + id) });
  const w = allocate(wd, wc, EPS_W);
  const weight = r3(wd.reduce((s, x) => s + x.amount, 0) - wc.reduce((s, x) => s + x.amount, 0));

  const linkLabel = (key) => {
    if (key === 'o') return 'Opening balance';
    const id = Number(key.slice(1));
    if (key[0] === 'b') { const b = e.bills.find(x => x.id === id); return b ? `Bill ${b.bill_no}` : key; }
    if (key[0] === 'p') { const p = e.payments.find(x => x.id === id); return p ? `Payment ${p.pay_date}` : key; }
    if (key[0] === 'i') { const i = e.issues.find(x => x.id === id); return i ? `Issue ${i.issue_no}` : key; }
    if (key[0] === 'r') { const r = e.receipts.find(x => x.id === id); return r ? `Receipt ${r.receipt_no || r.receipt_date}` : key; }
    return key;
  };
  const linksFor = (links, key, side) => links.filter(l => l[side] === key).map(l => ({ to: linkLabel(side === 'd' ? l.c : l.d), key: side === 'd' ? l.c : l.d, amount: l.amount }));

  const bills = e.bills.map(b => {
    const key = 'b' + b.id;
    if (SIGN[b.kind] > 0) {
      const due = r2(Math.max(0, m.dRem.get(key)));
      return { ...b, sign: 1, paid: r2(b.net - due), due, status: due <= EPS_M ? 'PAID' : due < b.net - EPS_M ? 'PARTIAL' : 'UNPAID', days: daysBetween(b.bill_date, today), links: linksFor(m.links, key, 'd') };
    }
    const unused = r2(Math.max(0, m.cRem.get(key)));
    return { ...b, sign: -1, used: r2(b.net - unused), unused, status: unused <= EPS_M ? 'USED' : 'OPEN', links: linksFor(m.links, key, 'c') };
  });
  const payments = e.payments.map(p => {
    const key = 'p' + p.id;
    if (p.direction === 'RECEIVED') return { ...p, used: p.amount, unused: 0, links: [] };
    const total = r2(p.amount + p.round_off);
    const unused = r2(Math.max(0, m.cRem.get(key)));
    return { ...p, total, used: r2(total - unused), unused, days: daysBetween(p.pay_date, today), links: linksFor(m.links, key, 'c') };
  });
  const issues = e.issues.map(i => {
    const key = 'i' + i.id;
    const remaining = r3(Math.max(0, w.dRem.get(key)));
    return { ...i, received: r3(i.net_wt - remaining), remaining, status: remaining <= EPS_W ? 'RECEIVED' : remaining < i.net_wt - EPS_W ? 'PARTIAL' : 'OPEN', days: daysBetween(i.issue_date, today), links: linksFor(w.links, key, 'd') };
  });
  const receipts = e.receipts.map(r => {
    const key = 'r' + r.id;
    const extra = r3(Math.max(0, w.cRem.get(key)));
    return { ...r, extra, links: linksFor(w.links, key, 'c') };
  });

  const open = bills.filter(b => b.sign > 0 && b.due > EPS_M);
  const buckets = { d30: 0, d60: 0, d60p: 0 };
  for (const b of open) { if (b.days <= 30) buckets.d30 += b.due; else if (b.days <= 60) buckets.d60 += b.due; else buckets.d60p += b.due; }
  const advance = r2([...m.cRem.values()].reduce((s, v) => s + Math.max(0, v), 0));
  return {
    money, weight, advance, due: r2(open.reduce((s, b) => s + b.due, 0)), buckets: { d30: r2(buckets.d30), d60: r2(buckets.d60), d60p: r2(buckets.d60p) },
    open_bills: open.length, oldest_due: open.length ? open.reduce((a, b) => (a.bill_date < b.bill_date ? a : b)).bill_date : null,
    open_issues: issues.filter(i => i.remaining > EPS_W).length,
    bills, payments, issues, receipts,
  };
}

// Chronological statement with running balances. Money: + = we owe them.
function ledgerRows(e, c, from, to) {
  const rows = [];
  const op = e.opening;
  if (op) rows.push({ date: op.as_of, ord: 0, type: 'OPENING', ref: 'Opening balance', debit: Math.max(0, op.money), credit: Math.max(0, -op.money), w_out: Math.max(0, op.weight), w_in: Math.max(0, -op.weight), note: op.notes });
  const KL = { PURCHASE: 'Purchase bill', EXPENSE: 'Expense bill', HALLMARK: 'Hallmark bill', LABOUR: 'Labour bill', CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note' };
  for (const b of c.bills) {
    rows.push({
      date: b.bill_date, ord: 1, seq: b.id, type: 'BILL', id: b.id, ref: `${KL[b.kind]} ${b.bill_no}`,
      debit: b.sign > 0 ? b.net : 0, credit: b.sign < 0 ? b.net : 0, w_out: 0, w_in: 0,
      note: [b.net_wt ? `${r3(b.net_wt)} g` : '', b.tds ? `TDS ₹${r2(b.tds)}` : ''].filter(Boolean).join(' · '),
      status: b.status, due: b.due,
    });
  }
  for (const p of c.payments) {
    const mode = [p.mode, p.reference].filter(Boolean).join(' · ');
    if (p.direction === 'RECEIVED') rows.push({ date: p.pay_date, ord: 2, seq: p.id, type: 'RECEIVED', id: p.id, ref: 'Money received', debit: p.amount, credit: 0, w_out: 0, w_in: 0, note: mode });
    else {
      rows.push({ date: p.pay_date, ord: 2, seq: p.id, type: 'PAYMENT', id: p.id, ref: 'Payment', debit: 0, credit: p.amount, w_out: 0, w_in: 0, note: mode });
      if (p.round_off) rows.push({ date: p.pay_date, ord: 2, seq: p.id + 0.5, type: 'ROUNDOFF', id: p.id, ref: 'Round off', debit: 0, credit: p.round_off, w_out: 0, w_in: 0, note: '' });
    }
  }
  for (const i of c.issues) rows.push({ date: i.issue_date, ord: 3, seq: i.id, type: 'ISSUE', id: i.id, ref: `Issue ${i.issue_no}`, debit: 0, credit: 0, w_out: i.net_wt, w_in: 0, note: [i.item_type, i.description].filter(Boolean).join(' · ') });
  for (const r of c.receipts) rows.push({ date: r.receipt_date, ord: 4, seq: r.id, type: 'RECEIPT', id: r.id, ref: `Receipt ${r.receipt_no || ''}`.trim(), debit: 0, credit: 0, w_out: 0, w_in: r.net_wt, note: '' });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ord - b.ord || (a.seq || 0) - (b.seq || 0)));

  let bal = 0, wbal = 0;
  const outRows = [];
  let bfM = 0, bfW = 0, hasBf = false;
  for (const r of rows) {
    bal = r2(bal + r.debit - r.credit);
    wbal = r3(wbal + r.w_out - r.w_in);
    if (from && r.date < from) { bfM = bal; bfW = wbal; hasBf = true; continue; }
    if (to && r.date > to) continue;
    outRows.push({ ...r, balance: bal, w_balance: wbal });
  }
  if (hasBf) outRows.unshift({ date: from, type: 'BF', ref: 'Balance brought forward', debit: 0, credit: 0, w_out: 0, w_in: 0, balance: bfM, w_balance: bfW });
  return outRows;
}

function registerAccounts({ api, db, firms, control }) {
  const firmIds = new Set(firms.map(f => f.id));

  // Load every live entry for a firm (optionally one party), grouped by party.
  async function loadFirm(firm, partyId) {
    const pw = partyId ? ' AND party_id = ?' : '';
    const a = partyId ? [firm, partyId] : [firm];
    const q = (sql) => db.execute({ sql, args: a }).then(r => r.rows);
    const [bills, payments, issues, receipts, openings] = await Promise.all([
      q(`SELECT id, firm, party_id, kind, bill_no, bill_date, ref_bill_id, taxable, other_charges, cgst, sgst, igst, total, tds, net, net_wt, photos, notes FROM pp_bills WHERE deleted_at IS NULL AND firm = ?${pw}`),
      q(`SELECT * FROM pp_payments WHERE deleted_at IS NULL AND firm = ?${pw}`),
      q(`SELECT * FROM pp_issues WHERE deleted_at IS NULL AND firm = ?${pw}`),
      q(`SELECT * FROM pp_receipts WHERE deleted_at IS NULL AND firm = ?${pw}`),
      q(`SELECT * FROM pp_openings WHERE deleted_at IS NULL AND firm = ?${pw}`),
    ]);
    const by = new Map();
    const g = (pid) => { if (!by.has(pid)) by.set(pid, { bills: [], payments: [], issues: [], receipts: [], opening: null }); return by.get(pid); };
    if (partyId) g(Number(partyId));
    for (const b of bills) { try { b.photos = JSON.parse(b.photos || '[]'); } catch { b.photos = []; } g(b.party_id).bills.push(b); }
    for (const p of payments) g(p.party_id).payments.push(p);
    for (const i of issues) g(i.party_id).issues.push(i);
    for (const r of receipts) g(r.party_id).receipts.push(r);
    for (const o of openings) g(o.party_id).opening = o;
    return by;
  }
  async function partiesMap() {
    const r = await db.execute('SELECT id, name, alias, city, types, gstin, pan, phone, tds_mode, deleted_at FROM pp_parties');
    const m = new Map();
    for (const p of r.rows) { try { p.types = JSON.parse(p.types || '[]'); } catch { p.types = []; } m.set(Number(p.id), p); }
    return m;
  }
  const strip = (c) => { const { bills, payments, issues, receipts, ...rest } = c; return rest; };

  api.get('/accounts', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      const [by, parties] = await Promise.all([loadFirm(firm), partiesMap()]);
      const today = todayIST();
      const out = [];
      for (const [pid, p] of parties) {
        const e = by.get(pid);
        if (p.deleted_at && !e) continue;
        const c = e ? computeParty(e, today) : null;
        out.push({ party_id: pid, name: p.name, alias: p.alias, city: p.city, types: p.types, phone: p.phone, deleted: !!p.deleted_at, active: !!e, ...(c ? strip(c) : { money: 0, weight: 0, advance: 0, due: 0, buckets: { d30: 0, d60: 0, d60p: 0 }, open_bills: 0, oldest_due: null, open_issues: 0 }) });
      }
      out.sort((a, b) => b.active - a.active || Math.abs(b.money) - Math.abs(a.money) || a.name.localeCompare(b.name));
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/accounts/:party', async (req, res) => {
    try {
      const firm = Number(req.query.firm), pid = Number(req.params.party);
      if (!firmIds.has(firm) || !pid) return res.status(400).json({ error: 'Pick the firm and supplier.' });
      const [by, parties] = await Promise.all([loadFirm(firm, pid), partiesMap()]);
      const p = parties.get(pid);
      if (!p) return res.status(404).json({ error: 'Supplier not found.' });
      const e = by.get(pid);
      const c = computeParty(e, todayIST());
      const conf = await db.execute({ sql: 'SELECT * FROM pp_confirmations WHERE firm = ? AND party_id = ? ORDER BY id DESC LIMIT 1', args: [firm, pid] });
      res.json({
        party: p, ...c, opening: e.opening,
        ledger: ledgerRows(e, c, req.query.from || null, req.query.to || null),
        last_confirmation: conf.rows[0] || null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Every TDS-able bill in date order with what TDS should have been.
  function tdsMissed(by, parties, tmap) {
    const out = [];
    for (const [pid, e] of by) {
      const p = parties.get(pid); if (!p) continue;
      const bills = e.bills.filter(b => control.KIND_SECTION[b.kind]).sort((a, b) => (a.bill_date < b.bill_date ? -1 : a.bill_date > b.bill_date ? 1 : a.id - b.id));
      const cum = {};
      for (const b of bills) {
        const sec = control.KIND_SECTION[b.kind];
        const fy = control.fyOf(b.bill_date).label;
        const k = sec + fy;
        const amount = r2(b.taxable);
        const calc = control.tdsCalc({ kind: b.kind, mode: p.tds_mode, pan: p.pan, prior: cum[k] || 0, amount, q: control.qSync(b.bill_date, tmap || {}) });
        cum[k] = (cum[k] || 0) + amount;
        if ((p.tds_mode === 'ALWAYS' || calc.required) && calc.suggested > 0 && !(b.tds > 0)) out.push({ ...b, party_name: p.name, suggested: calc.suggested, reason: calc.reason });
      }
    }
    return out;
  }

  api.get('/checker', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      const [by, parties, checks] = await Promise.all([loadFirm(firm), partiesMap(), control.checksMap()]);
      const today = todayIST();
      const name = (pid) => parties.get(pid)?.name || '—';
      const chk = (ent, id) => checks[`${ent}:${id}`] || null;
      const noBill = [], openIssues = [], noPhoto = [];
      for (const [pid, e] of by) {
        const c = computeParty(e, today);
        for (const p of c.payments) if (p.direction === 'PAID' && p.unused > 1 && p.days >= 7) noBill.push({ id: p.id, party_id: pid, party_name: name(pid), date: p.pay_date, days: p.days, amount: p.total, unused: p.unused, mode: p.mode, check: chk('payment', p.id) });
        for (const i of c.issues) if (i.remaining > EPS_W) openIssues.push({ id: i.id, party_id: pid, party_name: name(pid), date: i.issue_date, days: i.days, issue_no: i.issue_no, net_wt: i.net_wt, remaining: i.remaining, status: i.status, check: chk('issue', i.id) });
        for (const b of e.bills) if (!b.photos.length) noPhoto.push({ id: b.id, party_id: pid, party_name: name(pid), date: b.bill_date, days: daysBetween(b.bill_date, today), bill_no: b.bill_no, kind: b.kind, net: b.net, check: chk('bill_photo', b.id) });
      }
      const tds = tdsMissed(by, parties, await control.turnoverMap(firm)).map(b => ({ id: b.id, party_id: b.party_id, party_name: b.party_name, date: b.bill_date, bill_no: b.bill_no, kind: b.kind, amount: r2(b.taxable), suggested: b.suggested, reason: b.reason, check: chk('bill_tds', b.id) }));
      const byDays = (a, b) => b.days - a.days;
      res.json({ no_bill: noBill.sort(byDays), open_issues: openIssues.sort(byDays), no_photo: noPhoto.sort(byDays), tds_missed: tds.sort((a, b) => (a.date < b.date ? -1 : 1)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/dashboard', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      const [by, parties] = await Promise.all([loadFirm(firm), partiesMap()]);
      const today = todayIST(), month = today.slice(0, 7);
      const t = { payable: 0, advance_given: 0, due: 0, d30: 0, d60: 0, d60p: 0, weight_out: 0, bills_month: 0, bills_month_value: 0, paid_month: 0, no_photo: 0, open_issues: 0, unmatched_pay: 0 };
      const dues = [], workers = [];
      for (const [pid, e] of by) {
        const c = computeParty(e, today);
        const nm = parties.get(pid)?.name || '—';
        if (c.money > EPS_M) t.payable += c.money; else if (c.money < -EPS_M) t.advance_given += -c.money;
        t.due += c.due; t.d30 += c.buckets.d30; t.d60 += c.buckets.d60; t.d60p += c.buckets.d60p;
        if (c.weight > EPS_W) { t.weight_out += c.weight; workers.push({ party_id: pid, name: nm, weight: c.weight, open_issues: c.open_issues }); }
        for (const b of e.bills) {
          if (!b.photos.length) t.no_photo++;
          if (b.bill_date.slice(0, 7) === month && SIGN[b.kind] > 0) { t.bills_month++; t.bills_month_value += b.net; }
        }
        for (const p of c.payments) {
          if (p.pay_date.slice(0, 7) === month && p.direction === 'PAID') t.paid_month += p.amount;
          if (p.direction === 'PAID' && p.unused > 1 && p.days >= 7) t.unmatched_pay++;
        }
        t.open_issues += c.open_issues;
        if (c.money > EPS_M) dues.push({ party_id: pid, name: nm, money: c.money, due: c.due, d60p: c.buckets.d60p, oldest_due: c.oldest_due, open_bills: c.open_bills });
      }
      for (const k of Object.keys(t)) t[k] = k.includes('weight') ? r3(t[k]) : r2(t[k]);
      t.tds_missed = tdsMissed(by, parties, await control.turnoverMap(firm)).length;
      const recent = await db.execute('SELECT * FROM pp_audit ORDER BY id DESC LIMIT 12');
      res.json({ totals: t, top_dues: dues.sort((a, b) => b.money - a.money).slice(0, 10), workers: workers.sort((a, b) => b.weight - a.weight).slice(0, 10), recent: recent.rows, today });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return {};
}

module.exports = { registerAccounts, computeParty, allocate };
