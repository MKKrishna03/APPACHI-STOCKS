require('dotenv').config();
const express = require('express');
const { createClient } = require('@libsql/client');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ─── Web Push (VAPID) ─────────────────────────────────────────────────────────
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
    console.warn('⚠️  VAPID keys not set in .env — push notifications disabled');
    webpush = null;
  }
} catch {
  console.warn('⚠️  web-push not installed — push notifications disabled');
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

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── Stock Category Definitions ────────────────────────────────────────────────
const STOCK_CATEGORIES = [
  { id: 'cash',             label: 'CASH'                  },
  { id: 'steps',            label: 'STEPS'                 },
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
  { id: 'shop_closing',     label: 'TODAY SHOP CLOSING'    },
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
  tray_arrange:     { timing: ['1930'],          group: 'D',  days: null,   skip: false },
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
  pathiram_sl_box:  { timing: ['1000'],          group: 'C',  days: null,   skip: false },
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
      CREATE TABLE IF NOT EXISTS stock_assignments (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_id  TEXT NOT NULL,
        emp_alias TEXT NOT NULL,
        UNIQUE(stock_id, emp_alias)
      )
    `);

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
    console.log('✅ DB ready');
  } catch (err) {
    console.error('❌ DB init failed:', err.message);
  }
}

initDB();

// ─── Tomorrow's date in IST (server-authoritative) — assignments are for next day
app.get('/api/today', (_req, res) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(tomorrow);
  res.json({ date });
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
    //    { stock_id: { alias: 'YYYY-MM-DD' } }  — missing alias = never done
    const lastByEmp = {};
    await Promise.all(STOCK_CATEGORIES.map(async cat => {
      try {
        const hr = await db.execute({
          sql: `SELECT stock, MAX(date) AS last_date
                FROM stock_${cat.id}
                WHERE date < ?
                GROUP BY stock`,
          args: [date],
        });
        lastByEmp[cat.id] = {};
        hr.rows.forEach(r => { if (r.stock) lastByEmp[cat.id][r.stock] = r.last_date; });
      } catch { lastByEmp[cat.id] = {}; }
    }));

    // 3. Fetch employees on leave for this date (exclude from all assignments)
    let onLeave = new Set();
    try {
      const lr = await db.execute({ sql: 'SELECT emp_alias FROM leaves WHERE date = ?', args: [date] });
      lr.rows.forEach(r => onLeave.add(r.emp_alias));
      if (onLeave.size > 0) console.log(`🏖️  On leave for ${date}:`, [...onLeave].join(', '));
    } catch (_) {}

    // 4. Assignment algorithm
    const assignments   = {};
    const skipped       = [];
    const usedTimes     = {}; // alias → Set<slot>
    const usedGroups    = {}; // alias → Set<groupLetter>
    const dailyCount    = {}; // alias → stocks assigned so far today (load balancing)
    const targetDay     = new Date(date + 'T12:00:00');
    const priorityOrder = {}; // sid → [alias,...] pure date-rotation order (sent to client for soft-constraint UI)

    for (const cat of STOCK_CATEGORIES) {
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

      const count    = ENTRY_COUNTS[sid] || 1;
      const eligible = (byStock[sid] || []).filter(a => !onLeave.has(a)); // skip employees on leave
      const empDates = lastByEmp[sid]    || {};

      // Dynamic composite sort — re-evaluated per stock using current dailyCount.
      // Goal: rotate by least-recently-done FIRST, but penalise overloaded employees
      // so no one gets many more stocks than others on the same day.
      //
      // Score formula (lower = higher priority):
      //   score = dailyAssignments * DAILY_PENALTY − daysSinceLastDone
      // DAILY_PENALTY = 3 means 1 extra stock today ≈ 3 rotation-days of priority debt.
      //
      // Special cases:
      //   • "Never done" always beats anyone who has a history, regardless of count.
      //   • Among "never done" employees, lower dailyCount wins (spread load).
      const DAILY_PENALTY = 3;
      const sorted = [...eligible].sort((a, b) => {
        const ca = dailyCount[a] || 0;
        const cb = dailyCount[b] || 0;
        const da = empDates[a]; // undefined = never done
        const db = empDates[b];

        // Both never done → sort by daily load, then alphabetical
        if (!da && !db) { if (ca !== cb) return ca - cb; return a.localeCompare(b); }
        if (!da) return -1; // a never done → a first
        if (!db) return  1; // b never done → b first

        // Both have history → composite score
        const daysA = Math.round((targetDay - new Date(da + 'T12:00:00')) / 86400000);
        const daysB = Math.round((targetDay - new Date(db + 'T12:00:00')) / 86400000);
        const scoreA = ca * DAILY_PENALTY - daysA;
        const scoreB = cb * DAILY_PENALTY - daysB;
        if (scoreA !== scoreB) return scoreA - scoreB;
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
      const picked = [];
      const pickedSet = new Set(); // fast dedup guard — same person never fills two slots
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
  cash: 1, steps: 1, collection: 1, chain_stock: 1, drops_stock: 1,
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
    const pairs = await Promise.all(
      Object.entries(ENTRY_COUNTS).map(async ([catId, maxCount]) => {
        const r = await db.execute({
          sql: `SELECT COUNT(*) as n FROM stock_${catId} WHERE date = ?`,
          args: [date],
        });
        return [catId, Number(r.rows[0].n) >= maxCount];
      })
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
    for (const cat of STOCK_CATEGORIES) {
      try {
        await db.execute({ sql: `DELETE FROM stock_${cat.id} WHERE date = ?`, args: [date] });
      } catch (_) { /* table may not exist for this category — skip */ }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all saved assignments for a date  ?date=YYYY-MM-DD  →  [{stock_id, label, aliases:[]}]
app.get('/api/entry/all', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const result = [];
  for (const cat of STOCK_CATEGORIES) {
    try {
      const r = await db.execute({
        sql:  `SELECT stock as alias FROM stock_${cat.id} WHERE date = ? ORDER BY rowid`,
        args: [date],
      });
      if (r.rows.length > 0) {
        result.push({
          stock_id: cat.id,
          label:    cat.label,
          aliases:  r.rows.map(row => row.alias).filter(Boolean),
        });
      }
    } catch (_) { /* table may not exist for this category */ }
  }
  res.json(result);
});

// POST bulk submit  body: { date, entries: {stock_id: [alias, ...]} }
app.post('/api/entry/submit', async (req, res) => {
  const { date, entries } = req.body;
  if (!date || !entries) return res.status(400).json({ error: 'date and entries required' });

  const errors = [];
  const writes = [];

  for (const [catId, aliases] of Object.entries(entries)) {
    if (!VALID_IDS.has(catId) || !Array.isArray(aliases) || !aliases.length) continue;
    const maxCount = ENTRY_COUNTS[catId] || 3;
    const r = await db.execute({ sql: `SELECT COUNT(*) as n FROM stock_${catId} WHERE date = ?`, args: [date] });
    const current = Number(r.rows[0].n);
    if (current + aliases.length > maxCount) {
      const cat = STOCK_CATEGORIES.find(c => c.id === catId);
      errors.push(`${cat ? cat.label : catId}: already has ${current}/${maxCount} entries for this date.`);
    } else {
      aliases.forEach(alias => { if (alias?.trim()) writes.push({ catId, alias: alias.trim() }); });
    }
  }

  if (errors.length) return res.json({ error: true, messages: errors });

  const source = req.body.source || 'ENTRY'; // 'AUTO-ASSIGN' or 'ENTRY'
  try {
    for (const { catId, alias } of writes) {
      await db.execute({
        sql: `INSERT INTO stock_${catId} (date, stock, name, entry_by) VALUES (?, ?, ?, ?)`,
        args: [date, alias, '', source],
      });
    }
    res.json({ error: false });

    // Push notification — only for auto-assign saves
    if (source === 'AUTO-ASSIGN') {
      const d = new Date(date + 'T12:00:00');
      const label = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
      broadcastPush({
        title: '📋 Stock Assignments Ready',
        body:  `Duties for ${label} have been assigned. Check the Entry page.`,
        url:   '/entry.html',
        tag:   'aj-assign',
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

// DELETE /api/admin/clear-daily — delete all daily stock entries (keeps employees + assignments)
app.delete('/api/admin/clear-daily', async (req, res) => {
  let totalDeleted = 0;
  const details = [];
  for (const cat of STOCK_CATEGORIES) {
    try {
      const r = await db.execute(`DELETE FROM stock_${cat.id}`);
      const n = r.rowsAffected || 0;
      totalDeleted += n;
      if (n > 0) details.push({ table: `stock_${cat.id}`, deleted: n });
    } catch (_) {}
  }
  res.json({ ok: true, totalDeleted, details });
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
  // Clear all daily entry tables
  for (const cat of STOCK_CATEGORIES) {
    try {
      const r = await db.execute(`DELETE FROM stock_${cat.id}`);
      const n = r.rowsAffected || 0;
      totalDeleted += n;
      if (n > 0) details.push({ table: `stock_${cat.id}`, deleted: n });
    } catch (_) {}
  }
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

// POST /api/push/subscribe  — save a push subscription
app.post('/api/push/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  try {
    await db.execute({
      sql:  'INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)',
      args: [endpoint, keys?.p256dh || '', keys?.auth || ''],
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

// GET /api/push/count  — how many devices subscribed
app.get('/api/push/count', async (_req, res) => {
  try {
    const r = await db.execute('SELECT COUNT(*) as n FROM push_subscriptions');
    res.json({ count: Number(r.rows[0].n) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Leaves API ───────────────────────────────────────────────────────────────

// GET /api/leaves  — ?date=YYYY-MM-DD  OR  ?alias=NAME  OR  no filter (all, recent first)
app.get('/api/leaves', async (req, res) => {
  const { date, alias } = req.query;
  try {
    let sql  = 'SELECT id, date, emp_alias FROM leaves';
    const args = [];
    if (date)  { sql += ' WHERE date = ?';      args.push(date);  }
    else if (alias) { sql += ' WHERE emp_alias = ?'; args.push(alias); }
    sql += ' ORDER BY date DESC, emp_alias ASC';
    const r = await db.execute({ sql, args });
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leaves  —  {date, aliases:[...]}  OR  {alias, dates:[...]}
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
    for (const [d, a] of pairs) {
      const r = await db.execute({
        sql:  'INSERT OR IGNORE INTO leaves (date, emp_alias) VALUES (?, ?)',
        args: [d, a],
      });
      inserted += r.rowsAffected || 0;
    }
    res.json({ ok: true, inserted, skipped: pairs.length - inserted });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/leaves/:id
app.delete('/api/leaves/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM leaves WHERE id = ?', args: [Number(req.params.id)] });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Pages ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(__dirname + '/dashboard.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
