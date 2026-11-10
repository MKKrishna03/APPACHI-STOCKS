// Purchase Pro — the rebuilt Purchase module, mounted at /purchase-pro.
//
// Data lives in the main Turso DB in its own pp_* tables. The old Purchase
// app (/purchase, its own Postgres DBs) is never written to — it is only READ
// once, on demand, to import the supplier list.
//
// Data-safety rules every route here follows:
//   • nothing is ever hard-deleted — rows get deleted_at and can be restored
//   • every create / update / delete / restore writes a pp_audit row with the
//     full before/after JSON and who did it
//   • multi-statement writes run inside one transaction (all or nothing)

const express = require('express');
const { registerBills, BILL_KINDS } = require('./bills');
const { registerPhotos } = require('./photos');
const { registerControl } = require('./control');
const { registerEntries, PAY_MODES } = require('./entries');
const { registerAccounts } = require('./accounts');

// Purchase Pro is for the PVT LTD only (the sole proprietorship stays on the old Purchase).
// Every money / weight entry carries firm_id 2. Add a firm back here to bring the switch back.
const FIRMS = [
  { id: 2, name: 'APPACHI JEWELLERY PVT LTD', short: 'AJ PVT LTD', sub: 'Private Limited' },
];

const PARTY_TYPES = ['PURCHASE', 'LABOUR', 'HALLMARK', 'EXPENSE'];
const TDS_MODES = ['AUTO', 'ALWAYS', 'NEVER'];
const HOME_STATE_CODE = '33'; // Tamil Nadu — same state → CGST+SGST, else IGST

// PAN 4th letter → entity type (Income-tax PAN structure).
const PAN_ENTITY = {
  P: 'Individual', H: 'HUF', C: 'Company', F: 'Firm / LLP', A: 'AOP', B: 'BOI',
  T: 'Trust', L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government',
};

const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const PARTY_FIELDS = [
  'name', 'alias', 'types', 'gstin', 'pan', 'state', 'state_code', 'address', 'city', 'pincode',
  'phone', 'phone2', 'email', 'bank_holder', 'bank_name', 'bank_account', 'bank_ifsc', 'bank_branch',
  'tds_mode', 'notes',
];

function nowIso() { return new Date().toISOString(); }
function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function upper(v) { const s = clean(v); return s ? s.toUpperCase() : null; }

// Shape a DB row for the client: parse JSON columns, add derived GST/TDS info.
function partyOut(r) {
  if (!r) return null;
  const p = { ...r };
  try { p.types = JSON.parse(p.types || '[]'); } catch { p.types = []; }
  p.gst_type = p.state_code && p.state_code !== HOME_STATE_CODE ? 'IGST' : 'CGST+SGST';
  const letter = p.pan && p.pan.length >= 4 ? p.pan[3] : null;
  p.entity_type = letter ? (PAN_ENTITY[letter] || 'Unknown') : 'No PAN';
  return p;
}

