const express = require("express");
const { pool } = require("../db");
const { logActivity } = require("./activityLog");

const router = express.Router();

router.get("/chittai/list/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, u.name AS created_by_name FROM chittai c LEFT JOIN auth_users u ON u.user_id::text = c.created_by WHERE c.deleted_at IS NULL ORDER BY c.date DESC`,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/chittai/list", async (req, res) => {
  const { profile_id, is_paid } = req.query;
  if (!profile_id) return res.json([]);
  try {
    const result = await pool.query(
      `SELECT * FROM chittai WHERE profile_id = $1 AND (is_paid = $2 OR is_paid IS NULL) AND deleted_at IS NULL ORDER BY date DESC`,
      [profile_id, is_paid === "false" ? false : true],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/chittai/next-no", async (req, res) => {
  const { prefix } = req.query;
  try {
    const result = await pool.query(
      `SELECT chittai_no FROM chittai WHERE chittai_no LIKE $1 AND deleted_at IS NULL ORDER BY chittai_no DESC LIMIT 1`,
      [`${prefix}%`],
    );
    if (!result.rows.length) return res.json({ chittai_no: `${prefix}001` });
    const last = result.rows[0].chittai_no;
    const parts = last.split("-");
    const num = parseInt(parts[parts.length - 1]) + 1;
    res.json({ chittai_no: `${prefix}${String(num).padStart(3, "0")}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/chittai", async (req, res) => {
  const { profile_id, chittai_no, date, weight, rate, value, others, total, tds, rtgs_amount, photo_url, remarks } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO chittai (profile_id, chittai_no, date, weight, rate, value, others, total, tds, rtgs_amount, created_by, photo_url, remarks, photo_urls)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        profile_id, chittai_no, date, weight, rate, value, others || 0, total, tds || 0, rtgs_amount,
        req.body.created_by || null, photo_url || null, remarks || null,
        req.body.photo_urls?.length ? req.body.photo_urls : null,
      ],
    );
    const chittai_id = result.rows[0].id;
    const { is_paid, pay_date, pay_amount, pay_mop } = req.body;
    if (is_paid && pay_date && pay_amount && pay_mop) {
      await pool.query(
        `INSERT INTO vouchers (profile_id, voucher_type, date, bill_no, entry_type, description, total_value, linked_chittai_id)
         VALUES ($1,'Chittai Payment',$2,$3,'against',$4,$5,$6)`,
        [profile_id, pay_date, chittai_no, `Payment against Chittai ${chittai_no} via ${pay_mop}`, pay_amount, chittai_id],
      );
      await pool.query(`UPDATE chittai SET is_paid=true WHERE id=$1`, [chittai_id]);
    }
    logActivity({ action: "CREATE", entity_type: "Chittai", entity_id: chittai_id, bill_no: chittai_no, profile_id, user_id: req.user?.user_id || req.body.created_by, user_name: req.user?.name });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/chittai/:id", async (req, res) => {
  const { is_paid, profile_id, chittai_no, date, weight, rate, value, others, total, tds, rtgs_amount, linked_voucher_id } = req.body;
  try {
    let result;
    if (profile_id !== undefined) {
      result = await pool.query(
        `UPDATE chittai SET profile_id=$1, chittai_no=$2, date=$3, weight=$4, rate=$5, value=$6, others=$7, total=$8, tds=$9, rtgs_amount=$10, photo_url=COALESCE($11, photo_url), photo_urls=COALESCE($12, photo_urls), remarks=COALESCE($13, remarks) WHERE id=$14 RETURNING *`,
        [
          profile_id, chittai_no, date, weight, rate, value, others || 0, total, tds || 0, rtgs_amount,
          req.body.photo_url !== undefined ? req.body.photo_url || null : null,
          req.body.photo_urls?.length ? req.body.photo_urls : null,
          req.body.remarks !== undefined ? req.body.remarks || null : null,
          req.params.id,
        ],
      );
      logActivity({ action: "UPDATE", entity_type: "Chittai", entity_id: Number(req.params.id), bill_no: chittai_no, profile_id, user_id: req.user?.user_id, user_name: req.user?.name });
    } else if (linked_voucher_id !== undefined) {
      result = await pool.query(
        `UPDATE chittai SET linked_voucher_id=$1, is_paid=COALESCE($2, is_paid) WHERE id=$3 RETURNING *`,
        [linked_voucher_id, is_paid, req.params.id],
      );
    } else {
      result = await pool.query(`UPDATE chittai SET is_paid = $1 WHERE id = $2 RETURNING *`, [is_paid, req.params.id]);
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/chittai/:id/photo", async (req, res) => {
  try {
    await pool.query(`UPDATE chittai SET photo_url = $1 WHERE id = $2`, [req.body.photo_url || null, req.params.id]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/chittai/:id/accounted", async (req, res) => {
  try {
    await pool.query(`UPDATE chittai SET is_accounted = $1 WHERE id = $2`, [req.body.is_accounted, req.params.id]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
