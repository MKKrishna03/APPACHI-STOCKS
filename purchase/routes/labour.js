const express = require("express");
const { pool } = require("../db");
const { deleteCloudinaryPhoto } = require("./cloudinary");
const { logActivity } = require("./activityLog");

const router = express.Router();

pool.query(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT FALSE`)
  .catch(e => console.error("labour is_cancelled column error:", e.message));

router.get("/labour/list", async (req, res) => {
  const { profile_id, voucher_type } = req.query;
  try {
    const params = [];
    let where = "WHERE l.deleted_at IS NULL";
    if (profile_id) {
      params.push(profile_id);
      where += ` AND l.profile_id = $${params.length}`;
    }
    if (voucher_type) {
      params.push(voucher_type);
      where += ` AND l.voucher_type ILIKE $${params.length}`;
    }
    const result = await pool.query(
      `SELECT l.id, l.profile_id, l.company_name, l.date, l.issue_number, l.receipt_bill_no,
              l.voucher_type, l.bill_value_after_deduction, l.total, l.payment_voucher_id,
              COALESCE(
                l.remaining_value,
                CASE WHEN l.payment_voucher_id IS NOT NULL
                  THEN GREATEST(0::numeric,
                    COALESCE(l.bill_value_after_deduction, l.total, 0)::numeric
                    - COALESCE(pv.total_value, 0)::numeric)
                  ELSE NULL
                END
              ) AS remaining_value,
              COALESCE(SUM(li.amount::numeric), 0) AS total_value
       FROM labour l
       LEFT JOIN labour_items li ON li.labour_id = l.id
       LEFT JOIN vouchers pv ON pv.id = l.payment_voucher_id
       ${where}
       GROUP BY l.id, pv.total_value
       ORDER BY l.created_at DESC`,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/labour/rv-references", async (req, res) => {
  const { issue_number, profile_id } = req.query;
  if (!issue_number || !profile_id) return res.json([]);
  try {
    const result = await pool.query(
      `SELECT id, receipt_bill_no, issue_number, date FROM labour
       WHERE voucher_type = 'Receipt Voucher' AND profile_id = $1 AND issue_number IS NOT NULL
         AND (issue_number = $2 OR issue_number LIKE $3 OR issue_number LIKE $4 OR issue_number LIKE $5)
         AND deleted_at IS NULL`,
      [profile_id, issue_number, `${issue_number},%`, `%,${issue_number}`, `%,${issue_number},%`],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/labour/unlinked-receipts", async (req, res) => {
  const { profile_id } = req.query;
  if (!profile_id) return res.status(400).json({ error: "profile_id required" });
  try {
    const linkedIds = await pool.query(`SELECT linked_labour_id FROM vouchers WHERE linked_labour_id IS NOT NULL AND deleted_at IS NULL`);
    const linkedSet = linkedIds.rows.map((r) => r.linked_labour_id);
    const result = await pool.query(
      `SELECT id, issue_number, receipt_bill_no, date FROM labour WHERE voucher_type = 'Receipt Voucher' AND profile_id = $1 AND deleted_at IS NULL`,
      [profile_id],
    );
    res.json(result.rows.filter((r) => !linkedSet.includes(r.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/labour/mc-bill-issues", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.id, l.profile_id, l.company_name, l.date, l.issue_number,
              COALESCE(
                NULLIF(SUM(li.quantity::numeric), 0),
                (SELECT SUM(ri.quantity::numeric) FROM labour_items ri WHERE ri.labour_id = r.id)
              ) AS total_weight,
              p.address, p.city, p.pincode, p.pan_number, p.gst_number,
              l.mc_receipt_id,
              r.receipt_bill_no AS mc_receipt_bill_no,
              r.gold_rate       AS mc_gold_rate,
              r.mc_pct,
              r.date            AS mc_receipt_date,
              r.taxable_total   AS mc_taxable_total,
              r.round_off       AS mc_round_off,
              r.total           AS mc_total,
              r.bill_value_after_deduction AS mc_bill_value_after_deduction,
              r.photo_url       AS mc_photo_url
       FROM labour l
       LEFT JOIN labour_items li ON li.labour_id = l.id
       LEFT JOIN profiles p ON p.id = l.profile_id
       LEFT JOIN labour r ON r.id = l.mc_receipt_id AND r.deleted_at IS NULL
       WHERE l.voucher_type = 'ISSUE VOUCHER'
         AND UPPER(l.labour_item_type) = 'OTHERS'
         AND l.deleted_at IS NULL
       GROUP BY l.id, l.profile_id, l.company_name, l.date, l.issue_number,
                p.address, p.city, p.pincode, p.pan_number, p.gst_number,
                l.mc_receipt_id, r.id, r.receipt_bill_no, r.gold_rate, r.mc_pct, r.date,
                r.taxable_total, r.round_off, r.total, r.bill_value_after_deduction, r.photo_url
       ORDER BY l.date DESC`,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/labour/:id", async (req, res) => {
  if (isNaN(req.params.id)) return res.status(404).json({ error: "Not found" });
  try {
    const labourResult = await pool.query("SELECT * FROM labour WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    if (!labourResult.rows[0]) return res.status(404).json({ error: "Labour not found" });
    const itemsResult = await pool.query(
      "SELECT * FROM labour_items WHERE labour_id = $1 ORDER BY sl_no",
      [req.params.id],
    );
    res.json({ labour: labourResult.rows[0], items: itemsResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/labour", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, u.name AS created_by_name,
              CASE WHEN l.voucher_type = 'Receipt Voucher'
                   THEN (SELECT iv.labour_item_type FROM labour iv
                         WHERE UPPER(iv.voucher_type) = 'ISSUE VOUCHER'
                           AND (l.issue_number = iv.issue_number OR l.issue_number LIKE '%' || iv.issue_number || '%')
                           AND iv.deleted_at IS NULL
                         LIMIT 1)
                   ELSE l.labour_item_type
              END AS effective_item_type
       FROM labour l
       LEFT JOIN auth_users u ON u.user_id::text = l.created_by
       WHERE l.deleted_at IS NULL
       ORDER BY l.created_at DESC`,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/labour", async (req, res) => {
  const { profile_id, company_name, date, issue_number, labour_item_type, items } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO labour (profile_id, company_name, date, issue_number, labour_item_type, voucher_type, created_by)
       VALUES ($1, $2, $3, $4, $5, 'ISSUE VOUCHER', $6) RETURNING *`,
      [profile_id, company_name, date, issue_number, labour_item_type, req.body.created_by || null],
    );
    const labourId = result.rows[0].id;
    for (const item of items) {
      await client.query(
        `INSERT INTO labour_items (labour_id, sl_no, description, quantity, rate, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
        [labourId, item.sl_no, item.description, item.quantity, item.rate, item.amount],
      );
    }
    await client.query("COMMIT");
    logActivity({ action: "CREATE", entity_type: "Issue Voucher", entity_id: labourId, bill_no: issue_number, profile_id, company_name, user_id: req.user?.user_id || req.body.created_by, user_name: req.user?.name });
    res.json({ status: "SUCCESS", id: labourId });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put("/labour/:id/with-cascade", async (req, res) => {
  const { profile_id, company_name, date, issue_number, labour_item_type, items, old_issue_number } = req.body;
  const id = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE labour SET profile_id=$1, company_name=$2, date=$3, issue_number=$4, labour_item_type=$5 WHERE id=$6`,
      [profile_id, company_name, date, issue_number, labour_item_type, id],
    );
    if (items?.length) {
      await client.query(`DELETE FROM labour_items WHERE labour_id=$1`, [id]);
      for (const item of items) {
        await client.query(
          `INSERT INTO labour_items (labour_id, sl_no, description, quantity, rate, amount) VALUES ($1,$2,$3,$4,$5,$6)`,
          [id, item.sl_no, item.description, item.quantity, item.rate, item.amount],
        );
      }
    }
    let updated_rv_count = 0;
    if (old_issue_number && issue_number && old_issue_number !== issue_number) {
      const rvs = await client.query(
        `SELECT id, issue_number FROM labour WHERE voucher_type = 'Receipt Voucher' AND profile_id = $1 AND issue_number IS NOT NULL AND deleted_at IS NULL`,
        [profile_id],
      );
      for (const rv of rvs.rows) {
        const parts = rv.issue_number.split(",").map((s) => s.trim());
        const idx = parts.indexOf(old_issue_number);
        if (idx !== -1) {
          parts[idx] = issue_number;
          await client.query(`UPDATE labour SET issue_number=$1 WHERE id=$2`, [parts.join(","), rv.id]);
          updated_rv_count++;
        }
      }
    }
    await client.query("COMMIT");
    logActivity({ action: "UPDATE", entity_type: "Issue Voucher", entity_id: parseInt(id), bill_no: issue_number, profile_id, company_name, user_id: req.user?.user_id, user_name: req.user?.name });
    res.json({ status: "SUCCESS", updated_rv_count });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put("/labour/:id", async (req, res) => {
  const {
    profile_id, company_name, date, issue_number, labour_item_type, items,
    receipt_bill_no, taxable_total, cgst, sgst, igst, round_off, total, tds, bill_value_after_deduction,
    payment_voucher_id, labour_ids,
  } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (profile_id !== undefined) {
      await client.query(
        `UPDATE labour SET profile_id=$1, company_name=$2, date=$3, issue_number=$4, labour_item_type=$5 WHERE id=$6`,
        [profile_id, company_name, date, issue_number, labour_item_type, req.params.id],
      );
    } else {
      const newPvId = payment_voucher_id || null;
      const cur = await client.query(`SELECT payment_voucher_id FROM labour WHERE id = $1`, [req.params.id]);
      const oldPvId = cur.rows[0]?.payment_voucher_id || null;
      if (oldPvId && String(oldPvId) !== String(newPvId)) {
        await client.query(`UPDATE vouchers SET linked_labour_id = NULL WHERE id = $1`, [oldPvId]);
      }
      if (newPvId && String(newPvId) !== String(oldPvId)) {
        await client.query(`UPDATE vouchers SET linked_labour_id = $1 WHERE id = $2`, [req.params.id, newPvId]);
      }
      let newRemaining = null;
      if (newPvId) {
        const pvRes = await client.query(`SELECT total_value FROM vouchers WHERE id = $1`, [newPvId]);
        const pvAmt = parseFloat(pvRes.rows[0]?.total_value || 0);
        const billAmt = parseFloat(bill_value_after_deduction ?? total ?? 0);
        newRemaining = Math.max(0, billAmt - pvAmt);
      } else {
        newRemaining = parseFloat(bill_value_after_deduction ?? total ?? 0) || null;
      }
      // If labour_ids supplied (user changed the IV selection), recompute issue_number
      let newIssueNumber = null;
      if (labour_ids?.length) {
        const nums = await Promise.all(
          labour_ids.map(async (lid) => {
            const r = await client.query("SELECT issue_number FROM labour WHERE id = $1", [lid]);
            return r.rows[0]?.issue_number || String(lid);
          })
        );
        newIssueNumber = nums.join(",");
      }
      await client.query(
        `UPDATE labour SET date=$1, receipt_bill_no=$2, taxable_total=$3, cgst=$4, sgst=$5, igst=$6, round_off=$7, total=$8, tds=$9, bill_value_after_deduction=$10, photo_url=COALESCE($11, photo_url), photo_urls=COALESCE($12, photo_urls), payment_voucher_id=$13, remaining_value=$14, gold_rate=COALESCE($15, gold_rate), mc_pct=COALESCE($16, mc_pct), issue_number=COALESCE($17, issue_number) WHERE id=$18`,
        [
          date, receipt_bill_no, taxable_total || null, cgst || null, sgst || null,
          igst || null, round_off || null, total || null, tds || null,
          bill_value_after_deduction || null, req.body.photo_url || null,
          req.body.photo_urls?.length ? req.body.photo_urls : null, newPvId, newRemaining,
          req.body.gold_rate || null, req.body.mc_pct || null, newIssueNumber, req.params.id,
        ],
      );
    }
    if (items?.length) {
      await client.query(`DELETE FROM labour_items WHERE labour_id=$1`, [req.params.id]);
      for (const item of items) {
        await client.query(
          `INSERT INTO labour_items (labour_id, sl_no, description, quantity, rate, tax_percent, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.params.id, item.sl_no, item.description, item.quantity, item.rate, item.tax_percent ?? null, item.amount],
        );
      }
    }
    await client.query("COMMIT");
    if (profile_id !== undefined) {
      logActivity({ action: "UPDATE", entity_type: "Issue Voucher", entity_id: parseInt(req.params.id), bill_no: issue_number, profile_id, company_name, user_id: req.user?.user_id, user_name: req.user?.name });
    } else {
      pool.query(`SELECT profile_id, company_name FROM labour WHERE id=$1`, [req.params.id])
        .then(r => { const ro = r.rows[0] || {}; logActivity({ action: "UPDATE", entity_type: "Receipt Voucher", entity_id: parseInt(req.params.id), bill_no: receipt_bill_no, profile_id: ro.profile_id, company_name: ro.company_name, user_id: req.user?.user_id, user_name: req.user?.name }); })
        .catch(() => {});
    }
    res.json({ status: "SUCCESS" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch("/labour/:id/accounted", async (req, res) => {
  try {
    await pool.query(`UPDATE labour SET is_accounted = $1 WHERE id = $2`, [req.body.is_accounted, req.params.id]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/close-issue-voucher", async (req, res) => {
  const {
    labour_id, labour_ids, closing_date, closing_type, partial_qty, items,
    payment_voucher_id, taxable_total, cgst, sgst, igst, round_off, total, tds, bill_value_after_deduction,
  } = req.body;

  if (labour_ids?.length) {
    const client = await pool.connect();
    try {
      const firstRes = await pool.query("SELECT * FROM labour WHERE id = $1", [labour_ids[0]]);
      if (!firstRes.rows[0]) return res.status(404).json({ error: "Labour bill not found" });
      const labour = firstRes.rows[0];
      const issueNumbers = await Promise.all(
        labour_ids.map(async (id) => {
          const r = await pool.query("SELECT issue_number FROM labour WHERE id = $1", [id]);
          return r.rows[0] ? r.rows[0].issue_number : id;
        }),
      );
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO labour (profile_id, company_name, date, issue_number, voucher_type, receipt_bill_no, taxable_total, cgst, sgst, igst, round_off, total, tds, bill_value_after_deduction, created_by, photo_url, photo_urls, payment_voucher_id, gold_rate, mc_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
        [
          labour.profile_id, labour.company_name, closing_date, issueNumbers.join(","),
          "Receipt Voucher", req.body.bill_no || null, taxable_total ?? null, cgst ?? null,
          sgst ?? null, igst ?? null, round_off ?? null, total ?? null, tds ?? null,
          bill_value_after_deduction ?? null, req.body.created_by || null,
          req.body.photo_url || null, req.body.photo_urls?.length ? req.body.photo_urls : null,
          payment_voucher_id || null, req.body.gold_rate ?? null, req.body.mc_pct ?? null,
        ],
      );
      const close_labour_id = result.rows[0].id;
      if (items?.length) {
        for (const item of items) {
          await client.query(
            `INSERT INTO labour_items (labour_id, sl_no, description, quantity, rate, tax_percent, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [close_labour_id, item.sl_no, item.description, item.quantity, item.rate, item.tax_percent ?? null, item.amount],
          );
        }
      }
      if (payment_voucher_id) {
        const pvRes = await client.query(`SELECT total_value FROM vouchers WHERE id = $1`, [payment_voucher_id]);
        const pvAmt = parseFloat(pvRes.rows[0]?.total_value || 0);
        const billAmt = parseFloat(bill_value_after_deduction ?? total ?? 0);
        await client.query(`UPDATE labour SET remaining_value = $1 WHERE id = $2`, [Math.max(0, billAmt - pvAmt), close_labour_id]);
        await client.query(`UPDATE vouchers SET linked_labour_id = $1 WHERE id = $2`, [close_labour_id, payment_voucher_id]);
      }
      if (req.body.is_mc) {
        for (const id of labour_ids) {
          await client.query(`UPDATE labour SET mc_receipt_id = $1 WHERE id = $2`, [close_labour_id, id]);
        }
      }
      await client.query("COMMIT");
      logActivity({ action: "CREATE", entity_type: "Receipt Voucher", entity_id: close_labour_id, bill_no: req.body.bill_no || null, profile_id: labour.profile_id, company_name: labour.company_name, user_id: req.user?.user_id || req.body.created_by, user_name: req.user?.name });
      console.log("[close-issue-voucher] BULK saved receipt id=%d issue_number=%s labour_ids=%j", close_labour_id, issueNumbers.join(","), labour_ids);
      return res.json({ status: "SUCCESS", id: close_labour_id, saved_issue_number: issueNumbers.join(","), saved_count: labour_ids.length });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[close-issue-voucher] ROLLBACK error:", err.message, "labour_ids:", labour_ids);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  const client = await pool.connect();
  try {
    const labourResult = await pool.query("SELECT * FROM labour WHERE id = $1", [labour_id]);
    if (!labourResult.rows[0]) return res.status(404).json({ error: "Labour bill not found" });
    const labour = labourResult.rows[0];
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO labour (profile_id, company_name, date, issue_number, voucher_type, receipt_bill_no, taxable_total, cgst, sgst, igst, round_off, total, tds, bill_value_after_deduction, created_by, photo_url, photo_urls, payment_voucher_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        labour.profile_id, labour.company_name, closing_date, labour.issue_number,
        "Receipt Voucher", req.body.bill_no || null, taxable_total ?? null, cgst ?? null,
        sgst ?? null, igst ?? null, round_off ?? null, total ?? null, tds ?? null,
        bill_value_after_deduction ?? null, req.body.created_by || null,
        req.body.photo_url || null, req.body.photo_urls?.length ? req.body.photo_urls : null,
        payment_voucher_id || null,
      ],
    );
    const close_labour_id = result.rows[0].id;
    if (items?.length) {
      for (const item of items) {
        await client.query(
          `INSERT INTO labour_items (labour_id, sl_no, description, quantity, rate, tax_percent, amount) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            close_labour_id, item.sl_no, item.description,
            partial_qty && closing_type === "partial" ? partial_qty : item.quantity,
            item.rate, item.tax_percent ?? null, item.amount,
          ],
        );
      }
    }
    if (payment_voucher_id) {
      const pvRes = await client.query(`SELECT total_value FROM vouchers WHERE id = $1`, [payment_voucher_id]);
      const pvAmt = parseFloat(pvRes.rows[0]?.total_value || 0);
      const billAmt = parseFloat(bill_value_after_deduction ?? total ?? 0);
      await client.query(`UPDATE labour SET remaining_value = $1 WHERE id = $2`, [Math.max(0, billAmt - pvAmt), close_labour_id]);
      await client.query(`UPDATE vouchers SET linked_labour_id = $1 WHERE id = $2`, [close_labour_id, payment_voucher_id]);
    }
    await client.query("COMMIT");
    logActivity({ action: "CREATE", entity_type: "Receipt Voucher", entity_id: close_labour_id, bill_no: req.body.bill_no || null, profile_id: labour.profile_id, company_name: labour.company_name, user_id: req.user?.user_id || req.body.created_by, user_name: req.user?.name });
    res.json({ status: "SUCCESS", id: close_labour_id });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.patch("/labour/:id/mc", async (req, res) => {
  const { date, receipt_bill_no, gold_rate, mc_pct, photo_url } = req.body;
  try {
    if (photo_url) {
      const old = await pool.query(`SELECT photo_url FROM labour WHERE id = $1`, [req.params.id]);
      const oldUrl = old.rows[0]?.photo_url;
      // UPDATE first — if it fails, old Cloudinary photo is preserved
      await pool.query(
        `UPDATE labour SET date=$1, receipt_bill_no=$2, gold_rate=$3, mc_pct=$4, photo_url=$5 WHERE id=$6`,
        [date || null, receipt_bill_no || null, gold_rate ?? null, mc_pct ?? null, photo_url, req.params.id],
      );
      // Delete old photo AFTER DB is updated (unique filename guarantees old != new)
      if (oldUrl && oldUrl !== photo_url) await deleteCloudinaryPhoto(oldUrl);
    } else {
      await pool.query(
        `UPDATE labour SET date=$1, receipt_bill_no=$2, gold_rate=$3, mc_pct=$4 WHERE id=$5`,
        [date || null, receipt_bill_no || null, gold_rate ?? null, mc_pct ?? null, req.params.id],
      );
    }
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/labour/:id/cancel", async (req, res) => {
  const client = await pool.connect();
  try {
    const row = await client.query(`SELECT * FROM labour WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]);
    if (!row.rows[0]) return res.status(404).json({ error: "Not found" });
    const l = row.rows[0];
    await client.query("BEGIN");
    await client.query(`UPDATE labour SET is_cancelled=TRUE WHERE id=$1`, [req.params.id]);
    await client.query(
      `INSERT INTO cancelled_bills (profile_id, bill_type, bill_no, date, amount, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        l.profile_id,
        "Issue Voucher",
        l.issue_number || "",
        l.date || null,
        null,
        req.body.reason || "Cancelled from bill view",
        req.body.cancelled_by || null,
      ],
    );
    await client.query("COMMIT");
    logActivity({ action: "CANCEL", entity_type: "Issue Voucher", entity_id: parseInt(req.params.id), bill_no: l.issue_number, profile_id: l.profile_id, company_name: l.company_name, user_id: req.user?.user_id, user_name: req.user?.name });
    res.json({ status: "SUCCESS" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete("/labour/:id", async (req, res) => {
  if (isNaN(req.params.id)) return res.status(404).json({ error: "Not found" });
  const client = await pool.connect();
  try {
    // Fetch photo URL before deleting so we can clean up Cloudinary
    const photoRes = await client.query(`SELECT photo_url FROM labour WHERE id = $1`, [req.params.id]);
    const photoUrl = photoRes.rows[0]?.photo_url;

    await client.query("BEGIN");
    await client.query(`UPDATE labour SET mc_receipt_id = NULL WHERE mc_receipt_id = $1 AND deleted_at IS NULL`, [req.params.id]);
    await client.query(`UPDATE labour SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    await client.query("COMMIT");

    // Delete Cloudinary photo after DB is committed (non-fatal if this fails)
    if (photoUrl) await deleteCloudinaryPhoto(photoUrl);

    res.json({ status: "SUCCESS" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
