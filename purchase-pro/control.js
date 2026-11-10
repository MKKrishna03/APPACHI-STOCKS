// Purchase Pro — controls: month lock, TDS rules, supplier confirmations,
// checker ticks, reports and the full backup download.

// ── TDS — same as the old Purchase app ───────────────────────────────────
// Rate by the supplier's PAN 4th letter. Purchase and Hallmark bills use the
// 194Q rates, Labour uses 194C. TDS = taxable value × rate, rounded up.
// No yearly limits: like old Purchase, you choose per bill whether to deduct.
// Rates are read (read-only) from old Purchase's own TDS table for the PVT LTD
// company, so a rate changed there shows here too; these are the fallbacks.
const DEFAULT_RATES = {
  '194Q': { letters: { P: 0.1, H: 0.1, C: 0.1, F: 0.1, A: 0.1, B: 0.1, T: 0.1 }, noPan: 5 },
  '194C': { letters: { P: 1, H: 1, C: 2, F: 2, A: 2, B: 2, T: 2, L: 2, J: 2, G: 2 }, noPan: 20 },
};
let RATES = JSON.parse(JSON.stringify(DEFAULT_RATES));
async function loadRates() {
  if (!process.env.PURCHASE_DATABASE_URL) return;
  try {
    const { newPool } = require('../purchase/db');
    const r = await newPool.query('SELECT pan_4th_letter, section, tds_percentage FROM tds'); // SELECT only — never writes
    const next = JSON.parse(JSON.stringify(DEFAULT_RATES));
    for (const row of r.rows) {
      const sec = String(row.section || '').trim(), letter = String(row.pan_4th_letter || '').trim().toUpperCase();
      const pct = parseFloat(row.tds_percentage);
      if (!next[sec] || !letter || !Number.isFinite(pct)) continue;
      if (letter === 'X') next[sec].noPan = pct; else next[sec].letters[letter] = pct;
    }
    RATES = next;
  } catch (e) { console.warn('Purchase Pro: TDS rates from old Purchase not read —', e.message); }
}
const KIND_SECTION = { PURCHASE: '194Q', HALLMARK: '194Q', LABOUR: '194C', EXPENSE: null, CREDIT_NOTE: null, DEBIT_NOTE: null };

function fyOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `${start}-${String(start + 1).slice(2)}` };
}

// 194Q (Purchase / Hallmark): applies only when our turnover in the PREVIOUS
// financial year was over ₹10 crore — so never in the company's first year
// (started 22/04/2026 → nothing before 01/04/2027). The owner ticks each
// year's turnover in Reports → TDS. Then 0.1% only on the part of a
// supplier's purchases this year above ₹50 lakh.
const Q_TURNOVER = 100000000;   // ₹10 crore — previous year's turnover
const Q_SUPPLIER = 5000000;     // ₹50 lakh — per supplier per year
const prevFy = (label) => { const y = Number(label.slice(0, 4)) - 1; return `${y}-${String(y + 1).slice(2)}`; };
const fmtInr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

// amount = the bill's taxable value; prior = this supplier's taxable value
// earlier in the same FY (same section). q = { fy, firstYear, overLimit }
// for 194Q. Labour (194C): you choose per bill, like old Purchase.
function tdsCalc({ kind, mode, pan, prior, amount, q }) {
  const section = KIND_SECTION[kind] || null;
  const base = { section, prior, amount, suggested: 0, rate: 0, reason: '', mode: mode || 'AUTO', required: false };
  if (!section || amount <= 0) return { ...base, reason: 'No TDS for this bill type.' };
  if (mode === 'NEVER') return { ...base, reason: 'Supplier is set to never deduct TDS.' };
  const r = RATES[section];
  const letter = pan && pan.length >= 4 ? pan[3].toUpperCase() : null;
  const rate = letter && r.letters[letter] !== undefined ? r.letters[letter] : r.noPan;
  const who = letter ? `PAN letter ${letter}` : 'no PAN';
  const pct = (x) => Math.ceil((x * rate) / 100);
  if (mode === 'ALWAYS') return { ...base, rate, suggested: pct(amount), reason: `Always deduct: ${rate}% (${section}, ${who}).` };
  if (section === '194Q') {
    if (!q || q.firstYear) return { ...base, rate, reason: 'No purchase TDS in the company’s first year (until 31/03/2027) — 194Q needs last year’s turnover over ₹10 crore.' };
    if (!q.overLimit) return { ...base, rate, reason: `No purchase TDS — FY ${prevFy(q.fy)} turnover is not marked over ₹10 crore (Reports → TDS).` };
    const over = Math.max(0, prior + amount - Math.max(prior, Q_SUPPLIER));
    if (!over) return { ...base, rate, reason: `Below ₹50 lakh with this supplier this year — ${fmtInr(Q_SUPPLIER - prior - amount)} left before TDS.` };
    return { ...base, rate, suggested: pct(over), required: true, reason: `${rate}% (194Q) on ${fmtInr(over)} — this supplier crossed ₹50 lakh this year.` };
  }
  return { ...base, rate, suggested: pct(amount), reason: `If deducted: ${rate}% (${section}, ${who}) on taxable value.` };
}

