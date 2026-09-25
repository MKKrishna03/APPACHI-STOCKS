const express = require("express");
const { oldPool: pool } = require("../db");
const { broadcast } = require("../sse");

const router = express.Router();

router.get("/todos", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json([]);
  try {
    const result = await pool.query(
      `SELECT t.id, t.title, t.giver, t.receiver,
              COALESCE(u.name, t.receiver) AS receiver_name,
              to_char(t.date,'YYYY-MM-DD') as date, t.time, t.notes, t.status,
              t.priority, t.photo, t.replies, t.seen_at, t.done_at, t.created_at
       FROM todos t
       LEFT JOIN auth_users u ON u.user_id = t.receiver
       WHERE t.deleted_at IS NULL
         AND (t.receiver='all' OR t.receiver=$1 OR t.giver=$1
          OR t.giver=(SELECT name FROM auth_users WHERE user_id=$1))
       ORDER BY t.created_at DESC`,
      [user_id],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/todos", async (req, res) => {
  const { title, giver, receiver, date, time, notes, priority, photo } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO todos (title, giver, receiver, date, time, notes, priority, photo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [title, giver, receiver, date, time, notes || null, priority || "medium", photo || null],
    );
    broadcast("todo-update", {});
    res.json({ status: "SUCCESS", todo: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/todos/:id/reply", async (req, res) => {
  const { sender, text, photo } = req.body;
  try {
    const result = await pool.query(`SELECT replies FROM todos WHERE id=$1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    const replies = result.rows[0].replies || [];
    replies.push({ id: Date.now(), sender, text: text || "", photo: photo || null, created_at: new Date().toISOString(), seen_by: [sender] });
    await pool.query(`UPDATE todos SET replies=$1 WHERE id=$2`, [JSON.stringify(replies), req.params.id]);
    broadcast("todo-update", {});
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/todos/:id/replies-seen", async (req, res) => {
  const { user } = req.body;
  try {
    const result = await pool.query(`SELECT replies FROM todos WHERE id=$1`, [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    const replies = (result.rows[0].replies || []).map((r) => {
      if (!r.seen_by) r.seen_by = [];
      if (!r.seen_by.includes(user)) r.seen_by.push(user);
      return r;
    });
    await pool.query(`UPDATE todos SET replies=$1 WHERE id=$2`, [JSON.stringify(replies), req.params.id]);
    broadcast("todo-update", {});
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/todos/:id", async (req, res) => {
  const { status } = req.body;
  try {
    const col = status === "seen" ? "seen_at" : status === "done" ? "done_at" : null;
    if (col) {
      await pool.query(`UPDATE todos SET status=$1, ${col}=NOW() WHERE id=$2`, [status, req.params.id]);
    } else {
      await pool.query(`UPDATE todos SET status=$1 WHERE id=$2`, [status, req.params.id]);
    }
    broadcast("todo-update", {});
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/todos/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM todos WHERE id=$1`, [req.params.id]);
    broadcast("todo-update", {});
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reminders", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, to_char(date,'YYYY-MM-DD') as date, to_char(time,'HH24:MI') as time, notes, company, alerted_day_before, alerted_on_day FROM reminders ORDER BY date ASC, time ASC",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/reminders", async (req, res) => {
  const { title, date, time, notes, company } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO reminders (title, date, time, notes, company) VALUES ($1, $2::date, $3, $4, $5) RETURNING *",
      [title, date, time, notes || null, company || null],
    );
    res.json({ status: "SUCCESS", reminder: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/reminders/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM reminders WHERE id=$1", [req.params.id]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/reminders/:id/alerted", async (req, res) => {
  const { type, date, time } = req.body;
  try {
    if (type === "snooze") {
      await pool.query(`UPDATE reminders SET date=$1, time=$2, alerted_on_day=false, alerted_day_before=false WHERE id=$3`, [date, time, req.params.id]);
    } else {
      const col = type === "day_before" ? "alerted_day_before" : "alerted_on_day";
      await pool.query(`UPDATE reminders SET ${col}=true WHERE id=$1`, [req.params.id]);
    }
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
