const express = require("express");
const { pool } = require("../db");
const { logActivity } = require("./activityLog");

const router = express.Router();

router.get("/hallmark-expenses/list", async (req, res) => {
  const { profile_id } = req.query;
  try {
    const params = [];
    let where = "WHERE he.deleted_at IS NULL";
    if (profile_id) {
      params.push(profile_id);
      where += ` AND he.profile_id=$1`;
    }
    const result = await pool.query(
      `SELECT he.*, u.name AS created_by_name FROM hallmark_expenses he LEFT JOIN auth_users u ON u.user_id::text = he.created_by ${where} ORDER BY he.created_at DESC`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/hallmark-expenses/:id", async (req, res) => {
  if (Number.isNaN(Number(req.params.id))) return res.status(404).json({ error: "Not found" });
  try {
    const p = await pool.query("SELECT * FROM hallmark_expenses WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
    if (!p.rows[0]) return res.status(404).json({ error: "Not found" });
    const items = await pool.query(
      "SELECT * FROM hallmark_expense_items WHERE hallmark_expense_id=$1 ORDER BY sl_no",
      [req.params.id],
    );
    res.json({ entry: p.rows[0], items: items.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/hallmark-expenses", async (req, res) => {
  const {
    profile_id, date, bill_no, voucher_type, description, taxable_value, tax_percent,
    cgst, sgst, igst, round_off, total_value, tds, net_value,
    linked_voucher_id, linked_voucher_ids, linked_chittai_id, linked_chittai_ids,
    items, created_by, photo_url,
  } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO hallmark_expenses
        (profile_id, date, bill_no, voucher_type, description, taxable_value, tax_percent,
         cgst, sgst, igst, round_off, total_value, tds, net_value, linked_voucher_id,
         linked_voucher_ids, linked_chittai_id, linked_chittai_ids, photo_url, created_by, photo_urls)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [
        profile_id, date, bill_no, voucher_type, description, taxable_value, tax_percent || 0,
        cgst, sgst, igst, round_off, total_value, tds, net_value,
        linked_voucher_id || null, linked_voucher_ids?.length ? linked_voucher_ids : null,
        linked_chittai_id || null, linked_chittai_ids?.length ? linked_chittai_ids : null,
        photo_url || null, created_by || null,
        req.body.photo_urls?.length ? req.body.photo_urls : null,
      ],
    );
    const entryId = result.rows[0].id;
    if (items?.length) {
      for (const item of items) {
        await client.query(
          `INSERT INTO hallmark_expense_items (hallmark_expense_id, sl_no, description, quantity, rate, tax_percent, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [entryId, item.sl_no, item.description, item.quantity, item.rate, item.tax_percent, item.amount],
        );
      }
    }
    if (linked_voucher_ids?.length) {
      for (const vid of linked_voucher_ids) await client.query(`UPDATE vouchers SET linked_purchase_id=$1 WHERE id=$2`, [entryId, vid]);
    }
    if (linked_chittai_ids?.length) {
      for (const cid of linked_chittai_ids) await client.query(`UPDATE chittai SET linked_purchase_id=$1 WHERE id=$2`, [entryId, cid]);
    }
    await client.query("COMMIT");
    logActivity({ action: "CREATE", entity_type: voucher_type || "Hallmark/Expense", entity_id: entryId, bill_no: bill_no, profile_id, user_id: req.user?.user_id || created_by, user_name: req.user?.name });
    res.json({ status: "SUCCESS", id: entryId });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put("/hallmark-expenses/:id", async (req, res) => {
  const id = req.params.id;
  const {
    date, bill_no, voucher_type, description, taxable_value, tax_percent,
    cgst, sgst, igst, round_off, total_value, tds, net_value, items, photo_url, photo_urls,
  } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const curRow = await client.query(`SELECT profile_id FROM hallmark_expenses WHERE id=$1`, [id]);
    const profileId = curRow.rows[0]?.profile_id;
    await client.query(
      `UPDATE hallmark_expenses SET date=$1, bill_no=$2, voucher_type=$3, description=$4, taxable_value=$5,
        tax_percent=$6, cgst=$7, sgst=$8, igst=$9, round_off=$10, total_value=$11, tds=$12, net_value=$13,
        photo_url=$14, photo_urls=$15 WHERE id=$16`,
      [date, bill_no, voucher_type, description, taxable_value, tax_percent || 0,
        cgst, sgst, igst, round_off, total_value, tds, net_value,
        photo_url || null, photo_urls?.length ? photo_urls : null, id],
    );
    await client.query(`DELETE FROM hallmark_expense_items WHERE hallmark_expense_id=$1`, [id]);
    if (items?.length) {
      for (const item of items) {
        await client.query(
          `INSERT INTO hallmark_expense_items (hallmark_expense_id, sl_no, description, quantity, rate, tax_percent, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, item.sl_no, item.description, item.quantity, item.rate, item.tax_percent, item.amount],
        );
      }
    }
    await client.query("COMMIT");
    logActivity({ action: "UPDATE", entity_type: voucher_type || "Hallmark/Expense", entity_id: Number(id), bill_no, profile_id: profileId, user_id: req.user?.user_id, user_name: req.user?.name });
    res.json({ status: "SUCCESS", id: Number(id) });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch("/hallmark-expenses/:id/accounted", async (req, res) => {
  try {
    await pool.query(`UPDATE hallmark_expenses SET is_accounted = $1 WHERE id = $2`, [req.body.is_accounted, req.params.id]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
