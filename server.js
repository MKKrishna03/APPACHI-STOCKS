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

// Sessions never expire on their own — only /api/logout ends one. Login sets
// cookie.maxAge to this so both the cookie and the store row live effectively forever.
const SESSION_MAX_AGE = 10 * 365 * 24 * 60 * 60 * 1000;

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
      const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + SESSION_MAX_AGE;
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
      const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + SESSION_MAX_AGE;
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
  cookie: { httpOnly: true, maxAge: SESSION_MAX_AGE }, // sessions persist until manual logout
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
  { id: 'pathiram_sl_box',  label: 'PATHIRAM, SL BOX'      },
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
];
const VALID_IDS = new Set(STOCK_CATEGORIES.map(c => c.id));

// Stocks restricted to MALE employees only
const GENTS_STOCKS = new Set(['shop_opening', 'shop_closing']);

// Stocks where every slot must share the same city category (all IN_CITY or
// all OUT_OF_CITY) — never a mix — when auto-assign fills them.
const SAME_CITY_STOCKS = new Set(['tray_arrange', 'silver_arrange']);

// Which Assignment Rules toggle gates each same-city stock above.
const SAME_CITY_RULE_BY_STOCK = {
  tray_arrange: 'same_city_tray_arrange',
  silver_arrange: 'same_city_silver_arrange',
};

// Same-city stocks exempted from the check on manual ENTRY saves (the daily
// "what actually happened" page) — the rule still constrains AUTO-ASSIGN's
// own picks and the dashboard's auto-assign edit, just not manual entry.
const SAME_CITY_ENTRY_EXEMPT = new Set(['silver_arrange']);

// Stocks currently set inactive by owner (not shown in entry/auto-assign)
const INACTIVE_STOCKS = new Set();

// Stock conflict pairs — same person cannot be in both stocks on the same day
// { stock_id: Set<conflicting_stock_id> }  (stored bidirectionally)
const STOCK_CONFLICTS = {};

// ─── Assignment Rules — owner-toggleable on/off switches for the fixed rules
// below. Backed by the `assignment_rules` table; RULES_ENABLED is refreshed
// from it at boot and on every toggle. Each key here maps to a specific
// hard-coded behavior gated elsewhere in this file (search the id string).
const ASSIGNMENT_RULE_DEFS = [
  { id: 'same_city_tray_arrange',   label: 'TRAY ARRANGE: both slots must share one city category (In City or Out of City) — never mixed' },
  { id: 'same_city_silver_arrange', label: 'SILVER ARRANGE: both slots must share one city category (In City or Out of City) — never mixed' },
  { id: 'gents_only_shop',        label: 'SHOP OPENING & SHOP CLOSING: restricted to male staff only' },
  { id: 'forced_sunday_opener',   label: 'Every Sunday, PARIMANAM opens the shop first (if eligible and not on leave)' },
];
const RULES_ENABLED = {}; // id -> boolean, populated by loadAssignmentRules()

// Gated wrapper — each same-city stock's rule can be switched off individually
// from the Assignment Rules popup, in which case that stock is exempted.
function sameCityRuleActive(sid) {
  if (!SAME_CITY_STOCKS.has(sid)) return false;
  const ruleId = SAME_CITY_RULE_BY_STOCK[sid];
  return RULES_ENABLED[ruleId] !== false;
}

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
  pathiram_sl_box:  { timing: ['1000'],          group: 'C',  days: [2, 5], skip: false },
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
async function loadCustomStocks() {
  try {
    const rows = await db.execute('SELECT * FROM custom_stocks ORDER BY created_at');
    rows.rows.forEach(r => {
      const timingArr = r.timing ? r.timing.split(',') : ['any'];
      if (VALID_IDS.has(r.id)) {
        // Built-in stock — apply saved overrides (label, timing, slots, gents, days)
        const cat = STOCK_CATEGORIES.find(c => c.id === r.id);
        if (cat) cat.label = r.label;
        if (STOCK_META[r.id]) {
          STOCK_META[r.id].timing = timingArr;
          STOCK_META[r.id].days   = r.days ? r.days.split(',').map(Number) : null;
        }
        ENTRY_COUNTS[r.id] = r.slots || ENTRY_COUNTS[r.id];
        if (r.gents) GENTS_STOCKS.add(r.id); else GENTS_STOCKS.delete(r.id);
        return;
      }
      STOCK_CATEGORIES.push({ id: r.id, label: r.label, custom: true });
      VALID_IDS.add(r.id);
      STOCK_META[r.id]   = { timing: timingArr, group: r.grp || null, days: r.days ? r.days.split(',').map(Number) : null, skip: false };
      ENTRY_COUNTS[r.id] = r.slots || 1;
      if (r.gents) GENTS_STOCKS.add(r.id);
    });
    if (rows.rows.length) console.log(`✅ Loaded ${rows.rows.length} custom stock(s): ${rows.rows.map(r=>r.id).join(', ')}`);
  } catch (e) { console.error('loadCustomStocks:', e.message); }
}

async function loadStockStatus() {
  try {
    const rows = await db.execute('SELECT stock_id FROM stock_status WHERE is_active = 0');
    INACTIVE_STOCKS.clear();
    rows.rows.forEach(r => INACTIVE_STOCKS.add(r.stock_id));
    if (INACTIVE_STOCKS.size) console.log(`⏸️  Inactive stocks: ${[...INACTIVE_STOCKS].join(', ')}`);
  } catch (e) { console.error('loadStockStatus:', e.message); }
}

async function loadStockConflicts() {
  try {
    const rows = await db.execute('SELECT stock_a, stock_b FROM stock_conflicts');
    Object.keys(STOCK_CONFLICTS).forEach(k => delete STOCK_CONFLICTS[k]);
    rows.rows.forEach(r => {
      if (!STOCK_CONFLICTS[r.stock_a]) STOCK_CONFLICTS[r.stock_a] = new Set();
      STOCK_CONFLICTS[r.stock_a].add(r.stock_b);
    });
  } catch (_) {}
}

async function loadAssignmentRules() {
  try {
    const rows = await db.execute('SELECT id, enabled FROM assignment_rules');
    const byId = {};
    rows.rows.forEach(r => { byId[r.id] = !!r.enabled; });
    ASSIGNMENT_RULE_DEFS.forEach(def => { RULES_ENABLED[def.id] = byId[def.id] !== undefined ? byId[def.id] : true; });
  } catch (e) { console.error('loadAssignmentRules:', e.message); }
}

