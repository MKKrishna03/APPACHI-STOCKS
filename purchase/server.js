// Mounted by the Stocks server at /purchase (see mountPurchase in ../server.js).
// A Router, not an app: the parent owns the port, and its process-wide
// TZ / crash handlers are deliberately NOT applied here.

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

const { initDB, companyStore, oldPool, newPool } = require("./db");
const { requireAuth } = require("./middleware/auth");
const { requestLogger } = require("./middleware/logger");
const { sseHandler } = require("./sse");

// Route modules
const authRoutes = require("./routes/auth");
const profileRoutes = require("./routes/profiles");
const labourRoutes = require("./routes/labour");
const purchaseRoutes = require("./routes/purchases");
const chittaiRoutes = require("./routes/chittai");
const voucherRoutes = require("./routes/vouchers");
const hallmarkRoutes = require("./routes/hallmark");
const todoRoutes = require("./routes/todos");
const scheduleRoutes = require("./routes/schedule");
const { router: cloudinaryRouter } = require("./routes/cloudinary");
const aiRoutes = require("./routes/ai");
const miscRoutes = require("./routes/misc");
const cancelledBillsRoutes = require("./routes/cancelledBills");
const photoBillEntriesRoutes = require("./routes/photoBillEntries");
const { router: activityLogRouter } = require("./routes/activityLog");

const app = express.Router();

// ── Security headers ──
app.use(
  helmet({
    contentSecurityPolicy: false, // disabled — HTML pages load inline scripts
    crossOriginEmbedderPolicy: false,
  }),
);

// ── CORS ──
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000"];

// Pages served by this same host are never cross-origin, but POSTs from them
// still carry an Origin header — let those straight through instead of
// requiring the deployment's own hostname in ALLOWED_ORIGINS.
const corsMw = cors({
    origin: (origin, cb) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        origin.startsWith("http://localhost")
      ) {
        return cb(null, true);
      }
      cb(new Error("CORS not allowed"));
    },
    credentials: true,
});
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && req.headers.host && o.replace(/^https?:\/\//, "") === req.headers.host) return next();
  corsMw(req, res, next);
});

// ── Rate limiting ──
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "AI scan rate limit reached. Wait a minute before scanning again.",
  },
});

app.use("/api/", globalLimiter);
app.use("/api/ai-scan", aiLimiter);
app.use("/api/ai-scan-text", aiLimiter);

// ── Body parsers ──
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Company context middleware ──
// Reads X-Company-ID header (sent by company-context.js on every /api fetch)
// and binds the correct DB pool for the duration of the request via AsyncLocalStorage.
// companyId 1 = APPACHI JEWELLERY (old DB), 2 = APPACHI JEWELLERY PVT LTD (new DB)
app.use("/api/", (req, res, next) => {
  // Default to company 1 (old DB) when header is absent so existing data
  // is visible even before company-context.js has run on the client.
  const cid = req.headers["x-company-id"] === "2" ? 2 : 1;
  companyStore.run(cid, () => next());
});

// ── Request logging ──
app.use(requestLogger);

