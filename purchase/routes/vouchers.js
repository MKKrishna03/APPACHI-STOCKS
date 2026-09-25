const express = require("express");
const { pool } = require("../db");
const { logActivity } = require("./activityLog");

const router = express.Router();

function num(v) {
  return v === "" || v == null ? null : v;
}

router.get("/voucher-types", async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM voucher_types ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/voucher-type", async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query("INSERT INTO voucher_types (name) VALUES ($1) ON CONFLICT DO NOTHING", [name]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



router.get("/labour-item-types", async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM labour_item_types ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/vouchers/list", async (req, res) => {
  const { profile_id, voucher_type, unlinked_only } = req.query;
  try {
    const params = [];
    let where = "WHERE v.deleted_at IS NULL";
    if (profile_id && profile_id !== "undefined" && profile_id !== "null") {
      params.push(profile_id);
      where += ` AND v.profile_id = $${params.length}`;
    }
    if (voucher_type) {
      params.push(`%${voucher_type}%`);
      where += ` AND v.voucher_type ILIKE $${params.length}`;
    }
    if (unlinked_only === "true") {
      where += ` AND linked_labour_id IS NULL AND linked_chittai_id IS NULL AND linked_purchase_id IS NULL AND v.voucher_type NOT IN ('Payment Voucher', 'Receipt Voucher', 'Chittai Payment')`;
    }
    const result = await pool.query(
      `SELECT v.id, v.profile_id, v.voucher_type, v.date, v.bill_no, v.total_value, v.entry_type,
              v.description, v.linked_labour_id, v.linked_chittai_id, v.linked_purchase_id,
              v.created_at, v.created_by, u.name AS created_by_name
       FROM vouchers v LEFT JOIN auth_users u ON u.user_id::text = v.created_by
       ${where} ORDER BY v.created_at DESC`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/vouchers", async (req, res) => {
  const {
    profile_id, voucher_type, date, bill_no, entry_type, description,
    qty, rate, va, taxable_value, tax_percent, igst, cgst, sgst, tax_amount, total_value,
  } = req.body;
  const against_type = req.body.against_type;
  const billNos = Array.isArray(req.body.bill_nos) && req.body.bill_nos.length
    ? req.body.bill_nos
    : (bill_no ? [bill_no] : []);
  const billAmounts = Array.isArray(req.body.bill_amounts) ? req.body.bill_amounts : [];
  try {
    let linked_labour_id = null;
    if (entry_type === "against" && against_type === "Receipt Voucher" && billNos.length) {
      for (let i = 0; i < billNos.length; i++) {
        const payAmt = parseFloat(billAmounts[i] ?? 0) || 0;
        const labourMatch = await pool.query(
          `SELECT id, COALESCE(remaining_value, bill_value_after_deduction, total) AS rem FROM labour WHERE receipt_bill_no = $1 AND profile_id = $2 AND voucher_type = 'Receipt Voucher' LIMIT 1`,
          [billNos[i], profile_id],
        );
        const row = labourMatch.rows[0];
        if (row) {
          if (!linked_labour_id) linked_labour_id = row.id;
          const newRem = Math.max(0, parseFloat(row.rem || 0) - payAmt);
          await pool.query(`UPDATE labour SET remaining_value=$1 WHERE id=$2`, [newRem, row.id]);
        }
      }
    }
    let linked_chittai_id = null;
    if (entry_type === "against" && billNos.length) {
      for (const bNo of billNos) {
        const chittaiMatch = await pool.query(
          `SELECT id FROM chittai WHERE chittai_no = $1 AND profile_id = $2 LIMIT 1`,
          [bNo, profile_id],
        );
        if (chittaiMatch.rows[0]) {
          if (!linked_chittai_id) linked_chittai_id = chittaiMatch.rows[0].id;
          await pool.query(`UPDATE chittai SET is_paid=true WHERE id=$1`, [chittaiMatch.rows[0].id]);
        }
      }
    }
    if (entry_type === "against" && against_type === "Purchase Voucher" && billNos.length) {
      for (let i = 0; i < billNos.length; i++) {
        const payAmt = parseFloat(billAmounts[i] ?? 0) || 0;
        const purchaseMatch = await pool.query(
          `SELECT id, COALESCE(remaining_value, net_value, total_value) AS rem FROM purchases WHERE bill_no = $1 AND profile_id = $2 LIMIT 1`,
          [billNos[i], profile_id],
        );
        const row = purchaseMatch.rows[0];
        if (row) {
          const newRem = Math.max(0, parseFloat(row.rem || 0) - payAmt);
          await pool.query(`UPDATE purchases SET remaining_value=$1 WHERE id=$2`, [newRem, row.id]);
        }
      }
    }
    let voucher_no = null;
    if (voucher_type === "Payment Voucher") {
      const seq = await pool.query(`SELECT nextval('payment_voucher_seq') AS val`);
      voucher_no = "P-" + String(seq.rows[0].val).padStart(2, "0");
    } else if (voucher_type === "Receipt Voucher") {
      const seq = await pool.query(`SELECT nextval('receipt_voucher_seq') AS val`);
      voucher_no = "R-" + String(seq.rows[0].val).padStart(2, "0");
    }
    const result = await pool.query(
      `INSERT INTO vouchers
        (profile_id,voucher_type,date,bill_no,entry_type,description,qty,rate,va,taxable_value,
         tax_percent,igst,cgst,sgst,tax_amount,total_value,linked_labour_id,linked_chittai_id,created_by,voucher_no)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [
        profile_id, voucher_type, date, bill_no, entry_type, description,
        num(qty), num(rate), num(va), num(taxable_value), num(tax_percent),
        num(igst), num(cgst), num(sgst), num(tax_amount), num(total_value),
        linked_labour_id, linked_chittai_id, req.body.created_by || null, voucher_no,
      ],
    );
    logActivity({ action: "CREATE", entity_type: voucher_type, entity_id: result.rows[0].id, bill_no, profile_id, user_id: req.user?.user_id || req.body.created_by, user_name: req.user?.name });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/vouchers/:id", async (req, res) => {
  const { date, total_value, description, linked_chittai_id, profile_id, voucher_type, bill_no, entry_type } = req.body;
  try {
    let result;
    if (linked_chittai_id !== undefined && Object.keys(req.body).length === 1) {
      result = await pool.query(`UPDATE vouchers SET linked_chittai_id=$1 WHERE id=$2 RETURNING *`, [linked_chittai_id, req.params.id]);
    } else {
      let linked_chittai_id_val = null;
      if (entry_type === "against" && bill_no && profile_id) {
        const chittaiMatch = await pool.query(`SELECT id FROM chittai WHERE chittai_no = $1 AND profile_id = $2 LIMIT 1`, [bill_no, profile_id]);
        if (chittaiMatch.rows[0]) {
          linked_chittai_id_val = chittaiMatch.rows[0].id;
          await pool.query(`UPDATE chittai SET is_paid=true WHERE id=$1`, [linked_chittai_id_val]);
        }
      }
      result = await pool.query(
        `UPDATE vouchers SET profile_id=$1, voucher_type=$2, date=$3, bill_no=$4, entry_type=$5, description=$6, total_value=$7, linked_chittai_id=COALESCE($8, linked_chittai_id) WHERE id=$9 RETURNING *`,
        [profile_id, voucher_type, date, bill_no, entry_type, description, total_value, linked_chittai_id_val, req.params.id],
      );
      logActivity({ action: "UPDATE", entity_type: voucher_type, entity_id: Number(req.params.id), bill_no, profile_id, user_id: req.user?.user_id, user_name: req.user?.name });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
