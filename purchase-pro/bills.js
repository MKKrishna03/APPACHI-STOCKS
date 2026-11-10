// Purchase Pro — bills (purchase / expense / hallmark / labour / credit note / debit note).
// Registered onto the gated API router by api.js.

const BILL_KINDS = ['PURCHASE', 'EXPENSE', 'HALLMARK', 'LABOUR', 'CREDIT_NOTE', 'DEBIT_NOTE'];
// Which supplier type a bill kind belongs to (used to suggest suppliers).
const KIND_PARTY_TYPE = { PURCHASE: 'PURCHASE', EXPENSE: 'EXPENSE', HALLMARK: 'HALLMARK', LABOUR: 'LABOUR', CREDIT_NOTE: null, DEBIT_NOTE: null };
// Notes reduce what we owe the supplier; every other kind adds to it.
const KIND_SIGN = { PURCHASE: 1, EXPENSE: 1, HALLMARK: 1, LABOUR: 1, CREDIT_NOTE: -1, DEBIT_NOTE: -1 };

const BILL_FIELDS = [
  'firm', 'party_id', 'kind', 'bill_no', 'bill_date', 'ref_bill_id', 'gst_type',
  'taxable', 'other_charges', 'cgst', 'sgst', 'igst', 'round_off', 'total', 'tds', 'net',
  'pcs', 'gross_wt', 'net_wt', 'photos', 'verified', 'notes',
];
const ITEM_FIELDS = ['sl', 'description', 'huid', 'pcs', 'gross_wt', 'net_wt', 'rate', 'tax_pct', 'amount'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function registerBills({ api, db, inTx, auditStmt, who, nowIso, clean, firms, locks }) {
  const firmIds = new Set(firms.map(f => f.id));

  async function init() {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS pp_bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firm INTEGER NOT NULL,
        party_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        bill_no TEXT NOT NULL,
        bill_date TEXT NOT NULL,
        ref_bill_id INTEGER,
        gst_type TEXT,
        taxable REAL NOT NULL DEFAULT 0, other_charges REAL NOT NULL DEFAULT 0,
        cgst REAL NOT NULL DEFAULT 0, sgst REAL NOT NULL DEFAULT 0, igst REAL NOT NULL DEFAULT 0,
        round_off REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0,
        tds REAL NOT NULL DEFAULT 0, net REAL NOT NULL DEFAULT 0,
        pcs REAL NOT NULL DEFAULT 0, gross_wt REAL NOT NULL DEFAULT 0, net_wt REAL NOT NULL DEFAULT 0,
        photos TEXT NOT NULL DEFAULT '[]',
        verified INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL, created_by TEXT, created_by_name TEXT,
        updated_at TEXT, updated_by TEXT, updated_by_name TEXT,
        deleted_at TEXT, deleted_by TEXT, deleted_by_name TEXT, delete_reason TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS pp_bills_firm_date ON pp_bills (firm, bill_date)`,
      `CREATE INDEX IF NOT EXISTS pp_bills_party ON pp_bills (party_id)`,
      `CREATE TABLE IF NOT EXISTS pp_bill_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_id INTEGER NOT NULL,
        sl INTEGER, description TEXT, huid TEXT,
        pcs REAL, gross_wt REAL, net_wt REAL, rate REAL, tax_pct REAL, amount REAL
      )`,
      `CREATE INDEX IF NOT EXISTS pp_bill_items_bill ON pp_bill_items (bill_id)`,
    ], 'write');
    // Photos page: "Accounted" = the bill photo has been handed to the accountant
    const cols = (await db.execute('PRAGMA table_info(pp_bills)')).rows.map(c => c.name);
    if (!cols.includes('accounted_at')) await db.execute('ALTER TABLE pp_bills ADD COLUMN accounted_at TEXT');
    if (!cols.includes('accounted_by_name')) await db.execute('ALTER TABLE pp_bills ADD COLUMN accounted_by_name TEXT');
  }

  function billOut(r, items) {
    if (!r) return null;
    const b = { ...r };
    try { b.photos = JSON.parse(b.photos || '[]'); } catch { b.photos = []; }
    b.verified = !!Number(b.verified);
    b.sign = KIND_SIGN[b.kind] || 1;
    if (items) b.items = items;
    return b;
  }

  async function loadBill(id, withItems = true) {
    const r = await db.execute({
      sql: `SELECT b.*, p.name AS party_name, p.gstin AS party_gstin FROM pp_bills b
            LEFT JOIN pp_parties p ON p.id = b.party_id WHERE b.id = ?`,
      args: [id],
    });
    if (!r.rows[0]) return null;
    const items = withItems
      ? (await db.execute({ sql: 'SELECT * FROM pp_bill_items WHERE bill_id = ? ORDER BY sl, id', args: [id] })).rows
      : undefined;
    return billOut(r.rows[0], items);
  }

  // Validate + compute a bill. Weight totals come from the items; money totals
  // are checked (taxable + charges + GST + round-off must equal the total).
  async function normaliseBill(body) {
    const d = {};
    d.firm = Number(body.firm);
    if (!firmIds.has(d.firm)) return { error: 'Pick the firm (AJ or AJ PVT LTD).' };
    d.party_id = Number(body.party_id);
    if (!d.party_id) return { error: 'Pick the supplier.' };
    const party = (await db.execute({ sql: 'SELECT id, state_code, deleted_at FROM pp_parties WHERE id = ?', args: [d.party_id] })).rows[0];
    if (!party || party.deleted_at) return { error: 'That supplier does not exist (or is in the Recycle Bin).' };
    d.kind = String(body.kind || '').toUpperCase();
    if (!BILL_KINDS.includes(d.kind)) return { error: 'Pick the bill type.' };
    d.bill_no = clean(body.bill_no)?.toUpperCase() || null;
    if (!d.bill_no) return { error: 'Bill number is required.' };
    d.bill_date = clean(body.bill_date);
    if (!d.bill_date || !DATE_RE.test(d.bill_date)) return { error: 'Bill date is required.' };
    if (d.bill_date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return { error: 'Bill date cannot be in the future.' };
    d.ref_bill_id = null;
    if (body.ref_bill_id && (d.kind === 'CREDIT_NOTE' || d.kind === 'DEBIT_NOTE')) {
      const ref = (await db.execute({ sql: `SELECT id FROM pp_bills WHERE id = ? AND firm = ? AND party_id = ? AND deleted_at IS NULL AND kind NOT IN ('CREDIT_NOTE','DEBIT_NOTE')`, args: [Number(body.ref_bill_id), d.firm, d.party_id] })).rows[0];
      if (!ref) return { error: 'The bill this note is against must be a bill of the same supplier and firm.' };
      d.ref_bill_id = Number(ref.id);
    }
    d.gst_type = party.state_code && party.state_code !== '33' ? 'IGST' : 'CGST+SGST';

    const items = (Array.isArray(body.items) ? body.items : [])
      .map(it => ({
        description: clean(it.description)?.toUpperCase() || null,
        huid: clean(it.huid)?.toUpperCase() || null,
        pcs: num(it.pcs), gross_wt: round3(it.gross_wt), net_wt: round3(it.net_wt),
        rate: round2(it.rate), tax_pct: num(it.tax_pct), amount: round2(it.amount),
      }))
      .filter(it => it.description || it.net_wt || it.gross_wt || it.amount || it.pcs)
      .map((it, i) => ({ sl: i + 1, ...it }));
    if (!items.length) return { error: 'Add at least one item line.' };
    for (const it of items) {
      if (it.amount < 0 || it.net_wt < 0 || it.gross_wt < 0 || it.pcs < 0) return { error: `Line ${it.sl}: values cannot be negative.` };
      if (it.gross_wt && it.net_wt > it.gross_wt + 0.0005) return { error: `Line ${it.sl}: net weight is more than gross weight.` };
    }

    d.pcs = items.reduce((s, it) => s + it.pcs, 0);
    d.gross_wt = round3(items.reduce((s, it) => s + it.gross_wt, 0));
    d.net_wt = round3(items.reduce((s, it) => s + it.net_wt, 0));
    d.taxable = round2(items.reduce((s, it) => s + it.amount, 0));
    d.other_charges = round2(body.other_charges);
    d.cgst = round2(body.cgst); d.sgst = round2(body.sgst); d.igst = round2(body.igst);
    if (d.gst_type === 'IGST' && (d.cgst || d.sgst)) return { error: 'This supplier is from another state — use IGST, not CGST/SGST.' };
    if (d.gst_type === 'CGST+SGST' && d.igst) return { error: 'This supplier is in Tamil Nadu — use CGST + SGST, not IGST.' };
    d.round_off = round2(body.round_off);
    if (Math.abs(d.round_off) > 100) return { error: 'Round off looks too big (more than ₹100). Please check.' };
    d.total = round2(d.taxable + d.other_charges + d.cgst + d.sgst + d.igst + d.round_off);
    if (body.total != null && body.total !== '' && Math.abs(round2(body.total) - d.total) > 0.01) {
      return { error: `Totals don't add up: lines + charges + GST + round off = ₹${d.total.toFixed(2)}, but the bill total says ₹${round2(body.total).toFixed(2)}.` };
    }
    d.tds = round2(body.tds);
    if (d.tds < 0 || d.tds > d.total) return { error: 'TDS must be between 0 and the bill total.' };
    d.net = round2(d.total - d.tds);
    if (d.total <= 0) return { error: 'Bill total must be more than zero.' };

    let photos = Array.isArray(body.photos) ? body.photos : [];
    photos = photos.map(String).filter(u => /^https:\/\//.test(u));
    d.photos = JSON.stringify([...new Set(photos)]);
    d.verified = body.verified ? 1 : 0;
    if (!d.verified) return { error: 'Tick "I checked this bill against the photo / paper bill" before saving.' };
    d.notes = clean(body.notes);
    return { data: d, items };
  }

  async function duplicateOf(d, exceptId) {
    const r = await db.execute({
      sql: `SELECT id, bill_date FROM pp_bills WHERE deleted_at IS NULL AND firm = ? AND party_id = ? AND UPPER(bill_no) = ? AND id != ? LIMIT 1`,
      args: [d.firm, d.party_id, d.bill_no, exceptId || 0],
    });
    return r.rows[0] || null;
  }

  function itemStmts(billId, items) {
    return items.map(it => ({
      sql: `INSERT INTO pp_bill_items (bill_id, ${ITEM_FIELDS.join(',')}) VALUES (?, ${ITEM_FIELDS.map(() => '?').join(',')})`,
      args: [billId, ...ITEM_FIELDS.map(f => it[f] ?? null)],
    }));
  }

  // ── Routes ──
  api.get('/bills', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      const deleted = req.query.deleted === '1';
      const where = [deleted ? 'b.deleted_at IS NOT NULL' : 'b.deleted_at IS NULL'];
      const args = [];
      if (firmIds.has(firm)) { where.push('b.firm = ?'); args.push(firm); }
      if (req.query.party_id) { where.push('b.party_id = ?'); args.push(Number(req.query.party_id)); }
      if (req.query.from) { where.push('b.bill_date >= ?'); args.push(String(req.query.from)); }
      if (req.query.to) { where.push('b.bill_date <= ?'); args.push(String(req.query.to)); }
      const r = await db.execute({
        sql: `SELECT b.*, p.name AS party_name FROM pp_bills b LEFT JOIN pp_parties p ON p.id = b.party_id
              WHERE ${where.join(' AND ')} ORDER BY b.bill_date DESC, b.id DESC`,
        args,
      });
      res.json(r.rows.map(row => billOut(row)));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/bills/:id', async (req, res) => {
    try {
      const b = await loadBill(Number(req.params.id));
      if (!b) return res.status(404).json({ error: 'Bill not found.' });
      res.json(b);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.post('/bills', async (req, res) => {
    try {
      const { data, items, error } = await normaliseBill(req.body || {});
      if (error) return res.status(400).json({ error });
      const lockErr = await locks.check(req, data.firm, data.bill_date);
      if (lockErr) return res.status(423).json({ error: lockErr });
      const dup = await duplicateOf(data);
      if (dup && !req.body.allow_duplicate) {
        return res.status(409).json({ code: 'DUPLICATE', error: `Bill ${data.bill_no} from this supplier is already entered (dated ${dup.bill_date}).` });
      }
      const user = who(req);
      const id = await inTx(async (tx) => {
        const cols = [...BILL_FIELDS, 'created_at', 'created_by', 'created_by_name'];
        const ins = await tx.execute({
          sql: `INSERT INTO pp_bills (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING id`,
          args: [...BILL_FIELDS.map(f => data[f]), nowIso(), user.id, user.name],
        });
        const billId = Number(ins.rows[0].id);
        for (const s of itemStmts(billId, items)) await tx.execute(s);
        await tx.execute(auditStmt({ entity: 'bill', entity_id: billId, action: 'CREATE', after: { ...data, items }, user, note: dup ? 'Saved as duplicate bill number' : null }));
        return billId;
      });
      res.json(await loadBill(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.put('/bills/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await loadBill(id);
      if (!cur) return res.status(404).json({ error: 'Bill not found.' });
      if (cur.deleted_at) return res.status(400).json({ error: 'This bill is in the Recycle Bin. Restore it first.' });
      const { data, items, error } = await normaliseBill(req.body || {});
      if (error) return res.status(400).json({ error });
      const lockErr = (await locks.check(req, cur.firm, cur.bill_date)) || (await locks.check(req, data.firm, data.bill_date));
      if (lockErr) return res.status(423).json({ error: lockErr });
      const dup = await duplicateOf(data, id);
      if (dup && !req.body.allow_duplicate) {
        return res.status(409).json({ code: 'DUPLICATE', error: `Bill ${data.bill_no} from this supplier is already entered (dated ${dup.bill_date}).` });
      }
      const user = who(req);
      await inTx(async (tx) => {
        await tx.execute({
          sql: `UPDATE pp_bills SET ${BILL_FIELDS.map(f => `${f} = ?`).join(', ')}, updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ?`,
          args: [...BILL_FIELDS.map(f => data[f]), nowIso(), user.id, user.name, id],
        });
        await tx.execute({ sql: 'DELETE FROM pp_bill_items WHERE bill_id = ?', args: [id] });
        for (const s of itemStmts(id, items)) await tx.execute(s);
        await tx.execute(auditStmt({ entity: 'bill', entity_id: id, action: 'UPDATE', before: cur, after: { ...data, items }, user }));
      });
      res.json(await loadBill(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Mark bills Accounted (photos handed to the accountant) or undo it. body: { ids: [billId], accounted: bool }
  // Bookkeeping only — no amounts change, so month locks don't apply.
  api.post('/bills/accounted', async (req, res) => {
    try {
      const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(n => n > 0))].slice(0, 2000);
      if (!ids.length) return res.status(400).json({ error: 'No bills chosen.' });
      const on = !!req.body?.accounted, user = who(req), at = on ? nowIso() : null;
      const cur = await db.execute({ sql: `SELECT id, accounted_at FROM pp_bills WHERE deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, args: ids });
      const change = cur.rows.filter(r => !!r.accounted_at !== on);
      if (change.length) {
        await inTx(async (tx) => {
          for (const r of change) {
            await tx.execute({ sql: 'UPDATE pp_bills SET accounted_at = ?, accounted_by_name = ? WHERE id = ?', args: [at, on ? user.name : null, r.id] });
            await tx.execute(auditStmt({ entity: 'bill', entity_id: r.id, action: 'UPDATE', before: { accounted_at: r.accounted_at || null }, after: { accounted_at: at }, note: on ? 'Marked Accounted' : 'Accounted mark removed', user }));
          }
        });
      }
      res.json({ ok: true, changed: change.length, accounted_at: at, accounted_by_name: on ? user.name : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Photos can be added later without re-checking the whole bill.
  api.patch('/bills/:id/photos', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await loadBill(id, false);
      if (!cur || cur.deleted_at) return res.status(404).json({ error: 'Bill not found.' });
      const photos = (Array.isArray(req.body?.photos) ? req.body.photos : []).map(String).filter(u => /^https:\/\//.test(u));
      const user = who(req);
      await inTx(async (tx) => {
        await tx.execute({ sql: 'UPDATE pp_bills SET photos = ?, updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ?', args: [JSON.stringify([...new Set(photos)]), nowIso(), user.id, user.name, id] });
        await tx.execute(auditStmt({ entity: 'bill', entity_id: id, action: 'UPDATE', before: { photos: cur.photos }, after: { photos }, note: 'Photos changed', user }));
      });
      res.json(await loadBill(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.delete('/bills/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const reason = clean(req.body?.reason);
      if (!reason) return res.status(400).json({ error: 'Please give a reason for deleting.' });
      const cur = await loadBill(id);
      if (!cur) return res.status(404).json({ error: 'Bill not found.' });
      if (cur.deleted_at) return res.json(cur);
      const lockErr = await locks.check(req, cur.firm, cur.bill_date);
      if (lockErr) return res.status(423).json({ error: lockErr });
      const user = who(req);
      await inTx(async (tx) => {
        await tx.execute({ sql: 'UPDATE pp_bills SET deleted_at = ?, deleted_by = ?, deleted_by_name = ?, delete_reason = ? WHERE id = ?', args: [nowIso(), user.id, user.name, reason, id] });
        await tx.execute(auditStmt({ entity: 'bill', entity_id: id, action: 'DELETE', before: cur, note: reason, user }));
      });
      res.json(await loadBill(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.post('/bills/:id/restore', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await loadBill(id, false);
      if (!cur) return res.status(404).json({ error: 'Bill not found.' });
      if (!cur.deleted_at) return res.json(cur);
      const lockErr = await locks.check(req, cur.firm, cur.bill_date);
      if (lockErr) return res.status(423).json({ error: lockErr });
      const user = who(req);
      await inTx(async (tx) => {
        await tx.execute({ sql: 'UPDATE pp_bills SET deleted_at = NULL, deleted_by = NULL, deleted_by_name = NULL, delete_reason = NULL, updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ?', args: [nowIso(), user.id, user.name, id] });
        await tx.execute(auditStmt({ entity: 'bill', entity_id: id, action: 'RESTORE', before: { deleted_at: cur.deleted_at }, user }));
      });
      res.json(await loadBill(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { init };
}

module.exports = { registerBills, BILL_KINDS, KIND_PARTY_TYPE, KIND_SIGN };