// ── Static files ──
// Server-side source lives alongside the pages in this folder — never serve it.
app.use((req, res, next) => {
  if (/^\/(server|db|sse)\.js$/i.test(req.path) || /^\/(routes|middleware)\//i.test(req.path)) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(path.join(__dirname)));

// ── Health check (no auth required) ──
app.get("/health", async (req, res) => {
  const { pool } = require("./db");
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected", ts: new Date().toISOString() });
  } catch {
    res.status(503).json({
      status: "error",
      db: "disconnected",
      ts: new Date().toISOString(),
    });
  }
});

// ── Auth middleware on all /api/ routes ──
app.use("/api/", requireAuth);

// ── Restrict old DB (company 1 / APPACHI JEWELLERY) to specific users ──
// user_id "16" = MUTHUKUMAR, "admin" = VIMAL. Everyone else is transparently
// routed to the new DB (company 2) even if they request/still have company 1 active.
const OLD_DB_ALLOWED_USER_IDS = new Set(["16", "admin"]);
app.use("/api/", (req, res, next) => {
  if (
    companyStore.getStore() === 1 &&
    req.user &&
    !OLD_DB_ALLOWED_USER_IDS.has(String(req.user.user_id))
  ) {
    return companyStore.run(2, () => next());
  }
  next();
});

// ── Server-Sent Events ──
app.get("/api/events", sseHandler);

// ── API routes ──
app.use("/api", authRoutes);
app.use("/api", profileRoutes);
app.use("/api", labourRoutes);
app.use("/api", purchaseRoutes);
app.use("/api", chittaiRoutes);
app.use("/api", voucherRoutes);
app.use("/api", hallmarkRoutes);
app.use("/api", todoRoutes);
app.use("/api", scheduleRoutes);
app.use("/api", cloudinaryRouter);
app.use("/api", aiRoutes);
app.use("/api", miscRoutes);
app.use("/api", cancelledBillsRoutes);
app.use("/api", photoBillEntriesRoutes);
app.use("/api", activityLogRouter);

// ── Companies endpoint ──
app.get("/api/companies", (req, res) => {
  res.json([
    { id: 1, name: "APPACHI JEWELLERY", sub: "Sole Proprietorship (Old)", color: "#92400e", dot: "#f59e0b" },
    { id: 2, name: "AJ PRIVATE LIMITED", fullName: "APPACHI JEWELLERY PVT LTD", sub: "Private Limited (Active)", color: "#065f46", dot: "#10b981" },
  ]);
});

// ── One-time admin endpoint: copy reference data from old DB to new DB ──
app.post("/api/admin/copy-reference-data", async (req, res) => {
  if (newPool === oldPool) return res.status(400).json({ error: "NEW_DATABASE_URL not configured" });
  try {
    const tables = [
      { name: "profiles", seq: "profiles_id_seq" },
      { name: "auth_users", seq: "auth_users_id_seq" },
      { name: "descriptions", seq: "descriptions_id_seq" },
      { name: "labour_item_types", seq: "labour_item_types_id_seq" },
      { name: "tds", seq: "tds_id_seq" },
      { name: "tax_format", seq: "tax_format_id_seq" },
      { name: "voucher_types", seq: "voucher_types_id_seq" },
    ];
    const report = [];
    for (const { name, seq } of tables) {
      const { rows } = await oldPool.query(`SELECT * FROM ${name} ORDER BY id`);
      if (!rows.length) { report.push({ table: name, copied: 0 }); continue; }
      await newPool.query(`DELETE FROM ${name}`);
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map((_, i) => `$${i + 1}`);
        await newPool.query(
          `INSERT INTO ${name} (${cols.join(",")}) VALUES (${vals.join(",")}) ON CONFLICT DO NOTHING`,
          Object.values(row),
        );
      }
      const maxId = Math.max(...rows.map((r) => r.id || 0));
      if (maxId > 0) await newPool.query(`SELECT setval('${seq}', $1)`, [maxId]);
      report.push({ table: name, copied: rows.length });
    }
    res.json({ status: "SUCCESS", report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Page routes ──
const pages = {
  "/": "login.html",
  "/login": "login.html",
  "/dashboard": "dashboard.html",
  "/profile": "profile.html",
  "/labour": "labour.html",
  "/labclose": "labclose.html",
  "/transaction": "newtrns.html",
  "/newtrns": "newtrns.html",
  "/receipt": "newtrns.html",
  "/payment": "newtrns.html",
  "/chittai": "chittai.html",
  "/purchase": "purchase.html",
  "/note": "note.html",
  "/hmex": "hmex.html",
  "/media": "media.html",
  "/company": "company.html",
  "/reports/transaction": "trnsrpt.html",
  "/reports/iv-rv": "vhrrpt.html",
  "/reports/chittai": "ctirpt.html",
  "/reports/purchase": "prchsrpt.html",
  "/reports/hallmark": "hmrpt.html",
  "/reports/expense": "exprpt.html",
  "/reports/tds": "tds.html",
  "/reports/cd-note": "cdrpt.html",
  "/reports/cancelled": "cancelrpt.html",
  "/reports/mc": "mcrpt.html",
  "/photo-entry": "photobill.html",
  "/mc": "mc.html",
};

// Inject company-context.js into every HTML page so the company switcher
// and fetch interceptor (X-Company-ID header) are available without
// touching the 20+ individual HTML files.
const CO_SCRIPT = '<script src="/purchase/company-context.js"></script>';
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (req, res) => {
    try {
      let html = fs.readFileSync(path.join(__dirname, file), "utf8");
      html = html.replace("</head>", CO_SCRIPT + "\n</head>");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch {
      res.sendFile(path.join(__dirname, file));
    }
  });
}

// Mobile upload page (token-based, no auth)
app.get("/upload/:token", (req, res) =>
  res.sendFile(path.join(__dirname, "mobile-upload.html")),
);

// ── Global error handler ──
// Express 5 async routes propagate thrown errors here automatically.
// Routes with try/catch also call next(err) on failure.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : "Internal server error";
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: err.message,
      stack: err.stack,
      method: req.method,
      path: req.path,
    }),
  );
  if (!res.headersSent) res.status(status).json({ error: message });
});


