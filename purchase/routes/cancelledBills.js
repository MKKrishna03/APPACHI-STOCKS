const express = require("express");
const { pool } = require("../db");

const router = express.Router();

// Create table on startup if it does not exist, then add fields_data if missing
pool.query(`
  CREATE TABLE IF NOT EXISTS cancelled_bills (
    id           SERIAL PRIMARY KEY,
    profile_id   INTEGER,
    bill_type    VARCHAR(60),
    bill_no      VARCHAR(100),
    date         DATE,
    amount       DECIMAL(15,2),
    reason       TEXT,
    photo_url    TEXT,
    photo_urls   TEXT[],
    created_by   TEXT,
    created_at   TIMESTAMP DEFAULT NOW()
  )
`).then(() =>
  pool.query(`ALTER TABLE cancelled_bills ADD COLUMN IF NOT EXISTS fields_data JSONB`)
).catch((e) => console.error("cancelled_bills table init error:", e.message));

// GET /api/cancelled-bills
router.get("/cancelled-bills", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cb.*, COALESCE(pr.alias, pr.company_name) AS company_name
       FROM cancelled_bills cb
       LEFT JOIN profiles pr ON pr.id = cb.profile_id
       ORDER BY cb.created_at DESC`,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cancelled-bills
router.post("/cancelled-bills", async (req, res) => {
  const {
    profile_id, bill_type, bill_no, date,
    amount, reason, fields_data, photo_url, photo_urls, created_by,
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO cancelled_bills
         (profile_id, bill_type, bill_no, date, amount, reason, fields_data, photo_url, photo_urls, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        profile_id || null,
        bill_type || "",
        bill_no || "",
        date || null,
        amount != null && amount !== "" ? amount : null,
        reason || "",
        fields_data ? JSON.stringify(fields_data) : null,
        photo_url || null,
        photo_urls?.length ? photo_urls : null,
        created_by || null,
      ],
    );
    res.json({ status: "SUCCESS", id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cancelled-bills/:id/accounted
router.patch("/cancelled-bills/:id/accounted", async (req, res) => {
  try {
    await pool.query(`UPDATE cancelled_bills SET is_accounted = $1 WHERE id = $2`, [req.body.is_accounted, req.params.id]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cancelled-bills/:id
router.delete("/cancelled-bills/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM cancelled_bills WHERE id=$1`, [req.params.id]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
