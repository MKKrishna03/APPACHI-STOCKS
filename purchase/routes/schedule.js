const express = require("express");
const { oldPool: pool } = require("../db");

const router = express.Router();

router.get("/schedule/templates", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM schedule_templates ORDER BY day_of_month ASC");
  res.json(rows);
});

router.post("/schedule/templates", async (req, res) => {
  const { title, receiver, priority, day_of_month, deadline_days, notes } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO schedule_templates (title, receiver, priority, day_of_month, deadline_days, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [title, receiver, priority, day_of_month, deadline_days, notes],
  );
  res.json(rows[0]);
});

router.delete("/schedule/templates/:id", async (req, res) => {
  await pool.query("DELETE FROM schedule_templates WHERE id=$1", [req.params.id]);
  res.json({ status: "SUCCESS" });
});

router.get("/schedule/instances", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM schedule_instances ORDER BY scheduled_date ASC");
  res.json(rows);
});

router.post("/schedule/instances", async (req, res) => {
  const { template_id, title, receiver, priority, notes, scheduled_date, deadline_date, status } = req.body;
  const { rows } = await pool.query(
    "INSERT INTO schedule_instances (template_id, title, receiver, priority, notes, scheduled_date, deadline_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
    [template_id, title, receiver, priority, notes, scheduled_date, deadline_date, status || "pending"],
  );
  res.json(rows[0]);
});

router.patch("/schedule/instances/:id", async (req, res) => {
  const { status, done_at } = req.body;
  const { rows } = await pool.query(
    "UPDATE schedule_instances SET status=$1, done_at=$2 WHERE id=$3 RETURNING *",
    [status, done_at || null, req.params.id],
  );
  res.json(rows[0]);
});

router.delete("/schedule/instances/:id", async (req, res) => {
  await pool.query("DELETE FROM schedule_instances WHERE id=$1", [req.params.id]);
  res.json({ status: "SUCCESS" });
});

module.exports = router;