// ── Sync profiles from oldPool → newPool on startup ──
async function syncProfilesToNewDb() {
  if (newPool === oldPool) return;
  try {
    const { rows } = await oldPool.query(`SELECT * FROM profiles ORDER BY id`);
    if (!rows.length) return;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((_, i) => `$${i + 1}`);
      const updateCols = cols.filter((c) => c !== "id");
      await newPool.query(
        `INSERT INTO profiles (${cols.join(",")}) VALUES (${vals.join(",")})
         ON CONFLICT (id) DO UPDATE SET ${updateCols.map((c) => `${c}=EXCLUDED.${c}`).join(",")}`,
        Object.values(row),
      );
    }
    const maxId = Math.max(...rows.map((r) => r.id || 0));
    if (maxId > 0) await newPool.query(`SELECT setval('profiles_id_seq', GREATEST(currval('profiles_id_seq'), $1))`, [maxId]);
    console.log(`[DB] Synced ${rows.length} profiles to new DB`);
  } catch (err) {
    console.error("[DB] Profile sync on startup failed:", err.message);
  }
}

// ── Sync labour item types from oldPool → newPool on startup ──
async function syncLabourItemTypesToNewDb() {
  if (newPool === oldPool) return;
  try {
    const { rows } = await oldPool.query(`SELECT * FROM labour_item_types ORDER BY id`);
    if (!rows.length) return;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((_, i) => `$${i + 1}`);
      await newPool.query(
        `INSERT INTO labour_item_types (${cols.join(",")}) VALUES (${vals.join(",")}) ON CONFLICT (name) DO NOTHING`,
        Object.values(row),
      );
    }
    const maxId = Math.max(...rows.map((r) => r.id || 0));
    if (maxId > 0) await newPool.query(`SELECT setval('labour_item_types_id_seq', GREATEST(currval('labour_item_types_id_seq'), $1))`, [maxId]);
    console.log(`[DB] Synced ${rows.length} labour item types to new DB`);
  } catch (err) {
    console.error("[DB] Labour item type sync on startup failed:", err.message);
  }
}

// ── Sync tax formats (GST dropdown) from oldPool → newPool on startup ──
async function syncTaxFormatsToNewDb() {
  if (newPool === oldPool) return;
  try {
    const { rows } = await oldPool.query(`SELECT * FROM tax_format ORDER BY id`);
    if (!rows.length) return;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((_, i) => `$${i + 1}`);
      const updateCols = cols.filter((c) => c !== "id");
      await newPool.query(
        `INSERT INTO tax_format (${cols.join(",")}) VALUES (${vals.join(",")})
         ON CONFLICT (id) DO UPDATE SET ${updateCols.map((c) => `${c}=EXCLUDED.${c}`).join(",")}`,
        Object.values(row),
      );
    }
    const maxId = Math.max(...rows.map((r) => r.id || 0));
    if (maxId > 0) await newPool.query(`SELECT setval('tax_format_id_seq', GREATEST(currval('tax_format_id_seq'), $1))`, [maxId]);
    console.log(`[DB] Synced ${rows.length} tax formats to new DB`);
  } catch (err) {
    console.error("[DB] Tax format sync on startup failed:", err.message);
  }
}

// ── Sync descriptions (autosuggest) from oldPool → newPool on startup ──
async function syncDescriptionsToNewDb() {
  if (newPool === oldPool) return;
  try {
    const { rows } = await oldPool.query(`SELECT * FROM descriptions ORDER BY id`);
    if (!rows.length) return;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((_, i) => `$${i + 1}`);
      await newPool.query(
        `INSERT INTO descriptions (${cols.join(",")}) VALUES (${vals.join(",")}) ON CONFLICT (name) DO NOTHING`,
        Object.values(row),
      );
    }
    const maxId = Math.max(...rows.map((r) => r.id || 0));
    if (maxId > 0) await newPool.query(`SELECT setval('descriptions_id_seq', GREATEST(currval('descriptions_id_seq'), $1))`, [maxId]);
    console.log(`[DB] Synced ${rows.length} descriptions to new DB`);
  } catch (err) {
    console.error("[DB] Description sync on startup failed:", err.message);
  }
}

// ── Start ── (called once by the parent server; never exits the process)
function start() {
  return initDB()
    .then(() => syncProfilesToNewDb())
    .then(() => syncLabourItemTypesToNewDb())
    .then(() => syncTaxFormatsToNewDb())
    .then(() => syncDescriptionsToNewDb())
    .then(() => console.log("✅ Purchase DB ready"))
    .catch((err) => console.error("❌ Purchase INITDB FAILED:", err));
}

module.exports = { router: app, start };
