require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const { createClient } = require('@libsql/client');

const app = express();
app.set('trust proxy', 1); // required for Render.com reverse proxy
app.use(express.json());

const db = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── Persistent session store (Turso-backed) ──────────────────────────────────
class TursoSessionStore extends session.Store {
  async get(sid, cb) {
    try {
      const r = await db.execute({ sql: 'SELECT data FROM sessions WHERE sid = ? AND expires > ?', args: [sid, Date.now()] });
      cb(null, r.rows.length ? JSON.parse(r.rows[0].data) : null);
    } catch (e) { cb(e); }
  }
  async set(sid, sess, cb) {
    try {
      const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 3600 * 1000;
      await db.execute({
        sql:  'INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)',
        args: [sid, JSON.stringify(sess), exp],
      });
      cb(null);
    } catch (e) { cb(e); }
  }
  async destroy(sid, cb) {
    try { await db.execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [sid] }); cb(null); }
    catch (e) { cb(e); }
  }
  async touch(sid, sess, cb) {
    try {
      const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 3600 * 1000;
      await db.execute({ sql: 'UPDATE sessions SET expires = ? WHERE sid = ?', args: [exp, sid] });
      cb(null);
    } catch (e) { cb(e); }
  }
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'appachi-change-me',
  resave: false,
  saveUninitialized: false,
  store: new TursoSessionStore(),
  cookie: { httpOnly: true }, // no maxAge = session cookie by default; stayLoggedIn sets 30 days
}));
// HTML pages: serve cached version instantly, revalidate in background
// (no-store caused blank white screen in Capacitor WebView on cold Render starts)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, stale-while-revalidate=3600');
  }
  next();
});
app.use(express.static(__dirname));

// ─── Web Push (VAPID) — for PC browsers ───────────────────────────────────────
let webpush = null;
try {
  webpush = require('web-push');
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:admin@appachijewellery.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    console.log('✅ Web Push (VAPID) configured');
  } else {
    console.warn('⚠️  VAPID keys not set — web push disabled');
    webpush = null;
  }
} catch {
  console.warn('⚠️  web-push not installed — web push disabled');
}

// ─── Firebase Admin SDK — for native Android app (FCM) ────────────────────────
let firebaseAdmin = null;
try {
  const admin = require('firebase-admin');
  const svcRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (svcRaw) {
    const svc = JSON.parse(svcRaw);
    admin.initializeApp({ credential: admin.credential.cert(svc) });
    firebaseAdmin = admin;
    console.log('✅ Firebase Admin (FCM) configured');
  } else {
    console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT not set — native push disabled');
  }
} catch (e) {
  console.warn('⚠️  Firebase Admin setup failed:', e.message);
}

// Helper: send push to all subscribers
async function broadcastPush(payload) {
  if (!webpush) return;
  try {
    const r = await db.execute('SELECT endpoint, p256dh, auth FROM push_subscriptions');
    const json = JSON.stringify(payload);
    const results = await Promise.allSettled(
      r.rows.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json
        )
      )
    );
    // Remove expired subscriptions (410 Gone or 404 Not Found)
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const code = results[i].reason?.statusCode;
        if (code === 410 || code === 404) {
          await db.execute({
            sql:  'DELETE FROM push_subscriptions WHERE endpoint = ?',
            args: [r.rows[i].endpoint],
          }).catch(() => {});
        }
      }
    }
    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`📨 Push sent to ${sent}/${r.rows.length} subscribers`);
  } catch (err) {
    console.error('Push broadcast error:', err.message);
  }
}


// Employee IDs with admin privileges
const ADMIN_EMP_IDS = new Set([74]);

function computeRole(id, designation) {
  if (ADMIN_EMP_IDS.has(Number(id))) return 'OWNER';
  if (designation === 'COMPUTER') return 'COMPUTER';
  return 'STAFF';
}

