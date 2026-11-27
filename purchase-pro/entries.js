// Purchase Pro — payments, issue vouchers, receipt vouchers, opening balances.
const { makeCrud, AUDIT_COLS } = require('./crud');

const PAY_MODES = ['CASH', 'NEFT/RTGS', 'UPI', 'CHEQUE', 'OTHER'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function registerEntries(h) {
  const { db, clean } = h;

  async function init() {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS pp_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, firm INTEGER NOT NULL, party_id INTEGER NOT NULL,
        direction TEXT NOT NULL DEFAULT 'PAID', pay_date TEXT NOT NULL,
        amount REAL NOT NULL, round_off REAL NOT NULL DEFAULT 0, mode TEXT, reference TEXT,
        bill_ids TEXT NOT NULL DEFAULT '[]', notes TEXT, ${AUDIT_COLS})`,
      `CREATE INDEX IF NOT EXISTS pp_payments_firm_party ON pp_payments (firm, party_id)`,
      `CREATE TABLE IF NOT EXISTS pp_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT, firm INTEGER NOT NULL, party_id INTEGER NOT NULL,
        issue_no TEXT NOT NULL, issue_date TEXT NOT NULL, item_type TEXT, description TEXT,
        pcs REAL NOT NULL DEFAULT 0, gross_wt REAL NOT NULL DEFAULT 0, net_wt REAL NOT NULL DEFAULT 0,
        notes TEXT, ${AUDIT_COLS})`,
      `CREATE INDEX IF NOT EXISTS pp_issues_firm_party ON pp_issues (firm, party_id)`,
      `CREATE TABLE IF NOT EXISTS pp_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, firm INTEGER NOT NULL, party_id INTEGER NOT NULL,
        receipt_no TEXT, receipt_date TEXT NOT NULL,
        pcs REAL NOT NULL DEFAULT 0, gross_wt REAL NOT NULL DEFAULT 0, net_wt REAL NOT NULL DEFAULT 0,
        issue_ids TEXT NOT NULL DEFAULT '[]', bill_id INTEGER, notes TEXT, ${AUDIT_COLS})`,
      `CREATE INDEX IF NOT EXISTS pp_receipts_firm_party ON pp_receipts (firm, party_id)`,
      `CREATE TABLE IF NOT EXISTS pp_openings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, firm INTEGER NOT NULL, party_id INTEGER NOT NULL,
        as_of TEXT NOT NULL, money REAL NOT NULL DEFAULT 0, weight REAL NOT NULL DEFAULT 0, notes TEXT, ${AUDIT_COLS})`,
    ], 'write');
    // split payments (e.g. part bank + part cash): [{ mode, amount, reference }]
    const pcols = (await db.execute('PRAGMA table_info(pp_payments)')).rows.map(c => c.name);
    if (!pcols.includes('parts')) await db.execute("ALTER TABLE pp_payments ADD COLUMN parts TEXT NOT NULL DEFAULT '[]'");
    // chittai (gold-rate slip, as in the old Purchase) paid by this payment: {no,date,weight,rate,value,rnd,others,total,tds,rtgs,remarks} or null
    if (!pcols.includes('chittai')) await db.execute("ALTER TABLE pp_payments ADD COLUMN chittai TEXT NOT NULL DEFAULT 'null'");
    // issue voucher photos (like bills): ["https://…"]
    const icols = (await db.execute('PRAGMA table_info(pp_issues)')).rows.map(c => c.name);
    if (!icols.includes('photos')) await db.execute("ALTER TABLE pp_issues ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'");
    // Accounted mark on the Photos page (same as bills)
    if (!icols.includes('accounted_at')) await db.execute('ALTER TABLE pp_issues ADD COLUMN accounted_at TEXT');
    if (!icols.includes('accounted_by_name')) await db.execute('ALTER TABLE pp_issues ADD COLUMN accounted_by_name TEXT');
  }

  // Photos page: mark issue voucher photos Accounted / remove the mark
  h.api.post('/issues/accounted', async (req, res) => {
    try {
      const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(n => n > 0))].slice(0, 2000);
      if (!ids.length) return res.status(400).json({ error: 'No vouchers chosen.' });
      const on = !!req.body?.accounted, user = h.who(req), at = on ? h.nowIso() : null;
      const cur = await db.execute({ sql: `SELECT id, accounted_at FROM pp_issues WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, args: ids });
      const change = cur.rows.filter(r => !!r.accounted_at !== on);
      if (change.length) {
        await h.inTx(async (tx) => {
          for (const r of change) {
            await tx.execute({ sql: 'UPDATE pp_issues SET accounted_at = ?, accounted_by_name = ? WHERE id = ?', args: [at, on ? user.name : null, r.id] });
            await tx.execute(h.auditStmt({ entity: 'issue', entity_id: r.id, action: 'UPDATE', before: { accounted_at: r.accounted_at || null }, after: { accounted_at: at }, note: on ? 'Marked Accounted' : 'Accounted mark removed', user }));
          }
        });
      }
      res.json({ ok: true, changed: change.length, accounted_at: at, accounted_by_name: on ? user.name : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Ids in `ids` must be live rows of `table` for the same firm + party.
  async function ownIds(table, ids, firm, party, extra = '') {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))];
    if (!list.length) return { ids: [] };
    const r = await db.execute({
      sql: `SELECT id FROM ${table} WHERE id IN (${list.map(() => '?').join(',')}) AND firm = ? AND party_id = ? AND deleted_at IS NULL ${extra}`,
      args: [...list, firm, party],
    });
    if (r.rows.length !== list.length) return { error: 'Some linked entries do not belong to this supplier / firm (or were deleted). Re-select them.' };
    return { ids: list };
  }

  // Next chittai number for a payment date: CH-MM-NNN, numbered per month (as in the old Purchase)
  async function nextChittaiNo(firm, date) {
    const prefix = `CH-${String(date).slice(5, 7)}-`;
    const rows = (await db.execute({ sql: "SELECT json_extract(chittai, '$.no') AS no FROM pp_payments WHERE firm = ? AND chittai != 'null' AND json_extract(chittai, '$.no') LIKE ?", args: [firm, prefix + '%'] })).rows;
    const max = rows.reduce((m, x) => Math.max(m, Number(String(x.no).slice(prefix.length)) || 0), 0);
    return prefix + String(max + 1).padStart(3, '0');
  }
  h.api.get('/chittai/next', async (req, res) => {
    try {
      const date = DATE_RE.test(String(req.query.date || '')) ? req.query.date : new Date().toISOString().slice(0, 10);
      res.json({ no: await nextChittaiNo(Number(req.query.firm) || 2, date) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Payments ──
  const payments = makeCrud(h, {
    table: 'pp_payments', entity: 'payment', path: 'payments', label: 'Payment', dateField: 'pay_date',
    fields: ['firm', 'party_id', 'direction', 'pay_date', 'amount', 'round_off', 'mode', 'reference', 'bill_ids', 'notes', 'parts', 'chittai'],
    jsonFields: ['bill_ids', 'parts', 'chittai'],
    describe: (d) => `${d.direction === 'RECEIVED' ? 'Received' : 'Paid'} ₹${r2(d.amount)} on ${d.pay_date}`,
    async normalise(b, d, existing) {
      d.direction = String(b.direction || 'PAID').toUpperCase() === 'RECEIVED' ? 'RECEIVED' : 'PAID';
      d.pay_date = clean(b.pay_date);
      if (!d.pay_date || !DATE_RE.test(d.pay_date)) return { error: 'Payment date is required.' };
      if (require('./firm').beforeStart(d.pay_date)) return { error: require('./firm').START_MSG };
      d.amount = r2(b.amount);
      if (!(d.amount > 0)) return { error: 'Amount must be more than zero.' };
      d.round_off = r2(b.round_off);
      if (Math.abs(d.round_off) > 100) return { error: 'Round off looks too big (more than ₹100).' };
      d.mode = PAY_MODES.includes(String(b.mode || '').toUpperCase()) ? String(b.mode).toUpperCase() : null;
      if (!d.mode) return { error: 'Pick how it was paid (Cash, NEFT/RTGS, UPI, Cheque).' };
      d.reference = clean(b.reference);
      d.notes = clean(b.notes);
      // Split payment: two or more modes in one entry; amount becomes the total.
      const parts = (Array.isArray(b.parts) ? b.parts : []).map(x => ({
        mode: String(x?.mode || '').toUpperCase(), amount: r2(x?.amount), reference: clean(x?.reference) || null,
      })).filter(x => x.amount > 0);
      if (parts.length > 1) {
        if (parts.some(x => !PAY_MODES.includes(x.mode))) return { error: 'Pick how each part was paid (Cash, NEFT/RTGS, UPI, Cheque).' };
        d.amount = r2(parts.reduce((s, x) => s + x.amount, 0));
        d.mode = parts[0].mode;
        d.reference = parts.map(x => x.reference).filter(Boolean).join(' / ') || null;
        d.parts = JSON.stringify(parts);
      } else d.parts = '[]';
      // Chittai: same fields and sums as the old Purchase — Value = Weight × Rate, Total = Value + Rnd + Others, RTGS = Total − TDS
      const c = b.chittai && typeof b.chittai === 'object' ? b.chittai : null;
      if (c && d.direction === 'PAID' && (Number(c.weight) || Number(c.rate))) {
        const weight = Math.round((Number(c.weight) || 0) * 1000) / 1000, rate = r2(c.rate);
        if (!(weight > 0) || !(rate > 0)) return { error: 'Chittai: enter the weight and the rate.' };
        const value = r2(weight * rate), rnd = r2(c.rnd), others = r2(c.others), tds = r2(c.tds);
        const total = r2(value + rnd + others), rtgs = r2(total - tds);
        if (tds < 0 || tds > total) return { error: 'Chittai: TDS must be between 0 and the total.' };
        const cdate = d.pay_date; // chittai date is always the payment date
        // number is automatic: an edited payment keeps its own number, a new chittai gets the next one
        const ex = existing?.chittai;
        const keep = ex && typeof ex === 'object' ? ex.no : (typeof ex === 'string' && ex !== 'null' ? (() => { try { return JSON.parse(ex).no; } catch { return null; } })() : null);
        const no = keep || await nextChittaiNo(d.firm, cdate);
        d.chittai = JSON.stringify({ no, date: cdate, weight, rate, value, rnd, others, total, tds, rtgs, remarks: clean(c.remarks) || null });
      } else d.chittai = 'null';
      const own = await ownIds('pp_bills', d.direction === 'PAID' ? b.bill_ids : [], d.firm, d.party_id);
      if (own.error) return own;
      d.bill_ids = JSON.stringify(own.ids);
      return {};
    },
  });

  // ── Issue vouchers ──
  const issues = makeCrud(h, {
    table: 'pp_issues', entity: 'issue', path: 'issues', label: 'Issue voucher', dateField: 'issue_date',
    fields: ['firm', 'party_id', 'issue_no', 'issue_date', 'item_type', 'description', 'pcs', 'gross_wt', 'net_wt', 'notes', 'photos'],
    jsonFields: ['photos'],
    describe: (d) => `Issue ${d.issue_no} — ${r3(d.net_wt)} g`,
    async normalise(b, d, existing) {
      d.issue_no = clean(b.issue_no)?.toUpperCase();
      if (!d.issue_no) {
        const r = await db.execute({ sql: `SELECT COUNT(*) AS n FROM pp_issues WHERE firm = ?`, args: [d.firm] });
        d.issue_no = `IV-${String(Number(r.rows[0].n) + 1).padStart(4, '0')}`;
      }
      const dup = await db.execute({ sql: 'SELECT id FROM pp_issues WHERE firm = ? AND UPPER(issue_no) = ? AND deleted_at IS NULL AND id != ?', args: [d.firm, d.issue_no, existing?.id || 0] });
      if (dup.rows.length) return { error: `Issue number ${d.issue_no} is already used.`, status: 409 };
      d.issue_date = clean(b.issue_date);
      if (require('./firm').beforeStart(d.issue_date)) return { error: require('./firm').START_MSG };
      d.item_type = clean(b.item_type)?.toUpperCase() || null;
      d.description = clean(b.description)?.toUpperCase() || null;
      d.pcs = Number(b.pcs) || 0; d.gross_wt = r3(b.gross_wt); d.net_wt = r3(b.net_wt);
      if (!(d.net_wt > 0)) return { error: 'Net weight issued must be more than zero.' };
      if (d.gross_wt && d.net_wt > d.gross_wt + 0.0005) return { error: 'Net weight is more than gross weight.' };
      d.notes = clean(b.notes);
      // photos: new (temporary) ones go to Cloudinary only now, when the voucher is saved
      const urls = (Array.isArray(b.photos) ? b.photos : []).map(String).filter(u => /^https:\/\/|^\/purchase-pro\/api\/temp\//.test(u));
      try { d.photos = JSON.stringify(h.late?.finalizePhotos ? await h.late.finalizePhotos(urls, d.firm, 'IV ' + d.issue_no) : urls.filter(u => /^https:/.test(u))); }
      catch (e) { return { error: e.message }; }
      return {};
    },
  });

  // ── Receipt vouchers (link only to that worker's own issues) ──
  const receipts = makeCrud(h, {
    table: 'pp_receipts', entity: 'receipt', path: 'receipts', label: 'Receipt voucher', dateField: 'receipt_date',
    fields: ['firm', 'party_id', 'receipt_no', 'receipt_date', 'pcs', 'gross_wt', 'net_wt', 'issue_ids', 'bill_id', 'notes'],
    jsonFields: ['issue_ids'],
    describe: (d) => `Receipt ${d.receipt_no || ''} — ${r3(d.net_wt)} g`.replace('  ', ' '),
    async normalise(b, d) {
      d.receipt_no = clean(b.receipt_no)?.toUpperCase() || null;
      d.receipt_date = clean(b.receipt_date);
      if (require('./firm').beforeStart(d.receipt_date)) return { error: require('./firm').START_MSG };
      d.pcs = Number(b.pcs) || 0; d.gross_wt = r3(b.gross_wt); d.net_wt = r3(b.net_wt);
      if (!(d.net_wt > 0)) return { error: 'Net weight received must be more than zero.' };
      if (d.gross_wt && d.net_wt > d.gross_wt + 0.0005) return { error: 'Net weight is more than gross weight.' };
      const own = await ownIds('pp_issues', b.issue_ids, d.firm, d.party_id);
      if (own.error) return own;
      if (!own.ids.length) return { error: 'Link at least one issue voucher of this worker.' };
      d.issue_ids = JSON.stringify(own.ids);
      if (b.bill_id) {
        const bill = await ownIds('pp_bills', [b.bill_id], d.firm, d.party_id, "AND kind = 'LABOUR'");
        if (bill.error) return { error: 'The linked labour bill does not belong to this worker / firm.' };
        d.bill_id = bill.ids[0];
      } else d.bill_id = null;
      d.notes = clean(b.notes);
      return {};
    },
  });

  // ── Opening balances (one live row per firm + supplier) ──
  async function openingClash(firm, party, exceptId) {
    const r = await db.execute({ sql: 'SELECT id FROM pp_openings WHERE firm = ? AND party_id = ? AND deleted_at IS NULL AND id != ?', args: [firm, party, exceptId || 0] });
    return r.rows.length ? 'This supplier already has an opening balance for this firm — edit that one.' : null;
  }
  const openings = makeCrud(h, {
    table: 'pp_openings', entity: 'opening', path: 'openings', label: 'Opening balance', dateField: 'as_of',
    fields: ['firm', 'party_id', 'as_of', 'money', 'weight', 'notes'],
    describe: (d) => `Opening ₹${r2(d.money)} / ${r3(d.weight)} g as of ${d.as_of}`,
    async normalise(b, d, existing) {
      const clash = await openingClash(d.firm, d.party_id, existing?.id);
      if (clash) return { error: clash, status: 409 };
      d.as_of = clean(b.as_of);
      d.money = r2(b.money); d.weight = r3(b.weight);
      if (!d.money && !d.weight) return { error: 'Enter the opening money or weight (or both).' };
      d.notes = clean(b.notes);
      return {};
    },
    beforeRestore: (cur) => openingClash(cur.firm, cur.party_id, cur.id),
  });

  return { init, payments, issues, receipts, openings, PAY_MODES };
}

module.exports = { registerEntries, PAY_MODES };
