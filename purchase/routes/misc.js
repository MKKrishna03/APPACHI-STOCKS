const express = require("express");
const { pool } = require("../db");
const { logActivity } = require("./activityLog");

const router = express.Router();

// ── Reference data ──

router.get("/descriptions/metal", async (req, res) => {
  try {
    const result = await pool.query("SELECT name, metal_type FROM descriptions ORDER BY name");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/descriptions", async (req, res) => {
  try {
    const result = await pool.query("SELECT name FROM descriptions ORDER BY name");
    res.json(result.rows.map((r) => r.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/tax-formats", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, percent FROM tax_format ORDER BY percent ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/tds", async (req, res) => {
  const { section } = req.query;
  try {
    const result = section
      ? await pool.query(
          "SELECT id, pan_4th_letter, section, entity_type, tds_percentage, remarks FROM tds WHERE section = $1 ORDER BY pan_4th_letter",
          [section],
        )
      : await pool.query(
          "SELECT id, pan_4th_letter, section, entity_type, tds_percentage, remarks FROM tds ORDER BY section, pan_4th_letter",
        );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/tds-required/:profile_id", async (req, res) => {
  try {
    const { profile_id } = req.params;
    const now = new Date();
    const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStart = `${fyYear}-04-01`;
    const fyEnd = `${fyYear + 1}-03-31`;
    const result = await pool.query(
      `SELECT tds FROM purchases WHERE profile_id=$1 AND tds IS NOT NULL AND tds>0 AND date BETWEEN $2 AND $3 AND deleted_at IS NULL
       UNION ALL
       SELECT tds FROM labour WHERE profile_id=$1 AND voucher_type='Receipt Voucher' AND tds IS NOT NULL AND tds>0 AND date BETWEEN $2 AND $3 AND deleted_at IS NULL
       UNION ALL
       SELECT tds FROM hallmark_expenses WHERE profile_id=$1 AND tds IS NOT NULL AND tds>0 AND date BETWEEN $2 AND $3 AND deleted_at IS NULL
       LIMIT 1`,
      [profile_id, fyStart, fyEnd],
    );
    res.json({ required: result.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Linked data ──

router.get("/linked-data/:type/:id", async (req, res) => {
  const { type, id } = req.params;
  try {
    const linked = [];
    if (type === "issue") {
      const rvs = await pool.query(
        `SELECT id, receipt_bill_no, date FROM labour WHERE voucher_type='Receipt Voucher' AND (issue_number=(SELECT issue_number FROM labour WHERE id=$1) OR issue_number LIKE '%' || (SELECT issue_number FROM labour WHERE id=$1) || '%')`,
        [id],
      );
      rvs.rows.forEach((r) => linked.push({
        type: "receipt", id: r.id,
        label: `Receipt Voucher: ${r.receipt_bill_no || "ID-" + r.id} (${r.date?.toString().slice(0, 10)})`,
      }));
    }
    if (type === "receipt") {
      const vs = await pool.query(`SELECT id, bill_no, total_value FROM vouchers WHERE linked_labour_id=$1`, [id]);
      vs.rows.forEach((v) => linked.push({ type: "voucher", id: v.id, label: `Payment Voucher: ${v.bill_no || "ID-" + v.id} ₹${v.total_value}` }));
    }
    if (type === "purchase") {
      const vs = await pool.query(`SELECT id, bill_no, total_value FROM vouchers WHERE linked_purchase_id=$1`, [id]);
      vs.rows.forEach((v) => linked.push({ type: "voucher", id: v.id, label: `Payment Voucher: ${v.bill_no || "ID-" + v.id} ₹${v.total_value}` }));
    }
    if (type === "hallmark") {
      const vs = await pool.query(`SELECT id, bill_no, total_value FROM vouchers WHERE linked_purchase_id=$1`, [id]);
      vs.rows.forEach((v) => linked.push({ type: "voucher", id: v.id, label: `Payment Voucher: ${v.bill_no || "ID-" + v.id} ₹${v.total_value}` }));
    }
    if (type === "chittai") {
      const vs = await pool.query(`SELECT id, bill_no, total_value FROM vouchers WHERE linked_chittai_id=$1`, [id]);
      vs.rows.forEach((v) => linked.push({ type: "voucher", id: v.id, label: `Payment Voucher: ${v.bill_no || "ID-" + v.id} ₹${v.total_value}` }));
      const ps = await pool.query(`SELECT id, bill_no FROM purchases WHERE linked_chittai_id=$1`, [id]);
      ps.rows.forEach((p) => linked.push({ type: "purchase", id: p.id, label: `Purchase: ${p.bill_no || "ID-" + p.id}` }));
    }
    res.json(linked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete entry (soft-delete: sets deleted_at, preserves data for recovery) ──

async function softDeleteLinked(l) {
  if (l.type === "voucher") {
    await pool.query(`UPDATE vouchers SET deleted_at=NOW() WHERE id=$1`, [l.id]);
  } else if (l.type === "receipt") {
    await pool.query(`UPDATE labour SET deleted_at=NOW() WHERE id=$1`, [l.id]);
  } else if (l.type === "purchase") {
    await pool.query(`UPDATE vouchers SET linked_purchase_id=NULL WHERE linked_purchase_id=$1`, [l.id]);
    await pool.query(`UPDATE chittai SET linked_purchase_id=NULL WHERE linked_purchase_id=$1`, [l.id]);
    await pool.query(`UPDATE purchases SET deleted_at=NOW() WHERE id=$1`, [l.id]);
  }
}

async function softDeleteById(type, id) {
  if (type === "issue" || type === "receipt") {
    await pool.query(`UPDATE labour SET deleted_at=NOW() WHERE id=$1`, [id]);
  } else if (type === "txn") {
    await pool.query(`UPDATE vouchers SET deleted_at=NOW() WHERE id=$1`, [id]);
  } else if (type === "purchase") {
    const group = await pool.query(
      `SELECT id FROM purchases
       WHERE bill_no=(SELECT bill_no FROM purchases WHERE id=$1)
         AND profile_id=(SELECT profile_id FROM purchases WHERE id=$1)
         AND deleted_at IS NULL`,
      [id],
    );
    for (const row of group.rows) {
      await pool.query(`UPDATE vouchers SET linked_purchase_id=NULL WHERE linked_purchase_id=$1`, [row.id]);
      await pool.query(`UPDATE chittai SET linked_purchase_id=NULL WHERE linked_purchase_id=$1`, [row.id]);
      await pool.query(`UPDATE purchases SET deleted_at=NOW() WHERE id=$1`, [row.id]);
    }
  } else if (type === "chittai") {
    await pool.query(`UPDATE vouchers SET linked_chittai_id=NULL WHERE linked_chittai_id=$1`, [id]);
    await pool.query(`UPDATE purchases SET linked_chittai_id=NULL WHERE linked_chittai_id=$1`, [id]);
    await pool.query(`UPDATE chittai SET deleted_at=NOW() WHERE id=$1`, [id]);
  } else if (type === "hallmark") {
    await pool.query(`UPDATE vouchers SET linked_purchase_id=NULL WHERE linked_purchase_id=$1`, [id]);
    await pool.query(`UPDATE hallmark_expenses SET deleted_at=NOW() WHERE id=$1`, [id]);
  } else {
    throw new Error(`Unknown entry type: ${type}`);
  }
}

router.delete("/delete-entry", async (req, res) => {
  const { type, id, linked } = req.body;
  try {
    // Capture entity info before deletion for the activity log
    let logInfo = { entity_type: type, bill_no: null, profile_id: null, company_name: null };
    if (type === "issue" || type === "receipt") {
      const r = await pool.query(`SELECT issue_number, receipt_bill_no, profile_id, company_name, voucher_type FROM labour WHERE id=$1`, [id]);
      if (r.rows[0]) {
        const ro = r.rows[0];
        logInfo.entity_type = ro.voucher_type === "Receipt Voucher" ? "Receipt Voucher" : "Issue Voucher";
        logInfo.bill_no = ro.issue_number || ro.receipt_bill_no;
        logInfo.profile_id = ro.profile_id;
        logInfo.company_name = ro.company_name;
      }
    } else if (type === "txn") {
      const r = await pool.query(`SELECT bill_no, profile_id, voucher_type FROM vouchers WHERE id=$1`, [id]);
      if (r.rows[0]) { logInfo.entity_type = r.rows[0].voucher_type || "Transaction"; logInfo.bill_no = r.rows[0].bill_no; logInfo.profile_id = r.rows[0].profile_id; }
    } else if (type === "purchase") {
      const r = await pool.query(`SELECT bill_no, profile_id FROM purchases WHERE id=$1`, [id]);
      if (r.rows[0]) { logInfo.entity_type = "Purchase"; logInfo.bill_no = r.rows[0].bill_no; logInfo.profile_id = r.rows[0].profile_id; }
    } else if (type === "chittai") {
      const r = await pool.query(`SELECT chittai_no, profile_id FROM chittai WHERE id=$1`, [id]);
      if (r.rows[0]) { logInfo.entity_type = "Chittai"; logInfo.bill_no = r.rows[0].chittai_no; logInfo.profile_id = r.rows[0].profile_id; }
    } else if (type === "hallmark") {
      const r = await pool.query(`SELECT bill_no, profile_id, voucher_type FROM hallmark_expenses WHERE id=$1`, [id]);
      if (r.rows[0]) { logInfo.entity_type = r.rows[0].voucher_type || "Hallmark/Expense"; logInfo.bill_no = r.rows[0].bill_no; logInfo.profile_id = r.rows[0].profile_id; }
    }

    if (linked?.length) {
      for (const l of linked) await softDeleteLinked(l);
    }
    await softDeleteById(type, id);
    logActivity({ action: "DELETE", ...logInfo, entity_id: id, user_id: req.user?.user_id, user_name: req.user?.name });
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
