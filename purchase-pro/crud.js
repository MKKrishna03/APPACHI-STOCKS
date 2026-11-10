// Purchase Pro — one safe CRUD implementation shared by payments, issues,
// receipts and opening balances. Every write: validation → month-lock check →
// one transaction (row + audit). Deletes are soft and restorable.

function makeCrud({ api, db, inTx, auditStmt, who, nowIso, clean, firms, locks }, cfg) {
  const { table, entity, path, fields, dateField, label, normalise, describe } = cfg;
  const firmIds = new Set(firms.map(f => f.id));

  const out = (r) => {
    if (!r) return null;
    const o = { ...r };
    for (const f of cfg.jsonFields || []) { try { o[f] = JSON.parse(o[f] || '[]'); } catch { o[f] = []; } }
    return o;
  };
  async function load(id) {
    const r = await db.execute({
      sql: `SELECT t.*, p.name AS party_name FROM ${table} t LEFT JOIN pp_parties p ON p.id = t.party_id WHERE t.id = ?`,
      args: [id],
    });
    return out(r.rows[0]);
  }

  async function checkParty(id) {
    const r = await db.execute({ sql: 'SELECT id, types, deleted_at FROM pp_parties WHERE id = ?', args: [Number(id)] });
    const p = r.rows[0];
    return p && !p.deleted_at ? p : null;
  }

  async function prepare(body, existing) {
    const d = {};
    d.firm = Number(body.firm);
    if (!firmIds.has(d.firm)) return { error: 'Pick the firm.' };
    d.party_id = Number(body.party_id);
    if (!d.party_id || !(await checkParty(d.party_id))) return { error: 'Pick the supplier / worker from the list.' };
    const res = await normalise(body, d, existing);
    if (res.error) return res;
    const date = d[dateField];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Date is required.' };
    if (date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return { error: 'Date cannot be in the future.' };
    return { data: d };
  }

  api.get(`/${path}`, async (req, res) => {
    try {
      const where = [req.query.deleted === '1' ? 't.deleted_at IS NOT NULL' : 't.deleted_at IS NULL'];
      const args = [];
      const firm = Number(req.query.firm);
      if (firmIds.has(firm)) { where.push('t.firm = ?'); args.push(firm); }
      if (req.query.party_id) { where.push('t.party_id = ?'); args.push(Number(req.query.party_id)); }
      if (req.query.from) { where.push(`t.${dateField} >= ?`); args.push(String(req.query.from)); }
      if (req.query.to) { where.push(`t.${dateField} <= ?`); args.push(String(req.query.to)); }
      const r = await db.execute({
        sql: `SELECT t.*, p.name AS party_name FROM ${table} t LEFT JOIN pp_parties p ON p.id = t.party_id
              WHERE ${where.join(' AND ')} ORDER BY t.${dateField} DESC, t.id DESC`,
        args,
      });
      res.json(r.rows.map(out));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get(`/${path}/:id`, async (req, res) => {
    try {
      const row = await load(Number(req.params.id));
      if (!row) return res.status(404).json({ error: `${label} not found.` });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.post(`/${path}`, async (req, res) => {
    try {
      const { data, error, status } = await prepare(req.body || {});
      if (error) return res.status(status || 400).json({ error });
      const lockErr = await locks.check(req, data.firm, data[dateField]);
      if (lockErr) return res.status(423).json({ error: lockErr });
      const user = who(req);
      const id = await inTx(async (tx) => {
        const cols = [...fields, 'created_at', 'created_by', 'created_by_name'];
        const ins = await tx.execute({
          sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING id`,
          args: [...fields.map(f => data[f] ?? null), nowIso(), user.id, user.name],
        });
        const newId = Number(ins.rows[0].id);
        await tx.execute(auditStmt({ entity, entity_id: newId, action: 'CREATE', after: { ...data, title: describe(data) }, user }));
        return newId;
      });
      res.json(await load(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.put(`/${path}/:id`, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await load(id);
      if (!cur) return res.status(404).json({ error: `${label} not found.` });
      if (cur.deleted_at) return res.status(400).json({ error: 'This entry is in the Recycle Bin. Restore it first.' });
      const { data, error, status } = await prepare(req.body || {}, cur);
      if (error) return res.status(status || 400).json({ error });
      const lockErr = (await locks.check(req, cur.firm, cur[dateField])) || (await locks.check(req, data.firm, data[dateField]));
      if (lockErr) return res.status(423).json({ error: lockErr });
      const user = who(req);
      await inTx(async (tx) => {
        await tx.execute({
          sql: `UPDATE ${table} SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ?`,
          args: [...fields.map(f => data[f] ?? null), nowIso(), user.id, user.name, id],
        });
        await tx.execute(auditStmt({ entity, entity_id: id, action: 'UPDATE', before: { ...cur, title: describe(cur) }, after: { ...data, title: describe(data) }, user }));
      });
      res.json(await load(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.delete(`/${path}/:id`, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const reason = clean(req.body?.reason);
      if (!reason) return res.status(400).json({ error: 'Please give a reason for deleting.' });
      const cur = await load(id);
      if (!cur) return res.status(404).json({ error: `${label} not found.` });
      if (cur.deleted_at) return res.json(cur);
      const lockErr = await locks.check(req, cur.firm, cur[dateField]);
      if (lockErr) return res.status(423).json({ error: lockErr });
      const user = who(req);
      await inTx(async (tx) => {
        await tx.execute({ sql: `UPDATE ${table} SET deleted_at = ?, deleted_by = ?, deleted_by_name = ?, delete_reason = ? WHERE id = ?`, args: [nowIso(), user.id, user.name, reason, id] });
        await tx.execute(auditStmt({ entity, entity_id: id, action: 'DELETE', before: { ...cur, title: describe(cur) }, note: reason, user }));
      });
      res.json(await load(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.post(`/${path}/:id/restore`, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = await load(id);
      if (!cur) return res.status(404).json({ error: `${label} not found.` });
      if (!cur.deleted_at) return res.json(cur);
      if (cfg.beforeRestore) { const err = await cfg.beforeRestore(cur); if (err) return res.status(409).json({ error: err }); }
      const lockErr = await locks.check(req, cur.firm, cur[dateField]);
      if (lockErr) return res.status(423).json({ error: lockErr });
      const user = who(req);
      await inTx(async (tx) => {
        await tx.execute({ sql: `UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL, deleted_by_name = NULL, delete_reason = NULL, updated_at = ?, updated_by = ?, updated_by_name = ? WHERE id = ?`, args: [nowIso(), user.id, user.name, id] });
        await tx.execute(auditStmt({ entity, entity_id: id, action: 'RESTORE', after: { title: describe(cur) }, user }));
      });
      res.json(await load(id));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { load };
}

// Columns every CRUD table carries for the audit trail + soft delete.
const AUDIT_COLS = `created_at TEXT NOT NULL, created_by TEXT, created_by_name TEXT,
  updated_at TEXT, updated_by TEXT, updated_by_name TEXT,
  deleted_at TEXT, deleted_by TEXT, deleted_by_name TEXT, delete_reason TEXT`;

module.exports = { makeCrud, AUDIT_COLS };