// Validate + normalise a supplier payload. Returns { data } or { error }.
function normaliseParty(body, existing) {
  const d = {};
  for (const f of PARTY_FIELDS) d[f] = existing ? existing[f] : null;
  for (const f of PARTY_FIELDS) if (f in body) d[f] = body[f];

  d.name = upper(d.name);
  if (!d.name) return { error: 'Supplier name is required.' };
  d.alias = upper(d.alias);
  d.gstin = upper(d.gstin)?.replace(/\s/g, '') || null;
  d.pan = upper(d.pan)?.replace(/\s/g, '') || null;
  if (d.gstin && !GSTIN_RE.test(d.gstin)) return { error: 'GSTIN must be 15 characters, e.g. 33ABCDE1234F1Z5.' };
  if (d.pan && !PAN_RE.test(d.pan)) return { error: 'PAN must be 10 characters, e.g. ABCDE1234F.' };
  // A GSTIN already contains the PAN (chars 3-12) and the state code (chars 1-2).
  if (d.gstin && !d.pan) d.pan = d.gstin.slice(2, 12);
  if (d.gstin) d.state_code = d.gstin.slice(0, 2);
  d.state_code = clean(d.state_code);
  if (d.state_code && !/^[0-9]{2}$/.test(d.state_code)) return { error: 'State code must be 2 digits.' };
  d.state = upper(d.state);
  for (const f of ['address', 'city', 'bank_holder', 'bank_name', 'bank_branch']) d[f] = upper(d[f]);
  for (const f of ['pincode', 'phone', 'phone2', 'bank_account', 'notes']) d[f] = clean(d[f]);
  d.email = clean(d.email)?.toLowerCase() || null;
  d.bank_ifsc = upper(d.bank_ifsc);

  let types = d.types;
  if (typeof types === 'string') { try { types = JSON.parse(types); } catch { types = [types]; } }
  types = Array.isArray(types) ? [...new Set(types.map(t => String(t).toUpperCase()))].filter(t => PARTY_TYPES.includes(t)) : [];
  if (!types.length) return { error: 'Pick at least one type (Purchase, Labour, Hallmark, Expense).' };
  d.types = JSON.stringify(types);

  d.tds_mode = TDS_MODES.includes(String(d.tds_mode || '').toUpperCase()) ? String(d.tds_mode).toUpperCase() : 'AUTO';
  return { data: d };
}