function generateInviteCode() {
  // Excludes I, O, 0, 1 to avoid confusion
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─── Stock Category Definitions ────────────────────────────────────────────────
const STOCK_CATEGORIES = [
  { id: 'cash',             label: 'CASH'                  },
  { id: 'steps',            label: 'STEPS'                 },
  { id: 'chittai',          label: 'CHITTAI'               },
  { id: 'collection',       label: 'COLLECTION'            },
  { id: 'chain_stock',      label: 'CHAIN STOCK'           },
  { id: 'drops_stock',      label: 'DROPS STOCK'           },
  { id: 'ring_stock',       label: 'RING STOCK'            },
  { id: 'metty_mookuthi',   label: 'METTY, MOOKUTHI STOCK' },
  { id: 'pathiram_stock',   label: 'PATHIRAM STOCK'        },
  { id: 'sl_stock',         label: 'SL STOCK'              },
  { id: 'kolusu_stock',     label: 'KOLUSU STOCK'          },
  { id: 'chain_arrange',    label: 'CHAIN ARRANGE'         },
  { id: 'drops_arrange',    label: 'DROPS ARRANGE'         },
  { id: 'tray_arrange',     label: 'TRAY ARRANGE'          },
  { id: 'silver_arrange',   label: 'SILVER ARRANGE'        },
  { id: 'morning_cleaning', label: 'MORNING CLEANING'      },
  { id: 'tea',              label: 'TEA'                   },
  { id: 'dustbin_cleaning', label: 'DUSTBIN CLEANING'      },
  { id: 'evening_cleaning', label: 'EVENING CLEANING'      },
  { id: 'dustbin_checking', label: 'DUSTBIN CHECKING'      },
  { id: 'shop_closing',     label: 'SHOP CLOSING'          },
  { id: 'shop_opening',     label: 'SHOP OPENING'          },
  { id: 'purse_bag_stock',  label: 'PURSE, BAG STOCK'      },
  { id: 'fan_cleaning',     label: 'FAN CLEANING'          },
  { id: 'maadi_cleaning',   label: 'MAADI CLEANING'        },
  { id: 'pathiram_sl_box',  label: 'PATHIRAM, SL BOX'      },
];
const VALID_IDS = new Set(STOCK_CATEGORIES.map(c => c.id));

// Stocks restricted to MALE employees only
const GENTS_STOCKS = new Set(['shop_opening', 'shop_closing']);

// ─── Stock metadata for auto-assignment ────────────────────────────────────────
// timing: time-slot keys used for conflict detection (24h HHMM strings, or 'any')
// group:  letter group — same person should not be in two stocks of same group (soft rule)
// days:   [day-of-week numbers] restriction — null = all days  (0=Sun,1=Mon,2=Tue…5=Fri,6=Sat)
// skip:   true = never auto-assign (CASH, STEPS)
const STOCK_META = {
  cash:             { timing: [],                group: null, days: null,   skip: true  },
  steps:            { timing: [],                group: null, days: null,   skip: true  },
  chittai:          { timing: [],                group: null, days: null,   skip: true  },
  collection:       { timing: ['1000'],          group: null, days: null,   skip: false },
  chain_stock:      { timing: ['1000','1700'],   group: 'T',  days: null,   skip: false },
  drops_stock:      { timing: ['1700'],          group: 'T',  days: null,   skip: false },
  ring_stock:       { timing: ['1700'],          group: 'T',  days: null,   skip: false },
  metty_mookuthi:   { timing: ['1000'],          group: 'T',  days: null,   skip: false },
  pathiram_stock:   { timing: ['1000'],          group: 'T',  days: [2, 5], skip: false },
  sl_stock:         { timing: ['1000'],          group: 'T',  days: [2, 5], skip: false },
  kolusu_stock:     { timing: ['1000'],          group: 'T',  days: [2, 5], skip: false },
  chain_arrange:    { timing: ['1000'],          group: 'D',  days: null,   skip: false },
  drops_arrange:    { timing: ['1100'],          group: 'D',  days: null,   skip: false },
  tray_arrange:     { timing: ['1930'],          group: null, days: null,   skip: false },
  silver_arrange:   { timing: ['1000'],          group: 'C',  days: null,   skip: false },
  morning_cleaning: { timing: ['0845'],          group: 'A',  days: null,   skip: false },
  tea:              { timing: ['1000','1600'],   group: null, days: null,   skip: false },
  dustbin_cleaning: { timing: ['1930'],          group: 'B',  days: null,   skip: false },
  evening_cleaning: { timing: ['1700'],          group: 'B',  days: null,   skip: false },
  dustbin_checking: { timing: ['1500'],          group: 'B',  days: null,   skip: false },
  shop_closing:     { timing: ['2130'],          group: null, days: null,   skip: false },
  shop_opening:     { timing: ['0845'],          group: null, days: null,   skip: false },
  purse_bag_stock:  { timing: ['any'],           group: null, days: null,   skip: false },
  fan_cleaning:     { timing: ['1000'],          group: 'A',  days: null,   skip: false },
  maadi_cleaning:   { timing: ['any'],           group: 'A',  days: null,   skip: false },
  pathiram_sl_box:  { timing: ['1000'],          group: 'C',  days: [2, 5], skip: false },
};

// Forced day-of-week assignments: { stock_id: { dow: alias } }  (0=Sun … 6=Sat)
// The named employee is always placed first for that stock on that day of week,
// provided they are eligible and not on leave (leave still takes priority).
const FORCED_DOW = {
  shop_opening: { 0: 'PARIMANAM' }, // Every Sunday: PARIMANAM opens the shop
};

// ─── Assignment seed data (from screenshot) ────────────────────────────────────
const T1 = ['tray_arrange','silver_arrange','morning_cleaning','tea','dustbin_cleaning','evening_cleaning','dustbin_checking','purse_bag_stock','fan_cleaning','maadi_cleaning','pathiram_sl_box'];
const T2 = [...T1, 'chain_arrange','drops_arrange'];
const T3 = [...T2, 'pathiram_stock','sl_stock','kolusu_stock'];
const T4 = [...T3, 'chain_stock','drops_stock','ring_stock','metty_mookuthi'];

const INITIAL_ASSIGNMENTS = [
  { alias: 'BHARATHI',     stocks: [...T4, 'collection'] },
  { alias: 'CHINNAMMAL',   stocks: [...T4]               },
  { alias: 'DEEPA',        stocks: [...T4, 'collection'] },
  { alias: 'DHANALAKSHMI', stocks: [...T4, 'cash']       },
  { alias: 'JEYANTHI',     stocks: [...T4]               },
  { alias: 'KAVYA',        stocks: [...T4, 'steps']      },
  { alias: 'MUTHUPRIYA',   stocks: [...T4, 'cash']       },
  { alias: 'NIVETHA',      stocks: [...T4]               },
  { alias: 'PANJU',        stocks: [...T1]               },
  { alias: 'PRIYANKA',     stocks: [...T4, 'steps']      },
  { alias: 'RAJI-1',       stocks: [...T4, 'collection'] },
  { alias: 'RAJI-2',       stocks: [...T4, 'collection'] },
  { alias: 'RANI',         stocks: [...T4]               },
  { alias: 'SAHANA',       stocks: [...T4, 'cash']       },
  { alias: 'SANTHIYA',     stocks: [...T4, 'steps']      },
  { alias: 'SHANTHI',      stocks: [...T4, 'steps']      },
  { alias: 'SUDHARSHINI',  stocks: [...T4, 'cash']       },
  { alias: 'TAMILSELVI',   stocks: [...T4, 'collection'] },
  { alias: 'VARSHINI',     stocks: [...T4, 'steps']      },
  { alias: 'VIDHYA',       stocks: [...T4, 'cash']       },
  { alias: 'VIJI-1',       stocks: [...T4]               },
  { alias: 'VIJI-2',       stocks: [...T4]               },
  { alias: 'VISHNUPRIYA',  stocks: [...T4]               },
  { alias: 'YAMUNA',       stocks: [...T4, 'cash']       },
  { alias: 'YOGAPRIYA',    stocks: [...T4, 'collection'] },
];

// ─── DB init ───────────────────────────────────────────────────────────────────
async function initDB() {
  try {
    await db.execute('SELECT 1');
    console.log('✅ Connected to Turso database');

    try { await db.execute(`ALTER TABLE employees ADD COLUMN alias_name TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN designation TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN pin_hash TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN invite_code TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN email TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN password_hash TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN registered_at TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN pin_plain TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE leaves ADD COLUMN booked_by TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE push_subscriptions ADD COLUMN emp_alias TEXT`); } catch (_) {}

    // Stock data tables
    for (const cat of STOCK_CATEGORIES) {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS stock_${cat.id} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL, stock TEXT, name TEXT, entry_by TEXT,
          created_at TEXT DEFAULT (datetime('now','localtime'))
        )
      `);
    }

    // Leaves table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS leaves (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        date       TEXT NOT NULL,
        emp_alias  TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(date, emp_alias)
      )
    `);

    // Leave bookings metadata (who booked each leave: ADMIN or SELF)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS leave_bookings (
        date       TEXT NOT NULL,
        emp_alias  TEXT NOT NULL,
        booked_by  TEXT NOT NULL,
        booked_at  TEXT DEFAULT (datetime('now','localtime')),
        PRIMARY KEY(date, emp_alias)
      )
    `);

    // Push subscriptions table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT,
        auth       TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);

    // Assignments table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid     TEXT PRIMARY KEY,
        data    TEXT NOT NULL,
        expires INTEGER NOT NULL
      )
    `);

    // Clean up expired sessions on startup
    await db.execute({ sql: 'DELETE FROM sessions WHERE expires <= ?', args: [Date.now()] }).catch(() => {});

    await db.execute(`
      CREATE TABLE IF NOT EXISTS stock_assignments (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id  TEXT NOT NULL,
        emp_alias TEXT NOT NULL,
        UNIQUE(stock_id, emp_alias)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS assignment (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        date       TEXT NOT NULL,
        stock_id   TEXT NOT NULL,
        emp_alias  TEXT NOT NULL,
        entry_by   TEXT DEFAULT '',
        source     TEXT DEFAULT 'AUTO-ASSIGN',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(date, stock_id, emp_alias)
      )
    `);

    // Entries table — stores actual work submitted by employees (separate from planned assignments)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        date       TEXT NOT NULL,
        stock_id   TEXT NOT NULL,
        emp_alias  TEXT NOT NULL,
        entry_by   TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(date, stock_id, emp_alias)
      )
    `);

    // FCM tokens table — native Android push (one token per device)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS fcm_tokens (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        emp_alias  TEXT NOT NULL,
        token      TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // One-time migration: move old source='ENTRY' rows from assignment → entries
    await db.execute(`
      INSERT OR IGNORE INTO entries (date, stock_id, emp_alias, entry_by, created_at)
      SELECT date, stock_id, emp_alias, COALESCE(entry_by,''), COALESCE(created_at, datetime('now'))
      FROM assignment WHERE source = 'ENTRY'
    `);
    await db.execute(`DELETE FROM assignment WHERE source = 'ENTRY'`);

    // Seed if empty
    const row = await db.execute('SELECT COUNT(*) as n FROM stock_assignments');
    if (Number(row.rows[0].n) === 0) {
      let total = 0;
      for (const emp of INITIAL_ASSIGNMENTS) {
        for (const sid of emp.stocks) {
          await db.execute({
            sql: 'INSERT OR IGNORE INTO stock_assignments (stock_id, emp_alias) VALUES (?, ?)',
            args: [sid, emp.alias],
          });
          total++;
        }
      }
      console.log(`✅ Seeded ${total} assignments`);
    }
    // Bootstrap: pre-generate invite code for admin employee (ID 74) if not yet registered
    try {
      const adminRow = await db.execute({ sql: 'SELECT invite_code, registered_at FROM employees WHERE id = 74', args: [] });
      if (adminRow.rows.length && !adminRow.rows[0].registered_at && !adminRow.rows[0].invite_code) {
        const code = generateInviteCode();
        await db.execute({ sql: 'UPDATE employees SET invite_code = ? WHERE id = 74', args: [code] });
        console.log(`\n🔑 ADMIN SIGNUP CODE (Employee ID 74 — MUTHUKUMAR): ${code}\n`);
      }
    } catch (_) {}

    console.log('✅ DB ready');
  } catch (err) {
    console.error('❌ DB init failed:', err.message);
  }
}

// ─── Auth helpers ──────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(403).json({ error: 'Admin access required' });
}

// ─── Auth API (public — no requireAuth) ───────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { employee_id, pin, email, password } = req.body;

  // Developer/superadmin fallback account
  if (employee_id && String(employee_id).toLowerCase() === 'admin') {
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminHash || !(await bcrypt.compare(String(pin || password || ''), adminHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.userId  = 'admin';
    req.session.isAdmin = true;
    req.session.role    = 'OWNER';
    req.session.name    = 'Admin';
    if (req.body.stayLoggedIn) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    return res.json({ ok: true, isAdmin: true, role: 'OWNER', name: 'Admin', id: 'admin' });
  }

  try {
    // Email + Password login
    if (email && password) {
      const r = await db.execute({
        sql:  'SELECT id, name, alias_name, password_hash, designation FROM employees WHERE email = ?',
        args: [String(email).toLowerCase().trim()],
      });
      if (!r.rows.length || !r.rows[0].password_hash) return res.status(401).json({ error: 'Invalid credentials' });
      const emp = r.rows[0];
      if (!(await bcrypt.compare(String(password), emp.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.userId  = emp.id;
      req.session.isAdmin = ADMIN_EMP_IDS.has(Number(emp.id));
      req.session.role    = computeRole(emp.id, emp.designation);
      req.session.name    = emp.alias_name || emp.name;
      if (req.body.stayLoggedIn) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      return res.json({ ok: true, isAdmin: req.session.isAdmin, role: req.session.role, name: req.session.name, id: emp.id });
    }

    // Employee ID + PIN login
    if (employee_id && pin) {
      const empId = Number(employee_id);
      if (!Number.isInteger(empId) || empId <= 0) return res.status(401).json({ error: 'Invalid credentials' });
      const r = await db.execute({
        sql:  'SELECT id, name, alias_name, pin_hash, registered_at, designation FROM employees WHERE id = ?',
        args: [empId],
      });
      if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
      const emp = r.rows[0];
      if (!emp.registered_at) return res.status(401).json({ error: 'Account not set up yet. Please sign up first.' });
      if (!emp.pin_hash || !(await bcrypt.compare(String(pin), emp.pin_hash))) return res.status(401).json({ error: 'Invalid credentials' });
      req.session.userId  = emp.id;
      req.session.isAdmin = ADMIN_EMP_IDS.has(empId);
      req.session.role    = computeRole(empId, emp.designation);
      req.session.name    = emp.alias_name || emp.name;
      if (req.body.stayLoggedIn) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
      return res.json({ ok: true, isAdmin: req.session.isAdmin, role: req.session.role, name: req.session.name, id: emp.id });
    }

    return res.status(400).json({ error: 'Provide email + password or employee_id + pin' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Signup — requires invite code issued by admin
app.post('/api/signup', async (req, res) => {
  const { employee_id, invite_code, email, password, pin } = req.body;
  if (!employee_id || !invite_code || !email || !password || !pin)
    return res.status(400).json({ error: 'All fields are required' });
  const empId = Number(employee_id);
  if (!Number.isInteger(empId) || empId <= 0) return res.status(400).json({ error: 'Invalid employee ID' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });

  try {
    const r = await db.execute({ sql: 'SELECT id, name, alias_name, invite_code, email FROM employees WHERE id = ?', args: [empId] });
    if (!r.rows.length) return res.status(404).json({ error: 'Employee ID not found. Check your ID or contact admin.' });
    const emp = r.rows[0];

    if (emp.email) return res.status(400).json({ error: 'Already registered. Use the Reset page to update your credentials.' });
    if (!emp.invite_code || emp.invite_code.toUpperCase() !== String(invite_code).toUpperCase().trim())
      return res.status(401).json({ error: 'Invalid invite code. Ask your admin for a code.' });

    const emailCheck = await db.execute({ sql: 'SELECT id FROM employees WHERE email = ?', args: [email.toLowerCase()] });
    if (emailCheck.rows.length) return res.status(400).json({ error: 'Email already in use by another account' });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const pinHash      = await bcrypt.hash(String(pin), 10);
    await db.execute({
      sql:  'UPDATE employees SET email = ?, password_hash = ?, pin_hash = ?, pin_plain = ?, invite_code = NULL, registered_at = ? WHERE id = ?',
      args: [email.toLowerCase(), passwordHash, pinHash, String(pin), new Date().toISOString(), empId],
    });

    req.session.userId  = empId;
    req.session.isAdmin = ADMIN_EMP_IDS.has(empId);
    req.session.role    = computeRole(empId, emp.designation);
    req.session.name    = emp.alias_name || emp.name;
    res.json({ ok: true, isAdmin: req.session.isAdmin, role: req.session.role, name: req.session.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reset account — requires a fresh invite code from admin
app.post('/api/reset-account', async (req, res) => {
  const { employee_id, invite_code, email, password, pin } = req.body;
  if (!employee_id || !invite_code || !password)
    return res.status(400).json({ error: 'employee_id, invite_code and new password are required' });
  const empId = Number(employee_id);
  if (!Number.isInteger(empId) || empId <= 0) return res.status(400).json({ error: 'Invalid employee ID' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  try {
    const r = await db.execute({ sql: 'SELECT id, name, alias_name, invite_code FROM employees WHERE id = ?', args: [empId] });
    if (!r.rows.length) return res.status(404).json({ error: 'Employee ID not found' });
    const emp = r.rows[0];

    if (!emp.invite_code || emp.invite_code.toUpperCase() !== String(invite_code).toUpperCase().trim())
      return res.status(401).json({ error: 'Invalid invite code. Ask your admin for a new code.' });

    const setClauses = ['password_hash = ?', 'invite_code = NULL'];
    const args       = [await bcrypt.hash(String(password), 10)];

    if (email && email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
      const ec = await db.execute({ sql: 'SELECT id FROM employees WHERE email = ? AND id != ?', args: [email.toLowerCase(), empId] });
      if (ec.rows.length) return res.status(400).json({ error: 'Email already in use' });
      setClauses.push('email = ?'); args.push(email.toLowerCase());
    }
    if (pin && String(pin).trim()) {
      if (!/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });
      setClauses.push('pin_hash = ?'); args.push(await bcrypt.hash(String(pin), 10));
      setClauses.push('pin_plain = ?'); args.push(String(pin));
    }
    args.push(empId);

    await db.execute({ sql: `UPDATE employees SET ${setClauses.join(', ')} WHERE id = ?`, args });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: req.session.userId, name: req.session.name, isAdmin: req.session.isAdmin || false, role: req.session.role || 'STAFF' });
});

// ─── All remaining /api/* routes require a valid session ───────────────────────
app.use('/api', requireAuth);

// Admin-only routes
app.use('/api/admin', requireAdmin);

// ─── Tomorrow's date in IST (server-authoritative) — assignments are for next day
app.get('/api/today', (_req, res) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow);
  res.json({ date });
});

// ─── Employee self-service leaves ─────────────────────────────────────────────

// Helper: get the emp_alias for the logged-in employee
async function getSessionAlias(session) {
  if (!session.userId || session.userId === 'admin') return null;
  const r = await db.execute({ sql: 'SELECT alias_name, name FROM employees WHERE id = ?', args: [Number(session.userId)] });
  if (!r.rows.length) return null;
  return r.rows[0].alias_name || r.rows[0].name;
}

// Helper: find the next-priority replacement for a stock on a given date
async function findReplacement(stockId, date, excludeAlias) {
  try {
    const eligibleR = await db.execute({
      sql:  'SELECT emp_alias FROM stock_assignments WHERE stock_id = ? AND emp_alias != ?',
      args: [stockId, excludeAlias],
    });
    if (!eligibleR.rows.length) return null;

    const leaveR  = await db.execute({ sql: 'SELECT emp_alias FROM leaves WHERE date = ?', args: [date] });
    const onLeave = new Set(leaveR.rows.map(r => r.emp_alias));

    const assignedR = await db.execute({
      sql:  'SELECT emp_alias FROM assignment WHERE date = ? AND stock_id = ?',
      args: [date, stockId],
    });
    const alreadyIn = new Set(assignedR.rows.map(r => r.emp_alias));

    const candidates = eligibleR.rows.map(r => r.emp_alias)
      .filter(a => !onLeave.has(a) && !alreadyIn.has(a));
    if (!candidates.length) return null;

    // Sort by who did this stock longest ago (rotation order — reads historical stock_* table)
    const ph    = candidates.map(() => '?').join(',');
    const histR = await db.execute({
      sql:  `SELECT stock, MAX(date) AS last_date FROM stock_${stockId} WHERE date < ? AND stock IN (${ph}) GROUP BY stock`,
      args: [date, ...candidates],
    });
    const lastMap = {};
    histR.rows.forEach(r => { lastMap[r.stock] = r.last_date; });

    candidates.sort((a, b) => {
      const la = lastMap[a], lb = lastMap[b];
      if (!la && !lb) return a.localeCompare(b);
      if (!la) return -1;
      if (!lb) return  1;
      return la < lb ? -1 : la > lb ? 1 : a.localeCompare(b);
    });

    return candidates[0];
  } catch { return null; }
}

// Helper: reassign all assignment-table slots belonging to `alias` on `date`
// Returns array of { stock, to } (to=null means no replacement found, slot removed)
async function reassignSlotsForLeave(date, alias) {
  const reassigned = [];
  for (const cat of STOCK_CATEGORIES) {
    const existing = await db.execute({
      sql:  'SELECT id FROM assignment WHERE date = ? AND stock_id = ? AND emp_alias = ?',
      args: [date, cat.id, alias],
    });
    if (!existing.rows.length) continue;
    const next = await findReplacement(cat.id, date, alias);
    if (next) {
      await db.execute({
        sql:  'UPDATE assignment SET emp_alias = ?, entry_by = ? WHERE date = ? AND stock_id = ? AND emp_alias = ?',
        args: [next, 'AUTO-REASSIGN', date, cat.id, alias],
      });
      reassigned.push({ stock: cat.label, to: next });
    } else {
      await db.execute({
        sql:  'DELETE FROM assignment WHERE date = ? AND stock_id = ? AND emp_alias = ?',
        args: [date, cat.id, alias],
      });
      reassigned.push({ stock: cat.label, to: null });
    }
  }
  return reassigned;
}

// GET my own leaves
app.get('/api/my-leaves', async (req, res) => {
  try {
    const alias = await getSessionAlias(req.session);
    if (!alias) return res.json([]);
    const r = await db.execute({ sql: 'SELECT id, date FROM leaves WHERE emp_alias = ? ORDER BY date ASC', args: [alias] });
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — book leave; auto-reassign any saved stocks for that date
app.post('/api/my-leaves', async (req, res) => {
  const { date } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Valid date required (YYYY-MM-DD)' });
  try {
    const alias = await getSessionAlias(req.session);
    if (!alias) return res.status(400).json({ error: 'Cannot book leave for this account' });

    const insertR = await db.execute({ sql: 'INSERT OR IGNORE INTO leaves (date, emp_alias) VALUES (?, ?)', args: [date, alias] });
    const inserted = (insertR.rowsAffected || 0) > 0;
    if (inserted) {
      // Record that the employee booked their own leave
      await db.execute({
        sql:  'INSERT OR IGNORE INTO leave_bookings (date, emp_alias, booked_by) VALUES (?, ?, ?)',
        args: [date, alias, 'SELF'],
      });
    }

    const reassigned = inserted ? await reassignSlotsForLeave(date, alias) : [];
    res.json({ ok: true, inserted, reassigned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE — cancel my own leave (also cleans up leave_bookings)
app.delete('/api/my-leaves/:id', async (req, res) => {
  try {
    const alias = await getSessionAlias(req.session);
    if (!alias) return res.status(403).json({ error: 'Forbidden' });
    // Fetch date before deleting so we can clean leave_bookings
    const check = await db.execute({ sql: 'SELECT date FROM leaves WHERE id = ? AND emp_alias = ?', args: [Number(req.params.id), alias] });
    if (check.rows.length) {
      await db.execute({ sql: 'DELETE FROM leave_bookings WHERE date = ? AND emp_alias = ?', args: [check.rows[0].date, alias] });
    }
    await db.execute({ sql: 'DELETE FROM leaves WHERE id = ? AND emp_alias = ?', args: [Number(req.params.id), alias] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Change own PIN (authenticated) ───────────────────────────────────────────
app.put('/api/me/pin', async (req, res) => {
  if (req.session.userId === 'admin') return res.status(400).json({ error: 'Use config to change admin password' });
  const { current_pin, new_pin } = req.body;
  if (!current_pin || !new_pin) return res.status(400).json({ error: 'current_pin and new_pin required' });
  if (!/^\d{4,6}$/.test(String(new_pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });
  try {
    const r = await db.execute({ sql: 'SELECT pin_hash FROM employees WHERE id = ?', args: [Number(req.session.userId)] });
    if (!r.rows.length) return res.status(404).json({ error: 'Employee not found' });
    const emp = r.rows[0];
    if (!emp.pin_hash || !(await bcrypt.compare(String(current_pin), emp.pin_hash)))
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    await db.execute({
      sql:  'UPDATE employees SET pin_hash = ?, pin_plain = ? WHERE id = ?',
      args: [await bcrypt.hash(String(new_pin), 10), String(new_pin), Number(req.session.userId)],
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Admin: Invite Code Management ────────────────────────────────────────────

// Generate (or regenerate) an invite code for an employee
app.post('/api/admin/invite/:emp_id', async (req, res) => {
  const empId = Number(req.params.emp_id);
  if (!empId) return res.status(400).json({ error: 'Invalid employee ID' });
  try {
    const r = await db.execute({ sql: 'SELECT id, name, alias_name FROM employees WHERE id = ?', args: [empId] });
    if (!r.rows.length) return res.status(404).json({ error: 'Employee not found' });
    const code = generateInviteCode();
    await db.execute({ sql: 'UPDATE employees SET invite_code = ? WHERE id = ?', args: [code, empId] });
    res.json({ ok: true, code, name: r.rows[0].alias_name || r.rows[0].name, id: empId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List all employees with registration status and invite codes
app.get('/api/admin/invites', async (req, res) => {
  try {
    const r = await db.execute(
      'SELECT id, name, alias_name, email, invite_code, registered_at FROM employees ORDER BY COALESCE(alias_name, name) ASC'
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Employees API ─────────────────────────────────────────────────────────────
app.get('/api/employees', async (req, res) => {
  try {
    const r = await db.execute(
      `SELECT id, name, alias_name, gender, designation FROM employees ORDER BY COALESCE(alias_name, name) ASC`
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE employee (OWNER only) — cleans up assignments, leaves, subscriptions
app.delete('/api/employees/:id', async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId) || empId <= 0) return res.status(400).json({ error: 'Invalid ID' });
  if (String(req.session.userId) === String(empId)) return res.status(400).json({ error: 'Cannot remove yourself' });
  try {
    const r = await db.execute({ sql: 'SELECT name, alias_name FROM employees WHERE id = ?', args: [empId] });
    if (!r.rows.length) return res.status(404).json({ error: 'Employee not found' });
    const alias = r.rows[0].alias_name || r.rows[0].name;
    await db.execute({ sql: 'DELETE FROM stock_assignments WHERE emp_alias = ?', args: [alias] });
    await db.execute({ sql: 'DELETE FROM leave_bookings WHERE emp_alias = ?', args: [alias] });
    await db.execute({ sql: 'DELETE FROM leaves WHERE emp_alias = ?', args: [alias] });
    await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE emp_alias = ?', args: [alias] });
    await db.execute({ sql: 'DELETE FROM employees WHERE id = ?', args: [empId] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Stocks API ────────────────────────────────────────────────────────────────
app.get('/api/stock-categories', (_req, res) => res.json(STOCK_CATEGORIES));

app.get('/api/stocks/:category', async (req, res) => {
  const { category } = req.params;
  if (!VALID_IDS.has(category)) return res.status(400).json({ error: 'Invalid' });
  try {
    const r = await db.execute(`SELECT * FROM stock_${category} ORDER BY date DESC, id DESC`);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stocks/:category', async (req, res) => {
  const { category } = req.params;
  if (!VALID_IDS.has(category)) return res.status(400).json({ error: 'Invalid' });
  const { date, stock, name, entry_by } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const r = await db.execute({
      sql: `INSERT INTO stock_${category} (date,stock,name,entry_by) VALUES (?,?,?,?)`,
      args: [date, stock ?? '', name ?? '', entry_by ?? ''],
    });
    res.json({ id: Number(r.lastInsertRowid), date, stock, name, entry_by });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/stocks/:category/:id', async (req, res) => {
  const { category, id } = req.params;
  if (!VALID_IDS.has(category)) return res.status(400).json({ error: 'Invalid' });
  try {
    await db.execute({ sql: `DELETE FROM stock_${category} WHERE id=?`, args: [Number(id)] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Assignments API ───────────────────────────────────────────────────────────

// GET all employees assigned to a stock
app.get('/api/assignments/stock/:stock_id', async (req, res) => {
  const { stock_id } = req.params;
  if (!VALID_IDS.has(stock_id)) return res.status(400).json({ error: 'Invalid' });
  try {
    const r = await db.execute({
      sql: 'SELECT emp_alias FROM stock_assignments WHERE stock_id = ? ORDER BY emp_alias',
      args: [stock_id],
    });
    res.json(r.rows.map(row => row.emp_alias));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET stocks assigned to an employee
app.get('/api/assignments/employee/:alias', async (req, res) => {
  const alias = decodeURIComponent(req.params.alias);
  try {
    const r = await db.execute({
      sql: 'SELECT stock_id FROM stock_assignments WHERE emp_alias = ?',
      args: [alias],
    });
    res.json(r.rows.map(row => row.stock_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — add assignment
app.post('/api/assignments', async (req, res) => {
  const { stock_id, emp_alias } = req.body;
  if (!stock_id || !emp_alias) return res.status(400).json({ error: 'stock_id and emp_alias required' });
  if (!VALID_IDS.has(stock_id)) return res.status(400).json({ error: 'Invalid stock_id' });
  try {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO stock_assignments (stock_id, emp_alias) VALUES (?, ?)',
      args: [stock_id, emp_alias],
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE — remove assignment
app.delete('/api/assignments/:stock_id/:alias', async (req, res) => {
  const stock_id = req.params.stock_id;
  const alias    = decodeURIComponent(req.params.alias);
  if (!VALID_IDS.has(stock_id)) return res.status(400).json({ error: 'Invalid stock_id' });
  try {
    await db.execute({
      sql: 'DELETE FROM stock_assignments WHERE stock_id = ? AND emp_alias = ?',
      args: [stock_id, alias],
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET all assignments grouped by employee  {alias: [stock_id, ...]}
app.get('/api/assignments/all', async (req, res) => {
  try {
    const r = await db.execute('SELECT emp_alias, stock_id FROM stock_assignments');
    const map = {};
    r.rows.forEach(row => {
      if (!map[row.emp_alias]) map[row.emp_alias] = [];
      map[row.emp_alias].push(row.stock_id);
    });
    res.json(map);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auto-Assign API ───────────────────────────────────────────────────────────
// GET /api/auto-assign?date=YYYY-MM-DD
// Returns proposed daily staff assignments based on:
//   • Last-date history priority (who did it most recently)
//   • Time-slot conflict prevention (same person can't be in two simultaneous stocks)
//   • Group-letter soft constraint (same person avoids two stocks in same letter group)
//   • Day restrictions (PATHIRAM/SL/KOLUSU only on Tue/Fri)
//   • CASH and STEPS are omitted entirely
app.get('/api/auto-assign', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const d   = new Date(date + 'T12:00:00');
    const dow = d.getDay();
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    // 1. Eligible employees per stock  (from stock_assignments)
    //    If stock_assignments is empty (e.g. after clear-all), auto-reseed from INITIAL_ASSIGNMENTS
    let asgnCheck = await db.execute('SELECT COUNT(*) as n FROM stock_assignments');
    if (Number(asgnCheck.rows[0].n) === 0) {
      console.log('⚠️  stock_assignments empty — reseeding from INITIAL_ASSIGNMENTS');
      for (const emp of INITIAL_ASSIGNMENTS) {
        for (const sid of emp.stocks) {
          await db.execute({
            sql: 'INSERT OR IGNORE INTO stock_assignments (stock_id, emp_alias) VALUES (?, ?)',
            args: [sid, emp.alias],
          });
        }
      }
    }

    const asgn = await db.execute('SELECT stock_id, emp_alias FROM stock_assignments ORDER BY emp_alias');
    const byStock = {};
    asgn.rows.forEach(r => {
      if (!byStock[r.stock_id]) byStock[r.stock_id] = [];
      byStock[r.stock_id].push(r.emp_alias);
    });

    // 2. Each eligible employee's personal last-done date per stock (before the target date)
    //    Single batch request instead of 26 parallel HTTP calls → avoids Turso rate limits
    const lastByEmp = {};
    try {
      const batchResults = await db.batch(
        STOCK_CATEGORIES.map(cat => ({
          sql:  `SELECT stock, MAX(date) AS last_date FROM stock_${cat.id} WHERE date < ? GROUP BY stock`,
          args: [date],
        })),
        'read'
      );
      STOCK_CATEGORIES.forEach((cat, i) => {
        lastByEmp[cat.id] = {};
        const rows = batchResults[i]?.rows || [];
        rows.forEach(r => { if (r.stock) lastByEmp[cat.id][r.stock] = r.last_date; });
      });
    } catch {
      STOCK_CATEGORIES.forEach(cat => { lastByEmp[cat.id] = {}; });
    }

    // 3. Fetch employees on leave for this date (exclude from all assignments)
    let onLeave = new Set();
    try {
      const lr = await db.execute({ sql: 'SELECT emp_alias FROM leaves WHERE date = ?', args: [date] });
      lr.rows.forEach(r => onLeave.add(r.emp_alias));
      if (onLeave.size > 0) console.log(`🏖️  On leave for ${date}:`, [...onLeave].join(', '));
    } catch (_) {}

    // 3b. Fetch previous day's leave AND assignments
    //     - prev-day leave: used to exclude employees from morning_cleaning
    //       (if they were off yesterday they won't be in for early morning)
    //     - prev-day assignments: same-stock consecutive-day exclusion
    const prevDateStr = (() => {
      const p = new Date(d.getTime() - 86400000);
      return p.getFullYear() + '-' +
        String(p.getMonth() + 1).padStart(2, '0') + '-' +
        String(p.getDate()).padStart(2, '0');
    })();
    // Employees on leave the previous day (excluded from morning_cleaning)
    let onLeavePrevDay = new Set();
    try {
      const lr2 = await db.execute({ sql: 'SELECT emp_alias FROM leaves WHERE date = ?', args: [prevDateStr] });
      lr2.rows.forEach(r => onLeavePrevDay.add(r.emp_alias));
    } catch (_) {}

    const prevDay = {}; // { stock_id: Set<alias> }
    try {
      // assignment table (app-generated entries)
      const ar = await db.execute({
        sql:  'SELECT stock_id, emp_alias FROM assignment WHERE date = ?',
        args: [prevDateStr],
      });
      ar.rows.forEach(r => {
        if (!prevDay[r.stock_id]) prevDay[r.stock_id] = new Set();
        prevDay[r.stock_id].add(r.emp_alias);
      });
      // stock_* tables (historical entries)
      const batchPrev = await db.batch(
        STOCK_CATEGORIES.map(cat => ({
          sql:  `SELECT stock FROM stock_${cat.id} WHERE date = ?`,
          args: [prevDateStr],
        })),
        'read'
      );
      STOCK_CATEGORIES.forEach((cat, i) => {
        (batchPrev[i]?.rows || []).forEach(r => {
          if (!r.stock) return;
          if (!prevDay[cat.id]) prevDay[cat.id] = new Set();
          prevDay[cat.id].add(r.stock);
        });
      });
    } catch (_) {}

    // 4. Assignment algorithm
    const assignments   = {};
    const skipped       = [];
    const usedTimes     = {}; // alias → Set<slot>
    const usedGroups    = {}; // alias → Set<groupLetter>
    const dailyCount    = {}; // alias → stocks assigned so far today (load balancing)
    const targetDay     = new Date(date + 'T12:00:00');
    const priorityOrder = {}; // sid → [alias,...] pure date-rotation order (sent to client for soft-constraint UI)

    // Process morning_cleaning first so its 3 assignees have higher daily counts
    // before the rest of the stocks are distributed — prevents them from accumulating more.
    const orderedCats = [
      ...STOCK_CATEGORIES.filter(c => c.id === 'morning_cleaning'),
      ...STOCK_CATEGORIES.filter(c => c.id !== 'morning_cleaning'),
    ];

    for (const cat of orderedCats) {
      const sid  = cat.id;
      const meta = STOCK_META[sid];
      if (!meta) continue;
      if (meta.skip) { assignments[sid] = null; continue; }       // CASH / STEPS

      // Day restriction check
      if (meta.days && !meta.days.includes(dow)) {
        skipped.push(sid);
        assignments[sid] = [];
        continue;
      }

      const count = ENTRY_COUNTS[sid] || 1;

      // Base: exclude employees on leave today
      let allEligible = (byStock[sid] || []).filter(a => !onLeave.has(a));

      // Morning cleaning: also exclude employees who were on leave yesterday
      // (they weren't in yesterday evening so can't do early morning today)
      if (sid === 'morning_cleaning') {
        const withoutPrevLeave = allEligible.filter(a => !onLeavePrevDay.has(a));
        if (withoutPrevLeave.length >= count) allEligible = withoutPrevLeave;
      }

      const yesterdaySet = prevDay[sid] || new Set();
      // Prefer candidates who did NOT do this stock yesterday; fall back to all if too few remain
      const withoutYesterday = allEligible.filter(a => !yesterdaySet.has(a));
      const eligible = withoutYesterday.length >= count ? withoutYesterday : allEligible;
      const empDates = lastByEmp[sid] || {};

      // Sort by two keys:
      //   1. Daily load (PRIMARY) — fewest stocks assigned today wins.
      //      This is the hard equaliser: no one accumulates many stocks while
      //      others have few, regardless of rotation history.
      //   2. Last-done date (TIEBREAK) — among employees with equal daily load,
      //      whoever did this stock longest ago (or never) wins.
      const sorted = [...eligible].sort((a, b) => {
        const ca = dailyCount[a] || 0;
        const cb = dailyCount[b] || 0;

        // 1. Primary: even daily distribution
        if (ca !== cb) return ca - cb;

        // 2. Tiebreak: rotation by last-done date
        const da = empDates[a];
        const db = empDates[b];
        if (!da && !db) return a.localeCompare(b);
        if (!da) return -1; // never done → higher rotation priority
        if (!db) return  1;
        if (da !== db) return da < db ? -1 : 1; // older date first
        return a.localeCompare(b);
      });

      // Date-only rotation order for client-side soft-constraint display
      // (pure rotation: who did it longest ago = index 0; ignores daily-load scoring)
      priorityOrder[sid] = [...eligible].sort((a, b) => {
        const da = empDates[a], db = empDates[b];
        if (!da && !db) return a.localeCompare(b);
        if (!da) return -1;
        if (!db) return  1;
        return da < db ? -1 : da > db ? 1 : a.localeCompare(b);
      });

      // Fill slots — pass 1: respect group constraint; pass 2 (fallback): ignore it
      const picked    = [];
      const pickedSet = new Set(); // fast dedup guard — same person never fills two slots

      // Forced day-of-week: place the named employee first if eligible and not on leave
      const forcedAlias = (FORCED_DOW[sid] || {})[dow];
      if (forcedAlias && eligible.includes(forcedAlias)) {
        picked.push(forcedAlias);
        pickedSet.add(forcedAlias);
      }
      for (const respectGroup of [true, false]) {
        if (picked.length >= count) break;
        for (const alias of sorted) {
          if (picked.length >= count) break;
          if (pickedSet.has(alias)) continue;           // already picked for this stock
          // Hard constraint: time conflict
          const empT = usedTimes[alias]  || new Set();
          if (meta.timing.some(t => t !== 'any' && empT.has(t))) continue;
          // Soft constraint: group letter
          if (respectGroup && meta.group) {
            const empG = usedGroups[alias] || new Set();
            if (empG.has(meta.group)) continue;
          }
          picked.push(alias);
          pickedSet.add(alias);
        }
      }

      // Commit time, group, and daily-count for assigned employees
      for (const alias of picked) {
        if (!usedTimes[alias])  usedTimes[alias]  = new Set();
        if (!usedGroups[alias]) usedGroups[alias] = new Set();
        meta.timing.forEach(t => { if (t !== 'any') usedTimes[alias].add(t); });
        if (meta.group) usedGroups[alias].add(meta.group);
        dailyCount[alias] = (dailyCount[alias] || 0) + 1; // track load for balancing
      }

      assignments[sid] = picked;
    }

    res.json({ date, dayName: DAY_NAMES[dow], dayOfWeek: dow, assignments, skipped, priorityOrder, onLeave: [...onLeave] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Entry API ─────────────────────────────────────────────────────────────────

// Staff count (how many slots per stock per day)
const ENTRY_COUNTS = {
  cash: 1, steps: 1, chittai: 1, collection: 1, chain_stock: 1, drops_stock: 1,
  ring_stock: 1, metty_mookuthi: 1, pathiram_stock: 2, sl_stock: 2,
  kolusu_stock: 4, chain_arrange: 1, drops_arrange: 2, tray_arrange: 2,
  silver_arrange: 2, morning_cleaning: 3, tea: 2, dustbin_cleaning: 2,
  evening_cleaning: 1, dustbin_checking: 2, shop_closing: 2, shop_opening: 1,
  purse_bag_stock: 2, fan_cleaning: 2, maadi_cleaning: 4, pathiram_sl_box: 2,
};

// GET all assignments grouped by stock  {stock_id: [alias, ...]}
app.get('/api/assignments/all-by-stock', async (req, res) => {
  try {
    const r = await db.execute('SELECT stock_id, emp_alias FROM stock_assignments ORDER BY emp_alias');
    const map = {};
    r.rows.forEach(row => {
      if (!map[row.stock_id]) map[row.stock_id] = [];
      map[row.stock_id].push(row.emp_alias);
    });
    res.json(map);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET today's limit status  ?date=YYYY-MM-DD  →  {stock_id: bool}
app.get('/api/entry/limits', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const counts = {};
    await Promise.all(
      Object.keys(ENTRY_COUNTS).map(async catId => {
        try {
          const r = await db.execute({ sql: `SELECT COUNT(*) as n FROM stock_${catId} WHERE date = ?`, args: [date] });
          counts[catId] = Number(r.rows[0]?.n || 0);
        } catch (_) { counts[catId] = 0; }
      })
    );
    const pairs = Object.entries(ENTRY_COUNTS).map(([catId, maxCount]) =>
      [catId, (counts[catId] || 0) >= maxCount]
    );
    res.json(Object.fromEntries(pairs));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE all saved entries for a date (used by re-assign to clear before re-saving)
app.delete('/api/entry/date/:date', async (req, res) => {
  const { date } = req.params;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  try {
    await db.execute({ sql: "DELETE FROM assignment WHERE date = ? AND source = 'AUTO-ASSIGN'", args: [date] });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all saved data for a date  ?date=YYYY-MM-DD[&source=ENTRY]  →  [{stock_id, label, aliases:[]}]
// source=ENTRY  → reads from dedicated stock_* tables (actual work done)
// default       → reads from assignment table (auto-assigned/planned)
app.get('/api/entry/all', async (req, res) => {
  const { date, source } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    if (source === 'ENTRY') {
      const map = {};
      await Promise.all(
        STOCK_CATEGORIES.map(async cat => {
          try {
            const r = await db.execute({ sql: `SELECT stock FROM stock_${cat.id} WHERE date = ? ORDER BY id`, args: [date] });
            const names = r.rows.map(row => row.stock).filter(Boolean);
            if (names.length) map[cat.id] = names;
          } catch (_) {}
        })
      );
      const result = STOCK_CATEGORIES
        .filter(cat => map[cat.id]?.length)
        .map(cat => ({ stock_id: cat.id, label: cat.label, aliases: map[cat.id] }));
      return res.json(result);
    }

    // Default: auto-assign planned data
    const r = await db.execute({
      sql:  "SELECT stock_id, emp_alias FROM assignment WHERE date = ? AND source = 'AUTO-ASSIGN' ORDER BY id",
      args: [date],
    });
    const map = {};
    r.rows.forEach(({ stock_id, emp_alias }) => {
      if (!map[stock_id]) map[stock_id] = [];
      if (emp_alias) map[stock_id].push(emp_alias);
    });
    const result = STOCK_CATEGORIES
      .filter(cat => map[cat.id]?.length)
      .map(cat => ({ stock_id: cat.id, label: cat.label, aliases: map[cat.id] }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST bulk submit  body: { date, entries: {stock_id: [alias, ...]} }
app.post('/api/entry/submit', async (req, res) => {
  const { date, entries } = req.body;
  if (!date || !entries) return res.status(400).json({ error: 'date and entries required' });

  const errors = [];
  const writes = [];
  const source = req.body.source || 'ENTRY';

  try {
    const validEntries = Object.entries(entries)
      .filter(([catId, aliases]) => VALID_IDS.has(catId) && Array.isArray(aliases) && aliases.length);

    const validEntryIds = validEntries.map(([catId]) => catId);

    if (source === 'AUTO-ASSIGN') {
      // Count check against assignment table
      const placeholders = validEntryIds.map(() => '?').join(',');
      const countRows = validEntryIds.length
        ? (await db.execute({
            sql:  `SELECT stock_id, COUNT(*) as n FROM assignment WHERE date = ? AND source = 'AUTO-ASSIGN' AND stock_id IN (${placeholders}) GROUP BY stock_id`,
            args: [date, ...validEntryIds],
          })).rows
        : [];
      const currentCounts = {};
      countRows.forEach(r => { currentCounts[r.stock_id] = Number(r.n); });
      validEntries.forEach(([catId, aliases]) => {
        const maxCount = ENTRY_COUNTS[catId] || 3;
        const current  = currentCounts[catId] || 0;
        if (current + aliases.length > maxCount) {
          const cat = STOCK_CATEGORIES.find(c => c.id === catId);
          errors.push(`${cat ? cat.label : catId}: already has ${current}/${maxCount} entries for this date.`);
        } else {
          aliases.forEach(alias => { if (alias?.trim()) writes.push({ catId, alias: alias.trim() }); });
        }
      });
    } else {
      // ENTRY — count check against each dedicated stock_* table
      const currentCounts = {};
      await Promise.all(
        validEntryIds.map(async catId => {
          try {
            const r = await db.execute({ sql: `SELECT COUNT(*) as n FROM stock_${catId} WHERE date = ?`, args: [date] });
            currentCounts[catId] = Number(r.rows[0]?.n || 0);
          } catch (_) { currentCounts[catId] = 0; }
        })
      );
      validEntries.forEach(([catId, aliases]) => {
        const maxCount = ENTRY_COUNTS[catId] || 3;
        const current  = currentCounts[catId] || 0;
        if (current + aliases.length > maxCount) {
          const cat = STOCK_CATEGORIES.find(c => c.id === catId);
          errors.push(`${cat ? cat.label : catId}: already has ${current}/${maxCount} entries for this date.`);
        } else {
          aliases.forEach(alias => { if (alias?.trim()) writes.push({ catId, alias: alias.trim() }); });
        }
      });
    }
  } catch (err) {
    return res.status(500).json({ error: true, messages: [err.message] });
  }

  if (errors.length) return res.json({ error: true, messages: errors });

  try {
    if (source === 'AUTO-ASSIGN') {
      // Planned assignment — save to assignment table
      await db.batch(
        writes.map(({ catId, alias }) => ({
          sql:  "INSERT OR IGNORE INTO assignment (date, stock_id, emp_alias, entry_by, source) VALUES (?, ?, ?, ?, 'AUTO-ASSIGN')",
          args: [date, catId, alias, ''],
        })),
        'write'
      );
    } else {
      // Actual work done — save to each dedicated stock_* table
      // stock = employee who did the work, entry_by = user who submitted
      const submittedBy = req.session?.name || '';
      for (const { catId, alias } of writes) {
        await db.execute({
          sql:  `INSERT OR IGNORE INTO stock_${catId} (date, stock, entry_by) VALUES (?, ?, ?)`,
          args: [date, alias, submittedBy],
        });
      }
    }
    res.json({ error: false });

    // Personalized push notifications — one per assigned employee
    if (source === 'AUTO-ASSIGN' && webpush) {
      const d = new Date(date + 'T12:00:00');
      const label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

      // Group assigned stocks by employee alias
      const byEmp = {};
      writes.forEach(({ catId, alias }) => {
        const cat = STOCK_CATEGORIES.find(c => c.id === catId);
        if (!byEmp[alias]) byEmp[alias] = [];
        byEmp[alias].push(cat ? cat.label : catId);
      });

      console.log(`[PUSH] Auto-assign for ${date} — employees:`, Object.keys(byEmp));

      // 1. Web push (VAPID) — PC browsers
      if (webpush) {
        const subs = await db.execute('SELECT endpoint, p256dh, auth, emp_alias FROM push_subscriptions').catch(() => ({ rows: [] }));
        for (const sub of subs.rows) {
          const stocks = byEmp[sub.emp_alias];
          if (!stocks?.length) continue;
          const payload = JSON.stringify({
            title: `📋 Your Stocks — ${label}`,
            body:  stocks.join(' · '),
            url:   '/entry.html',
            tag:   `aj-assign-${date}`,
          });
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          ).then(() => {
            console.log(`[WEB-PUSH] ✅ Sent to ${sub.emp_alias}`);
          }).catch(async err => {
            console.error(`[WEB-PUSH] ❌ ${sub.emp_alias}: ${err.statusCode} ${err.message}`);
            if (err.statusCode === 410 || err.statusCode === 404) {
              await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [sub.endpoint] }).catch(() => {});
            }
          });
        }
      }

      // 2. FCM (Firebase Admin) — native Android app
      if (firebaseAdmin) {
        const fcmRows = await db.execute('SELECT emp_alias, token FROM fcm_tokens').catch(() => ({ rows: [] }));
        for (const row of fcmRows.rows) {
          const stocks = byEmp[row.emp_alias];
          if (!stocks?.length) continue;
          firebaseAdmin.messaging().send({
            token: row.token,
            notification: { title: `📋 Your Stocks — ${label}`, body: stocks.join(' · ') },
            data: { url: '/entry.html', tag: `aj-assign-${date}` },
            android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
          }).then(() => {
            console.log(`[FCM] ✅ Sent to ${row.emp_alias}`);
          }).catch(async err => {
            console.error(`[FCM] ❌ ${row.emp_alias}: ${err.message}`);
            if (err.code === 'messaging/registration-token-not-registered') {
              await db.execute({ sql: 'DELETE FROM fcm_tokens WHERE token = ?', args: [row.token] }).catch(() => {});
            }
          });
        }
      }
    }
  } catch (err) {
    res.json({ error: true, messages: [err.message] });
  }
});

// ─── Admin / SQL Editor API ────────────────────────────────────────────────────

// POST /api/admin/sql — run arbitrary SQL query, return rows + columns
app.post('/api/admin/sql', async (req, res) => {
  const { sql } = req.body;
  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    return res.status(400).json({ error: 'sql is required' });
  }
  // Safety: block DROP of employees table
  const up = sql.trim().toUpperCase();
  if (up.includes('DROP') && up.includes('EMPLOYEES')) {
    return res.status(400).json({ error: 'Dropping the employees table is not allowed.' });
  }
  try {
    const r = await db.execute(sql.trim());
    res.json({
      columns:      r.columns      || [],
      rows:         r.rows         || [],
      rowsAffected: r.rowsAffected ?? 0,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/admin/clear-daily — delete all daily entries (keeps employees + stock_assignments)
app.delete('/api/admin/clear-daily', async (req, res) => {
  try {
    const r = await db.execute('DELETE FROM assignment');
    res.json({ ok: true, totalDeleted: r.rowsAffected || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/reseed — re-insert default stock_assignments (INSERT OR IGNORE, safe to run anytime)
app.post('/api/admin/reseed', async (req, res) => {
  try {
    let inserted = 0;
    for (const emp of INITIAL_ASSIGNMENTS) {
      for (const sid of emp.stocks) {
        const r = await db.execute({
          sql:  'INSERT OR IGNORE INTO stock_assignments (stock_id, emp_alias) VALUES (?, ?)',
          args: [sid, emp.alias],
        });
        inserted += r.rowsAffected || 0;
      }
    }
    const total = await db.execute('SELECT COUNT(*) as n FROM stock_assignments');
    res.json({ ok: true, inserted, totalNow: Number(total.rows[0].n) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/clear-all — delete everything except the employees table
app.delete('/api/admin/clear-all', async (req, res) => {
  let totalDeleted = 0;
  const details = [];
  // Clear daily assignment table
  try {
    const r = await db.execute('DELETE FROM assignment');
    const n = r.rowsAffected || 0;
    totalDeleted += n;
    if (n > 0) details.push({ table: 'assignment', deleted: n });
  } catch (_) {}
  // Clear permanent assignments
  try {
    const r = await db.execute('DELETE FROM stock_assignments');
    const n = r.rowsAffected || 0;
    totalDeleted += n;
    if (n > 0) details.push({ table: 'stock_assignments', deleted: n });
  } catch (_) {}
  res.json({ ok: true, totalDeleted, details });
});

// ─── Push Notification API ─────────────────────────────────────────────────────

// GET /api/push/public-key  — returns VAPID public key for client subscription
app.get('/api/push/public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// POST /api/push/subscribe  — save a push subscription linked to the logged-in employee
app.post('/api/push/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  const empAlias = req.session?.name || null;
  try {
    await db.execute({
      sql:  `INSERT INTO push_subscriptions (endpoint, p256dh, auth, emp_alias) VALUES (?, ?, ?, ?)
             ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, emp_alias=excluded.emp_alias`,
      args: [endpoint, keys?.p256dh || '', keys?.auth || '', empAlias],
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/push/unsubscribe  — remove a push subscription
app.delete('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  try {
    await db.execute({
      sql:  'DELETE FROM push_subscriptions WHERE endpoint = ?',
      args: [endpoint],
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/push/notify  — send push to all subscribers (called by client after key events)
app.post('/api/push/notify', async (req, res) => {
  const { title, body, url, tag } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  await broadcastPush({ title, body, url: url || '/', tag: tag || 'aj-stocks' });
  res.json({ ok: true });
});

// POST /api/push/test-me  — send a test notification to ALL devices of the logged-in user
app.post('/api/push/test-me', requireAuth, async (req, res) => {
  if (!webpush) return res.status(503).json({ error: 'Push not configured on server' });
  const empAlias = req.session?.name;
  if (!empAlias) return res.status(400).json({ error: 'Session has no name' });
  try {
    const r = await db.execute({ sql: 'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE emp_alias = ?', args: [empAlias] });
    if (!r.rows.length) return res.status(404).json({ error: `No subscription found for "${empAlias}" — open the app/browser and reload a page first.` });
    const payload = JSON.stringify({ title: '✦ APPACHI Test', body: `Hello ${empAlias} — notifications working!`, url: '/', tag: 'aj-test' });
    let sent = 0, failed = 0;
    for (const sub of r.rows) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        console.log(`[PUSH] test-me ✅ sent to ${empAlias} @ ${sub.endpoint.slice(0,60)}`);
        sent++;
      } catch (err) {
        console.error(`[PUSH] test-me ❌ ${empAlias}: ${err.statusCode} ${err.message}`);
        failed++;
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [sub.endpoint] }).catch(() => {});
        }
      }
    }
    // Also send via FCM to native Android app
    if (firebaseAdmin) {
      const fcmRows = await db.execute({ sql: 'SELECT token FROM fcm_tokens WHERE emp_alias = ?', args: [empAlias] });
      for (const row of fcmRows.rows) {
        try {
          await firebaseAdmin.messaging().send({
            token: row.token,
            notification: { title: '✦ APPACHI Test', body: `Hello ${empAlias} — notifications working!` },
            data: { url: '/' },
            android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
          });
          console.log(`[FCM] test-me ✅ sent to ${empAlias}`);
          sent++;
        } catch (err) {
          console.error(`[FCM] test-me ❌ ${empAlias}: ${err.message}`);
          failed++;
          if (err.code === 'messaging/registration-token-not-registered') {
            await db.execute({ sql: 'DELETE FROM fcm_tokens WHERE token = ?', args: [row.token] }).catch(() => {});
          }
        }
      }
    }

    res.json({ ok: sent > 0, sent, failed, total: r.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/fcm-token  — save FCM device token for native Android push
app.post('/api/push/fcm-token', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  const empAlias = req.session?.name;
  if (!empAlias) return res.status(400).json({ error: 'Not authenticated' });
  try {
    await db.execute({
      sql:  `INSERT INTO fcm_tokens (emp_alias, token) VALUES (?, ?)
             ON CONFLICT(token) DO UPDATE SET emp_alias = excluded.emp_alias`,
      args: [empAlias, token],
    });
    console.log(`[FCM] Token saved for ${empAlias}`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/push/count  — how many devices subscribed
app.get('/api/push/count', async (_req, res) => {
  try {
    const r = await db.execute('SELECT COUNT(*) as n FROM push_subscriptions');
    res.json({ count: Number(r.rows[0].n) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Leaves API ───────────────────────────────────────────────────────────────

// GET /api/leaves — joins leave_bookings to always return the correct booked_by
app.get('/api/leaves', async (req, res) => {
  const { date, alias } = req.query;
  try {
    let sql = `
      SELECT l.id, l.date, l.emp_alias,
             COALESCE(lb.booked_by, 'ADMIN') AS booked_by
      FROM   leaves l
      LEFT JOIN leave_bookings lb
             ON lb.date = l.date AND lb.emp_alias = l.emp_alias`;
    const args = [];
    if (date)       { sql += ' WHERE l.date = ?';       args.push(date);  }
    else if (alias) { sql += ' WHERE l.emp_alias = ?';  args.push(alias); }
    sql += ' ORDER BY l.date DESC, l.emp_alias ASC';
    const r = await db.execute({ sql, args });
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leaves — admin-booked leaves
app.post('/api/leaves', async (req, res) => {
  const { date, aliases, alias, dates } = req.body;
  const pairs = [];

  if (date && Array.isArray(aliases)) {
    for (const a of aliases) if (a?.trim()) pairs.push([date, a.trim()]);
  } else if (alias && Array.isArray(dates)) {
    for (const d of dates) if (d?.trim()) pairs.push([d.trim(), alias.trim()]);
  } else {
    return res.status(400).json({ error: 'Provide {date, aliases:[]} or {alias, dates:[]}' });
  }

  if (!pairs.length) return res.status(400).json({ error: 'No valid entries provided' });

  try {
    let inserted = 0;
    let totalReassigned = 0;
    for (const [d, a] of pairs) {
      const r = await db.execute({
        sql:  'INSERT OR IGNORE INTO leaves (date, emp_alias) VALUES (?, ?)',
        args: [d, a],
      });
      if ((r.rowsAffected || 0) > 0) {
        await db.execute({
          sql:  'INSERT OR IGNORE INTO leave_bookings (date, emp_alias, booked_by) VALUES (?, ?, ?)',
          args: [d, a, 'ADMIN'],
        });
        inserted++;
        const reassigned = await reassignSlotsForLeave(d, a);
        totalReassigned += reassigned.length;
      }
    }
    res.json({ ok: true, inserted, skipped: pairs.length - inserted, reassigned: totalReassigned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leaves/sync-assignments  body:{date}  — OWNER only
// For every employee on leave that date, reassigns their assignment slots
app.post('/api/leaves/sync-assignments', async (req, res) => {
  if (req.session?.user?.role !== 'OWNER') return res.status(403).json({ error: 'Forbidden' });
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const leaveR = await db.execute({
      sql:  'SELECT DISTINCT emp_alias FROM leaves WHERE date = ?',
      args: [date],
    });
    let total = 0;
    for (const { emp_alias } of leaveR.rows) {
      const r = await reassignSlotsForLeave(date, emp_alias);
      total += r.length;
    }
    res.json({ ok: true, reassigned: total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/leaves/:id — also cleans up leave_bookings
app.delete('/api/leaves/:id', async (req, res) => {
  try {
    const check = await db.execute({ sql: 'SELECT date, emp_alias FROM leaves WHERE id = ?', args: [Number(req.params.id)] });
    if (check.rows.length) {
      const { date, emp_alias } = check.rows[0];
      await db.execute({ sql: 'DELETE FROM leave_bookings WHERE date = ? AND emp_alias = ?', args: [date, emp_alias] });
    }
    await db.execute({ sql: 'DELETE FROM leaves WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Pages ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(__dirname + '/dashboard.html'));

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
