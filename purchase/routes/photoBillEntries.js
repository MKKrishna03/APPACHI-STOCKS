const express = require("express");
const { pool } = require("../db");
const { deleteCloudinaryPhoto } = require("./cloudinary");
const { logActivity } = require("./activityLog");

const router = express.Router();

pool.query(`
  CREATE TABLE IF NOT EXISTS photo_bill_entries (
    id           SERIAL PRIMARY KEY,
    profile_id   INTEGER,
    bill_no      VARCHAR(100),
    date         DATE,
    remarks      TEXT,
    photo_url    TEXT,
    photo_urls   TEXT[],
    is_accounted BOOLEAN DEFAULT false,
    created_by   TEXT,
    created_at   TIMESTAMP DEFAULT NOW()
  )
`).catch(e => console.error("photo_bill_entries table init error:", e.message));
pool.query(`ALTER TABLE photo_bill_entries ADD COLUMN IF NOT EXISTS is_accounted BOOLEAN DEFAULT false`)
  .catch(e => console.error("photo_bill_entries is_accounted column init error:", e.message));

router.get("/photo-bill-entries", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pbe.*, COALESCE(pr.alias, pr.company_name) AS company_name
       FROM photo_bill_entries pbe
       LEFT JOIN profiles pr ON pr.id = pbe.profile_id
       ORDER BY COALESCE(pbe.date, pbe.created_at::date) DESC, pbe.created_at DESC`,
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/photo-bill-entries", async (req, res) => {
  const { profile_id, bill_no, date, remarks, photo_url, photo_urls, created_by } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO photo_bill_entries (profile_id, bill_no, date, remarks, photo_url, photo_urls, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        profile_id || null, bill_no || "", date || null, remarks || "",
        photo_url || null, photo_urls?.length ? photo_urls : null, created_by || null,
      ],
    );
    logActivity({ action: "CREATE", entity_type: "Photo Bill Entry", entity_id: result.rows[0].id, bill_no: bill_no || null, profile_id: profile_id || null, user_id: req.user?.user_id || created_by, user_name: req.user?.name });
    res.json({ status: "SUCCESS", id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch("/photo-bill-entries/:id/accounted", async (req, res) => {
  try {
    await pool.query(`UPDATE photo_bill_entries SET is_accounted = $1 WHERE id = $2`, [req.body.is_accounted, req.params.id]);
    res.json({ status: "SUCCESS" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/photo-bill-entries/:id", async (req, res) => {
  try {
    const row = await pool.query(`SELECT photo_url, photo_urls, bill_no, profile_id FROM photo_bill_entries WHERE id=$1`, [req.params.id]);
    const r = row.rows[0];
    if (r) {
      const urls = [...(r.photo_urls || []), r.photo_url].filter(Boolean);
      for (const u of urls) await deleteCloudinaryPhoto(u);
    }
    await pool.query(`DELETE FROM photo_bill_entries WHERE id=$1`, [req.params.id]);
    logActivity({ action: "DELETE", entity_type: "Photo Bill Entry", entity_id: Number(req.params.id), bill_no: r?.bill_no || null, profile_id: r?.profile_id || null, user_id: req.user?.user_id, user_name: req.user?.name });
    res.json({ status: "SUCCESS" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
