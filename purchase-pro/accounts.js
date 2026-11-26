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
  // Labour bill linked to issue vouchers = weight received back (bill net wt)
  for (const b of e.bills) if (b.kind === 'LABOUR' && b.net_wt > 0 && parseIds(b.issue_ids).length) wc.push({ key: 'b' + b.id, date: b.bill_date, seq: b.id, amount: b.net_wt, pins: parseIds(b.issue_ids).map(id => 'i' + id) });
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

// Silver or gold, from the issue voucher's item type / description / number
// (e.g. "OLD SILVER", "OSIV/NOV26/2"). Everything else counts as gold.
function metalOf(i) {
  const s = `${i.item_type || ''} ${i.description || ''} ${i.issue_no || ''}`.toUpperCase();
  return /SILVER|\bSLV\b|\bSL\b|(^|\s)O?SIV\b|\bOSIV\//.test(s) ? 'SILVER' : 'GOLD';
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
      debit: b.sign > 0 ? b.net : 0, credit: b.sign < 0 ? b.net : 0, w_out: 0,
      w_in: b.kind === 'LABOUR' && b.net_wt > 0 && parseIds(b.issue_ids).length ? b.net_wt : 0,
      note: [b.net_wt ? `${r3(b.net_wt)} g` : '', b.tds ? `TDS ₹${r2(b.tds)}` : ''].filter(Boolean).join(' · '),
      status: b.status, due: b.due,
    });
  }
  for (const p of c.payments) {
    let parts = []; try { parts = JSON.parse(p.parts || '[]'); } catch {}
    const mode = parts.length > 1 ? parts.map(x => [`${x.mode} ₹${r2(x.amount)}`, x.reference].filter(Boolean).join(' ')).join(' + ') : [p.mode, p.reference].filter(Boolean).join(' · ');
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
  // MC (making charges) is our own issue → MC bill (receipt) cycle: "OTHERS" issue vouchers and MC bills.
  // It lives only in the MC section, so every list / total here leaves MC parties out unless asked.
  const isMcEntry = (e) => e.bills.some(b => Number(b.is_mc) === 1) || e.issues.some(i => String(i.item_type || '').toUpperCase() === 'OTHERS');
  async function loadFirm(firm, partyId, withMc = false) {
    const pw = partyId ? ' AND party_id = ?' : '';
    const a = partyId ? [firm, partyId] : [firm];
    const q = (sql) => db.execute({ sql, args: a }).then(r => r.rows);
    const [bills, payments, issues, receipts, openings] = await Promise.all([
      q(`SELECT id, firm, party_id, kind, bill_no, bill_date, ref_bill_id, taxable, other_charges, cgst, sgst, igst, total, tds, net, net_wt, photos, notes, accounted_at, issue_ids, is_mc FROM pp_bills WHERE deleted_at IS NULL AND firm = ?${pw}`),
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
    if (!partyId && !withMc) for (const [pid, e] of [...by]) if (isMcEntry(e)) by.delete(pid);
    return by;
  }
  async function partiesMap() {
    const r = await db.execute('SELECT id, name, alias, city, types, gstin, pan, phone, tds_mode, state_code, deleted_at FROM pp_parties');
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
      const cum = {}, had = {};
      for (const b of bills) {
        const sec = control.KIND_SECTION[b.kind];
        const fy = control.fyOf(b.bill_date).label;
        const k = sec + fy;
        const amount = r2(b.taxable);
        const calc = control.tdsCalc({ kind: b.kind, mode: p.tds_mode, pan: p.pan, prior: cum[k] || 0, amount, q: control.qSync(b.bill_date, tmap || {}), hadTds: had[sec] || null });
        cum[k] = (cum[k] || 0) + amount;
        if (b.tds > 0 && !had[sec]) had[sec] = b; // from here on, this supplier's bills need TDS
        if ((p.tds_mode === 'ALWAYS' || calc.required) && calc.suggested > 0 && !(b.tds > 0)) out.push({ ...b, party_name: p.name, suggested: calc.suggested, reason: calc.reason });
      }
    }
    return out;
  }

  const monthEndOf = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
  const prevMonth = (d) => { let y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };

  // Everything that could mean a bill is missing / not filed.
  // upto: only items dated on/before this day. confMonth: month whose supplier statements must be matched.
  async function collectPending(firm, upto, confMonth) {
    const [by, parties, checks] = await Promise.all([loadFirm(firm), partiesMap(), control.checksMap()]);
    const today = todayIST();
    const name = (pid) => parties.get(pid)?.name || '—';
    const chk = (ent, id) => checks[`${ent}:${id}`] || null;
    const confEnd = monthEndOf(confMonth);
    const confs = (await db.execute({ sql: 'SELECT party_id, MAX(as_of) AS as_of FROM pp_confirmations WHERE firm = ? GROUP BY party_id', args: [firm] })).rows;
    const lastConf = new Map(confs.map(c => [Number(c.party_id), c.as_of]));
    const out = { no_bill: [], open_issues: [], no_photo: [], not_accounted: [], not_confirmed: [], tds_missed: [], unusual: [] };
    for (const [pid, e] of by) {
      const c = computeParty(e, today);
      for (const p of c.payments) if (p.direction === 'PAID' && p.unused > 1 && p.days >= 7 && p.pay_date <= upto) out.no_bill.push({ id: p.id, party_id: pid, party_name: name(pid), date: p.pay_date, days: p.days, amount: p.total, unused: p.unused, mode: p.mode, check: chk('payment', p.id) });
      for (const i of c.issues) if (i.remaining > EPS_W && i.issue_date <= upto) out.open_issues.push({ id: i.id, party_id: pid, party_name: name(pid), date: i.issue_date, days: i.days, issue_no: i.issue_no, metal: metalOf(i), net_wt: i.net_wt, remaining: i.remaining, status: i.status, check: chk('issue', i.id) });
      for (const b of e.bills) {
        if (b.bill_date > upto) continue;
        const row = { id: b.id, party_id: pid, party_name: name(pid), date: b.bill_date, days: daysBetween(b.bill_date, today), bill_no: b.bill_no, kind: b.kind, net: b.net };
        if (!b.photos.length) out.no_photo.push({ ...row, check: chk('bill_photo', b.id) });
        else if (!b.accounted_at) out.not_accounted.push({ ...row, check: chk('bill_acc', b.id) });
      }
      // Statement check: supplier had activity that month, or a balance at its end
      const inM = (d) => d && d.slice(0, 7) === confMonth;
      const upToEnd = { bills: e.bills.filter(b => b.bill_date <= confEnd), payments: e.payments.filter(p => p.pay_date <= confEnd), issues: e.issues.filter(i => i.issue_date <= confEnd), receipts: e.receipts.filter(r => r.receipt_date <= confEnd), opening: e.opening && e.opening.as_of <= confEnd ? e.opening : null };
      const busy = e.bills.some(b => inM(b.bill_date)) || e.payments.some(p => inM(p.pay_date)) || e.issues.some(i => inM(i.issue_date)) || e.receipts.some(r => inM(r.receipt_date));
      const atEnd = computeParty(upToEnd, confEnd);
      const conf = lastConf.get(pid);
      // MC ledgers are our own making-charge bills — there is no supplier statement to match
      const isMc = e.bills.some(b => Number(b.is_mc) === 1);
      if (!isMc && (busy || Math.abs(atEnd.money) > EPS_M || Math.abs(atEnd.weight) > EPS_W) && !(conf && conf >= confEnd)) {
        out.not_confirmed.push({ id: `${pid}:${confMonth}`, party_id: pid, party_name: name(pid), month: confMonth, money: atEnd.money, weight: atEnd.weight, last: conf || null, check: chk('confirm', `${pid}:${confMonth}`) });
      }
    }
    out.tds_missed = tdsMissed(by, parties, await control.turnoverMap(firm)).filter(b => b.bill_date <= upto).map(b => ({ id: b.id, party_id: b.party_id, party_name: b.party_name, date: b.bill_date, bill_no: b.bill_no, kind: b.kind, amount: r2(b.taxable), suggested: b.suggested, reason: b.reason, check: chk('bill_tds', b.id) }));
    out.unusual = require('./unusual').findUnusual({ by, parties, today, computeParty }).filter(x => x.date <= upto || x.rule === 'future').map(x => ({ ...x, days: daysBetween(x.date, today), check: chk('unusual', x.id) })).sort((a, b) => (a.date < b.date ? 1 : -1));
    const byDays = (a, b) => b.days - a.days;
    for (const k of ['no_bill', 'open_issues', 'no_photo', 'not_accounted']) out[k].sort(byDays);
    out.not_confirmed.sort((a, b) => a.party_name.localeCompare(b.party_name));
    out.tds_missed.sort((a, b) => (a.date < b.date ? -1 : 1));
    out.conf_month = confMonth;
    return out;
  }
  const pendingCounts = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.filter(x => !x.check).length]));

  api.get('/checker', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      const today = todayIST();
      res.json(await collectPending(firm, today, prevMonth(today)));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Month close: what is still pending for entries dated in / before that month
  async function closeCheck(firm, month) {
    const p = await collectPending(firm, monthEndOf(month), month);
    return pendingCounts(p);
  }
  control.locks.closeCheck = closeCheck;
  api.get('/close-check', async (req, res) => {
    try {
      const firm = Number(req.query.firm), month = String(req.query.month || '');
      if (!firmIds.has(firm) || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Pick firm and month.' });
      res.json(await closeCheck(firm, month));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── To collect: every open issue voucher (gold/silver still with a worker), for the phone app
  // and its home-screen widget. "Collected" is only a reminder tick (went and collected it);
  // the voucher closes for real when its labour bill / receipt is entered.
  let collectReady = null;
  const collectTable = () => collectReady || (collectReady = db.execute(`CREATE TABLE IF NOT EXISTS pp_collect (
    issue_id INTEGER PRIMARY KEY, at TEXT NOT NULL, by_id TEXT, by_name TEXT)`));
  async function collectList(firm) {
      await collectTable();
      const [by, parties, marks] = await Promise.all([loadFirm(firm), partiesMap(), db.execute('SELECT * FROM pp_collect')]);
      const mk = new Map(marks.rows.map(m => [Number(m.issue_id), m]));
      const today = todayIST(), out = [];
      for (const [pid, e] of by) {
        if (!e.issues.length) continue;
        const c = computeParty(e, today);
        for (const i of c.issues) {
          if (i.remaining <= EPS_W) continue;
          const m = mk.get(Number(i.id));
          out.push({ id: i.id, party_id: pid, party_name: parties.get(pid)?.name || '—', phone: parties.get(pid)?.phone || '', issue_no: i.issue_no, issue_date: i.issue_date, days: i.days, metal: metalOf(i), net_wt: i.net_wt, remaining: i.remaining, status: i.status, collected_at: m?.at || null, collected_by: m?.by_name || null });
        }
      }
      // not collected first, oldest first
      out.sort((a, b) => (!!a.collected_at - !!b.collected_at) || b.days - a.days || a.party_name.localeCompare(b.party_name));
      return out;
  }
  api.get('/collect', async (req, res) => {
    try {
      const firm = Number(req.query.firm) || 2;
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      res.set('Cache-Control', 'no-store').json(await collectList(firm));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  async function collectMark(id, on, user) {
    await collectTable();
    if (!on) await db.execute({ sql: 'DELETE FROM pp_collect WHERE issue_id = ?', args: [Number(id)] });
    else await db.execute({ sql: 'INSERT OR REPLACE INTO pp_collect (issue_id, at, by_id, by_name) VALUES (?,?,?,?)', args: [Number(id), new Date().toISOString(), user?.id != null ? String(user.id) : null, user?.name || null] });
  }
  api.post('/collect/:id', async (req, res) => {
    try {
      await collectTable();
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: 'Which voucher?' });
      if (req.body?.collected === false) await db.execute({ sql: 'DELETE FROM pp_collect WHERE issue_id = ?', args: [id] });
      else await db.execute({ sql: 'INSERT OR REPLACE INTO pp_collect (issue_id, at, by_id, by_name) VALUES (?,?,?,?)', args: [id, new Date().toISOString(), req.session?.userId != null ? String(req.session.userId) : null, req.session?.name || null] });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Month-end checklist: one row per supplier with every check for that month (✓ / count pending).
  api.get('/month-checklist', async (req, res) => {
    try {
      const firm = Number(req.query.firm), month = String(req.query.month || '');
      if (!firmIds.has(firm) || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Pick firm and month.' });
      const end = monthEndOf(month);
      const [p, by, parties, lock, inbox] = await Promise.all([
        collectPending(firm, end, month), loadFirm(firm), partiesMap(),
        db.execute({ sql: 'SELECT * FROM pp_month_locks WHERE firm = ? AND month = ?', args: [firm, month] }),
        db.execute({ sql: "SELECT COUNT(*) AS n FROM pp_inbox WHERE firm = ? AND status = 'new' AND created_at <= ?", args: [firm, end + 'T23:59:59'] }).catch(() => ({ rows: [{ n: 0 }] })),
      ]);
      const confs = (await db.execute({ sql: 'SELECT party_id, MAX(as_of) AS as_of FROM pp_confirmations WHERE firm = ? GROUP BY party_id', args: [firm] })).rows;
      const lastConf = new Map(confs.map(c => [Number(c.party_id), c.as_of]));
      const KEYS = ['no_photo', 'not_accounted', 'open_issues', 'no_bill', 'tds_missed', 'not_confirmed'];
      const rows = new Map();
      const row = (pid) => {
        if (!rows.has(pid)) rows.set(pid, { party_id: pid, name: parties.get(pid)?.name || '—', bills: 0, bills_value: 0, paid: 0, money: 0, weight: 0, last_conf: lastConf.get(pid) || null, ...Object.fromEntries(KEYS.map(k => [k, 0])) });
        return rows.get(pid);
      };
      const inM = (d) => d && d.slice(0, 7) === month;
      for (const [pid, e] of by) {
        const upToEnd = { bills: e.bills.filter(b => b.bill_date <= end), payments: e.payments.filter(x => x.pay_date <= end), issues: e.issues.filter(i => i.issue_date <= end), receipts: e.receipts.filter(r => r.receipt_date <= end), opening: e.opening && e.opening.as_of <= end ? e.opening : null };
        const atEnd = computeParty(upToEnd, end);
        const mb = e.bills.filter(b => inM(b.bill_date)), mp = e.payments.filter(x => inM(x.pay_date) && x.direction === 'PAID');
        const busy = mb.length || mp.length || e.issues.some(i => inM(i.issue_date)) || e.receipts.some(r => inM(r.receipt_date));
        if (!busy && Math.abs(atEnd.money) <= EPS_M && Math.abs(atEnd.weight) <= EPS_W) continue;
        const r = row(pid);
        r.bills = mb.length; r.bills_value = r2(mb.reduce((s, b) => s + (SIGN[b.kind] || 1) * (Number(b.net) || 0), 0));
        r.paid = r2(mp.reduce((s, x) => s + (Number(x.amount) || 0), 0));
        r.money = atEnd.money; r.weight = atEnd.weight;
      }
      // pending items (ones ticked Verified in Checker count as done)
      for (const k of KEYS) for (const x of p[k] || []) if (!x.check && x.party_id != null) row(Number(x.party_id))[k]++;
      const list = [...rows.values()].map(r => ({ ...r, pending: KEYS.reduce((s, k) => s + r[k], 0) }))
        .sort((a, b) => (b.pending > 0) - (a.pending > 0) || a.name.localeCompare(b.name));
      res.json({ month, end, locked: lock.rows[0] || null, inbox: Number(inbox.rows[0].n) || 0, rows: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/dashboard', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      const [by, parties] = await Promise.all([loadFirm(firm, null, true), partiesMap()]);
      const today = todayIST(), month = today.slice(0, 7);
      const t = { payable: 0, advance_given: 0, due: 0, mc_payable: 0, mc_d60p: 0, mc_count: 0, d30: 0, d60: 0, d60p: 0, weight_out: 0, gold_out: 0, silver_out: 0, bills_month: 0, bills_month_value: 0, paid_month: 0, no_photo: 0, open_issues: 0, unmatched_pay: 0 };
      const dues = [], workers = [];
      for (const [pid, e] of by) {
        const c = computeParty(e, today);
        const nm = parties.get(pid)?.name || '—';
        // MC (our own making-charge cycle) is kept out of every other figure and shown on its own
        const isMc = isMcEntry(e);
        if (isMc) {
          if (c.money > EPS_M) { t.mc_payable += c.money; t.mc_count++; dues.push({ party_id: pid, name: nm, money: c.money, due: c.due, d60p: c.buckets.d60p, oldest_due: c.oldest_due, open_bills: c.open_bills, mc: true }); }
          t.mc_d60p += c.buckets.d60p;
          continue;
        } else {
          if (c.money > EPS_M) t.payable += c.money; else if (c.money < -EPS_M) t.advance_given += -c.money;
          t.due += c.due; t.d30 += c.buckets.d30; t.d60 += c.buckets.d60; t.d60p += c.buckets.d60p;
        }
        if (c.weight > EPS_W) t.weight_out += c.weight;
        // Gold and silver kept apart: what is still pending on each open issue voucher
        for (const metal of ['GOLD', 'SILVER']) {
          const open = c.issues.filter(i => i.remaining > EPS_W && metalOf(i) === metal);
          if (!open.length) continue;
          const wt = r3(open.reduce((s, i) => s + i.remaining, 0));
          t[metal === 'GOLD' ? 'gold_out' : 'silver_out'] += wt;
          workers.push({ party_id: pid, name: nm, metal, weight: wt, open_issues: open.length });
        }
        for (const b of e.bills) {
          if (!b.photos.length) t.no_photo++;
          if (b.bill_date.slice(0, 7) === month && SIGN[b.kind] > 0) { t.bills_month++; t.bills_month_value += b.net; }
        }
        for (const p of c.payments) {
          if (p.pay_date.slice(0, 7) === month && p.direction === 'PAID') t.paid_month += p.amount;
          if (p.direction === 'PAID' && p.unused > 1 && p.days >= 7) t.unmatched_pay++;
        }
        t.open_issues += c.open_issues;
        if (c.money > EPS_M) dues.push({ party_id: pid, name: nm, money: c.money, due: c.due, d60p: c.buckets.d60p, oldest_due: c.oldest_due, open_bills: c.open_bills, mc: false });
      }
      for (const k of Object.keys(t)) t[k] = /weight|_out$/.test(k) ? r3(t[k]) : r2(t[k]);
      t.tds_missed = tdsMissed(new Map([...by].filter(([, e]) => !isMcEntry(e))), parties, await control.turnoverMap(firm)).length;
      const pending = pendingCounts(await collectPending(firm, today, prevMonth(today)));
      const recent = await db.execute('SELECT * FROM pp_audit ORDER BY id DESC LIMIT 12');
      res.json({ totals: t, pending, conf_month: prevMonth(today), top_dues: dues.filter(x => !x.mc).sort((a, b) => b.money - a.money), mc_dues: dues.filter(x => x.mc).sort((a, b) => b.money - a.money), workers: workers.sort((a, b) => b.weight - a.weight).slice(0, 10), recent: recent.rows, today });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { collectList, collectMark, loadFirm, partiesMap, collectPending };
}

module.exports = { registerAccounts, computeParty, allocate, metalOf };
