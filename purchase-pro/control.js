// Purchase Pro — controls: month lock, TDS rules, supplier confirmations,
// checker ticks, reports and the full backup download.

// ── TDS rules (confirm with the accountant) ──────────────────────────────
// 194Q goods: 0.1% on the part of the year's purchases above ₹50 lakh (5% without PAN).
// 194C contracts: 1% individual/HUF, 2% others (20% without PAN) — applies when a
//   single bill is over ₹30,000 or the year's total goes over ₹1,00,000.
const TDS = {
  '194Q': { threshold: 5000000, rate: () => 0.1, noPan: 5 },
  '194C': { single: 30000, threshold: 100000, rate: (l) => (l === 'P' || l === 'H' ? 1 : 2), noPan: 20 },
};
const KIND_SECTION = { PURCHASE: '194Q', LABOUR: '194C', HALLMARK: '194C', EXPENSE: null, CREDIT_NOTE: null, DEBIT_NOTE: null };

function fyOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${start}-${String(start + 1).slice(2)}` };
}

// Pure calculation. prior = this supplier's basis earlier in the same FY.
function tdsCalc({ kind, mode, pan, prior, amount }) {
  const section = KIND_SECTION[kind] || (mode === 'ALWAYS' && kind !== 'CREDIT_NOTE' && kind !== 'DEBIT_NOTE' ? '194C' : null);
  const base = { section, prior, amount, threshold: section ? TDS[section].threshold : null, suggested: 0, rate: 0, reason: '' };
  if (!section || amount <= 0) return { ...base, reason: 'No TDS for this bill type.' };
  if (mode === 'NEVER') return { ...base, reason: 'Supplier is set to never deduct TDS.' };
  const r = TDS[section];
  const letter = pan && pan.length >= 4 ? pan[3] : null;
  const rate = letter ? r.rate(letter) : r.noPan;
  const ceil = (x) => Math.ceil(Math.round(x * 100) / 100);
  if (mode === 'ALWAYS') return { ...base, rate, suggested: ceil(amount * rate / 100), reason: `Always deduct: ${rate}% (${section}).` };
  if (section === '194Q') {
    const over = Math.max(0, prior + amount - Math.max(prior, r.threshold));
    if (!over) return { ...base, rate, reason: `Below the ₹50 lakh yearly limit — ₹${Math.round(r.threshold - prior - amount).toLocaleString('en-IN')} left.` };
    return { ...base, rate, suggested: ceil(over * rate / 100), reason: `Yearly purchases cross ₹50 lakh — ${rate}% on ₹${Math.round(over).toLocaleString('en-IN')}.` };
  }
  const crosses = amount > r.single || prior + amount > r.threshold;
  if (!crosses) return { ...base, rate, reason: `Below the limit (single bill ₹30,000 / year ₹1,00,000) — ₹${Math.round(r.threshold - prior - amount).toLocaleString('en-IN')} left this year.` };
  return { ...base, rate, suggested: ceil(amount * rate / 100), reason: `${rate}% (${section}) — ${amount > r.single ? 'bill is over ₹30,000' : 'year total is over ₹1,00,000'}.` };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function registerControl({ api, db, inTx, auditStmt, who, nowIso, clean, firms }) {
  const firmIds = new Set(firms.map(f => f.id));
  const isOwner = (req) => req.session?.role === 'OWNER';

  async function init() {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS pp_month_locks (firm INTEGER NOT NULL, month TEXT NOT NULL, locked_at TEXT NOT NULL, locked_by TEXT, locked_by_name TEXT, PRIMARY KEY (firm, month))`,
      `CREATE TABLE IF NOT EXISTS pp_confirmations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, firm INTEGER NOT NULL, party_id INTEGER NOT NULL, as_of TEXT NOT NULL,
        money REAL NOT NULL, weight REAL NOT NULL, note TEXT, at TEXT NOT NULL, by_id TEXT, by_name TEXT)`,
      `CREATE TABLE IF NOT EXISTS pp_checks (entity TEXT NOT NULL, entity_id TEXT NOT NULL, at TEXT NOT NULL, by_id TEXT, by_name TEXT, PRIMARY KEY (entity, entity_id))`,
    ], 'write');
  }

  // ── Month lock ──
  const locks = {
    async check(req, firm, date) {
      if (!date) return null;
      const month = String(date).slice(0, 7);
      const r = await db.execute({ sql: 'SELECT 1 FROM pp_month_locks WHERE firm = ? AND month = ?', args: [Number(firm), month] });
      if (!r.rows.length || isOwner(req)) return null;
      return `${monthName(month)} is closed. Only the owner can change entries in a closed month.`;
    },
  };
  api.get('/locks', async (req, res) => {
    try { res.json((await db.execute({ sql: 'SELECT * FROM pp_month_locks WHERE firm = ? ORDER BY month DESC', args: [Number(req.query.firm)] })).rows); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  api.post('/locks', async (req, res) => {
    try {
      if (!isOwner(req)) return res.status(403).json({ error: 'Only the owner can close or reopen a month.' });
      const firm = Number(req.body?.firm), month = String(req.body?.month || '');
      if (!firmIds.has(firm) || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Pick firm and month.' });
      const user = who(req);
      await inTx(async (tx) => {
        if (req.body.lock) {
          await tx.execute({ sql: 'INSERT OR IGNORE INTO pp_month_locks (firm, month, locked_at, locked_by, locked_by_name) VALUES (?,?,?,?,?)', args: [firm, month, nowIso(), user.id, user.name] });
        } else {
          await tx.execute({ sql: 'DELETE FROM pp_month_locks WHERE firm = ? AND month = ?', args: [firm, month] });
        }
        await tx.execute(auditStmt({ entity: 'month', entity_id: Number(month.replace('-', '')), action: req.body.lock ? 'LOCK' : 'UNLOCK', after: { firm, month, title: monthName(month) }, user }));
      });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── TDS suggestion for a bill being entered ──
  async function priorBasis(firm, partyId, kind, date, excludeId) {
    const section = KIND_SECTION[kind];
    const kinds = Object.keys(KIND_SECTION).filter(k => KIND_SECTION[k] === section && section);
    if (!kinds.length) return 0;
    const fy = fyOf(date);
    const r = await db.execute({
      sql: `SELECT COALESCE(SUM(taxable + other_charges), 0) AS s FROM pp_bills
            WHERE deleted_at IS NULL AND firm = ? AND party_id = ? AND kind IN (${kinds.map(() => '?').join(',')})
              AND bill_date >= ? AND bill_date <= ? AND id != ?`,
      args: [firm, partyId, ...kinds, fy.from, fy.to, Number(excludeId) || 0],
    });
    return Number(r.rows[0].s) || 0;
  }
  api.get('/tds/suggest', async (req, res) => {
    try {
      const firm = Number(req.query.firm), partyId = Number(req.query.party_id);
      const kind = String(req.query.kind || ''), date = String(req.query.date || '');
      const amount = Number(req.query.amount) || 0;
      if (!firmIds.has(firm) || !partyId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.json({ suggested: 0, reason: '' });
      const p = (await db.execute({ sql: 'SELECT pan, tds_mode FROM pp_parties WHERE id = ?', args: [partyId] })).rows[0];
      if (!p) return res.json({ suggested: 0, reason: '' });
      const prior = await priorBasis(firm, partyId, kind, date, req.query.exclude);
      res.json({ ...tdsCalc({ kind, mode: p.tds_mode, pan: p.pan, prior, amount }), fy: fyOf(date).label });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Supplier balance confirmations (append-only) ──
  api.get('/confirmations', async (req, res) => {
    try {
      const r = await db.execute({ sql: 'SELECT * FROM pp_confirmations WHERE firm = ? AND party_id = ? ORDER BY id DESC', args: [Number(req.query.firm), Number(req.query.party_id)] });
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  api.post('/confirmations', async (req, res) => {
    try {
      const b = req.body || {};
      const firm = Number(b.firm), party = Number(b.party_id);
      if (!firmIds.has(firm) || !party || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.as_of || ''))) return res.status(400).json({ error: 'Missing details.' });
      const user = who(req);
      await inTx(async (tx) => {
        const ins = await tx.execute({
          sql: 'INSERT INTO pp_confirmations (firm, party_id, as_of, money, weight, note, at, by_id, by_name) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id',
          args: [firm, party, b.as_of, Number(b.money) || 0, Number(b.weight) || 0, clean(b.note), nowIso(), user.id, user.name],
        });
        await tx.execute(auditStmt({ entity: 'confirmation', entity_id: Number(ins.rows[0].id), action: 'CREATE', after: { firm, party_id: party, as_of: b.as_of, money: b.money, weight: b.weight, note: b.note, title: `Balance confirmed as of ${b.as_of}` }, user }));
      });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Checker "Verified" ticks ──
  async function checksMap() {
    const r = await db.execute('SELECT * FROM pp_checks');
    const m = {};
    for (const c of r.rows) m[`${c.entity}:${c.entity_id}`] = c;
    return m;
  }
  api.post('/checks', async (req, res) => {
    try {
      const entity = String(req.body?.entity || ''), id = String(req.body?.entity_id || '');
      if (!entity || !id) return res.status(400).json({ error: 'Missing item.' });
      const user = who(req);
      await inTx(async (tx) => {
        if (req.body.checked) await tx.execute({ sql: 'INSERT OR REPLACE INTO pp_checks (entity, entity_id, at, by_id, by_name) VALUES (?,?,?,?,?)', args: [entity, id, nowIso(), user.id, user.name] });
        else await tx.execute({ sql: 'DELETE FROM pp_checks WHERE entity = ? AND entity_id = ?', args: [entity, id] });
        await tx.execute(auditStmt({ entity: 'check', entity_id: null, action: req.body.checked ? 'VERIFY' : 'UNVERIFY', after: { title: `${entity} ${id}` }, user }));
      });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Reports ──
  api.get('/reports/tds', async (req, res) => {
    try {
      const r = await db.execute({
        sql: `SELECT b.id, b.bill_date, b.bill_no, b.kind, b.taxable, b.other_charges, b.tds, p.name AS party_name, p.pan
              FROM pp_bills b LEFT JOIN pp_parties p ON p.id = b.party_id
              WHERE b.deleted_at IS NULL AND b.firm = ? AND b.tds > 0 AND b.bill_date >= ? AND b.bill_date <= ?
              ORDER BY b.bill_date, b.id`,
        args: [Number(req.query.firm), String(req.query.from || '0000'), String(req.query.to || '9999')],
      });
      res.json(r.rows.map(x => ({ ...x, section: KIND_SECTION[x.kind] || '194C' })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  api.get('/reports/gst', async (req, res) => {
    try {
      const r = await db.execute({
        sql: `SELECT b.id, b.bill_date, b.bill_no, b.kind, b.taxable, b.other_charges, b.cgst, b.sgst, b.igst, b.total, p.name AS party_name, p.gstin
              FROM pp_bills b LEFT JOIN pp_parties p ON p.id = b.party_id
              WHERE b.deleted_at IS NULL AND b.firm = ? AND b.bill_date >= ? AND b.bill_date <= ?
              ORDER BY b.bill_date, b.id`,
        args: [Number(req.query.firm), String(req.query.from || '0000'), String(req.query.to || '9999')],
      });
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Full backup: every Purchase Pro table as one JSON download ──
  api.get('/backup', async (req, res) => {
    try {
      const t = await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pp\\_%' ESCAPE '\\' ORDER BY name`);
      const out = { exported_at: nowIso(), exported_by: who(req).name, tables: {} };
      for (const { name } of t.rows) {
        if (name === 'pp_upload_sessions') continue;
        out.tables[name] = (await db.execute(`SELECT * FROM ${name}`)).rows;
      }
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      res.setHeader('Content-Disposition', `attachment; filename="purchase-backup-${day}.json"`);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { init, locks, checksMap, tdsCalc, fyOf, KIND_SECTION, isOwner };
}

module.exports = { registerControl, tdsCalc, fyOf, KIND_SECTION };
