// Purchase Pro — MC bills (same as the old Purchase "MC Bill" page).
// For issue vouchers of type OTHERS (gold given to the family parties: NAMACHIVAYAM HUF,
// VIMAL MC, …) we make the making-charges invoice ourselves:
//   rate / g = pct% × gold rate (per 10 g) ÷ 10 ;  amount = weight (2 dp) × rate ; total rounded.
// It is saved as a LABOUR bill (is_mc = 1) that closes those issue vouchers.
// Each party has its own ₹19,20,000 limit per financial year, counted over BOTH
// companies — the sole proprietorship's MC bills still live in the old Purchase (read-only here).

const MC_LIMIT = 1920000;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function fyOf(date) {
  const d = String(date || '').slice(0, 10);
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  const s = m >= 4 ? y : y - 1;
  return { from: `${s}-04-01`, to: `${s + 1}-03-31`, label: `${s}-${String(s + 1).slice(2)}` };
}

function registerMc({ api, db }) {
  // Sole proprietorship MC bills from the old Purchase (company 1). SELECT only, cached 5 min.
  let soleCache = { at: 0, rows: [] };
  async function oldSoleMc() {
    if (Date.now() - soleCache.at < 300000) return soleCache.rows;
    let rows = [];
    try {
      if (process.env.PURCHASE_DATABASE_URL) {
        const { oldPool } = require('../purchase/db');
        const r = await oldPool.query(`
          SELECT r.id, r.company_name, to_char(r.date, 'YYYY-MM-DD') AS bill_date, r.receipt_bill_no AS bill_no,
                 COALESCE(r.bill_value_after_deduction, r.total, 0)::float AS total
          FROM labour r
          WHERE r.deleted_at IS NULL AND r.id IN (
            SELECT mc_receipt_id FROM labour WHERE voucher_type = 'ISSUE VOUCHER' AND mc_receipt_id IS NOT NULL AND deleted_at IS NULL)`);
        rows = r.rows.map(x => ({ ...x, company_name: String(x.company_name || '').trim().toUpperCase() }));
      }
    } catch (e) { console.warn('[MC] old Purchase read failed:', e.message); }
    soleCache = { at: Date.now(), rows };
    return rows;
  }

  async function partyName(partyId) {
    const r = await db.execute({ sql: 'SELECT name FROM pp_parties WHERE id = ?', args: [Number(partyId)] });
    return String(r.rows[0]?.name || '').trim().toUpperCase();
  }

  // Used so far this FY for one party (both companies), not counting one bill being edited.
  async function usedThisFy(partyId, date, excludeBillId) {
    const fy = fyOf(date);
    const pro = await db.execute({
      sql: `SELECT COALESCE(SUM(total), 0) AS s FROM pp_bills
            WHERE deleted_at IS NULL AND is_mc = 1 AND party_id = ? AND bill_date >= ? AND bill_date <= ? AND id != ?`,
      args: [Number(partyId), fy.from, fy.to, Number(excludeBillId) || 0],
    });
    const name = await partyName(partyId);
    const sole = (await oldSoleMc()).filter(x => x.company_name === name && x.bill_date >= fy.from && x.bill_date <= fy.to);
    const soleSum = sole.reduce((s, x) => s + (Number(x.total) || 0), 0);
    return { fy: fy.label, pro: r2(pro.rows[0].s), sole: r2(soleSum), used: r2(Number(pro.rows[0].s) + soleSum), limit: MC_LIMIT };
  }

  // bills.js asks this before saving an MC bill
  async function mcLimitError(partyId, date, total, excludeBillId) {
    const u = await usedThisFy(partyId, date, excludeBillId);
    const left = r2(MC_LIMIT - u.used);
    if (total > left + 0.5) {
      return `This MC bill (₹${Math.round(total).toLocaleString('en-IN')}) is more than the ₹19,20,000 limit left for FY ${u.fy} — only ₹${Math.max(0, left).toLocaleString('en-IN')} remains (both companies together).`;
    }
    return null;
  }

  // Everything the MC page needs: OTHERS issue vouchers with their MC bill (if made),
  // and the sole proprietorship's MC bill numbers (numbering runs across both companies).
  api.get('/mc', async (req, res) => {
    try {
      const firm = Number(req.query.firm) || 2;
      const issues = (await db.execute({
        sql: `SELECT i.id, i.party_id, i.issue_no, i.issue_date, i.item_type, i.description, i.net_wt,
                     p.name AS party_name, p.city, p.pincode, p.pan, p.address
              FROM pp_issues i LEFT JOIN pp_parties p ON p.id = i.party_id
              WHERE i.deleted_at IS NULL AND i.firm = ? AND UPPER(COALESCE(i.item_type, '')) = 'OTHERS'
              ORDER BY i.issue_date DESC, i.id DESC`,
        args: [firm],
      })).rows;
      const bills = (await db.execute({
        sql: `SELECT id, party_id, bill_no, bill_date, total, round_off, taxable, tds, net, photos, issue_ids, mc_gold_rate, mc_pct, accounted_at, items_json
              FROM (SELECT b.*, (SELECT json_group_array(json_object('description', description, 'net_wt', net_wt, 'rate', rate, 'amount', amount))
                                 FROM pp_bill_items it WHERE it.bill_id = b.id) AS items_json
                    FROM pp_bills b WHERE b.deleted_at IS NULL AND b.firm = ? AND b.is_mc = 1)`,
        args: [firm],
      })).rows.map(b => {
        let photos = [], ids = [], items = [];
        try { photos = JSON.parse(b.photos || '[]'); } catch {}
        try { ids = JSON.parse(b.issue_ids || '[]'); } catch {}
        try { items = JSON.parse(b.items_json || '[]'); } catch {}
        delete b.items_json;
        return { ...b, photos, issue_ids: ids, items };
      });
      const byIssue = new Map();
      for (const b of bills) for (const id of b.issue_ids) byIssue.set(Number(id), b);
      const sole = await oldSoleMc();
      res.json({
        limit: MC_LIMIT,
        issues: issues.map(i => ({ ...i, bill: byIssue.get(Number(i.id)) || null })),
        bills,
        sole: sole.map(x => ({ company_name: x.company_name, bill_no: x.bill_no, bill_date: x.bill_date, total: x.total })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/mc/used', async (req, res) => {
    try { res.json(await usedThisFy(req.query.party_id, req.query.date || new Date().toISOString().slice(0, 10), req.query.exclude)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { mcLimitError, usedThisFy };
}

module.exports = { registerMc, MC_LIMIT };
