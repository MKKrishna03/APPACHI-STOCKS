const express = require("express");
const { pool } = require("../db");

const router = express.Router();

pool.query(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id           SERIAL PRIMARY KEY,
    action       VARCHAR(20)  NOT NULL,
    entity_type  VARCHAR(80)  NOT NULL,
    entity_id    INTEGER,
    bill_no      VARCHAR(100),
    profile_id   INTEGER,
    company_name VARCHAR(255),
    details      TEXT,
    user_id      TEXT,
    user_name    TEXT,
    created_at   TIMESTAMP DEFAULT NOW()
  )
`).catch(e => console.error("activity_log table init error:", e.message));

async function logActivity({ action, entity_type, entity_id, bill_no, profile_id, company_name, details, user_id, user_name }) {
  pool.query(
    `INSERT INTO activity_log (action, entity_type, entity_id, bill_no, profile_id, company_name, details, user_id, user_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [action, entity_type, entity_id || null, bill_no || null, profile_id || null,
     company_name || null, details || null, user_id || null, user_name || null],
  ).catch(e => console.error("[activityLog]", e.message));
}

router.get("/activity-log", async (req, res) => {
  const { date } = req.query;
  try {
    const params = date ? [date] : [];
    const where = date
      ? `WHERE (al.created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`
      : "";
    const result = await pool.query(
      `SELECT al.*, COALESCE(pr.alias, pr.company_name) AS company_display
       FROM activity_log al
       LEFT JOIN profiles pr ON pr.id = al.profile_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT 500`,
      params,
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router, logActivity };