function createPurchasePro({ db, gate }) {
  const router = express.Router();
  const api = express.Router();
  api.use(express.json({ limit: '2mb' }));

  const who = (req) => ({ id: req.session?.userId != null ? String(req.session.userId) : null, name: req.session?.name || null });

  // Run fn(tx) inside one write transaction — commits on success, rolls back on any error.
  async function inTx(fn) {
    const tx = await db.transaction('write');
    try {
      const out = await fn(tx);
      await tx.commit();
      return out;
    } catch (e) {
      try { await tx.rollback(); } catch (_) {}
      throw e;
    } finally {
      try { tx.close(); } catch (_) {}
    }
  }

  function auditStmt({ entity, entity_id, action, before, after, note, user }) {
    return {
      sql: `INSERT INTO pp_audit (at, user_id, user_name, entity, entity_id, action, before_json, after_json, note)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [nowIso(), user.id, user.name, entity, entity_id, action,
        before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, note || null],
    };
  }

  // ── Schema ──────────────────────────────────────────────────────────────
  async function init() {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS pp_parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        alias TEXT,
        types TEXT NOT NULL DEFAULT '[]',
        gstin TEXT, pan TEXT, state TEXT, state_code TEXT,
        address TEXT, city TEXT, pincode TEXT,
        phone TEXT, phone2 TEXT, email TEXT,
        bank_holder TEXT, bank_name TEXT, bank_account TEXT, bank_ifsc TEXT, bank_branch TEXT,
        tds_mode TEXT NOT NULL DEFAULT 'AUTO',
        notes TEXT,
        legacy_source TEXT, legacy_id INTEGER,
        created_at TEXT NOT NULL, created_by TEXT, created_by_name TEXT,
        updated_at TEXT, updated_by TEXT, updated_by_name TEXT,
        deleted_at TEXT, deleted_by TEXT, deleted_by_name TEXT, delete_reason TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS pp_parties_name ON pp_parties (name)`,
      `CREATE INDEX IF NOT EXISTS pp_parties_legacy ON pp_parties (legacy_source, legacy_id)`,
      `CREATE TABLE IF NOT EXISTS pp_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        user_id TEXT, user_name TEXT,
        entity TEXT NOT NULL, entity_id INTEGER,
        action TEXT NOT NULL,
        before_json TEXT, after_json TEXT, note TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS pp_audit_entity ON pp_audit (entity, entity_id)`,
    ], 'write');
    console.log('✅ Purchase Pro tables ready');
  }

  // ── Session / reference ─────────────────────────────────────────────────
  api.get('/me', (req, res) => {
    res.json({
      user: who(req), isOwner: req.session?.role === 'OWNER', payModes: PAY_MODES, firms: FIRMS, partyTypes: PARTY_TYPES, tdsModes: TDS_MODES, billKinds: BILL_KINDS,
      homeStateCode: HOME_STATE_CODE, panEntity: PAN_ENTITY,
    });
  });

  // ── Suppliers ───────────────────────────────────────────────────────────
  api.get('/parties', async (req, res) => {
    try {
      const deleted = req.query.deleted === '1';
      const r = await db.execute(
        `SELECT * FROM pp_parties WHERE ${deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'} ORDER BY name COLLATE NOCASE`,
      );
      res.json(r.rows.map(partyOut));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/parties/:id', async (req, res) => {
    try {
      const r = await db.execute({ sql: 'SELECT * FROM pp_parties WHERE id = ?', args: [Number(req.params.id)] });
      if (!r.rows[0]) return res.status(404).json({ error: 'Supplier not found.' });
      res.json(partyOut(r.rows[0]));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  async function findDuplicate(d, exceptId) {
    const r = await db.execute({
      sql: `SELECT id, name, gstin FROM pp_parties
            WHERE deleted_at IS NULL AND id != ? AND (UPPER(name) = ? OR (? IS NOT NULL AND gstin = ?)) LIMIT 1`,
      args: [exceptId || 0, d.name, d.gstin, d.gstin],
    });
    const hit = r.rows[0];
    if (!hit) return null;
    return hit.name === d.name ? `A supplier named "${d.name}" already exists.` : `GSTIN ${d.gstin} is already used by "${hit.name}".`;
  }

  api.post('/parties', async (req, res) => {
    try {
      const { data, error } = normaliseParty(req.body || {});
      if (error) return res.status(400).json({ error });
      const dup = await findDuplicate(data);
      if (dup) return res.status(409).json({ error: dup });
      const user = who(req);
      const at = nowIso();
      const row = await inTx(async (tx) => {
        const cols = [...PARTY_FIELDS, 'created_at', 'created_by', 'created_by_name'];
        const ins = await tx.execute({
          sql: `INSERT INTO pp_parties (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING *`,
          args: [...PARTY_FIELDS.map(f => data[f]), at, user.id, user.name],
        });
        const created = ins.rows[0];
        await tx.execute(auditStmt({ entity: 'party', entity_id: Number(created.id), action: 'CREATE', after: created, user }));
        return created;
      });
      res.json(partyOut(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.put('/parties/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = (await db.execute({ sql: 'SELECT * FROM pp_parties WHERE id = ?', args: [id] })).rows[0];
      if (!cur) return res.status(404).json({ error: 'Supplier not found.' });
      if (cur.deleted_at) return res.status(400).json({ error: 'This supplier is in the Recycle Bin. Restore it first.' });
      const { data, error } = normaliseParty(req.body || {}, cur);
      if (error) return res.status(400).json({ error });
      const dup = await findDuplicate(data, id);
      if (dup) return res.status(409).json({ error: dup });
      const user = who(req);
      const row = await inTx(async (tx) => {
        const up = await tx.execute({
          sql: `UPDATE pp_parties SET ${PARTY_FIELDS.map(f => `${f} = ?`).join(', ')},
                  updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ? RETURNING *`,
          args: [...PARTY_FIELDS.map(f => data[f]), nowIso(), user.id, user.name, id],
        });
        const after = up.rows[0];
        await tx.execute(auditStmt({ entity: 'party', entity_id: id, action: 'UPDATE', before: cur, after, user }));
        return after;
      });
      res.json(partyOut(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.delete('/parties/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const reason = clean(req.body?.reason);
      if (!reason) return res.status(400).json({ error: 'Please give a reason for deleting.' });
      const cur = (await db.execute({ sql: 'SELECT * FROM pp_parties WHERE id = ?', args: [id] })).rows[0];
      if (!cur) return res.status(404).json({ error: 'Supplier not found.' });
      if (cur.deleted_at) return res.json(partyOut(cur));
      const used = await db.execute({
        sql: `SELECT (SELECT COUNT(*) FROM pp_bills WHERE party_id = ?1 AND deleted_at IS NULL)
                   + (SELECT COUNT(*) FROM pp_payments WHERE party_id = ?1 AND deleted_at IS NULL)
                   + (SELECT COUNT(*) FROM pp_issues WHERE party_id = ?1 AND deleted_at IS NULL)
                   + (SELECT COUNT(*) FROM pp_receipts WHERE party_id = ?1 AND deleted_at IS NULL)
                   + (SELECT COUNT(*) FROM pp_openings WHERE party_id = ?1 AND deleted_at IS NULL) AS n`,
        args: [id],
      });
      if (Number(used.rows[0].n) > 0) return res.status(409).json({ error: `${cur.name} has ${used.rows[0].n} entr${Number(used.rows[0].n) === 1 ? 'y' : 'ies'} (bills, payments, issues…). Delete those first, or keep the supplier.` });
      const user = who(req);
      const row = await inTx(async (tx) => {
        const up = await tx.execute({
          sql: `UPDATE pp_parties SET deleted_at = ?, deleted_by = ?, deleted_by_name = ?, delete_reason = ? WHERE id = ? RETURNING *`,
          args: [nowIso(), user.id, user.name, reason, id],
        });
        await tx.execute(auditStmt({ entity: 'party', entity_id: id, action: 'DELETE', before: cur, after: up.rows[0], note: reason, user }));
        return up.rows[0];
      });
      res.json(partyOut(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.post('/parties/:id/restore', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = (await db.execute({ sql: 'SELECT * FROM pp_parties WHERE id = ?', args: [id] })).rows[0];
      if (!cur) return res.status(404).json({ error: 'Supplier not found.' });
      if (!cur.deleted_at) return res.json(partyOut(cur));
      const dup = await findDuplicate({ name: cur.name, gstin: cur.gstin }, id);
      if (dup) return res.status(409).json({ error: `Can't restore: ${dup}` });
      const user = who(req);
      const row = await inTx(async (tx) => {
        const up = await tx.execute({
          sql: `UPDATE pp_parties SET deleted_at = NULL, deleted_by = NULL, deleted_by_name = NULL, delete_reason = NULL,
                  updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ? RETURNING *`,
          args: [nowIso(), user.id, user.name, id],
        });
        await tx.execute(auditStmt({ entity: 'party', entity_id: id, action: 'RESTORE', before: cur, after: up.rows[0], user }));
        return up.rows[0];
      });
      res.json(partyOut(row));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Edit history ────────────────────────────────────────────────────────
  api.get('/audit', async (req, res) => {
    try {
      const { entity, id } = req.query;
      const r = entity
        ? await db.execute({ sql: 'SELECT * FROM pp_audit WHERE entity = ? AND entity_id = ? ORDER BY id DESC', args: [String(entity), Number(id)] })
        : await db.execute('SELECT * FROM pp_audit ORDER BY id DESC LIMIT 300');
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Import suppliers from the OLD Purchase app (read-only there) ────────
  // Reads `profiles` from both old Postgres DBs, de-duplicates by name, and
  // adds only the ones not already imported. Safe to run more than once.
  async function readOldProfiles() {
    if (!process.env.PURCHASE_DATABASE_URL) throw new Error('Old Purchase database is not configured.');
    const { oldPool, newPool } = require('../purchase/db');
    const pools = newPool === oldPool ? [['old1', oldPool]] : [['old1', oldPool], ['old2', newPool]];
    const byName = new Map();
    for (const [source, pool] of pools) {
      const r = await pool.query('SELECT * FROM profiles ORDER BY id'); // SELECT only — never writes
      for (const p of r.rows) {
        const name = String(p.company_name || p.alias || '').trim().toUpperCase();
        if (!name || byName.has(name)) continue;
        byName.set(name, { source, p });
      }
    }
    return [...byName.values()];
  }

  const LEDGER_TO_TYPE = { PURCHASES: 'PURCHASE', PURCHASE: 'PURCHASE', LABOUR: 'LABOUR', HALLMARK: 'HALLMARK', EXPENSES: 'EXPENSE', EXPENSE: 'EXPENSE' };

  function mapOldProfile(p) {
    const types = (Array.isArray(p.ledger_types) ? p.ledger_types : [])
      .map(t => LEDGER_TO_TYPE[String(t).toUpperCase()]).filter(Boolean);
    const body = {
      name: p.company_name || p.alias,
      alias: p.alias && p.alias !== p.company_name ? p.alias : null,
      types: types.length ? types : ['PURCHASE'],
      gstin: p.gst_number, pan: p.pan_number, state: p.state, state_code: p.state_code,
      address: p.address, city: p.city, pincode: p.pincode,
      phone: p.contact1, phone2: p.contact2, email: p.email,
      bank_holder: p.ac_holder, bank_name: p.bank_name, bank_account: p.account_number,
      bank_ifsc: p.ifsc_code, bank_branch: p.branch, tds_mode: 'AUTO',
    };
    // Old data can have malformed GSTIN/PAN — keep the supplier, drop the bad
    // field into notes instead of refusing the whole row.
    const notes = [];
    const g = upper(body.gstin)?.replace(/\s/g, '');
    if (g && !GSTIN_RE.test(g)) { notes.push(`Old GSTIN (invalid format): ${body.gstin}`); body.gstin = null; }
    const pn = upper(body.pan)?.replace(/\s/g, '');
    if (pn && !PAN_RE.test(pn)) { notes.push(`Old PAN (invalid format): ${body.pan}`); body.pan = null; }
    if (notes.length) body.notes = notes.join('\n');
    return body;
  }

  api.get('/import/old-suppliers', async (req, res) => {
    try {
      const old = await readOldProfiles();
      const existing = await db.execute('SELECT UPPER(name) AS n FROM pp_parties WHERE deleted_at IS NULL');
      const have = new Set(existing.rows.map(r => r.n));
      const fresh = old.filter(o => !have.has(String(mapOldProfile(o.p).name).trim().toUpperCase()));
      res.json({ total: old.length, toAdd: fresh.length, already: old.length - fresh.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.post('/import/old-suppliers', async (req, res) => {
    try {
      const old = await readOldProfiles();
      const user = who(req);
      let added = 0, skipped = 0;
      const problems = [];
      for (const { source, p } of old) {
        const { data, error } = normaliseParty(mapOldProfile(p));
        if (error) { problems.push(`${p.company_name || p.alias}: ${error}`); continue; }
        if (await findDuplicate(data)) { skipped++; continue; }
        const at = nowIso();
        await inTx(async (tx) => {
          const cols = [...PARTY_FIELDS, 'legacy_source', 'legacy_id', 'created_at', 'created_by', 'created_by_name'];
          const ins = await tx.execute({
            sql: `INSERT INTO pp_parties (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING *`,
            args: [...PARTY_FIELDS.map(f => data[f]), source, p.id, at, user.id, user.name],
          });
          await tx.execute(auditStmt({ entity: 'party', entity_id: Number(ins.rows[0].id), action: 'IMPORT', after: ins.rows[0], note: `From old Purchase (${source} #${p.id})`, user }));
        });
        added++;
      }
      res.json({ added, skipped, problems });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Bills, photos, AI scan ──────────────────────────────────────────────
  const helpers = { api, db, inTx, auditStmt, who, nowIso, clean, firms: FIRMS };
  const control = registerControl(helpers);
  helpers.locks = control.locks;
  const bills = registerBills(helpers);
  const photos = registerPhotos(helpers);
  const entries = registerEntries(helpers);
  registerAccounts({ ...helpers, control });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));

  async function initAll() {
    await init();
    await control.init();
    await bills.init();
    await photos.init();
    await entries.init();
  }

  // ── Mount ───────────────────────────────────────────────────────────────
  // Public: only the phone upload page (its random token is the access key).
  router.use(photos.publicRouter);
  // Everything else is behind the gate.
  router.use(gate);
  router.use('/api', api);
  // Serve only the client files — never the server source.
  // Whitelist: only app.js and *-ui.js are browser scripts; every other .js here is server code.
  router.use((req, res, next) => (/\.js$/i.test(req.path) && !/^\/(app|[a-z]+-ui)\.js$/.test(req.path) ? res.status(404).end() : next()));
  router.use(express.static(__dirname, { index: 'index.html' }));

  return { router, init: initAll };
}

module.exports = { createPurchasePro, FIRMS };