const { FIRM_START } = require('./firm');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function registerControl({ api, db, inTx, auditStmt, who, nowIso, clean, firms }) {
  const firmIds = new Set(firms.map(f => f.id));
  const isOwner = (req) => req.session?.role === 'OWNER';

  async function init() {
    loadRates();
    setInterval(loadRates, 10 * 60 * 1000).unref?.();
    await db.batch([
      `CREATE TABLE IF NOT EXISTS pp_month_locks (firm INTEGER NOT NULL, month TEXT NOT NULL, locked_at TEXT NOT NULL, locked_by TEXT, locked_by_name TEXT, PRIMARY KEY (firm, month))`,
      `CREATE TABLE IF NOT EXISTS pp_confirmations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, firm INTEGER NOT NULL, party_id INTEGER NOT NULL, as_of TEXT NOT NULL,
        money REAL NOT NULL, weight REAL NOT NULL, note TEXT, at TEXT NOT NULL, by_id TEXT, by_name TEXT)`,
      `CREATE TABLE IF NOT EXISTS pp_tds_turnover (firm INTEGER NOT NULL, fy TEXT NOT NULL, over_limit INTEGER NOT NULL DEFAULT 0, set_at TEXT, set_by TEXT, PRIMARY KEY (firm, fy))`,
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
      sql: `SELECT COALESCE(SUM(taxable), 0) AS s FROM pp_bills
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
      const q = await qContext(firm, date);
      res.json({ ...tdsCalc({ kind, mode: p.tds_mode, pan: p.pan, prior, amount, q }), fy: fyOf(date).label });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 194Q: last year's turnover over ₹10 crore? (owner ticks it per year) ──
  async function turnoverMap(firm) {
    const r = await db.execute({ sql: 'SELECT fy, over_limit FROM pp_tds_turnover WHERE firm = ?', args: [Number(firm)] });
    const m = {}; for (const x of r.rows) m[x.fy] = !!Number(x.over_limit);
    return m;
  }
  const FIRST_FY = fyOf(FIRM_START).label;
  const qSync = (date, m) => { const fy = fyOf(date).label; return { fy, firstYear: fy <= FIRST_FY, overLimit: !!m[prevFy(fy)] }; };
  async function qContext(firm, date) { return qSync(date, await turnoverMap(firm)); }
  api.get('/tds/turnover', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      const m = await turnoverMap(firm);
      // One row per finished year since the company started, newest first
      const thisFy = fyOf(new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)).label;
      const years = [];
      for (let y = Number(FIRST_FY.slice(0, 4)); `${y}-${String(y + 1).slice(2)}` < thisFy; y++) years.push(`${y}-${String(y + 1).slice(2)}`);
      res.json({ first_fy: FIRST_FY, this_fy: thisFy, years: years.reverse().map(fy => ({ fy, over_limit: !!m[fy] })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  api.post('/tds/turnover', async (req, res) => {
    try {
      if (!isOwner(req)) return res.status(403).json({ error: 'Only the owner can set this.' });
      const firm = Number(req.body?.firm), fy = String(req.body?.fy || '');
      if (!firmIds.has(firm) || !/^\d{4}-\d{2}$/.test(fy)) return res.status(400).json({ error: 'Pick the year.' });
      const user = who(req), on = !!req.body.over_limit;
      await inTx(async (tx) => {
        await tx.execute({ sql: 'INSERT OR REPLACE INTO pp_tds_turnover (firm, fy, over_limit, set_at, set_by) VALUES (?,?,?,?,?)', args: [firm, fy, on ? 1 : 0, nowIso(), user.name] });
        await tx.execute(auditStmt({ entity: 'tds_turnover', entity_id: Number(fy.slice(0, 4)), action: 'UPDATE', after: { firm, fy, over_limit: on, title: `FY ${fy} turnover ${on ? 'over' : 'not over'} ₹10 crore` }, user }));
      });
      res.json({ ok: true });
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

  return { init, locks, checksMap, tdsCalc, fyOf, KIND_SECTION, isOwner, turnoverMap, qSync };
}

module.exports = { registerControl, tdsCalc, fyOf, KIND_SECTION };
