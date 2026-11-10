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
  }

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

  // ── Payments ──
  const payments = makeCrud(h, {
    table: 'pp_payments', entity: 'payment', path: 'payments', label: 'Payment', dateField: 'pay_date',
    fields: ['firm', 'party_id', 'direction', 'pay_date', 'amount', 'round_off', 'mode', 'reference', 'bill_ids', 'notes'],
    jsonFields: ['bill_ids'],
    describe: (d) => `${d.direction === 'RECEIVED' ? 'Received' : 'Paid'} ₹${r2(d.amount)} on ${d.pay_date}`,
    async normalise(b, d) {
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
      const own = await ownIds('pp_bills', d.direction === 'PAID' ? b.bill_ids : [], d.firm, d.party_id);
      if (own.error) return own;
      d.bill_ids = JSON.stringify(own.ids);
      return {};
    },
  });

  // ── Issue vouchers ──
  const issues = makeCrud(h, {
    table: 'pp_issues', entity: 'issue', path: 'issues', label: 'Issue voucher', dateField: 'issue_date',
    fields: ['firm', 'party_id', 'issue_no', 'issue_date', 'item_type', 'description', 'pcs', 'gross_wt', 'net_wt', 'notes'],
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