async function initDB() {
  try {
    await db.execute('SELECT 1');
    console.log('✅ Connected to Turso database');

    try { await db.execute(`ALTER TABLE employees ADD COLUMN alias_name TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE custom_stocks ADD COLUMN days TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN designation TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN pin_hash TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN invite_code TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN email TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN password_hash TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN registered_at TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN pin_plain TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN password_plain TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN last_login TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN is_active INTEGER DEFAULT 1`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN city_category TEXT DEFAULT 'IN_CITY'`); } catch (_) {}
    try { await db.execute(`ALTER TABLE employees ADD COLUMN last_seen_at TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE leaves ADD COLUMN booked_by TEXT`); } catch (_) {}
    try { await db.execute(`ALTER TABLE leaves ADD COLUMN leave_type TEXT DEFAULT 'FULL'`); } catch (_) {}
    try { await db.execute(`ALTER TABLE push_subscriptions ADD COLUMN emp_alias TEXT`); } catch (_) {}

    // Leave cancellation approval requests
    await db.execute(`
      CREATE TABLE IF NOT EXISTS leave_cancel_requests (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        leave_id     INTEGER NOT NULL UNIQUE,
        leave_date   TEXT NOT NULL,
        emp_alias    TEXT NOT NULL,
        requested_at TEXT DEFAULT (datetime('now','localtime')),
        status       TEXT DEFAULT 'PENDING'
      )
    `);

    // Staff feedback box — free-text notes from any employee straight to the developer
    await db.execute(`
      CREATE TABLE IF NOT EXISTS feedback (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        emp_alias  TEXT NOT NULL,
        message    TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        is_read    INTEGER DEFAULT 0
      )
    `);

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

    // Log of every stock slot reassignSlotsForLeave() has touched — lets the
    // owner see who a stock moved from/to, and (for reason='LEAVE') offers
    // restoring it to the original person after a leave cancellation is
    // approved, since approving a cancellation otherwise has no effect on
    // the assignment it already caused.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS leave_reassignments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        leave_date TEXT NOT NULL,
        emp_alias  TEXT NOT NULL,
        stock_id   TEXT NOT NULL,
        to_alias   TEXT,
        reason     TEXT DEFAULT 'LEAVE',
        restored   INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
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

    // Custom stocks created by admin at runtime
    await db.execute(`
      CREATE TABLE IF NOT EXISTS custom_stocks (
        id         TEXT PRIMARY KEY,
        label      TEXT NOT NULL,
        timing     TEXT NOT NULL DEFAULT 'any',
        grp        TEXT,
        days       TEXT,
        slots      INTEGER NOT NULL DEFAULT 1,
        gents      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);

    // Active/inactive status per stock (row present = overridden; default is active)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS stock_status (
        stock_id  TEXT PRIMARY KEY,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Conflict pairs — same person cannot be in both stocks on the same day
    await db.execute(`
      CREATE TABLE IF NOT EXISTS stock_conflicts (
        stock_a TEXT NOT NULL,
        stock_b TEXT NOT NULL,
        PRIMARY KEY (stock_a, stock_b)
      )
    `);

    // Owner-toggleable on/off switches for the fixed assignment rules listed
    // in ASSIGNMENT_RULE_DEFS above (shown as checkboxes in the Assignment
    // Rules popup on the Auto-Assign page).
    await db.execute(`
      CREATE TABLE IF NOT EXISTS assignment_rules (
        id         TEXT PRIMARY KEY,
        enabled    INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    for (const def of ASSIGNMENT_RULE_DEFS) {
      await db.execute({ sql: 'INSERT OR IGNORE INTO assignment_rules (id, enabled) VALUES (?, 1)', args: [def.id] });
    }

    // Temporary rotation-priority nudges from the owner's free-text Workload
    // Directive box (e.g. "increase work for X slightly for 1 week") — a soft
    // bias applied to auto-assign's sort, never to hard rules (leave/conflict/
    // day-restriction). Parsed locally, no external API involved.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS workload_bias (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        emp_alias     TEXT NOT NULL,
        direction     TEXT NOT NULL,
        intensity     INTEGER NOT NULL,
        duration_days INTEGER NOT NULL,
        raw_text      TEXT,
        created_by    TEXT,
        created_at    TEXT DEFAULT (datetime('now','localtime')),
        expires_at    TEXT NOT NULL
      )
    `);

    // Pin directives from the same free-text Workload Directive box (e.g. "put
    // Raji-2 in Ring Stock for the next 10 days") — forces that person into
    // that stock in Auto-Assign for the stated period, same soft-precedence
    // as FORCED_DOW: only applies when they're already eligible for the stock
    // and free (never overrides leave/conflicts/day-restriction).
    await db.execute(`
      CREATE TABLE IF NOT EXISTS pin_directives (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        emp_alias   TEXT NOT NULL,
        stock_id    TEXT NOT NULL,
        raw_text    TEXT,
        created_by  TEXT,
        created_at  TEXT DEFAULT (datetime('now','localtime')),
        expires_at  TEXT NOT NULL
      )
    `);

    // Tracks who currently occupies each "next to attend" queue slot (computed
    // client-side from the Sales app's Firestore data, synced here so we can
    // tell who's genuinely new to the queue and only notify them once, even
    // though every viewer's dashboard re-submits the same ranking on load.
    await db.execute(`
      CREATE TABLE IF NOT EXISTS next_to_attend (
        staff_type TEXT NOT NULL,
        rank       INTEGER NOT NULL,
        alias      TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (staff_type, rank)
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
    await loadCustomStocks();
    await loadStockStatus();
    await loadStockConflicts();
    await loadAssignmentRules();
  } catch (err) {
    console.error('❌ DB init failed:', err.message);
  }
}

// ─── Auth helpers ──────────────────────────────────────────────────────────────
// Throttled "last seen" tracking — updates employees.last_seen_at at most once
// per minute per user (fire-and-forget, never blocks the request) so the Staff
// Activity view can tell who's actually active right now vs just logged in once
// long ago and never logged out (sessions persist for years — see SESSION_MAX_AGE).
const lastSeenThrottle = new Map(); // empId -> last DB-write timestamp (ms)
function touchLastSeen(empId) {
  if (!Number.isInteger(Number(empId))) return; // skip the special 'admin' session id
  const now = Date.now();
  if (now - (lastSeenThrottle.get(empId) || 0) < 60000) return;
  lastSeenThrottle.set(empId, now);
  // Store as an unambiguous UTC ISO string (not SQLite's datetime('now','localtime'),
  // whose "local" is the DB host's timezone, not IST — the client then misreads the
  // naive string as local time and the displayed "time ago" comes out hours wrong).
  db.execute({ sql: `UPDATE employees SET last_seen_at = ? WHERE id = ?`, args: [new Date().toISOString(), empId] }).catch(() => {});
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    touchLastSeen(req.session.userId);
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(403).json({ error: 'Admin access required' });
}

// Kicks out any currently-logged-in session belonging to this employee — used when an
// employee is removed or temporarily disabled, so access is revoked immediately rather
// than only on their next login attempt.
async function killEmployeeSessions(empId) {
  try {
    const r = await db.execute('SELECT sid, data FROM sessions');
    for (const row of r.rows) {
      let data;
      try { data = JSON.parse(row.data); } catch (_) { continue; }
      if (String(data.userId) === String(empId)) {
        await db.execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [row.sid] });
      }
    }
  } catch (_) {}
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
    return res.json({ ok: true, isAdmin: true, role: 'OWNER', name: 'Admin', id: 'admin' });
  }

  try {
    // Email + Password login
    if (email && password) {
      const r = await db.execute({
        sql:  'SELECT id, name, alias_name, password_hash, designation, COALESCE(is_active,1) AS is_active FROM employees WHERE email = ?',
        args: [String(email).toLowerCase().trim()],
      });
      if (!r.rows.length || !r.rows[0].password_hash) return res.status(401).json({ error: 'Invalid credentials' });
      const emp = r.rows[0];
      if (!(await bcrypt.compare(String(password), emp.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
      if (!emp.is_active) return res.status(403).json({ error: 'This account has been temporarily disabled. Contact the owner.' });
      req.session.userId  = emp.id;
      req.session.isAdmin = ADMIN_EMP_IDS.has(Number(emp.id));
      req.session.role    = computeRole(emp.id, emp.designation);
      req.session.name    = emp.alias_name || emp.name;
        await db.execute({ sql: `UPDATE employees SET last_login = ?, last_seen_at = ? WHERE id = ?`, args: [new Date().toISOString(), new Date().toISOString(), emp.id] });
      return res.json({ ok: true, isAdmin: req.session.isAdmin, role: req.session.role, name: req.session.name, id: emp.id });
    }

    // Employee ID + PIN login
    if (employee_id && pin) {
      const empId = Number(employee_id);
      if (!Number.isInteger(empId) || empId <= 0) return res.status(401).json({ error: 'Invalid credentials' });
      const r = await db.execute({
        sql:  'SELECT id, name, alias_name, pin_hash, registered_at, designation, COALESCE(is_active,1) AS is_active FROM employees WHERE id = ?',
        args: [empId],
      });
      if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
      const emp = r.rows[0];
      if (!emp.registered_at) return res.status(401).json({ error: 'Account not set up yet. Please sign up first.' });
      if (!emp.pin_hash || !(await bcrypt.compare(String(pin), emp.pin_hash))) return res.status(401).json({ error: 'Invalid credentials' });
      if (!emp.is_active) return res.status(403).json({ error: 'This account has been temporarily disabled. Contact the owner.' });
      req.session.userId  = emp.id;
      req.session.isAdmin = ADMIN_EMP_IDS.has(empId);
      req.session.role    = computeRole(empId, emp.designation);
      req.session.name    = emp.alias_name || emp.name;
        await db.execute({ sql: `UPDATE employees SET last_login = ?, last_seen_at = ? WHERE id = ?`, args: [new Date().toISOString(), new Date().toISOString(), emp.id] });
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
      sql:  'UPDATE employees SET email = ?, password_hash = ?, password_plain = ?, pin_hash = ?, pin_plain = ?, invite_code = NULL, registered_at = ? WHERE id = ?',
      args: [email.toLowerCase(), passwordHash, String(password), pinHash, String(pin), new Date().toISOString(), empId],
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

    const setClauses = ['password_hash = ?', 'password_plain = ?', 'invite_code = NULL'];
    const args       = [await bcrypt.hash(String(password), 10), String(password)];

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
  // Every page calls this on load (see auth.js), making it the single most
  // reliable "the app was just opened" signal — touch it here directly since
  // this route sits before the requireAuth middleware below and wouldn't
  // otherwise trigger the last-seen tracking at all.
  touchLastSeen(req.session.userId);
  res.json({ id: req.session.userId, name: req.session.name, isAdmin: req.session.isAdmin || false, role: req.session.role || 'STAFF' });
});

// ─── All remaining /api/* routes require a valid session ───────────────────────
app.use('/api', requireAuth);

// Admin-only routes
app.use('/api/admin', requireAdmin);

// ─── Salary (Payroll app integration) ──────────────────────────────────────────
// Server-side proxy to the separate Payroll app's staff-data endpoint. That
// endpoint has no authentication of its own, so identity is enforced entirely
// here, not there: a non-owner can only ever request their OWN employee ID
// (taken from their session), never one supplied by the client — an OWNER can
// look up anyone, matching what the Payroll app's own Staff Data page allows.
const PAYROLL_BASE_URL = 'https://appachi-payroll.onrender.com';

// GET /api/salary-wake — fired the instant the Salary tab is opened, before
// we know which employee to load. Free-tier Render dynos spin down when
// idle, so this kicks the Payroll app's dyno awake in the background (not
// awaited) and responds immediately — same effect as this app itself waking
// up simply because a browser opened it. Gives the dyno a head start before
// the real /api/salary/:employeeId request needs actual data back.
app.get('/api/salary-wake', (_req, res) => {
  fetch(PAYROLL_BASE_URL, { signal: AbortSignal.timeout(55000) }).catch(() => {});
  res.json({ ok: true });
});

// The reactive wake-up above only helps if the Payroll dyno was already
// warm or fast enough to beat the real data request that fires right after
// it — in practice it's simultaneous, so the full 30-50s cold start still
// gets felt on the first open. Ping it proactively on a timer instead, as
// long as this server process itself is up, so it's rarely asleep by the
// time anyone actually opens the Salary tab. Render's free tier sleeps
// after ~15 minutes idle, so 10 minutes keeps it comfortably ahead of that.
// setInterval alone wouldn't fire until 10 minutes after *this* server just
// started (e.g. right after a deploy), leaving Payroll cold for that whole
// window, so ping once immediately too.
function pingPayroll() {
  fetch(PAYROLL_BASE_URL, { signal: AbortSignal.timeout(55000) }).catch(() => {});
}
pingPayroll();
setInterval(pingPayroll, 10 * 60 * 1000);

app.get('/api/salary/:employeeId', async (req, res) => {
  const targetId = String(req.params.employeeId).trim();
  const isOwner  = req.session.role === 'OWNER';
  if (!isOwner && targetId !== String(req.session.userId)) {
    return res.status(403).json({ error: 'You can only view your own salary data' });
  }
  const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const month = todayIST.slice(0, 7);
  try {
    const url = `${PAYROLL_BASE_URL}/api/staff-data?month=${month}&employee_id=${encodeURIComponent(targetId)}`;
    // 55s, not 25s — free-tier Render dynos can take 30-50s to cold-start,
    // and this is often the request that has to wait it out.
    const r = await fetch(url, { signal: AbortSignal.timeout(55000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data.error || `Payroll service error (HTTP ${r.status})` });

    // Leave dates for the month — from the Payroll app's Attendance page data.
    // That endpoint returns every employee for the month in one call (day is
    // unpivoted to a status/remark pair: L/H = full/half day, Reserved/
    // Unreserved), so filter down to this employee and drop present days.
    let leaveDates = [];
    try {
      const attR = await fetch(`${PAYROLL_BASE_URL}/api/attendance/daily?month=${month}`, { signal: AbortSignal.timeout(25000) });
      if (attR.ok) {
        const attRows = await attR.json();
        leaveDates = attRows
          .filter(row => String(row.employee_id) === targetId && row.status !== 'P')
          .map(row => ({ date: `${month}-${String(row.day).padStart(2, '0')}`, status: row.status, remark: row.remark }))
          .sort((a, b) => a.date.localeCompare(b.date));
      }
    } catch (_) { /* leave data is supplementary — don't fail the whole card over it */ }

    res.json({ ...data, leave_dates: leaveDates });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the payroll service — it may be waking up. Please try again in a moment.' });
  }
});

// ─── Tomorrow's date in IST (server-authoritative) — assignments are for next day
app.get('/api/today', (_req, res) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow);
  res.json({ date });
});

// ─── Employee self-service leaves ─────────────────────────────────────────────

// Send a push notification to a single alias (web push + FCM)
async function pushToAlias(alias, { title, body, url = '/', tag }) {
  const payload = JSON.stringify({ title, body, url, tag });
  if (webpush) {
    const r = await db.execute({ sql: 'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE emp_alias = ?', args: [alias] }).catch(() => ({ rows: [] }));
    for (const sub of r.rows) {
      try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload); }
      catch (e) { if (e.statusCode === 410 || e.statusCode === 404) await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [sub.endpoint] }).catch(() => {}); }
    }
  }
  if (firebaseAdmin) {
    const fcmR = await db.execute({ sql: 'SELECT token FROM fcm_tokens WHERE emp_alias = ?', args: [alias] }).catch(() => ({ rows: [] }));
    for (const row of fcmR.rows) {
      try {
        await firebaseAdmin.messaging().send({ token: row.token, notification: { title, body }, data: { url }, android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } } });
      } catch (e) { if (e.code === 'messaging/registration-token-not-registered') await db.execute({ sql: 'DELETE FROM fcm_tokens WHERE token = ?', args: [row.token] }).catch(() => {}); }
    }
  }
}

// Get aliases of all OWNER-role employees (for approval notifications)
async function getOwnerAliases() {
  const adminIds = [...ADMIN_EMP_IDS];
  const sql = adminIds.length
    ? `SELECT COALESCE(alias_name, name) AS alias FROM employees WHERE designation = 'OWNER' OR id IN (${adminIds.map(() => '?').join(',')})`
    : `SELECT COALESCE(alias_name, name) AS alias FROM employees WHERE designation = 'OWNER'`;
  const r = await db.execute({ sql, args: adminIds }).catch(() => ({ rows: [] }));
  return [...new Set(r.rows.map(row => row.alias).filter(Boolean))];
}

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

    // Disabled employees must never be picked as a replacement — treated
    // exactly like a full-day leave, same as everywhere else in the app.
    const disabledR = await db.execute("SELECT COALESCE(alias_name, name) AS alias FROM employees WHERE is_active = 0");
    const disabled  = new Set(disabledR.rows.map(r => r.alias));

    const assignedR = await db.execute({
      sql:  'SELECT emp_alias FROM assignment WHERE date = ? AND stock_id = ?',
      args: [date, stockId],
    });
    const alreadyIn = new Set(assignedR.rows.map(r => r.emp_alias));

    const candidates = eligibleR.rows.map(r => r.emp_alias)
      .filter(a => !onLeave.has(a) && !disabled.has(a) && !alreadyIn.has(a));
    if (!candidates.length) return null;

    // Consecutive-day exclusion: prefer candidates who were NOT on this stock
    // yesterday. Yesterday is a past date, so only actual submitted entries
    // (stock_* tables) count — never the `assignment` plan table, since a
    // plan for a day that's already over doesn't mean that's who actually
    // did the work.
    const prevDate = (() => {
      const d = new Date(date + 'T12:00:00');
      const p = new Date(d.getTime() - 86400000);
      return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
    })();
    const prevSet = new Set();
    try {
      const ps = await db.execute({ sql: `SELECT stock FROM stock_${stockId} WHERE date = ?`, args: [prevDate] });
      ps.rows.forEach(r => { if (r.stock) prevSet.add(r.stock); });
      // prevDate can be "today" (no entry submitted yet) — fall back to the
      // planned assignment so the exclusion still has a signal.
      if (!ps.rows.length) {
        const pa = await db.execute({ sql: 'SELECT emp_alias FROM assignment WHERE date = ? AND stock_id = ?', args: [prevDate, stockId] });
        pa.rows.forEach(r => prevSet.add(r.emp_alias));
      }
    } catch (_) {}
    const withoutPrev = candidates.filter(a => !prevSet.has(a));
    const pool = withoutPrev.length ? withoutPrev : candidates;

    // Sort by who did this stock longest ago — actual entries only (see above)
    const ph = pool.map(() => '?').join(',');
    const histR = await db.execute({ sql: `SELECT stock, MAX(date) AS last_date FROM stock_${stockId} WHERE date < ? AND stock IN (${ph}) GROUP BY stock`, args: [date, ...pool] });
    const lastMap = {};
    histR.rows.forEach(r => { lastMap[r.stock] = r.last_date; });

    pool.sort((a, b) => {
      const la = lastMap[a], lb = lastMap[b];
      if (!la && !lb) return a.localeCompare(b);
      if (!la) return -1;
      if (!lb) return  1;
      return la < lb ? -1 : la > lb ? 1 : a.localeCompare(b);
    });

    return pool[0];
  } catch { return null; }
}

// Returns true if a stock's timing conflicts with the absent half of a half-day leave.
// AM_CUTOFF = '1300': timings before that are AM, >= that are PM.
const AM_CUTOFF = '1300';
function stockConflictsWithLeave(meta, leave_type) {
  if (!meta || leave_type === 'FULL') return true; // full leave → always conflicts
  if (leave_type === 'HALF_AM') {
    // Absent in AM — conflicts only if stock has at least one AM timing
    return meta.timing.some(t => t !== 'any' && t < AM_CUTOFF);
  }
  if (leave_type === 'HALF_PM') {
    // Absent in PM — conflicts only if stock has at least one PM timing
    return meta.timing.some(t => t !== 'any' && t >= AM_CUTOFF);
  }
  return false;
}

// ─── Workload Directive — free-text parser (local, no external API) ───────────
// Parses sentences like "increase work for Chinnammal slightly for 1 week and
// decrease workload by minimum one stock for Raji-2" (rotation-priority nudge)
// or "put Raji-2 in Ring Stock for the next 10 days" (pin to a specific stock)
// into structured directives. Deliberately rule-based (regex + keyword
// matching), not a call to an LLM — this app runs on no budget, so this
// trades some flexibility on creative phrasing for zero cost and instant
// response. Handles one directive per "and"-joined clause; a clause naming
// two people (e.g. "for X and Y") won't split correctly — that's a known,
// disclosed limitation.
const WORKLOAD_NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function parseDurationDays(clause, fallbackDays) {
  const m = clause.match(/for\s+(?:the\s+)?(?:next\s+)?(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten)\s*(week|day)s?/i);
  if (!m) return fallbackDays;
  const n = m[1].toLowerCase();
  const count = (n === 'a') ? 1 : (WORKLOAD_NUMBER_WORDS[n] ?? (parseInt(n, 10) || 1));
  return /week/i.test(m[2]) ? count * 7 : count;
}

function parseDirectives(text, knownAliases) {
  const workloadDirectives = [];
  const pinDirectives = [];
  const unparsed = [];
  const clauses = String(text || '').split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  // Longest alias/label first so "RAJI-2" is matched before a shorter "RAJI"
  // would be, and "METTY, MOOKUTHI STOCK" before "STOCK" alone
  const sortedAliases = [...knownAliases].sort((a, b) => b.length - a.length);
  const sortedStocks  = [...STOCK_CATEGORIES].sort((a, b) => b.label.length - a.label.length);

  for (const clause of clauses) {
    const lower = clause.toLowerCase();

    // Pin directive: "put/assign/place/pin/keep ALIAS in/on/to STOCK [for N days]"
    if (/\b(put|place|assign|pin|keep)\b/i.test(clause)) {
      const alias = sortedAliases.find(a => lower.includes(a.toLowerCase()));
      const stock = sortedStocks.find(c => lower.includes(c.label.toLowerCase()));
      if (alias && stock) {
        pinDirectives.push({
          alias, stock_id: stock.id, stock_label: stock.label,
          duration_days: parseDurationDays(clause, 7), raw_text: clause,
        });
        continue;
      }
    }

    // Workload directive: "increase/decrease work ... for ALIAS"
    let direction = null;
    if (/\b(decrease|less|lighter|reduce|lower)\b/i.test(clause)) direction = 'decrease';
    else if (/\b(increase|more|heavier|harder|higher)\b/i.test(clause)) direction = 'increase';
    if (direction) {
      const alias = sortedAliases.find(a => lower.includes(a.toLowerCase()));
      if (alias) {
        // Intensity: an explicit count (e.g. "minimum one stock") wins over
        // adverbs; exclude numbers that belong to a "for N week/day" duration phrase.
        let intensity = 2;
        const numMatch = clause.match(/\b(?:by\s+)?(?:minimum\s+)?(\d+|one|two|three|four|five)\b(?!\s*(week|day))/i);
        if (numMatch) {
          const raw = numMatch[1].toLowerCase();
          intensity = WORKLOAD_NUMBER_WORDS[raw] ?? parseInt(raw, 10);
        } else if (/\b(slightly|a little|a bit|somewhat)\b/i.test(clause)) {
          intensity = 1;
        } else if (/\b(a lot|heavily|significantly|much|greatly)\b/i.test(clause)) {
          intensity = 4;
        }
        intensity = Math.min(Math.max(intensity || 2, 1), 5);

        workloadDirectives.push({
          alias, direction, intensity,
          duration_days: parseDurationDays(clause, 7), raw_text: clause,
        });
        continue;
      }
    }

    unparsed.push(clause);
  }

  return { workloadDirectives, pinDirectives, unparsed };
}

// Shift a 'YYYY-MM-DD' date string by `days` (may be negative)
function shiftDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Fetch active (non-expired) workload_bias rows and collapse to a net
// intensity per alias — positive = increase, negative = decrease. This is a
// STOCK COUNT (how many of their stocks to nudge), not a date-shift amount —
// see applyWorkloadNudge below for why.
async function getWorkloadBiasMap(todayIST) {
  const map = {}; // alias -> net signed intensity
  try {
    const r = await db.execute({
      sql:  'SELECT emp_alias, direction, intensity FROM workload_bias WHERE expires_at >= ?',
      args: [todayIST],
    });
    r.rows.forEach(row => {
      const signed = Number(row.intensity) * (row.direction === 'increase' ? 1 : -1);
      map[row.emp_alias] = (map[row.emp_alias] || 0) + signed;
    });
  } catch (_) {}
  return map;
}

// Fetch active (non-expired) pin_directives, grouped by stock_id — used by
// auto-assign to force a person into a specific stock for the stated period.
async function getPinnedMap(todayIST) {
  const map = {}; // stock_id -> [alias, ...]
  try {
    const r = await db.execute({
      sql:  'SELECT emp_alias, stock_id FROM pin_directives WHERE expires_at >= ?',
      args: [todayIST],
    });
    r.rows.forEach(row => {
      if (!map[row.stock_id]) map[row.stock_id] = [];
      map[row.stock_id].push(row.emp_alias);
    });
  } catch (_) {}
  return map;
}

// Applies a workload_bias nudge WITHOUT it being noticeable: rather than
// shifting every stock this person is eligible for (which would make them
// suddenly top the rotation everywhere at once — an obvious, all-at-once
// pile-up), it only nudges the `intensity` stocks where they were already
// closest to being picked naturally. That rides on the existing rotation
// instead of overriding it, so an "increase" shows up as slightly more work
// spread quietly across a few near-due stocks — not a flood of new
// assignments appearing out of nowhere. `lastByEmpMap` is mutated in place:
// { stock_id: { alias: last_date_or_undefined } }.
// Returns the list of nudges actually applied ({ sid, alias, direction }) so
// callers can explain a pick later (e.g. the "why was this picked" UI) —
// without this, a workload-nudged pick would look identical to a normal one.
function applyWorkloadNudge(lastByEmpMap, eligibleStockIdsByAlias, workloadBiasMap, targetDate) {
  const NUDGE_DAYS = 3; // small — just enough to tip a close call, never a hard override
  const applied = [];
  Object.entries(workloadBiasMap).forEach(([alias, netIntensity]) => {
    if (!netIntensity) return;
    const eligibleIds = eligibleStockIdsByAlias(alias);
    if (!eligibleIds.length) return;

    const ranked = eligibleIds.slice().sort((a, b) => {
      const da = lastByEmpMap[a]?.[alias], db_ = lastByEmpMap[b]?.[alias];
      if (!da && !db_) return 0;
      if (!da) return -1; // never done ranks as most "due"
      if (!db_) return 1;
      return da < db_ ? -1 : da > db_ ? 1 : 0;
    });

    const n = Math.min(Math.abs(netIntensity), ranked.length);
    const sign = netIntensity > 0 ? 1 : -1; // increase: nudge earlier (more due); decrease: nudge later (less due)
    ranked.slice(0, n).forEach(sid => {
      if (!lastByEmpMap[sid]) lastByEmpMap[sid] = {};
      const cur = lastByEmpMap[sid][alias];
      lastByEmpMap[sid][alias] = shiftDateStr(cur || targetDate, -sign * NUDGE_DAYS);
      applied.push({ sid, alias, direction: sign > 0 ? 'increase' : 'decrease' });
    });
  });
  return applied;
}

// Notifies `toAlias` that a stock was just reassigned to them because
// `fromAlias` booked leave for `date`. Fire-and-forget from the caller's
// perspective — errors are swallowed the same way every other push send
// in this app already is, so a notification failure never breaks reassignment.
async function notifyReassignment(fromAlias, toAlias, date, stockLabel) {
  if (!webpush && !firebaseAdmin) return;
  try {
    const todayIST    = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const tomorrowIST = (() => {
      const t = new Date(); t.setDate(t.getDate() + 1);
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t);
    })();
    const d       = new Date(date + 'T12:00:00');
    const dateFmt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const dayWord = date === todayIST ? 'today' : date === tomorrowIST ? 'tomorrow' : `on ${dateFmt}`;

    const title = '📋 Stock Reassigned';
    const body  = `${fromAlias} booked leave for ${dateFmt}, so ${stockLabel} is assigned to you ${dayWord}`;
    const tag   = `aj-reassign-${date}-${toAlias}`;

    if (webpush) {
      const subs = await db.execute({ sql: 'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE emp_alias = ?', args: [toAlias] }).catch(() => ({ rows: [] }));
      const payload = JSON.stringify({ title, body, url: '/entry.html', tag });
      for (const sub of subs.rows) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        } catch (e) {
          if (e.statusCode === 410 || e.statusCode === 404) {
            await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [sub.endpoint] }).catch(() => {});
          }
        }
      }
    }

    if (firebaseAdmin) {
      const fcmRows = await db.execute({ sql: 'SELECT token FROM fcm_tokens WHERE emp_alias = ?', args: [toAlias] }).catch(() => ({ rows: [] }));
      for (const row of fcmRows.rows) {
        try {
          await firebaseAdmin.messaging().send({
            token:        row.token,
            notification: { title, body },
            data:         { url: '/entry.html', tag },
            android:      { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
          });
        } catch (e) {
          if (e.code === 'messaging/registration-token-not-registered') {
            await db.execute({ sql: 'DELETE FROM fcm_tokens WHERE token = ?', args: [row.token] }).catch(() => {});
          }
        }
      }
    }
  } catch (e) {
    console.error('[PUSH] Reassignment notification error:', e.message);
  }
}

// Helper: reassign assignment-table slots for `alias` on `date`.
// With leave_type, only reassign slots that fall in the absent half.
// notify=false suppresses the "booked leave" push (used when this is called
// for reasons other than an actual leave booking, e.g. disabling an employee).
// `reason` is logged to leave_reassignments so the owner can later tell a
// leave-caused reassignment apart from a disable-caused or manual-sync one —
// only 'LEAVE' rows are offered for restoring after a cancellation is approved.
// Returns array of { stock, to } (to=null means no replacement found, slot removed)
async function reassignSlotsForLeave(date, alias, leave_type = 'FULL', notify = true, reason = 'LEAVE') {
  const reassigned = [];
  for (const cat of STOCK_CATEGORIES) {
    const meta = STOCK_META[cat.id];
    // Skip stocks the employee can still do (not in their absent period)
    if (leave_type !== 'FULL' && !stockConflictsWithLeave(meta, leave_type)) continue;

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
      if (notify) notifyReassignment(alias, next, date, cat.label).catch(() => {});
    } else {
      await db.execute({
        sql:  'DELETE FROM assignment WHERE date = ? AND stock_id = ? AND emp_alias = ?',
        args: [date, cat.id, alias],
      });
      reassigned.push({ stock: cat.label, to: null });
    }
    await db.execute({
      sql:  'INSERT INTO leave_reassignments (leave_date, emp_alias, stock_id, to_alias, reason) VALUES (?, ?, ?, ?, ?)',
      args: [date, alias, cat.id, next || null, reason],
    }).catch(() => {});
  }
  return reassigned;
}

// GET my own leaves (includes pending_cancel flag for leaves with an open cancellation request)
app.get('/api/my-leaves', async (req, res) => {
  try {
    const alias = await getSessionAlias(req.session);
    if (!alias) return res.json([]);
    const [leavesRes, pendingRes] = await Promise.all([
      db.execute({
        sql: `SELECT l.id, l.date, COALESCE(l.leave_type,'FULL') AS leave_type, COALESCE(lb.booked_by, 'ADMIN') AS booked_by
              FROM leaves l LEFT JOIN leave_bookings lb ON lb.date = l.date AND lb.emp_alias = l.emp_alias
              WHERE l.emp_alias = ? ORDER BY l.date ASC`,
        args: [alias],
      }),
      db.execute({ sql: "SELECT leave_id FROM leave_cancel_requests WHERE emp_alias = ? AND status = 'PENDING'", args: [alias] }),
    ]);
    const pendingIds = new Set(pendingRes.rows.map(r => Number(r.leave_id)));
    res.json(leavesRes.rows.map(l => ({ ...l, pending_cancel: pendingIds.has(Number(l.id)) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET my own last-done date per stock (real entries only) — used for a
// personal "I last did this on..." reminder next to an employee's own
// assigned stocks. Scoped to the logged-in session's alias only; no other
// employee's data is exposed here.
app.get('/api/my-last-done', async (req, res) => {
  try {
    const alias = await getSessionAlias(req.session);
    if (!alias) return res.json({});
    const map = {};
    await Promise.all(STOCK_CATEGORIES.map(async cat => {
      try {
        const r = await db.execute({
          sql:  `SELECT MAX(date) AS last_date FROM stock_${cat.id} WHERE stock = ?`,
          args: [alias],
        });
        const d = r.rows[0]?.last_date;
        if (d) map[cat.id] = d;
      } catch (_) {}
    }));
    res.json(map);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stocks-last-done — for every stock, the most recent actual entry
// date and who did it (everyone who did it that day, not just the current
// user — unlike /api/my-last-done above). Powers the "Last Done" tab
// alongside Today/Tomorrow on the mobile dashboard. No role gate — same
// visibility as the Today/Tomorrow assignment lists.
app.get('/api/stocks-last-done', async (_req, res) => {
  try {
    const cats = STOCK_CATEGORIES.filter(cat => !STOCK_META[cat.id]?.skip);
    const results = await Promise.all(cats.map(async cat => {
      try {
        const r = await db.execute(
          `SELECT stock, date FROM stock_${cat.id} WHERE date = (SELECT MAX(date) FROM stock_${cat.id}) ORDER BY id`
        );
        if (!r.rows.length) return { stock_id: cat.id, label: cat.label, last_date: null, staff: [] };
        return {
          stock_id: cat.id,
          label: cat.label,
          last_date: r.rows[0].date,
          staff: r.rows.map(row => row.stock).filter(Boolean),
        };
      } catch (_) {
        return { stock_id: cat.id, label: cat.label, last_date: null, staff: [] };
      }
    }));
    // Most overdue (oldest last-done, never-done first) — the most useful ordering
    results.sort((a, b) => {
      if (!a.last_date && !b.last_date) return a.label.localeCompare(b.label);
      if (!a.last_date) return -1;
      if (!b.last_date) return 1;
      return a.last_date < b.last_date ? -1 : a.last_date > b.last_date ? 1 : a.label.localeCompare(b.label);
    });
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET upcoming leave for the WHOLE team (today onward, next 14 days) — so
// any logged-in employee (not just the owner) can see who else is off
// before booking their own leave. No role gate: this is meant for staff.
app.get('/api/team-leaves', async (req, res) => {
  try {
    const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const endDateStr = (() => {
      const d = new Date(todayIST + 'T12:00:00');
      d.setDate(d.getDate() + 14);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const r = await db.execute({
      sql:  "SELECT date, emp_alias, COALESCE(leave_type,'FULL') AS leave_type FROM leaves WHERE date >= ? AND date <= ? ORDER BY date ASC, emp_alias ASC",
      args: [todayIST, endDateStr],
    });
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/feedback — free-text note from any logged-in employee straight to
// the developer's inbox. No role gate: this exists specifically so staff have a
// direct channel to be heard.
app.post('/api/feedback', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (message.length > 2000) return res.status(400).json({ error: 'Message is too long (max 2000 characters)' });
  const alias = req.session?.name;
  if (!alias) return res.status(401).json({ error: 'Not authenticated' });
  try {
    await db.execute({
      sql:  'INSERT INTO feedback (emp_alias, message) VALUES (?, ?)',
      args: [alias, message],
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — book leave; auto-reassign any saved stocks for that date
app.post('/api/my-leaves', async (req, res) => {
  const { date, leave_type } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Valid date required (YYYY-MM-DD)' });
  const lt = ['FULL','HALF_AM','HALF_PM'].includes(leave_type) ? leave_type : 'FULL';
  try {
    const alias = await getSessionAlias(req.session);
    if (!alias) return res.status(400).json({ error: 'Cannot book leave for this account' });

    // Block leave booking if the employee has Morning Cleaning assigned on that date
    const mcCheck = await db.execute({
      sql:  "SELECT id FROM assignment WHERE date = ? AND stock_id = 'morning_cleaning' AND emp_alias = ?",
      args: [date, alias],
    });
    if (mcCheck.rows.length && (lt === 'FULL' || lt === 'HALF_AM')) {
      const fmtD = new Date(date + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      return res.status(400).json({ error: `You have Morning Cleaning on ${fmtD}, so you can't book leave for that day` });
    }

    const insertR = await db.execute({
      sql:  `INSERT INTO leaves (date, emp_alias, leave_type) VALUES (?, ?, ?)
             ON CONFLICT(date, emp_alias) DO UPDATE SET leave_type = excluded.leave_type`,
      args: [date, alias, lt],
    });
    const inserted = (insertR.rowsAffected || 0) > 0;
    await db.execute({
      sql:  'INSERT OR REPLACE INTO leave_bookings (date, emp_alias, booked_by) VALUES (?, ?, ?)',
      args: [date, alias, 'SELF'],
    });

    const reassigned = inserted ? await reassignSlotsForLeave(date, alias, lt) : [];
    res.json({ ok: true, inserted, reassigned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE — cancel own leave.
// OWNER role: immediate. Non-owner: creates a pending approval request → notifies all owners.
app.delete('/api/my-leaves/:id', async (req, res) => {
  try {
    const alias   = await getSessionAlias(req.session);
    if (!alias) return res.status(403).json({ error: 'Forbidden' });
    const leaveId = Number(req.params.id);
    const check   = await db.execute({ sql: 'SELECT date FROM leaves WHERE id = ? AND emp_alias = ?', args: [leaveId, alias] });
    if (!check.rows.length) return res.status(404).json({ error: 'Leave not found' });
    const { date } = check.rows[0];

    // OWNER: cancel immediately
    if (req.session.role === 'OWNER') {
      await db.execute({ sql: 'DELETE FROM leave_bookings WHERE date = ? AND emp_alias = ?', args: [date, alias] });
      await db.execute({ sql: 'DELETE FROM leaves WHERE id = ?', args: [leaveId] });
      await db.execute({ sql: 'DELETE FROM leave_cancel_requests WHERE leave_id = ?', args: [leaveId] });
      const reassignRows = (await db.execute({
        sql:  "SELECT id, stock_id, to_alias FROM leave_reassignments WHERE leave_date = ? AND emp_alias = ? AND reason = 'LEAVE' AND restored = 0",
        args: [date, alias],
      })).rows;
      const reassignments = reassignRows.map(r => ({
        id:       r.id,
        stock_id: r.stock_id,
        label:    STOCK_CATEGORIES.find(c => c.id === r.stock_id)?.label || r.stock_id,
        to_alias: r.to_alias,
      }));
      return res.json({ ok: true, reassignments });
    }

    // Non-OWNER: create approval request if not already pending
    const existing = await db.execute({ sql: "SELECT id FROM leave_cancel_requests WHERE leave_id = ? AND status = 'PENDING'", args: [leaveId] });
    if (existing.rows.length) return res.json({ ok: true, pending: true });

    await db.execute({ sql: 'INSERT INTO leave_cancel_requests (leave_id, leave_date, emp_alias) VALUES (?, ?, ?)', args: [leaveId, date, alias] });

    // Push notification to all owners
    const fmtD = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const owners = await getOwnerAliases();
    for (const owner of owners) {
      await pushToAlias(owner, {
        title: 'Leave Cancel Request',
        body:  `${alias} wants to cancel leave on ${fmtD(date)}`,
        url:   '/dashboard.html',
        tag:   `leave-cancel-${leaveId}`,
      }).catch(() => {});
    }

    res.json({ ok: true, pending: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/leave-cancel-requests — list pending cancellation requests (OWNER only)
app.get('/api/leave-cancel-requests', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  try {
    const r = await db.execute(`
      SELECT lcr.id, lcr.leave_id, lcr.leave_date, lcr.emp_alias, lcr.requested_at,
             COALESCE(l.leave_type, 'FULL') AS leave_type
      FROM   leave_cancel_requests lcr
      LEFT JOIN leaves l ON l.id = lcr.leave_id
      WHERE  lcr.status = 'PENDING'
      ORDER  BY lcr.requested_at ASC
    `);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leave-cancel-requests/:id/approve — approve → delete the leave (OWNER only)
app.post('/api/leave-cancel-requests/:id/approve', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  try {
    const row = (await db.execute({ sql: "SELECT * FROM leave_cancel_requests WHERE id = ? AND status = 'PENDING'", args: [Number(req.params.id)] })).rows[0];
    if (!row) return res.status(404).json({ error: 'Request not found' });
    const { leave_id, leave_date, emp_alias } = row;
    await db.execute({ sql: 'DELETE FROM leave_bookings WHERE date = ? AND emp_alias = ?', args: [leave_date, emp_alias] });
    await db.execute({ sql: 'DELETE FROM leaves WHERE id = ?', args: [leave_id] });
    await db.execute({ sql: "UPDATE leave_cancel_requests SET status = 'APPROVED' WHERE id = ?", args: [Number(req.params.id)] });
    const fmtD = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    await pushToAlias(emp_alias, { title: 'Leave Cancellation Approved ✓', body: `Your leave on ${fmtD(leave_date)} has been cancelled.`, url: '/', tag: `lcr-approved-${leave_id}` }).catch(() => {});

    // Approving the cancellation has no effect on whatever stock this leave
    // already caused to be reassigned — surface those rows here so the owner
    // can be prompted to restore them (see /api/leave-reassignments/restore).
    const reassignRows = (await db.execute({
      sql:  "SELECT id, stock_id, to_alias FROM leave_reassignments WHERE leave_date = ? AND emp_alias = ? AND reason = 'LEAVE' AND restored = 0",
      args: [leave_date, emp_alias],
    })).rows;
    const reassignments = reassignRows.map(r => ({
      id:       r.id,
      stock_id: r.stock_id,
      label:    STOCK_CATEGORIES.find(c => c.id === r.stock_id)?.label || r.stock_id,
      to_alias: r.to_alias,
    }));

    res.json({ ok: true, reassignments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leave-cancel-requests/:id/reject — reject → keep the leave (OWNER only)
app.post('/api/leave-cancel-requests/:id/reject', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  try {
    const row = (await db.execute({ sql: "SELECT * FROM leave_cancel_requests WHERE id = ? AND status = 'PENDING'", args: [Number(req.params.id)] })).rows[0];
    if (!row) return res.status(404).json({ error: 'Request not found' });
    const { leave_id, leave_date, emp_alias } = row;
    await db.execute({ sql: "UPDATE leave_cancel_requests SET status = 'REJECTED' WHERE id = ?", args: [Number(req.params.id)] });
    const fmtD = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    await pushToAlias(emp_alias, { title: 'Leave Cancellation Rejected', body: `Your request to cancel leave on ${fmtD(leave_date)} was not approved.`, url: '/', tag: `lcr-rejected-${leave_id}` }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/leave-reassignments — full log of every stock slot reassignSlotsForLeave()
// has touched (OWNER only), most recent first. Powers the standalone "Stock
// Reassignments" viewer — this is the general audit view, not scoped to one leave.
app.get('/api/leave-reassignments', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  try {
    const r = await db.execute('SELECT * FROM leave_reassignments ORDER BY created_at DESC, id DESC LIMIT 200');
    res.json(r.rows.map(row => ({
      ...row,
      label: STOCK_CATEGORIES.find(c => c.id === row.stock_id)?.label || row.stock_id,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leave-reassignments/restore  body:{ ids:[...] }  — OWNER only.
// Puts the original employee back on each named slot (from the leave_reassignments
// log), swapping out whoever currently holds it. Used both from the standalone
// viewer and the "reassign back" prompt shown after approving a cancellation.
app.post('/api/leave-reassignments/restore', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids array required' });
  const restored = [];
  const failed = [];
  try {
    for (const id of ids) {
      const row = (await db.execute({ sql: 'SELECT * FROM leave_reassignments WHERE id = ? AND restored = 0', args: [id] })).rows[0];
      if (!row) { failed.push({ id, error: 'Already restored or not found' }); continue; }
      const { leave_date, emp_alias, stock_id, to_alias } = row;
      const meta = STOCK_META[stock_id];
      if (!meta) { failed.push({ id, error: 'Unknown stock' }); continue; }

      // Same time-conflict guard as the manual "Change Specific Tasks" editor —
      // don't put the original back if they've since picked up a conflicting slot.
      const otherRes = await db.execute({
        sql: 'SELECT stock_id, emp_alias FROM assignment WHERE date = ? AND stock_id != ? AND emp_alias = ?',
        args: [leave_date, stock_id, emp_alias],
      });
      const conflict = otherRes.rows.find(r => {
        const m = STOCK_META[r.stock_id];
        return m && meta.timing.some(t => t !== 'any' && m.timing.includes(t));
      });
      if (conflict) {
        const label = STOCK_CATEGORIES.find(c => c.id === conflict.stock_id)?.label || conflict.stock_id;
        failed.push({ id, error: `${emp_alias} is now booked into ${label} at a conflicting time` });
        continue;
      }

      const currentRes = await db.execute({ sql: 'SELECT emp_alias FROM assignment WHERE date = ? AND stock_id = ?', args: [leave_date, stock_id] });
      const stillHolding = to_alias && currentRes.rows.some(r => r.emp_alias === to_alias);
      if (stillHolding) {
        await db.execute({ sql: 'DELETE FROM assignment WHERE date = ? AND stock_id = ? AND emp_alias = ?', args: [leave_date, stock_id, to_alias] });
      }
      await db.execute({
        sql:  "INSERT OR IGNORE INTO assignment (date, stock_id, emp_alias, source, entry_by) VALUES (?, ?, ?, 'AUTO-ASSIGN', 'OWNER-RESTORE')",
        args: [leave_date, stock_id, emp_alias],
      });
      await db.execute({ sql: 'UPDATE leave_reassignments SET restored = 1 WHERE id = ?', args: [id] });
      restored.push(id);
    }
    res.json({ ok: true, restored, failed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Change own PIN (authenticated) ───────────────────────────────────────────
app.put('/api/me/pin', async (req, res) => {
  if (req.session.userId === 'admin') return res.status(400).json({ error: 'Use config to change admin password' });
  const { current_pin, invite_code, new_pin } = req.body;
  if (!new_pin) return res.status(400).json({ error: 'new_pin required' });
  if (!current_pin && !invite_code) return res.status(400).json({ error: 'Provide current PIN or invite code' });
  if (!/^\d{4,6}$/.test(String(new_pin))) return res.status(400).json({ error: 'PIN must be 4–6 digits' });
  try {
    const r = await db.execute({ sql: 'SELECT pin_hash, invite_code FROM employees WHERE id = ?', args: [Number(req.session.userId)] });
    if (!r.rows.length) return res.status(404).json({ error: 'Employee not found' });
    const emp = r.rows[0];

    if (invite_code) {
      if (!emp.invite_code || emp.invite_code !== String(invite_code).trim())
        return res.status(401).json({ error: 'Invite code is incorrect or expired' });
    } else {
      if (!emp.pin_hash || !(await bcrypt.compare(String(current_pin), emp.pin_hash)))
        return res.status(401).json({ error: 'Current PIN is incorrect' });
    }

    await db.execute({
      sql:  'UPDATE employees SET pin_hash = ?, pin_plain = ?, invite_code = NULL WHERE id = ?',
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
// Disabled employees are treated as permanently on leave everywhere except the
// Employees page itself — callers must pass ?all=1 to see them (used only by
// employees.html, which is where the owner re-enables/manages them).
app.get('/api/employees', async (req, res) => {
  try {
    const includeInactive = req.query.all === '1';
    const sql = `SELECT id, name, alias_name, gender, designation, last_login, COALESCE(is_active,1) AS is_active, COALESCE(city_category,'IN_CITY') AS city_category FROM employees` +
      (includeInactive ? '' : ` WHERE COALESCE(is_active,1) = 1`) +
      ` ORDER BY COALESCE(alias_name, name) ASC`;
    const r = await db.execute(sql);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/employees — add a new employee (OWNER only)
app.post('/api/employees', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { id, name, alias_name, gender, designation, city_category } = req.body;
  const empId = Number(id);
  if (!Number.isInteger(empId) || empId < 1) return res.status(400).json({ error: 'A valid Employee ID is required' });
  if (!name?.trim()) return res.status(400).json({ error: 'Full name is required' });
  const genderVal = (gender || '').toUpperCase();
  if (!['MALE', 'FEMALE'].includes(genderVal)) return res.status(400).json({ error: 'Gender must be MALE or FEMALE' });
  const cityVal = (city_category || 'IN_CITY').toUpperCase();
  if (!['IN_CITY', 'OUT_OF_CITY'].includes(cityVal)) return res.status(400).json({ error: 'City category must be IN_CITY or OUT_OF_CITY' });
  const inviteCode = generateInviteCode();
  try {
    await db.execute({
      sql:  'INSERT INTO employees (id, name, alias_name, gender, designation, invite_code, city_category) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [empId, name.trim(), alias_name?.trim() || null, genderVal, designation?.trim() || null, inviteCode, cityVal],
    });
    res.json({
      id: empId,
      name: name.trim(),
      alias_name: alias_name?.trim() || null,
      gender: genderVal,
      designation: designation?.trim() || null,
      city_category: cityVal,
      invite_code: inviteCode,
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.message?.includes('SQLITE_CONSTRAINT')) {
      return res.status(400).json({ error: `Employee ID ${empId} is already in use. Please choose a different ID.` });
    }
    res.status(500).json({ error: err.message });
  }
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
    await killEmployeeSessions(empId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Toggle employee active / temporarily disabled (OWNER only) ───────────────
// Disabled employees can't log in and are excluded from auto-assign / availability checks.
app.post('/api/employees/:id/toggle-active', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId) || empId <= 0) return res.status(400).json({ error: 'Invalid ID' });
  if (String(req.session.userId) === String(empId)) return res.status(400).json({ error: 'Cannot disable yourself' });
  try {
    const r = await db.execute({ sql: 'SELECT COALESCE(alias_name, name) AS alias, COALESCE(is_active,1) AS is_active FROM employees WHERE id = ?', args: [empId] });
    if (!r.rows.length) return res.status(404).json({ error: 'Employee not found' });
    const alias = r.rows[0].alias;
    const nowActive = !r.rows[0].is_active; // currently inactive → toggle to active
    await db.execute({ sql: 'UPDATE employees SET is_active = ? WHERE id = ?', args: [nowActive ? 1 : 0, empId] });

    let reassigned = [];
    if (!nowActive) {
      await killEmployeeSessions(empId); // just disabled → kick any live session now
      // Clear out any already-saved assignment slots for today/upcoming dates —
      // otherwise a disabled employee keeps showing up on the assignments
      // page since disabling only flips the flag, it doesn't touch rows
      // already saved before they were disabled.
      const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const datesRes = await db.execute({
        sql:  'SELECT DISTINCT date FROM assignment WHERE emp_alias = ? AND date >= ? ORDER BY date',
        args: [alias, todayIST],
      });
      for (const row of datesRes.rows) {
        // notify=false — this is a disable, not a leave booking, so the
        // "booked leave" push wording wouldn't be accurate here. reason=
        // 'DISABLED' keeps this out of the leave-cancellation restore flow
        // (there's no leave to cancel here) and labels it correctly in the
        // reassignments log.
        const forThisDate = await reassignSlotsForLeave(row.date, alias, 'FULL', false, 'DISABLED');
        reassigned.push(...forThisDate.map(x => ({ ...x, date: row.date })));
      }
    }
    res.json({ ok: true, id: empId, is_active: nowActive, reassigned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Set employee's city category (OWNER only) ─────────────────────────────────
app.post('/api/employees/:id/city-category', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const empId = Number(req.params.id);
  if (!Number.isInteger(empId) || empId <= 0) return res.status(400).json({ error: 'Invalid ID' });
  const cityVal = (req.body.city_category || '').toUpperCase();
  if (!['IN_CITY', 'OUT_OF_CITY'].includes(cityVal)) return res.status(400).json({ error: 'City category must be IN_CITY or OUT_OF_CITY' });
  try {
    const r = await db.execute({ sql: 'UPDATE employees SET city_category = ? WHERE id = ?', args: [cityVal, empId] });
    if (!r.rowsAffected) return res.status(404).json({ error: 'Employee not found' });
    res.json({ ok: true, id: empId, city_category: cityVal });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Stocks API ────────────────────────────────────────────────────────────────
app.get('/api/stock-categories', (_req, res) => {
  res.json(STOCK_CATEGORIES.map(c => ({
    ...c,
    slots:     ENTRY_COUNTS[c.id] || 1,
    timing:    STOCK_META[c.id]?.timing  || ['any'],
    group:     STOCK_META[c.id]?.group   || null,
    gents:     GENTS_STOCKS.has(c.id),
    days:      STOCK_META[c.id]?.days    || null,
    skip:      STOCK_META[c.id]?.skip    || false,
    is_active: !INACTIVE_STOCKS.has(c.id),
    conflicts: STOCK_CONFLICTS[c.id] ? [...STOCK_CONFLICTS[c.id]] : [],
  })));
});

// ─── Toggle stock active / inactive (OWNER only) ───────────────────────────────
app.post('/api/stock/:id/toggle-active', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { id } = req.params;
  if (!VALID_IDS.has(id)) return res.status(404).json({ error: 'Unknown stock' });
  const nowActive = INACTIVE_STOCKS.has(id); // currently inactive → toggle to active
  try {
    await db.execute({
      sql:  'INSERT OR REPLACE INTO stock_status (stock_id, is_active) VALUES (?, ?)',
      args: [id, nowActive ? 1 : 0],
    });
    if (nowActive) INACTIVE_STOCKS.delete(id); else INACTIVE_STOCKS.add(id);
    res.json({ ok: true, id, is_active: nowActive });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Create a new custom stock (OWNER only) ────────────────────────────────────
app.post('/api/custom-stock', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { label, slots, timing, gents, days } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'Stock name required' });
  const daysVal = Array.isArray(days) && days.length ? days.map(Number).filter(n => n >= 0 && n <= 6).join(',') : null;

  const id = label.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!id) return res.status(400).json({ error: 'Invalid stock name' });
  if (VALID_IDS.has(id)) return res.status(409).json({ error: 'A stock with this name already exists' });

  const timingVal = timing || 'any';
  const slotsNum  = Math.max(1, Math.min(20, parseInt(slots) || 1));
  const gentsFlag = gents ? 1 : 0;

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS stock_${id} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL, stock TEXT, name TEXT, entry_by TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);
    await db.execute({
      sql:  'INSERT INTO custom_stocks (id, label, timing, slots, gents, days) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, label.trim().toUpperCase(), timingVal, slotsNum, gentsFlag, daysVal],
    });

    // Register in memory so the server hot-adds it without restart
    const timingArr = timingVal === 'any' ? ['any'] : [timingVal];
    STOCK_CATEGORIES.push({ id, label: label.trim().toUpperCase(), custom: true });
    VALID_IDS.add(id);
    STOCK_META[id]    = { timing: timingArr, group: null, days: daysVal ? daysVal.split(',').map(Number) : null, skip: false };
    ENTRY_COUNTS[id]  = slotsNum;
    if (gentsFlag) GENTS_STOCKS.add(id);

    // Assign only the explicitly selected employees
    const empList = Array.isArray(req.body.employees) ? req.body.employees.filter(Boolean) : [];
    for (const alias of empList) {
      await db.execute({
        sql:  'INSERT OR IGNORE INTO stock_assignments (stock_id, emp_alias) VALUES (?, ?)',
        args: [id, String(alias).trim()],
      });
    }

    console.log(`✅ Custom stock created: ${id} (${label.trim().toUpperCase()}, ${slotsNum} slots, ${empList.length} employees)`);
    res.json({ ok: true, id, label: label.trim().toUpperCase() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Stock conflicts ───────────────────────────────────────────────────────────
// GET /api/stock-conflicts — full map { stock_id: [conflicting_ids] }
app.get('/api/stock-conflicts', (_req, res) => {
  const out = {};
  Object.entries(STOCK_CONFLICTS).forEach(([k, v]) => { out[k] = [...v]; });
  res.json(out);
});

// POST /api/stock/:id/conflicts — replace conflict list for a stock (OWNER only)
// body: { conflicts: ['other_stock_id', ...] }
app.post('/api/stock/:id/conflicts', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { id } = req.params;
  if (!VALID_IDS.has(id)) return res.status(404).json({ error: 'Unknown stock' });
  const conflicts = (req.body.conflicts || []).filter(c => VALID_IDS.has(c) && c !== id);
  try {
    // Remove all existing pairs for this stock (both directions)
    await db.execute({ sql: 'DELETE FROM stock_conflicts WHERE stock_a = ? OR stock_b = ?', args: [id, id] });
    // Insert new pairs bidirectionally
    for (const other of conflicts) {
      await db.execute({ sql: 'INSERT OR IGNORE INTO stock_conflicts (stock_a, stock_b) VALUES (?, ?)', args: [id, other] });
      await db.execute({ sql: 'INSERT OR IGNORE INTO stock_conflicts (stock_a, stock_b) VALUES (?, ?)', args: [other, id] });
    }
    await loadStockConflicts();
    res.json({ ok: true, id, conflicts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Edit a custom stock (OWNER only) ─────────────────────────────────────────
app.patch('/api/custom-stock/:id', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { id } = req.params;
  if (!VALID_IDS.has(id)) return res.status(404).json({ error: 'Unknown stock' });

  const { label, timing, slots, gents, days } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: 'Stock name required' });

  const timingVal = timing || 'any';
  const slotsNum  = Math.max(1, Math.min(20, parseInt(slots) || 1));
  const gentsFlag = gents ? 1 : 0;
  const daysVal   = Array.isArray(days) && days.length ? days.map(Number).filter(n => n >= 0 && n <= 6).join(',') : null;
  const newLabel  = label.trim().toUpperCase();

  try {
    // Upsert — works for both built-in and custom stocks
    await db.execute({
      sql:  'INSERT INTO custom_stocks (id, label, timing, slots, gents, days) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label=excluded.label, timing=excluded.timing, slots=excluded.slots, gents=excluded.gents, days=excluded.days',
      args: [id, newLabel, timingVal, slotsNum, gentsFlag, daysVal],
    });
    // Update in-memory
    const cat = STOCK_CATEGORIES.find(c => c.id === id);
    if (cat) cat.label = newLabel;
    STOCK_META[id].timing = timingVal === 'any' ? ['any'] : [timingVal];
    STOCK_META[id].days   = daysVal ? daysVal.split(',').map(Number) : null;
    ENTRY_COUNTS[id]      = slotsNum;
    if (gentsFlag) GENTS_STOCKS.add(id); else GENTS_STOCKS.delete(id);
    res.json({ ok: true, id, label: newLabel });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Delete a custom stock (OWNER only) ────────────────────────────────────────
app.delete('/api/custom-stock/:id', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { id } = req.params;
  const isCustom = (await db.execute({ sql: 'SELECT id FROM custom_stocks WHERE id = ?', args: [id] }).catch(() => ({ rows: [] }))).rows.length > 0;
  if (!isCustom) return res.status(400).json({ error: 'Only custom stocks can be deleted' });
  try {
    await db.execute({ sql: 'DELETE FROM custom_stocks WHERE id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM stock_assignments WHERE stock_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM assignment WHERE stock_id = ?', args: [id] });
    await db.execute({ sql: 'DELETE FROM stock_status WHERE stock_id = ?', args: [id] }).catch(() => {});
    await db.execute(`DROP TABLE IF EXISTS stock_${id}`).catch(() => {});
    const idx = STOCK_CATEGORIES.findIndex(c => c.id === id);
    if (idx !== -1) STOCK_CATEGORIES.splice(idx, 1);
    VALID_IDS.delete(id);
    delete STOCK_META[id];
    delete ENTRY_COUNTS[id];
    GENTS_STOCKS.delete(id);
    INACTIVE_STOCKS.delete(id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
// GET /api/check-availability?stock=STOCK_ID&date=YYYY-MM-DD
// Returns sorted availability list for a single stock on a given date (OWNER only).
// Checks: eligible pool, leave conflicts, time-slot conflicts, last-done rotation.
app.get('/api/check-availability', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { stock, date } = req.query;
  if (!stock || !date) return res.status(400).json({ error: 'stock and date required' });
  if (!VALID_IDS.has(stock)) return res.status(400).json({ error: 'Invalid stock' });
  const meta  = STOCK_META[stock];
  if (!meta) return res.status(400).json({ error: 'Invalid stock' });
  const label = STOCK_CATEGORIES.find(c => c.id === stock)?.label || stock;
  try {
    // 1. Eligible pool from stock_assignments
    const poolRes = await db.execute({
      sql:  'SELECT emp_alias FROM stock_assignments WHERE stock_id = ? ORDER BY emp_alias',
      args: [stock],
    });
    const aliases = poolRes.rows.map(r => r.emp_alias);

    // 2. Leave status for that date
    const leaveRes = await db.execute({
      sql:  "SELECT emp_alias, COALESCE(leave_type,'FULL') AS leave_type FROM leaves WHERE date = ?",
      args: [date],
    });
    const leaveMap = new Map();
    leaveRes.rows.forEach(r => leaveMap.set(r.emp_alias, r.leave_type));

    // 2b. Temporarily disabled employees — excluded from all pools
    const disabledRes = await db.execute("SELECT COALESCE(alias_name, name) AS alias FROM employees WHERE is_active = 0");
    const disabledSet = new Set(disabledRes.rows.map(r => r.alias));

    // 3. Who is already booked for THIS stock on the target date (assignment table)
    const selfAssignRes = await db.execute({
      sql:  'SELECT DISTINCT emp_alias FROM assignment WHERE stock_id = ? AND date = ?',
      args: [stock, date],
    });
    const alreadyBookedSet = new Set(selfAssignRes.rows.map(r => r.emp_alias));
    // Relative label for the booked date
    const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const tomorrowIST = (() => {
      const t = new Date(); t.setDate(t.getDate() + 1);
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(t);
    })();
    const bookedLabel = date === todayIST    ? 'already assigned today'
                      : date === tomorrowIST ? 'already assigned tomorrow'
                      : `already assigned on ${date}`;

    // 3b. Other-stock assignments for that date → occupied time slots (exclude this stock to avoid self-conflict label)
    const assignRes = await db.execute({
      sql:  'SELECT stock_id, emp_alias FROM assignment WHERE date = ? AND stock_id != ?',
      args: [date, stock],
    });
    const occupiedTimes = {}; // alias → Set<slot>
    const occupiedWith  = {}; // alias → string[]
    assignRes.rows.forEach(r => {
      const m   = STOCK_META[r.stock_id];
      const lbl = STOCK_CATEGORIES.find(c => c.id === r.stock_id)?.label || r.stock_id;
      if (!m) return;
      if (!occupiedTimes[r.emp_alias]) { occupiedTimes[r.emp_alias] = new Set(); occupiedWith[r.emp_alias] = []; }
      m.timing.forEach(t => { if (t !== 'any') occupiedTimes[r.emp_alias].add(t); });
      occupiedWith[r.emp_alias].push(lbl);
    });

    // 4. Last-done date per employee — for PAST dates (yesterday and earlier),
    // only actual submitted entries (stock_* tables) count as truth. The
    // `assignment` table only records what was planned, and a plan for a day
    // that's already over may not reflect who actually did the work (someone
    // else may have been entered instead) — so it must never be treated as
    // history for past dates. `assignment` remains the right source for
    // today/tomorrow/future checks (handled separately above).
    const prevDateStr = (() => {
      const p = new Date(new Date(date + 'T12:00:00').getTime() - 86400000);
      return p.getFullYear() + '-' + String(p.getMonth()+1).padStart(2,'0') + '-' + String(p.getDate()).padStart(2,'0');
    })();
    const [lastStockRes, pdStockRes] = await Promise.all([
      db.execute({ sql: `SELECT stock, MAX(date) AS last_date FROM stock_${stock} WHERE date < ? GROUP BY stock`, args: [date] }),
      db.execute({ sql: `SELECT DISTINCT stock FROM stock_${stock} WHERE date = ?`, args: [prevDateStr] }),
    ]);
    const lastDone = {};
    lastStockRes.rows.forEach(r => { if (r.stock) lastDone[r.stock] = r.last_date; });
    // Apply active Workload Directive nudges — same targeted, capped nudge
    // auto-assign uses (see applyWorkloadNudge), kept consistent so this
    // preview matches what auto-assign will actually do. Since this endpoint
    // only looks at one stock, figure out each biased alias's ranking across
    // ALL their eligible stocks first, so the nudge only shows up here if
    // this happens to be one of their closest-to-due stocks. Never touches
    // real history.
    const realTodayIST_ca = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const workloadBiasMap_ca = await getWorkloadBiasMap(realTodayIST_ca);
    if (Object.keys(workloadBiasMap_ca).length) {
      const lastByEmpMap_ca = { [stock]: lastDone };
      const eligibleByAlias_ca = {};
      for (const biasedAlias of Object.keys(workloadBiasMap_ca)) {
        const poolR = await db.execute({ sql: 'SELECT stock_id FROM stock_assignments WHERE emp_alias = ?', args: [biasedAlias] });
        const ids = poolR.rows.map(r => r.stock_id);
        eligibleByAlias_ca[biasedAlias] = ids;
        await Promise.all(ids.filter(sid => sid !== stock).map(async sid => {
          if (!lastByEmpMap_ca[sid]) lastByEmpMap_ca[sid] = {};
          try {
            const r = await db.execute({ sql: `SELECT MAX(date) AS last_date FROM stock_${sid} WHERE stock = ? AND date < ?`, args: [biasedAlias, date] });
            lastByEmpMap_ca[sid][biasedAlias] = r.rows[0]?.last_date || undefined;
          } catch (_) {}
        }));
      }
      applyWorkloadNudge(lastByEmpMap_ca, a => eligibleByAlias_ca[a] || [], workloadBiasMap_ca, date);
    }
    const prevDaySet = new Set();
    pdStockRes.rows.forEach(r => { if (r.stock) prevDaySet.add(r.stock); });
    // prevDateStr can be "today" (no entries submitted yet) — fall back to the
    // planned assignment for this stock so the exclusion still has a signal.
    if (!pdStockRes.rows.length) {
      const pdAssignRes = await db.execute({ sql: 'SELECT DISTINCT emp_alias FROM assignment WHERE stock_id = ? AND date = ?', args: [stock, prevDateStr] });
      pdAssignRes.rows.forEach(r => { if (r.emp_alias) prevDaySet.add(r.emp_alias); });
    }

    // 5. Categorise each alias
    const available = [], busy = [], on_leave = [], disabled = [];
    for (const alias of aliases) {
      const ld = lastDone[alias] || null;

      // Temporarily disabled — takes priority over every other status
      if (disabledSet.has(alias)) {
        disabled.push({ alias, last_done: ld });
        continue;
      }

      // Already assigned to this stock on the target date
      if (alreadyBookedSet.has(alias)) {
        busy.push({ alias, busy_with: [bookedLabel], last_done: ld });
        continue;
      }

      // Leave check
      const lt = leaveMap.get(alias);
      if (lt && stockConflictsWithLeave(meta, lt)) {
        on_leave.push({ alias, leave_type: lt, last_done: ld });
        continue;
      }

      // Time-slot conflict check (other stocks only — self-conflict already handled above)
      const empOcc    = occupiedTimes[alias] || new Set();
      const hasConflict = meta.timing.length > 0 &&
        meta.timing.some(t => t !== 'any' && empOcc.has(t));
      if (hasConflict) {
        busy.push({ alias, busy_with: occupiedWith[alias] || [], last_done: ld });
        continue;
      }

      // Assigned/did this same stock yesterday → move to busy
      if (prevDaySet.has(alias)) {
        busy.push({ alias, busy_with: ['assigned yesterday'], last_done: ld });
        continue;
      }

      available.push({ alias, last_done: ld });
    }

    // Sort available: oldest last-done first (never-done = highest priority)
    available.sort((a, b) => {
      if (!a.last_done && !b.last_done) return a.alias.localeCompare(b.alias);
      if (!a.last_done) return -1;
      if (!b.last_done) return  1;
      if (a.last_done !== b.last_done) return a.last_done < b.last_done ? -1 : 1;
      return a.alias.localeCompare(b.alias);
    });

    res.json({ stock: label, available, busy, on_leave, disabled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

    // City category per employee (alias) — used by SAME_CITY_STOCKS below
    const cityByAlias = {};
    const cityRes = await db.execute("SELECT COALESCE(alias_name, name) AS alias, COALESCE(city_category,'IN_CITY') AS city_category FROM employees");
    cityRes.rows.forEach(r => { cityByAlias[r.alias] = r.city_category; });

    // 2. Each eligible employee's personal last-done date per stock (before the target date).
    //    Uses only actual submitted entries (stock_* tables) as the source of truth for
    //    rotation priority. Planned assignments are only used for same-day conflict
    //    detection and yesterday's exclusion — not for advancing rotation history.
    const lastByEmp = {};
    STOCK_CATEGORIES.forEach(cat => { lastByEmp[cat.id] = {}; });
    await Promise.all(STOCK_CATEGORIES.map(async cat => {
      try {
        const r = await db.execute({
          sql:  `SELECT stock, MAX(date) AS last_date FROM stock_${cat.id} WHERE date < ? GROUP BY stock`,
          args: [date],
        });
        r.rows.forEach(row => { if (row.stock) lastByEmp[cat.id][row.stock] = row.last_date; });
      } catch (_) {}
    }));

    // Snapshot the REAL (unbiased) last-done dates before the workload nudge
    // below mutates lastByEmp for sorting — this is what gets shown to the
    // owner as a "last done" hint in the dropdown, so a workload nudge never
    // leaks a fake shifted date into the UI.
    const realLastDone = {};
    STOCK_CATEGORIES.forEach(cat => { realLastDone[cat.id] = { ...lastByEmp[cat.id] }; });

    // 2b. Apply any active Workload Directive nudges — shifts the effective
    // last-done date used for sorting only, and only for a capped number of
    // this person's already-closest-to-due stocks (see applyWorkloadNudge),
    // so an "increase" reads as a little more work quietly, not everything
    // at once. Never touches real history, and never overrides
    // leave/conflict/day-restriction hard rules.
    const realTodayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const workloadBiasMap = await getWorkloadBiasMap(realTodayIST);
    const pinnedMap = await getPinnedMap(realTodayIST);
    const appliedNudges = applyWorkloadNudge(
      lastByEmp,
      alias => STOCK_CATEGORIES.filter(cat => (byStock[cat.id] || []).includes(alias)).map(cat => cat.id),
      workloadBiasMap,
      date
    );
    const nudgedMap = {}; // sid -> { alias -> 'increase'|'decrease' }
    appliedNudges.forEach(({ sid, alias, direction }) => {
      if (!nudgedMap[sid]) nudgedMap[sid] = {};
      nudgedMap[sid][alias] = direction;
    });

    // 3. Fetch employees on leave for this date (with leave_type for half-day support)
    //    onLeaveMap: alias → leave_type ('FULL'|'HALF_AM'|'HALF_PM')
    let onLeaveMap = new Map();
    try {
      const lr = await db.execute({
        sql:  "SELECT emp_alias, COALESCE(leave_type,'FULL') AS leave_type FROM leaves WHERE date = ?",
        args: [date],
      });
      lr.rows.forEach(r => onLeaveMap.set(r.emp_alias, r.leave_type));

      // Temporarily disabled employees are excluded exactly like a full-day leave
      const disabledRes = await db.execute("SELECT COALESCE(alias_name, name) AS alias FROM employees WHERE is_active = 0");
      disabledRes.rows.forEach(r => onLeaveMap.set(r.alias, 'FULL'));

      if (onLeaveMap.size > 0) {
        const display = [...onLeaveMap.entries()].map(([a,t]) => t === 'FULL' ? a : `${a}(${t})`).join(', ');
        console.log(`🏖️  On leave for ${date}:`, display);
      }
    } catch (_) {}

    // 3b. Fetch previous day's leave AND assignments
    //     - prev-day leave: used to exclude employees from morning_cleaning
    //       (if they were absent in the PM yesterday, they can't do early morning today)
    //     - prev-day assignments: same-stock consecutive-day exclusion
    const prevDateStr = (() => {
      const p = new Date(d.getTime() - 86400000);
      return p.getFullYear() + '-' +
        String(p.getMonth() + 1).padStart(2, '0') + '-' +
        String(p.getDate()).padStart(2, '0');
    })();
    // Employees absent in PM yesterday → can't open shop / do morning_cleaning today
    let absentPmPrevDay = new Set();
    try {
      const lr2 = await db.execute({
        sql:  "SELECT emp_alias, COALESCE(leave_type,'FULL') AS leave_type FROM leaves WHERE date = ?",
        args: [prevDateStr],
      });
      lr2.rows.forEach(r => {
        // FULL or HALF_PM → absent in the evening yesterday → exclude from morning today
        if (r.leave_type === 'FULL' || r.leave_type === 'HALF_PM') absentPmPrevDay.add(r.emp_alias);
      });
    } catch (_) {}

    // Yesterday's "did this stock" set: actual submitted entries (stock_*
    // tables) are the source of truth whenever they exist — a plan in
    // `assignment` that a different person's entry has since overridden must
    // never count. But prevDateStr can be "today" relative to the date being
    // generated (e.g. generating tomorrow's schedule before today's entries
    // are all submitted), so for any stock with NO entry recorded yet for
    // that date, fall back to the `assignment` plan as the best available
    // signal instead of treating it as if nobody's doing it at all.
    const prevDay = {}; // { stock_id: Set<alias> }
    const prevDayHasEntry = new Set(); // stock_ids that have at least one real entry for prevDateStr
    // stock_* tables — actual submitted entries for previous day
    // Query each table individually so one missing/broken table never kills the rest
    await Promise.all(STOCK_CATEGORIES.map(async cat => {
      try {
        const r = await db.execute({
          sql:  `SELECT stock FROM stock_${cat.id} WHERE date = ?`,
          args: [prevDateStr],
        });
        if (r.rows.length) prevDayHasEntry.add(cat.id);
        r.rows.forEach(row => {
          if (!row.stock) return;
          if (!prevDay[cat.id]) prevDay[cat.id] = new Set();
          prevDay[cat.id].add(row.stock);
        });
      } catch (_) {}
    }));
    // Fallback: stocks with no entry recorded yet for prevDateStr use the
    // planned assignment instead, so a not-yet-entered "today" still excludes
    // its planned doer from tomorrow's same stock.
    try {
      const ar = await db.execute({ sql: 'SELECT stock_id, emp_alias FROM assignment WHERE date = ?', args: [prevDateStr] });
      ar.rows.forEach(r => {
        if (prevDayHasEntry.has(r.stock_id)) return; // real entry already recorded — trust that instead
        if (!prevDay[r.stock_id]) prevDay[r.stock_id] = new Set();
        prevDay[r.stock_id].add(r.emp_alias);
      });
    } catch (_) {}

    // DEBUG — log morning_cleaning prevDay so we can see if it's populated
    console.log(`[AUTO-ASSIGN] date=${date} prevDate=${prevDateStr}`);
    console.log(`[AUTO-ASSIGN] prevDay morning_cleaning:`, prevDay['morning_cleaning'] ? [...prevDay['morning_cleaning']] : 'EMPTY');
    console.log(`[AUTO-ASSIGN] byStock morning_cleaning:`, byStock['morning_cleaning'] || []);

    // 3c. Rows that already exist in `assignment` for the TARGET date itself —
    // e.g. added manually via SQL Editor, or left over from a previous partial
    // save. These are treated as already-decided facts: the algorithm must not
    // ignore them, double-book that person into a time-conflicting stock, or
    // move them during the load-balance pass.
    const existingToday = {}; // stock_id → emp_alias[]
    try {
      const er = await db.execute({
        sql:  'SELECT stock_id, emp_alias FROM assignment WHERE date = ?',
        args: [date],
      });
      er.rows.forEach(r => {
        if (!existingToday[r.stock_id]) existingToday[r.stock_id] = [];
        existingToday[r.stock_id].push(r.emp_alias);
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
    const reasons       = {}; // sid → { alias → human-readable reason this person was picked }
    const setReason = (sid, alias, text) => { if (!reasons[sid]) reasons[sid] = {}; reasons[sid][alias] = text; };

    // Pre-commit existingToday's time/group slots up front (before any stock is
    // processed) so a manual entry for a stock processed LATER in orderedCats
    // still blocks that person from being picked into a conflicting stock
    // processed EARLIER. dailyCount is intentionally left untouched here — it
    // gets incremented once, naturally, when each stock's own commit step below
    // iterates its (now-seeded) `picked` list.
    Object.entries(existingToday).forEach(([sid, aliasesForStock]) => {
      const m = STOCK_META[sid];
      if (!m) return;
      aliasesForStock.forEach(alias => {
        if (!usedTimes[alias])  usedTimes[alias]  = new Set();
        if (!usedGroups[alias]) usedGroups[alias] = new Set();
        m.timing.forEach(t => { if (t !== 'any') usedTimes[alias].add(t); });
        if (m.group) usedGroups[alias].add(m.group);
      });
    });

    // Process morning_cleaning first so its 3 assignees have higher daily counts
    // before the rest of the stocks are distributed — prevents them from accumulating more.
    const orderedCats = [
      ...STOCK_CATEGORIES.filter(c => c.id === 'morning_cleaning' && !INACTIVE_STOCKS.has(c.id)),
      ...STOCK_CATEGORIES.filter(c => c.id !== 'morning_cleaning' && !INACTIVE_STOCKS.has(c.id)),
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

      // Base: exclude employees whose leave conflicts with this stock's timing
      let allEligible = (byStock[sid] || []).filter(a => {
        const lt = onLeaveMap.get(a);
        if (!lt) return true;                          // not on leave
        return !stockConflictsWithLeave(meta, lt);     // only exclude if timing overlaps absent half
      });

      // Morning cleaning / shop_opening: also exclude employees absent in PM yesterday
      // (they weren't there for closing, so they can't do early-morning tasks today)
      if (sid === 'morning_cleaning' || sid === 'shop_opening') {
        const withoutPrevAbsent = allEligible.filter(a => !absentPmPrevDay.has(a));
        if (withoutPrevAbsent.length >= count) allEligible = withoutPrevAbsent;
      }

      const yesterdaySet = prevDay[sid] || new Set();
      // Hard-exclude anyone who did this stock yesterday.
      // Only fall back to the full pool if no one else exists at all.
      const withoutYesterday = allEligible.filter(a => !yesterdaySet.has(a));
      let eligible = withoutYesterday.length > 0 ? withoutYesterday : allEligible;

      // Conflict check: exclude employees already assigned to a conflicting stock today
      const conflictIds = STOCK_CONFLICTS[sid];
      if (conflictIds?.size) {
        const conflictBusy = new Set();
        for (const cid of conflictIds) (assignments[cid] || []).forEach(a => conflictBusy.add(a));
        const withoutConflict = eligible.filter(a => !conflictBusy.has(a));
        if (withoutConflict.length >= count) eligible = withoutConflict;
      }
      const empDates = lastByEmp[sid] || {};

      // Sort by two keys:
      //   1. Last-done date (PRIMARY) — whoever did this stock longest ago wins.
      //   2. Daily load (TIEBREAK) — fewer stocks today wins when dates tie.
      const sorted = [...eligible].sort((a, b) => {
        const da = empDates[a];
        const db = empDates[b];
        const ca = dailyCount[a] || 0;
        const cb = dailyCount[b] || 0;

        // 1. Primary: never done → highest priority
        if (!da && db)  return -1;
        if (da  && !db) return  1;

        // 2. Both never done → tiebreak by daily count
        if (!da && !db) {
          if (ca !== cb) return ca - cb;
          return a.localeCompare(b);
        }

        // 3. Both have dates: older date first
        if (da !== db) return da < db ? -1 : 1;

        // 4. Same date: tiebreak by daily count
        if (ca !== cb) return ca - cb;
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

      // Rows that already exist for this stock+date (manually entered via SQL
      // Editor, or a previous partial save) are authoritative — keep them and
      // only fill whatever slots remain. Exception: a full-day leave or a
      // disabled employee (onLeaveMap 'FULL') is a hard unavailability that
      // didn't necessarily exist when that row was saved — e.g. the person
      // got disabled afterward — so a stale pick like that must not survive
      // into a regenerate.
      (existingToday[sid] || []).forEach(alias => {
        if (picked.length >= count || pickedSet.has(alias)) return;
        if (onLeaveMap.get(alias) === 'FULL') return;
        picked.push(alias);
        pickedSet.add(alias);
        setReason(sid, alias, 'Already saved for this date');
      });

      // Forced day-of-week: place the named employee first if eligible and not on leave
      const forcedAlias = RULES_ENABLED.forced_sunday_opener !== false ? (FORCED_DOW[sid] || {})[dow] : null;
      if (forcedAlias && eligible.includes(forcedAlias) && picked.length < count && !pickedSet.has(forcedAlias)) {
        picked.push(forcedAlias);
        pickedSet.add(forcedAlias);
        setReason(sid, forcedAlias, `Always does this on ${DAY_NAMES[dow]}`);
      }

      // Pin directives: force in whoever's pinned to this stock via the
      // Workload Directive box — same hard rules still apply (eligible pool,
      // leave, time conflict, same-city-only stocks), it just skips rotation.
      for (const alias of (pinnedMap[sid] || [])) {
        if (picked.length >= count || pickedSet.has(alias)) continue;
        if (!eligible.includes(alias)) continue;
        const empT = usedTimes[alias] || new Set();
        if (meta.timing.some(t => t !== 'any' && empT.has(t))) continue;
        if (sameCityRuleActive(sid) && picked.length > 0) {
          const anchorCity = cityByAlias[picked[0]] || 'IN_CITY';
          if ((cityByAlias[alias] || 'IN_CITY') !== anchorCity) continue;
        }
        picked.push(alias);
        pickedSet.add(alias);
        setReason(sid, alias, 'Pinned by workload directive');
      }
      for (const respectGroup of [true, false]) {
        if (picked.length >= count) break;
        for (const alias of sorted) {
          if (picked.length >= count) break;
          if (pickedSet.has(alias)) continue;           // already picked for this stock
          // Hard constraint: time conflict
          const empT = usedTimes[alias]  || new Set();
          if (meta.timing.some(t => t !== 'any' && empT.has(t))) continue;
          // Hard constraint: same-city-only stocks — every slot must match the
          // city category of whoever is already picked (never a mix)
          if (sameCityRuleActive(sid) && picked.length > 0) {
            const anchorCity = cityByAlias[picked[0]] || 'IN_CITY';
            if ((cityByAlias[alias] || 'IN_CITY') !== anchorCity) continue;
          }
          // Soft constraint: group letter
          if (respectGroup && meta.group) {
            const empG = usedGroups[alias] || new Set();
            if (empG.has(meta.group)) continue;
          }
          picked.push(alias);
          pickedSet.add(alias);
          if (nudgedMap[sid]?.[alias] === 'increase') {
            // A "decrease" nudge pushes them later, not earlier — it never
            // explains a pick, so only "increase" is worth surfacing here.
            setReason(sid, alias, 'Workload directive: bumped up here');
          } else if (!empDates[alias]) {
            setReason(sid, alias, 'Never done this stock before');
          } else {
            setReason(sid, alias, `Longest since last done (${empDates[alias]})`);
          }
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

    // ── Phase 2: Load-Balance Pass ──────────────────────────────────────────────
    // After the initial assignment, if any employee has significantly more stocks
    // than the daily average, redistribute their excess to the next eligible person
    // who has done that stock least recently (or never) and has fewer tasks today.
    {
      const activeCount  = Object.keys(dailyCount).length;
      const totalCount   = Object.values(dailyCount).reduce((s, n) => s + n, 0);
      const avgLoad      = activeCount > 0 ? totalCount / activeCount : 0;
      // Threshold: allow at most ceil(avg)+1 stocks per person (e.g. avg=1.6 → max=3)
      const maxAllowed   = Math.max(2, Math.ceil(avgLoad) + 1);

      // Rebuild actual time-slot usage from the current live assignments array
      const getUsedTimes = () => {
        const times = {};
        for (const [sid, picked] of Object.entries(assignments)) {
          if (!picked || !picked.length) continue;
          const m = STOCK_META[sid];
          if (!m) continue;
          for (const a of picked) {
            if (!times[a]) times[a] = new Set();
            m.timing.forEach(t => { if (t !== 'any') times[a].add(t); });
          }
        }
        return times;
      };

      for (let iter = 0; iter < 5; iter++) {
        // Find employees over the allowed threshold, most-loaded first
        const overloaded = Object.entries(dailyCount)
          .filter(([, n]) => n > maxAllowed)
          .sort(([, a], [, b]) => b - a);
        if (!overloaded.length) break;

        let anyMoved = false;
        const curTimes = getUsedTimes();

        for (const [alias] of overloaded) {
          if ((dailyCount[alias] || 0) <= maxAllowed) continue;

          // All stocks currently held by this employee
          const myStocks = Object.entries(assignments)
            .filter(([, picked]) => Array.isArray(picked) && picked.includes(alias))
            .map(([sid]) => sid);

          for (const sid of myStocks) {
            if ((dailyCount[alias] || 0) <= maxAllowed) break;

            // Never move a forced day-of-week assignment
            const forcedToday = RULES_ENABLED.forced_sunday_opener !== false ? (FORCED_DOW[sid] || {})[dow] : null;
            if (forcedToday && alias === forcedToday) continue;

            // Never move a pre-existing assignment row (manually entered via
            // SQL Editor, or already saved) — it's a committed fact, not a pick.
            if ((existingToday[sid] || []).includes(alias)) continue;

            const m        = STOCK_META[sid];
            if (!m) continue;
            const empDates = lastByEmp[sid] || {};
            // On-leave/disabled must never be pulled in as a load-balance
            // replacement — byStock is the raw permission pool and doesn't
            // know about leave or disabled status on its own.
            const poolBase = (byStock[sid] || []).filter(a => {
              const lt = onLeaveMap.get(a);
              return !lt || !stockConflictsWithLeave(m, lt);
            });
            // Date priority is the hard rule, not "too many stocks" — never
            // swap in someone who did this exact stock yesterday just
            // because they're free today. Only fall back to allowing it if
            // literally everyone eligible did it yesterday (matches the
            // same fallback the initial pick uses).
            const yesterdaySet     = prevDay[sid] || new Set();
            const withoutYesterday = poolBase.filter(a => !yesterdaySet.has(a));
            const pool = withoutYesterday.length > 0 ? withoutYesterday : poolBase;

            // Find the best replacement: eligible, no time clash, strictly fewer tasks today
            const replacement = pool
              .filter(a => {
                if (a === alias) return false;
                // Already occupying another slot of this same stock
                if ((assignments[sid] || []).includes(a)) return false;
                // Hard time conflict
                const empT = curTimes[a] || new Set();
                if (m.timing.some(t => t !== 'any' && empT.has(t))) return false;
                // Hard constraint: same-city-only stocks — replacement must match
                // the city category of whoever else remains on this stock
                if (sameCityRuleActive(sid)) {
                  const others = (assignments[sid] || []).filter(x => x !== alias);
                  if (others.length) {
                    const anchorCity = cityByAlias[others[0]] || 'IN_CITY';
                    if ((cityByAlias[a] || 'IN_CITY') !== anchorCity) return false;
                  }
                }
                // Only replace with someone who has fewer tasks than the overloaded person
                return (dailyCount[a] || 0) < (dailyCount[alias] || 0);
              })
              .sort((a, b) => {
                const da = empDates[a], db = empDates[b];
                const ca = dailyCount[a] || 0, cb = dailyCount[b] || 0;
                // 1. Never done → highest rotation priority
                if (!da && db)  return -1;
                if (da  && !db) return  1;
                // 2. Both never done → fewest tasks today wins
                if (!da && !db) return ca !== cb ? ca - cb : a.localeCompare(b);
                // 3. Older last-done date first
                if (da !== db) return da < db ? -1 : 1;
                // 4. Same date → fewest tasks today
                return ca !== cb ? ca - cb : a.localeCompare(b);
              })[0];

            if (!replacement) continue;

            // Perform the swap
            const idx = assignments[sid].indexOf(alias);
            if (idx === -1) continue;
            assignments[sid][idx] = replacement;
            if (reasons[sid]) delete reasons[sid][alias];
            setReason(sid, replacement, `Load-balanced in — ${alias} had too many stocks today`);

            // Update daily load counts
            dailyCount[alias]       = (dailyCount[alias]       || 0) - 1;
            dailyCount[replacement] = (dailyCount[replacement] || 0) + 1;

            // Add replacement's new time-slots to curTimes so later iterations
            // correctly detect conflicts (alias's freed slots stay — conservative)
            if (!curTimes[replacement]) curTimes[replacement] = new Set();
            m.timing.forEach(t => { if (t !== 'any') curTimes[replacement].add(t); });

            anyMoved = true;
          }
        }
        if (!anyMoved) break; // nothing moved this iteration — stop early
      }
    }
    // ── End Load-Balance Pass ───────────────────────────────────────────────────

    const leaveTypes = Object.fromEntries(onLeaveMap);
    res.json({ date, dayName: DAY_NAMES[dow], dayOfWeek: dow, assignments, skipped, priorityOrder,
               onLeave: [...onLeaveMap.keys()], leaveTypes, reasons, lastDone: realLastDone });
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

// PUT replace assignments for a specific stock+date (owner only)
app.put('/api/assignment/:date/:stock_id', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { date, stock_id } = req.params;
  const { aliases } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  if (!VALID_IDS.has(stock_id)) return res.status(400).json({ error: 'Invalid stock' });
  if (!Array.isArray(aliases)) return res.status(400).json({ error: 'aliases array required' });
  const meta = STOCK_META[stock_id];
  if (!meta) return res.status(400).json({ error: 'Invalid stock' });
  try {
    // This endpoint saves one stock at a time and has no visibility into what's
    // already saved for other stocks that date — without this check the same
    // person could be saved into two time-overlapping stocks (e.g. Chain Stock
    // + Drops Stock, both at 1700) with nothing to catch it.
    const otherRes = await db.execute({
      sql: 'SELECT stock_id, emp_alias FROM assignment WHERE date = ? AND stock_id != ?',
      args: [date, stock_id],
    });
    const occupiedTimes = {}; // alias -> Set<slot>
    const occupiedWith  = {}; // alias -> [stock label]
    otherRes.rows.forEach(r => {
      const m = STOCK_META[r.stock_id];
      if (!m) return;
      if (!occupiedTimes[r.emp_alias]) { occupiedTimes[r.emp_alias] = new Set(); occupiedWith[r.emp_alias] = []; }
      m.timing.forEach(t => { if (t !== 'any') occupiedTimes[r.emp_alias].add(t); });
      occupiedWith[r.emp_alias].push(STOCK_CATEGORIES.find(c => c.id === r.stock_id)?.label || r.stock_id);
    });

    for (const alias of aliases.filter(Boolean)) {
      const occ = occupiedTimes[alias];
      if (occ && meta.timing.some(t => t !== 'any' && occ.has(t))) {
        return res.status(409).json({
          error: `${alias} is already booked into a conflicting stock today (${occupiedWith[alias].join(', ')}) — pick someone else.`,
        });
      }
      if (STOCK_CONFLICTS[stock_id]?.size) {
        const conflictStock = otherRes.rows.find(r => r.emp_alias === alias && STOCK_CONFLICTS[stock_id].has(r.stock_id));
        if (conflictStock) {
          const label = STOCK_CATEGORIES.find(c => c.id === conflictStock.stock_id)?.label || conflictStock.stock_id;
          return res.status(409).json({
            error: `${alias} cannot be in both this stock and ${label} — they are set as conflicting stocks.`,
          });
        }
      }
    }

    // Same-city-only stocks — every slot must share one city category, never a mix
    if (sameCityRuleActive(stock_id)) {
      const cleanAliases = aliases.filter(Boolean);
      if (cleanAliases.length > 1) {
        const cityRows = await db.execute({
          sql: `SELECT COALESCE(alias_name, name) AS alias, COALESCE(city_category,'IN_CITY') AS city_category FROM employees WHERE COALESCE(alias_name, name) IN (${cleanAliases.map(() => '?').join(',')})`,
          args: cleanAliases,
        });
        const cityMap = {};
        cityRows.rows.forEach(r => { cityMap[r.alias] = r.city_category; });
        const cities = new Set(cleanAliases.map(a => cityMap[a] || 'IN_CITY'));
        if (cities.size > 1) {
          const label = STOCK_CATEGORIES.find(c => c.id === stock_id)?.label || stock_id;
          return res.status(409).json({
            error: `${label} cannot mix In City and Out of City staff — pick staff from the same city category.`,
          });
        }
      }
    }

    await db.execute({ sql: "DELETE FROM assignment WHERE date = ? AND stock_id = ?", args: [date, stock_id] });
    for (const alias of aliases.filter(Boolean)) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO assignment (date, stock_id, emp_alias, source) VALUES (?, ?, ?, 'AUTO-ASSIGN')",
        args: [date, stock_id, alias],
      });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin Entry feature — writes directly to the dedicated stock_<id> table
// (the real "who did this work" history), not the assignment/plan table, so
// the owner can backfill or correct actual entry history for any date.
//
// POST /api/entry-record/:date/:stock_id/add — Admin Entry's "add names" action.
// Pure append: inserts each new alias if not already recorded for that
// date+stock, never touches or deletes existing rows. Deliberately not a
// delete-then-reinsert of the whole set — that used to require the client to
// perfectly resubmit every existing name to avoid losing it, which broke
// whenever the pre-filled state didn't round-trip exactly. Removing a wrong
// entry is a separate, explicit action (DELETE below).
app.post('/api/entry-record/:date/:stock_id/add', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { date, stock_id } = req.params;
  const { aliases } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  if (!VALID_IDS.has(stock_id)) return res.status(400).json({ error: 'Invalid stock' });
  if (!Array.isArray(aliases)) return res.status(400).json({ error: 'aliases array required' });
  try {
    const enteredBy = req.session?.name || 'ADMIN';
    const existingRes = await db.execute({ sql: `SELECT stock FROM stock_${stock_id} WHERE date = ?`, args: [date] });
    const existing = new Set(existingRes.rows.map(r => r.stock));
    let added = 0;
    for (const alias of aliases.filter(Boolean)) {
      if (existing.has(alias)) continue; // already recorded — don't duplicate
      await db.execute({
        sql: `INSERT INTO stock_${stock_id} (date, stock, entry_by) VALUES (?, ?, ?)`,
        args: [date, alias, enteredBy],
      });
      existing.add(alias);
      added++;
    }
    res.json({ ok: true, added });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/entry-record/:date/:stock_id/:alias — remove one specific
// recorded name (correcting a mistaken entry), leaving every other name for
// that date+stock untouched.
app.delete('/api/entry-record/:date/:stock_id/:alias', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { date, stock_id, alias } = req.params;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
  if (!VALID_IDS.has(stock_id)) return res.status(400).json({ error: 'Invalid stock' });
  try {
    await db.execute({ sql: `DELETE FROM stock_${stock_id} WHERE date = ? AND stock = ?`, args: [date, alias] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// POST bulk submit  body: { date, entries: {stock_id: [alias, ...]}, notifyAliases?: string[] }
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

  // Conflict check — same person cannot be in two conflicting stocks on the same day
  const conflictErrors = [];
  const aliasStockMap = {}; // alias → [stockLabel, ...]
  for (const { catId, alias } of writes) {
    if (!aliasStockMap[alias]) aliasStockMap[alias] = [];
    aliasStockMap[alias].push(catId);
  }
  // Same-timing double-booking on the ENTRY page (manual "what actually
  // happened" record) is a soft warning, not a hard block — the owner may
  // know the same person genuinely covered both stocks that day. Only
  // AUTO-ASSIGN (planned scheduling) keeps this as a hard rule, since the
  // scheduling algorithm itself already avoids same-timing overlaps.
  const timingWarnings = [];
  for (const [alias, stockIds] of Object.entries(aliasStockMap)) {
    for (let i = 0; i < stockIds.length; i++) {
      for (let j = i + 1; j < stockIds.length; j++) {
        const a = stockIds[i], b = stockIds[j];
        const labelA = STOCK_CATEGORIES.find(c => c.id === a)?.label || a;
        const labelB = STOCK_CATEGORIES.find(c => c.id === b)?.label || b;
        if (STOCK_CONFLICTS[a]?.has(b)) {
          conflictErrors.push(`${alias} cannot be in both ${labelA} and ${labelB} — they are set as conflicting stocks.`);
          continue;
        }
        // Same-timing overlap. Catches cases like Chain Stock + Drops Stock
        // (both 1700) that aren't in the manually-curated STOCK_CONFLICTS table
        // but still happen at the same time.
        const metaA = STOCK_META[a], metaB = STOCK_META[b];
        if (metaA && metaB && metaA.timing.some(t => t !== 'any' && metaB.timing.includes(t))) {
          if (source === 'AUTO-ASSIGN') {
            conflictErrors.push(`${alias} cannot be in both ${labelA} and ${labelB} — they happen at the same time.`);
          } else {
            timingWarnings.push(`${alias} is assigned to both ${labelA} and ${labelB} — they happen at the same time.`);
          }
        }
      }
    }
  }
  // Conflicting-stock / same-time double-booking is a hard block by default,
  // but the owner can force it through (e.g. auto-assign.html's "Save
  // Anyway") the same way consecutive-day warnings already work.
  if (conflictErrors.length && !req.body.force) {
    return res.json({ error: false, conflictWarnings: conflictErrors });
  }

  // Same-city-only stocks — every slot must share one city category, never a mix.
  // On manual ENTRY saves, stocks in SAME_CITY_ENTRY_EXEMPT skip this check —
  // the rule only constrains AUTO-ASSIGN's own picks for those stocks.
  const cityErrors = [];
  const sameCityCatIds = [...new Set(writes.map(w => w.catId))].filter(catId => {
    if (!sameCityRuleActive(catId)) return false;
    if (source !== 'AUTO-ASSIGN' && SAME_CITY_ENTRY_EXEMPT.has(catId)) return false;
    return true;
  });
  if (sameCityCatIds.length) {
    const allAliases = [...new Set(writes.filter(w => sameCityCatIds.includes(w.catId)).map(w => w.alias))];
    const cityRows = await db.execute({
      sql: `SELECT COALESCE(alias_name, name) AS alias, COALESCE(city_category,'IN_CITY') AS city_category FROM employees WHERE COALESCE(alias_name, name) IN (${allAliases.map(() => '?').join(',')})`,
      args: allAliases,
    });
    const cityMap = {};
    cityRows.rows.forEach(r => { cityMap[r.alias] = r.city_category; });
    for (const catId of sameCityCatIds) {
      const catAliases = writes.filter(w => w.catId === catId).map(w => w.alias);
      const cities = new Set(catAliases.map(a => cityMap[a] || 'IN_CITY'));
      if (cities.size > 1) {
        const cat = STOCK_CATEGORIES.find(c => c.id === catId);
        cityErrors.push(`${cat ? cat.label : catId} cannot mix In City and Out of City staff — pick staff from the same city category.`);
      }
    }
  }
  if (cityErrors.length) return res.json({ error: true, messages: cityErrors });

  // Consecutive-day check — same person cannot be assigned the same stock two days in a row.
  // Actual submitted entries (stock_* tables) are the source of truth whenever
  // they exist for a stock — a plan in `assignment` that a different person's
  // entry has since overridden must never trigger this warning. But prevDate
  // can be "today" relative to the date being saved (e.g. saving tomorrow's
  // auto-assign before today's entries are all submitted), so for any stock
  // with no entry yet for prevDate, fall back to the planned assignment.
  // Client can pass force:true to override with a confirmed warning
  const consecutiveWarnings = req.body.force ? [] : [...timingWarnings];
  if (!req.body.force) {
    const prevDate = (() => {
      const d = new Date(date + 'T12:00:00');
      const p = new Date(d.getTime() - 86400000);
      return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
    })();
    const prevDayMap = {};
    const prevDayHasEntry = new Set();
    try {
      const batchPrev = await db.batch(
        STOCK_CATEGORIES.map(cat => ({ sql: `SELECT stock FROM stock_${cat.id} WHERE date = ?`, args: [prevDate] })),
        'read'
      );
      STOCK_CATEGORIES.forEach((cat, i) => {
        const rows = batchPrev[i]?.rows || [];
        if (rows.length) prevDayHasEntry.add(cat.id);
        rows.forEach(r => {
          if (!r.stock) return;
          if (!prevDayMap[cat.id]) prevDayMap[cat.id] = new Set();
          prevDayMap[cat.id].add(r.stock);
        });
      });
      const ar = await db.execute({ sql: 'SELECT stock_id, emp_alias FROM assignment WHERE date = ?', args: [prevDate] });
      ar.rows.forEach(r => {
        if (prevDayHasEntry.has(r.stock_id)) return; // real entry already recorded — trust that instead
        if (!prevDayMap[r.stock_id]) prevDayMap[r.stock_id] = new Set();
        prevDayMap[r.stock_id].add(r.emp_alias);
      });
    } catch (_) {}

    for (const { catId, alias } of writes) {
      if (prevDayMap[catId]?.has(alias)) {
        const cat = STOCK_CATEGORIES.find(c => c.id === catId);
        consecutiveWarnings.push(`${alias} was assigned to ${cat?.label || catId} yesterday.`);
      }
    }
  }

  if (consecutiveWarnings.length) return res.json({ error: false, consecutiveWarnings });

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

    // ── Push notifications — run after response is sent so errors never cause a
    //    double-response crash. Each send is individually awaited + caught so one
    //    failed subscription never blocks the rest.
    if (source === 'AUTO-ASSIGN' && (webpush || firebaseAdmin)) {
      setImmediate(async () => {
        try {
          const d     = new Date(date + 'T12:00:00');
          const label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

          // Fresh assign → notify everyone. Re-assign → only newly added employees.
          const notifySet = Array.isArray(req.body.notifyAliases) && req.body.notifyAliases.length
            ? new Set(req.body.notifyAliases)
            : null;

          // Group stocks by employee
          const byEmp = {};
          writes.forEach(({ catId, alias }) => {
            if (notifySet && !notifySet.has(alias)) return;
            const cat = STOCK_CATEGORIES.find(c => c.id === catId);
            if (!byEmp[alias]) byEmp[alias] = [];
            byEmp[alias].push(cat ? cat.label : catId);
          });

          const targets = Object.keys(byEmp);
          if (!targets.length) return;
          console.log(`[PUSH] Auto-assign ${date} — notifying ${targets.length} employees:`, targets);

          // 1. Web push (VAPID) — browsers / PWA
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
              try {
                await webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  payload
                );
                console.log(`[WEB-PUSH] ✅ ${sub.emp_alias}`);
              } catch (e) {
                console.error(`[WEB-PUSH] ❌ ${sub.emp_alias}: ${e.statusCode} ${e.message}`);
                if (e.statusCode === 410 || e.statusCode === 404) {
                  await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [sub.endpoint] }).catch(() => {});
                }
              }
            }
          }

          // 2. FCM (Firebase Admin) — native Android app
          if (firebaseAdmin) {
            const fcmRows = await db.execute('SELECT emp_alias, token FROM fcm_tokens').catch(() => ({ rows: [] }));
            for (const row of fcmRows.rows) {
              const stocks = byEmp[row.emp_alias];
              if (!stocks?.length) continue;
              try {
                await firebaseAdmin.messaging().send({
                  token:        row.token,
                  notification: { title: `📋 Your Stocks — ${label}`, body: stocks.join(' · ') },
                  data:         { url: '/entry.html', tag: `aj-assign-${date}` },
                  android:      { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
                });
                console.log(`[FCM] ✅ ${row.emp_alias}`);
              } catch (e) {
                console.error(`[FCM] ❌ ${row.emp_alias}: ${e.message}`);
                if (e.code === 'messaging/registration-token-not-registered') {
                  await db.execute({ sql: 'DELETE FROM fcm_tokens WHERE token = ?', args: [row.token] }).catch(() => {});
                }
              }
            }
          }
        } catch (e) {
          console.error('[PUSH] Unexpected notification error:', e.message);
        }
      });
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

// GET /api/admin/feedback — staff feedback inbox, newest first
app.get('/api/admin/feedback', async (req, res) => {
  try {
    const r = await db.execute('SELECT id, emp_alias, message, created_at, is_read FROM feedback ORDER BY id DESC');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/feedback/:id/read — mark a feedback entry as read
app.post('/api/admin/feedback/:id/read', async (req, res) => {
  try {
    await db.execute({ sql: 'UPDATE feedback SET is_read = 1 WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/admin/feedback/:id — dismiss a feedback entry
app.delete('/api/admin/feedback/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM feedback WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/activity-log?limit=100 — recent activity across the app, merged
// and sorted newest-first: actual stock entries, planned assignments, and leave
// bookings. Read-only; protected by the /api/admin requireAdmin middleware above.
app.get('/api/admin/activity-log', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  try {
    const events = [];

    // Actual completed work — the real "who did this stock" history
    await Promise.all(STOCK_CATEGORIES.map(async cat => {
      try {
        const r = await db.execute({
          sql:  `SELECT date, stock, entry_by, created_at FROM stock_${cat.id} ORDER BY id DESC LIMIT ?`,
          args: [limit],
        });
        r.rows.forEach(row => {
          events.push({
            type:  'entry',
            label: cat.label,
            date:  row.date,
            alias: row.stock,
            by:    row.entry_by || '',
            at:    row.created_at,
          });
        });
      } catch (_) {}
    }));

    // Planned assignments — auto-assign saves and manual "Change Specific Tasks" edits
    try {
      const r = await db.execute({
        sql:  'SELECT date, stock_id, emp_alias, entry_by, source, created_at FROM assignment ORDER BY id DESC LIMIT ?',
        args: [limit],
      });
      r.rows.forEach(row => {
        const cat = STOCK_CATEGORIES.find(c => c.id === row.stock_id);
        events.push({
          type:  'assignment',
          label: cat?.label || row.stock_id,
          date:  row.date,
          alias: row.emp_alias,
          by:    row.entry_by || row.source || '',
          at:    row.created_at,
        });
      });
    } catch (_) {}

    // Leave bookings — who booked leave for whom
    try {
      const r = await db.execute({
        sql:  'SELECT date, emp_alias, booked_by, booked_at FROM leave_bookings ORDER BY booked_at DESC LIMIT ?',
        args: [limit],
      });
      r.rows.forEach(row => {
        events.push({
          type:  'leave',
          label: 'Leave',
          date:  row.date,
          alias: row.emp_alias,
          by:    row.booked_by || '',
          at:    row.booked_at,
        });
      });
    } catch (_) {}

    // Newest first (created_at strings are 'YYYY-MM-DD HH:MM:SS', sort correctly as text)
    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    res.json(events.slice(0, limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/stock-alerts — flags stocks that haven't been done in longer
// than their own eligible-staff count in days. The idea: a stock with N people
// who can do it should realistically cycle back to any one of them within
// roughly N days — if it's gone longer than that with nobody doing it at all,
// that's worth a look regardless of who's "due." Also flags stocks with zero
// eligible staff (misconfigured — nobody CAN do it) and stocks never done.
app.get('/api/admin/stock-alerts', async (req, res) => {
  try {
    const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const activeCats = STOCK_CATEGORIES.filter(c => {
      const m = STOCK_META[c.id];
      return m && !m.skip && !INACTIVE_STOCKS.has(c.id);
    });

    const results = await Promise.all(activeCats.map(async cat => {
      const poolRes = await db.execute({
        sql:  'SELECT COUNT(DISTINCT emp_alias) AS n FROM stock_assignments WHERE stock_id = ?',
        args: [cat.id],
      });
      const poolSize = Number(poolRes.rows[0]?.n || 0);

      let lastDate = null;
      try {
        const r = await db.execute(`SELECT MAX(date) AS last_date FROM stock_${cat.id}`);
        lastDate = r.rows[0]?.last_date || null;
      } catch (_) {}

      let daysSince = null;
      if (lastDate) {
        daysSince = Math.round((new Date(todayIST + 'T00:00:00') - new Date(lastDate + 'T00:00:00')) / 86400000);
      }

      let status = 'OK', overdueBy = 0;
      if (poolSize === 0)        status = 'NO_STAFF';
      else if (lastDate === null) status = 'NEVER_DONE';
      else if (daysSince > poolSize) { status = 'OVERDUE'; overdueBy = daysSince - poolSize; }

      return { stock_id: cat.id, label: cat.label, poolSize, lastDate, daysSince, status, overdueBy };
    }));

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/fairness — rotation fairness per stock (each eligible employee's
// real last-done date, oldest-first — same source of truth auto-assign uses) plus
// a 30-day workload summary across all stocks, so uneven distribution is visible
// before it turns into a complaint.
app.get('/api/admin/fairness', async (req, res) => {
  try {
    const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    // Employee lookup — used to omit deleted/inactive staff from the workload
    // summary (a deleted employee simply has no row here; a temporarily
    // disabled one has is_active=0) and to tag each entry with gender for the
    // male/female filter.
    const empRes = await db.execute(
      "SELECT COALESCE(alias_name, name) AS alias, gender, COALESCE(is_active,1) AS is_active FROM employees"
    );
    const empMap = {};
    empRes.rows.forEach(r => { empMap[r.alias] = { gender: r.gender || null, is_active: !!r.is_active }; });

    const stocks = await Promise.all(
      STOCK_CATEGORIES.filter(cat => !STOCK_META[cat.id]?.skip).map(async cat => {
        const poolRes = await db.execute({
          sql:  'SELECT emp_alias FROM stock_assignments WHERE stock_id = ? ORDER BY emp_alias',
          args: [cat.id],
        });
        const aliases = poolRes.rows.map(r => r.emp_alias);

        let lastRows = [];
        try {
          const r = await db.execute({
            sql:  `SELECT stock, MAX(date) AS last_date FROM stock_${cat.id} WHERE date < ? GROUP BY stock`,
            args: [todayIST],
          });
          lastRows = r.rows;
        } catch (_) {}
        const lastMap = {};
        lastRows.forEach(r => { if (r.stock) lastMap[r.stock] = r.last_date; });

        const people = aliases
          .map(alias => ({ alias, last_done: lastMap[alias] || null }))
          .sort((a, b) => {
            if (!a.last_done && !b.last_done) return a.alias.localeCompare(b.alias);
            if (!a.last_done) return -1;
            if (!b.last_done) return 1;
            return a.last_done < b.last_done ? -1 : a.last_done > b.last_done ? 1 : a.alias.localeCompare(b.alias);
          });

        return { stock_id: cat.id, label: cat.label, people };
      })
    );

    // Workload: total actual entries ALL-TIME per employee, normalized into a
    // tasks-per-day rate since each person's own first entry, then expressed
    // as a percentage of the team's average rate. A raw total (or even a
    // fixed recent window) unfairly makes a recently added employee look
    // under-loaded next to someone who's been here for months — dividing by
    // each person's own tenure so far puts everyone on the same footing:
    // 100% = pulling their fair share, regardless of how long they've been
    // on the roster.
    const totalCount = {}; // alias -> total entries all-time
    const firstDate  = {}; // alias -> earliest entry date all-time
    await Promise.all(STOCK_CATEGORIES.map(async cat => {
      try {
        const r = await db.execute(`SELECT stock, COUNT(*) as n, MIN(date) as first FROM stock_${cat.id} WHERE stock IS NOT NULL GROUP BY stock`);
        r.rows.forEach(row => {
          if (!row.stock) return;
          totalCount[row.stock] = (totalCount[row.stock] || 0) + Number(row.n);
          if (!firstDate[row.stock] || row.first < firstDate[row.stock]) firstDate[row.stock] = row.first;
        });
      } catch (_) {}
    }));

    const todayDateObj = new Date(todayIST + 'T12:00:00');
    const activeAliases = Object.keys(empMap).filter(a => empMap[a].is_active);
    const rateByAlias = {};
    activeAliases.forEach(alias => {
      const total = totalCount[alias] || 0;
      if (!total) { rateByAlias[alias] = 0; return; }
      const first = new Date(firstDate[alias] + 'T12:00:00');
      const daysSinceStart = Math.max(1, Math.round((todayDateObj - first) / 86400000) + 1);
      rateByAlias[alias] = total / daysSinceStart;
    });
    // Scale against the busiest person's rate, not the average — so the
    // percentage always reads out of 100% (the most-loaded person sits at
    // 100%, everyone else shows where they stand relative to that) instead
    // of a scale that can run past 100%.
    const maxRate = activeAliases.reduce((m, a) => Math.max(m, rateByAlias[a]), 0);

    const workloadList = activeAliases
      .map(alias => ({
        alias,
        count:   totalCount[alias] || 0,
        percent: maxRate > 0 ? Math.round((rateByAlias[alias] / maxRate) * 100) : 0,
        gender:  empMap[alias]?.gender || null,
      }))
      .sort((a, b) => b.percent - a.percent);

    res.json({ stocks, workload: workloadList });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/employee-stock-summary/:alias — every stock category and this
// employee's own last-done date for it (or null if they've never done it),
// for the Employee History sidebar tool. OWNER only.
app.get('/api/admin/employee-stock-summary/:alias', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const alias = req.params.alias;
  try {
    const cats = STOCK_CATEGORIES.filter(cat => !STOCK_META[cat.id]?.skip);
    const rows = await Promise.all(cats.map(async cat => {
      let lastDone = null;
      try {
        const r = await db.execute({
          sql:  `SELECT MAX(date) AS last_date FROM stock_${cat.id} WHERE stock = ?`,
          args: [alias],
        });
        lastDone = r.rows[0]?.last_date || null;
      } catch (_) {}
      return { stock_id: cat.id, label: cat.label, last_done: lastDone };
    }));
    rows.sort((a, b) => {
      if (!a.last_done && !b.last_done) return a.label.localeCompare(b.label);
      if (!a.last_done) return -1;
      if (!b.last_done) return 1;
      return a.last_done < b.last_done ? -1 : a.last_done > b.last_done ? 1 : a.label.localeCompare(b.label);
    });
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/employee-stock-entries/:alias/:stockId — this employee's actual
// completed entries for one stock over the last 30 days, newest first. OWNER only.
app.get('/api/admin/employee-stock-entries/:alias/:stockId', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { alias, stockId } = req.params;
  if (!VALID_IDS.has(stockId)) return res.status(400).json({ error: 'Invalid stock' });
  try {
    const since = new Date(Date.now() - 30 * 86400000);
    const sinceStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(since);
    const r = await db.execute({
      sql:  `SELECT date, entry_by, created_at FROM stock_${stockId} WHERE stock = ? AND date >= ? ORDER BY date DESC`,
      args: [alias, sinceStr],
    });
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/backup — full JSON export of every data table, for the owner
// to download and keep as a manual backup. Read-only; excludes `sessions`
// (transient login state, not meaningful to restore).
// GET /api/admin/staff-activity — every employee's last login + last seen
// (recent activity, throttled via touchLastSeen above), for the Insights
// "Staff Activity" section: who's online now, who's been active recently,
// and who has never logged into the app at all.
app.get('/api/admin/staff-activity', async (_req, res) => {
  try {
    const r = await db.execute(
      `SELECT id, name, alias_name, last_login, last_seen_at, COALESCE(is_active,1) AS is_active
       FROM employees ORDER BY COALESCE(alias_name, name) ASC`
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/backup', async (req, res) => {
  try {
    const tables = [
      'employees', 'stock_assignments', 'assignment', 'entries', 'leaves',
      'leave_bookings', 'leave_cancel_requests', 'stock_conflicts',
      'push_subscriptions', 'fcm_tokens', 'custom_stocks', 'workload_bias', 'pin_directives', 'assignment_rules',
      ...STOCK_CATEGORIES.map(c => `stock_${c.id}`),
    ];
    const dump = {};
    for (const t of tables) {
      try {
        const r = await db.execute(`SELECT * FROM ${t}`);
        dump[t] = r.rows;
      } catch (_) { /* table may not exist (e.g. custom_stocks) — skip it */ }
    }
    const filename = `appachi-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json({ exportedAt: new Date().toISOString(), tables: dump });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Assignment Rules — owner-toggleable on/off switches, shown as checkboxes
// in the Assignment Rules popup on the Auto-Assign page ─────────────────────

// GET /api/admin/assignment-rules — list all fixed rules with current state.
// gents_only_shop is derived live from GENTS_STOCKS rather than stored in
// assignment_rules, so it always reflects reality even if someone changes it
// from the Stocks page edit modal instead of this popup — one source of truth.
app.get('/api/admin/assignment-rules', (_req, res) => {
  res.json(ASSIGNMENT_RULE_DEFS.map(def => ({
    id: def.id, label: def.label,
    enabled: def.id === 'gents_only_shop'
      ? (GENTS_STOCKS.has('shop_opening') && GENTS_STOCKS.has('shop_closing'))
      : RULES_ENABLED[def.id] !== false,
  })));
});

// POST /api/admin/assignment-rules/:id/toggle — OWNER only
app.post('/api/admin/assignment-rules/:id/toggle', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { id } = req.params;
  const def = ASSIGNMENT_RULE_DEFS.find(d => d.id === id);
  if (!def) return res.status(404).json({ error: 'Unknown rule' });
  try {
    if (id === 'gents_only_shop') {
      // Drives the real `gents` flag for these two built-in stocks — the same
      // mechanism the Stocks page edit modal uses.
      const nowEnabled = !(GENTS_STOCKS.has('shop_opening') && GENTS_STOCKS.has('shop_closing'));
      for (const sid of ['shop_opening', 'shop_closing']) {
        const cat = STOCK_CATEGORIES.find(c => c.id === sid);
        const meta = STOCK_META[sid];
        await db.execute({
          sql:  `INSERT INTO custom_stocks (id, label, timing, slots, gents, days) VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET gents=excluded.gents`,
          args: [sid, cat?.label || sid, (meta?.timing || ['any'])[0], ENTRY_COUNTS[sid] || 1, nowEnabled ? 1 : 0, meta?.days?.join(',') || null],
        });
        if (nowEnabled) GENTS_STOCKS.add(sid); else GENTS_STOCKS.delete(sid);
      }
      return res.json({ ok: true, id, enabled: nowEnabled });
    }

    const nowEnabled = RULES_ENABLED[id] === false; // flip
    await db.execute({
      sql:  `INSERT INTO assignment_rules (id, enabled) VALUES (?, ?)
             ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, updated_at=datetime('now','localtime')`,
      args: [id, nowEnabled ? 1 : 0],
    });
    RULES_ENABLED[id] = nowEnabled;
    res.json({ ok: true, id, enabled: nowEnabled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/workload-directive — parse a free-text instruction (e.g.
// "increase work for Chinnammal slightly for 1 week" or "put Raji-2 in Ring
// Stock for the next 10 days") into structured directives and save them.
// Parsing is fully local (see parseDirectives above) — no external API, no cost.
app.post('/api/admin/workload-directive', async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const empRes = await db.execute("SELECT COALESCE(alias_name, name) AS alias FROM employees");
    const knownAliases = empRes.rows.map(r => r.alias).filter(Boolean);

    const { workloadDirectives, pinDirectives, unparsed } = parseDirectives(text, knownAliases);
    if (!workloadDirectives.length && !pinDirectives.length) {
      return res.json({ ok: true, saved: [], pinned: [], unparsed: unparsed.length ? unparsed : [text] });
    }

    const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const createdBy = req.session?.name || 'ADMIN';

    const saved = [];
    for (const d of workloadDirectives) {
      const expiresAt = shiftDateStr(todayIST, d.duration_days);
      await db.execute({
        sql:  `INSERT INTO workload_bias (emp_alias, direction, intensity, duration_days, raw_text, created_by, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [d.alias, d.direction, d.intensity, d.duration_days, d.raw_text, createdBy, expiresAt],
      });
      saved.push({ ...d, expires_at: expiresAt });
    }

    const pinned = [];
    for (const d of pinDirectives) {
      const expiresAt = shiftDateStr(todayIST, d.duration_days);
      await db.execute({
        sql:  `INSERT INTO pin_directives (emp_alias, stock_id, raw_text, created_by, expires_at)
               VALUES (?, ?, ?, ?, ?)`,
        args: [d.alias, d.stock_id, d.raw_text, createdBy, expiresAt],
      });
      pinned.push({ ...d, expires_at: expiresAt });
    }

    res.json({ ok: true, saved, pinned, unparsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/workload-directive — list currently active (non-expired)
// nudges AND pins together, tagged with `type` so the client can render/cancel each
app.get('/api/admin/workload-directive', async (_req, res) => {
  try {
    const todayIST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const [wr, pr] = await Promise.all([
      db.execute({
        sql:  'SELECT id, emp_alias, direction, intensity, duration_days, raw_text, created_by, created_at, expires_at FROM workload_bias WHERE expires_at >= ? ORDER BY id DESC',
        args: [todayIST],
      }),
      db.execute({
        sql:  'SELECT id, emp_alias, stock_id, raw_text, created_by, created_at, expires_at FROM pin_directives WHERE expires_at >= ? ORDER BY id DESC',
        args: [todayIST],
      }),
    ]);
    const workload = wr.rows.map(r => ({ ...r, type: 'workload' }));
    const pinned = pr.rows.map(r => ({
      ...r, type: 'pin',
      stock_label: STOCK_CATEGORIES.find(c => c.id === r.stock_id)?.label || r.stock_id,
    }));
    res.json([...workload, ...pinned]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/admin/workload-directive/:id — cancel a workload nudge early
app.delete('/api/admin/workload-directive/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM workload_bias WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/admin/pin-directive/:id — cancel a pin directive early
app.delete('/api/admin/pin-directive/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM pin_directives WHERE id = ?', args: [req.params.id] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

// POST /api/next-to-attend/sync — client (any logged-in dashboard) computes the
// "who's overdue to attend the next sale" ranking from the Sales app's Firestore
// data and submits it here on every Sales-tab load. We're the source of truth for
// who was already in each queue, so an alias only gets pushed a notification the
// moment they newly enter their staff-type's top 3 — repeated identical submits
// from multiple viewers' dashboards are no-ops.
app.post('/api/next-to-attend/sync', requireAuth, async (req, res) => {
  const groups = {
    NEW: Array.isArray(req.body.newStaff) ? req.body.newStaff.filter(Boolean).slice(0, 3) : [],
    OLD: Array.isArray(req.body.oldStaff) ? req.body.oldStaff.filter(Boolean).slice(0, 3) : [],
  };

  const notified = new Set();
  try {
    for (const staffType of ['NEW', 'OLD']) {
      const aliases = groups[staffType];
      const prevRows = await db.execute({ sql: 'SELECT alias FROM next_to_attend WHERE staff_type = ?', args: [staffType] });
      const prevSet = new Set(prevRows.rows.map(r => r.alias));

      await db.execute({ sql: 'DELETE FROM next_to_attend WHERE staff_type = ?', args: [staffType] });
      for (let rank = 0; rank < aliases.length; rank++) {
        await db.execute({ sql: 'INSERT INTO next_to_attend (staff_type, rank, alias) VALUES (?, ?, ?)', args: [staffType, rank, aliases[rank]] });
        if (!prevSet.has(aliases[rank])) notified.add(aliases[rank]);
      }
    }

    for (const alias of notified) {
      await pushToAlias(alias, {
        title: "You're next to attend",
        body: "It's been a while since your last sale — you're next in line to attend a customer.",
        url: '/',
        tag: 'next-to-attend',
      }).catch(() => {});
    }

    res.json({ ok: true, notified: [...notified] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/push/subscribed-employees — list distinct aliases that have at least one push subscription
app.get('/api/push/subscribed-employees', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  try {
    const [webRows, fcmRows] = await Promise.all([
      db.execute('SELECT DISTINCT emp_alias FROM push_subscriptions WHERE emp_alias IS NOT NULL'),
      db.execute('SELECT DISTINCT emp_alias FROM fcm_tokens WHERE emp_alias IS NOT NULL'),
    ]);
    const names = new Set([
      ...webRows.rows.map(r => r.emp_alias),
      ...fcmRows.rows.map(r => r.emp_alias),
    ]);
    res.json([...names].sort());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/push/greet — send personalised greeting to selected employees (OWNER only)
app.post('/api/push/greet', requireAuth, async (req, res) => {
  if (req.session.role !== 'OWNER') return res.status(403).json({ error: 'Owner only' });
  const { message, employees } = req.body;
  if (!message || !Array.isArray(employees) || !employees.length)
    return res.status(400).json({ error: 'message and employees[] are required' });
  if (!webpush && !firebaseAdmin) return res.status(503).json({ error: 'Push not configured on server' });
  let sent = 0, failed = 0;
  for (const alias of employees) {
    const body    = `Hi ${alias} - ${message}`;
    const payload = JSON.stringify({ title: 'APPACHI JEWELLERY', body, url: '/', tag: 'aj-greet' });
    if (webpush) {
      const r = await db.execute({ sql: 'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE emp_alias = ?', args: [alias] });
      for (const sub of r.rows) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
        } catch (err) {
          failed++;
          if (err.statusCode === 410 || err.statusCode === 404)
            await db.execute({ sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?', args: [sub.endpoint] }).catch(() => {});
        }
      }
    }
    if (firebaseAdmin) {
      const fcmRows = await db.execute({ sql: 'SELECT token FROM fcm_tokens WHERE emp_alias = ?', args: [alias] });
      for (const row of fcmRows.rows) {
        try {
          await firebaseAdmin.messaging().send({
            token: row.token,
            notification: { title: 'APPACHI JEWELLERY', body },
            data: { url: '/' },
            android: { priority: 'high', notification: { channelId: 'default', sound: 'default' } },
          });
          sent++;
        } catch (err) {
          failed++;
          if (err.code === 'messaging/registration-token-not-registered')
            await db.execute({ sql: 'DELETE FROM fcm_tokens WHERE token = ?', args: [row.token] }).catch(() => {});
        }
      }
    }
  }
  res.json({ ok: sent > 0, sent, failed });
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
             COALESCE(l.leave_type, 'FULL') AS leave_type,
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
  const { date, aliases, alias, dates, leave_type } = req.body;
  const lt = ['FULL','HALF_AM','HALF_PM'].includes(leave_type) ? leave_type : 'FULL';
  // pairs: [date, alias, leave_type]
  const pairs = [];

  if (date && Array.isArray(aliases)) {
    for (const a of aliases) if (a?.trim()) pairs.push([date, a.trim(), lt]);
  } else if (alias && Array.isArray(dates)) {
    // dates may be strings or {date, leave_type} objects
    for (const d of dates) {
      if (!d) continue;
      if (typeof d === 'string' && d.trim()) pairs.push([d.trim(), alias.trim(), lt]);
      else if (d.date?.trim()) pairs.push([d.date.trim(), alias.trim(), ['FULL','HALF_AM','HALF_PM'].includes(d.leave_type) ? d.leave_type : lt]);
    }
  } else {
    return res.status(400).json({ error: 'Provide {date, aliases:[]} or {alias, dates:[]}' });
  }

  if (!pairs.length) return res.status(400).json({ error: 'No valid entries provided' });

  try {
    let inserted = 0;
    let totalReassigned = 0;
    for (const [d, a, type] of pairs) {
      const r = await db.execute({
        sql:  `INSERT INTO leaves (date, emp_alias, leave_type) VALUES (?, ?, ?)
               ON CONFLICT(date, emp_alias) DO UPDATE SET leave_type = excluded.leave_type`,
        args: [d, a, type],
      });
      const isNew = (r.rowsAffected || 0) > 0;
      await db.execute({
        sql:  'INSERT OR REPLACE INTO leave_bookings (date, emp_alias, booked_by) VALUES (?, ?, ?)',
        args: [d, a, 'ADMIN'],
      });
      if (isNew) inserted++;
      if (isNew) {
        const reassigned = await reassignSlotsForLeave(d, a, type);
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
    let reassignments = [];
    if (check.rows.length) {
      const { date, emp_alias } = check.rows[0];
      await db.execute({ sql: 'DELETE FROM leave_bookings WHERE date = ? AND emp_alias = ?', args: [date, emp_alias] });

      // Same as approving a leave-cancel request (POST /api/leave-cancel-requests/:id/approve) —
      // cancelling the leave here has no effect on whatever stock it already caused to be
      // reassigned, so surface those rows for the owner to optionally restore.
      const reassignRows = (await db.execute({
        sql:  "SELECT id, stock_id, to_alias FROM leave_reassignments WHERE leave_date = ? AND emp_alias = ? AND reason = 'LEAVE' AND restored = 0",
        args: [date, emp_alias],
      })).rows;
      reassignments = reassignRows.map(r => ({
        id:       r.id,
        stock_id: r.stock_id,
        label:    STOCK_CATEGORIES.find(c => c.id === r.stock_id)?.label || r.stock_id,
        to_alias: r.to_alias,
      }));
    }
    await db.execute({ sql: 'DELETE FROM leaves WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ ok: true, reassignments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Pages ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(__dirname + '/dashboard.html'));

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
