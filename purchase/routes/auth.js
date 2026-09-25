const express = require("express");
const bcrypt = require("bcryptjs");
// Auth always reads/writes the old pool — users are shared across both companies.
const { oldPool: pool, generateResetKey } = require("../db");
const { signToken } = require("../middleware/auth");

const router = express.Router();

router.get("/auth/can-delete", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.json({ can_delete: false });
  try {
    const result = await pool.query(
      "SELECT can_delete FROM auth_users WHERE user_id=$1",
      [user_id],
    );
    res.json({ can_delete: result.rows[0]?.can_delete || false });
  } catch {
    res.json({ can_delete: false });
  }
});

router.post("/auth/signup", async (req, res) => {
  const { user_id, name, email, password } = req.body;
  try {
    const existing = await pool.query(
      "SELECT * FROM auth_users WHERE user_id = $1",
      [user_id],
    );
    if (!existing.rows[0])
      return res.json({ error: "ID not found. Request your ID from admin." });
    if (existing.rows[0].password)
      return res.json({ error: "Account already exists for this ID." });
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "UPDATE auth_users SET name=$1, email=$2, password=$3 WHERE user_id=$4",
      [name, email, hash, user_id],
    );
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/login", async (req, res) => {
  const { user_id, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM auth_users WHERE user_id = $1",
      [user_id],
    );
    const user = result.rows[0];
    if (!user || !user.password)
      return res.json({ error: "ID not found or account not set up." });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ error: "Incorrect password." });
    const token = signToken(user);
    res.cookie("auth_jwt", token, {
      httpOnly: true,
      maxAge: 3 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    res.json({
      status: "SUCCESS",
      user: {
        id: user.user_id,
        name: user.name,
        can_delete: user.can_delete || false,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/reset-password", async (req, res) => {
  const { user_id, key, new_password } = req.body;
  if (!user_id || !key || !new_password)
    return res.json({ error: "All fields are required." });
  if (new_password.length < 6)
    return res.json({ error: "Password must be at least 6 characters." });
  try {
    const result = await pool.query(
      "SELECT id, reset_key FROM auth_users WHERE user_id=$1",
      [user_id],
    );
    const user = result.rows[0];
    if (!user) return res.json({ error: "User ID not found." });
    if (
      !user.reset_key ||
      user.reset_key.toUpperCase() !== key.trim().toUpperCase()
    )
      return res.json({ error: "Invalid key. Please contact admin." });
    const hash = await bcrypt.hash(new_password, 10);
    const newKey = generateResetKey();
    await pool.query(
      "UPDATE auth_users SET password=$1, reset_key=$2 WHERE id=$3",
      [hash, newKey, user.id],
    );
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie("auth_jwt", { path: "/" });
  res.json({ status: "SUCCESS" });
});

router.get("/auth/admin-keys", async (req, res) => {
  const { requester_id } = req.query;
  if (!requester_id) return res.status(403).json({ error: "Forbidden" });
  try {
    const check = await pool.query(
      "SELECT can_delete FROM auth_users WHERE user_id=$1",
      [requester_id],
    );
    if (!check.rows[0]?.can_delete)
      return res.status(403).json({ error: "Admin access required." });
    const result = await pool.query(
      "SELECT user_id, name, reset_key FROM auth_users WHERE is_active=true ORDER BY name",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/auth/users-list", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT user_id, name FROM auth_users WHERE is_active=true AND password IS NOT NULL ORDER BY name",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
