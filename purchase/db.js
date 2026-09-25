const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const { Pool, types } = require("pg");
const { AsyncLocalStorage } = require("async_hooks");
// Return DATE columns as plain "YYYY-MM-DD" strings instead of JS Date objects.
// postgres-date v1 parses DATE as local-midnight Date, which JSON-serialises to
// the previous UTC day in IST (UTC+5:30), causing an off-by-one date bug.
types.setTypeParser(1082, (val) => val);
const crypto = require("crypto");

function generateResetKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(5);
  let key = "";
  for (let i = 0; i < 5; i++) key += chars[bytes[i] % chars.length];
  return key;
}

function makePool(url) {
  const dbUrl = new URL(url);
  const p = new Pool({
    host: dbUrl.hostname,
    port: dbUrl.port || 5432,
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.slice(1),
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 90000,
    keepAlive: true,
    allowExitOnIdle: false,
    lookup: (hostname, options, callback) => {
      dns.lookup(hostname, { family: 4 }, callback);
    },
  });
  p.on("error", (err) => console.error("[DB] Pool error:", err.message));
  const _orig = p.query.bind(p);
  p.query = async function (...args) {
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try { return await _orig(...args); }
      catch (err) {
        lastErr = err;
        if (
          err.code === "ETIMEDOUT" ||
          err.message?.includes("ETIMEDOUT") ||
          err.message?.includes("Connection terminated")
        ) {
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };
  return p;
}

// PURCHASE_-prefixed: this now shares a process with Billing, which owns the
// plain DATABASE_URL name.
const oldPool = makePool(process.env.PURCHASE_DATABASE_URL);
const newPool = process.env.PURCHASE_NEW_DATABASE_URL
  ? makePool(process.env.PURCHASE_NEW_DATABASE_URL)
  : oldPool;

// Keep-alive pings on both pools
setInterval(() => {
  oldPool.query("SELECT 1").catch(() => {});
  if (newPool !== oldPool) newPool.query("SELECT 1").catch(() => {});
}, 240000);

// ── Company context (AsyncLocalStorage) ──
// companyId 1 = APPACHI JEWELLERY (old), 2 = APPACHI JEWELLERY PVT LTD (new)
const companyStore = new AsyncLocalStorage();

// Proxy pool: routes all queries to oldPool (company 1) or newPool (company 2).
// Route files continue to do `const { pool } = require('../db')` unchanged.
const pool = new Proxy(Object.create(null), {
  get(_, prop) {
    const companyId = companyStore.getStore();
    const target = companyId === 1 ? oldPool : newPool;
    const val = target[prop];
    return typeof val === "function" ? val.bind(target) : val;
  },
});

// ── Database schema (runs on whichever pool is active via companyStore) ──
async function initDB_internal() {
  // ── Core tables ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      alias TEXT UNIQUE NOT NULL,
      company_name TEXT,
      address TEXT,
      city TEXT,
      pincode TEXT,
      state TEXT,
      state_code TEXT,
      gst_number TEXT,
      pan_number TEXT,
      contact1 TEXT,
      contact2 TEXT,
      email TEXT,
      ac_holder TEXT,
      bank_name TEXT,
      account_number TEXT,
      ifsc_code TEXT,
      branch TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS voucher_types (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS labour (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER REFERENCES profiles(id),
      company_name TEXT,
      date DATE,
      issue_number TEXT,
      labour_item_type TEXT,
      voucher_type TEXT,
      receipt_bill_no TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS labour_items (
      id SERIAL PRIMARY KEY,
      labour_id INTEGER REFERENCES labour(id),
      sl_no INTEGER,
      description TEXT,
      quantity NUMERIC,
      rate NUMERIC,
      amount NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER REFERENCES profiles(id),
      voucher_type TEXT,
      date DATE,
      bill_no TEXT,
      entry_type TEXT,
      description TEXT,
      qty NUMERIC,
      rate NUMERIC,
      va NUMERIC,
      taxable_value NUMERIC,
      tax_percent NUMERIC,
      igst NUMERIC,
      cgst NUMERIC,
      sgst NUMERIC,
      tax_amount NUMERIC,
      total_value NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(
    `INSERT INTO voucher_types (name) VALUES ('Create Issue Voucher'), ('Close Issue Voucher') ON CONFLICT DO NOTHING`,
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      giver TEXT,
      receiver TEXT,
      date DATE,
      time TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      seen_at TIMESTAMP,
      done_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id SERIAL PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      name TEXT,
      email TEXT,
      password TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_templates (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      receiver TEXT DEFAULT 'all',
      priority TEXT DEFAULT 'medium',
      day_of_month INTEGER NOT NULL,
      deadline_days INTEGER DEFAULT 3,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_instances (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES schedule_templates(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      receiver TEXT DEFAULT 'all',
      priority TEXT DEFAULT 'medium',
      notes TEXT,
      scheduled_date DATE,
      deadline_date DATE,
      status TEXT DEFAULT 'pending',
      done_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchases (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER REFERENCES profiles(id),
      date DATE,
      bill_no TEXT,
      description TEXT,
      taxable_value NUMERIC,
      cgst NUMERIC,
      sgst NUMERIC,
      igst NUMERIC,
      round_off NUMERIC,
      total_value NUMERIC,
      tds NUMERIC,
      net_value NUMERIC,
      linked_voucher_id INTEGER,
      linked_chittai_id INTEGER,
      created_by TEXT,
      photo_url TEXT,
      linked_purchase_ids INTEGER[],
      linked_voucher_ids INTEGER[],
      linked_chittai_ids INTEGER[],
      is_accounted BOOLEAN DEFAULT false,
      remaining_value NUMERIC,
      voucher_type TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_items (
      id SERIAL PRIMARY KEY,
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE CASCADE,
      sl_no INTEGER,
      description TEXT,
      quantity NUMERIC,
      rate NUMERIC,
      tax_percent NUMERIC,
      amount NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chittai (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER REFERENCES profiles(id),
      chittai_no TEXT,
      date DATE,
      weight NUMERIC,
      rate NUMERIC,
      value NUMERIC,
      others NUMERIC DEFAULT 0,
      total NUMERIC,
      tds NUMERIC DEFAULT 0,
      rtgs_amount NUMERIC,
      is_paid BOOLEAN DEFAULT false,
      linked_purchase_id INTEGER,
      linked_voucher_id INTEGER,
      created_by TEXT,
      photo_url TEXT,
      remarks TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      date DATE,
      time TIME,
      notes TEXT,
      company TEXT,
      alerted_day_before BOOLEAN DEFAULT false,
      alerted_on_day BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS labour_item_types (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tax_format (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      percent NUMERIC NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tds (
      id SERIAL PRIMARY KEY,
      pan_4th_letter TEXT,
      section TEXT,
      entity_type TEXT,
      tds_percentage NUMERIC,
      remarks TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Seed the TDS rate table if it's empty — this table has no per-row default,
  // so a freshly created database (e.g. a new company's DB) starts with zero
  // rows, which makes the auto-TDS lookup fall through to the hardcoded
  // "no PAN" rate (20%) for every company instead of their real rate.
  const tdsRowCount = await pool.query(`SELECT COUNT(*) FROM tds`);
  if (parseInt(tdsRowCount.rows[0].count, 10) === 0) {
    await pool.query(`
      INSERT INTO tds (pan_4th_letter, section, entity_type, tds_percentage, remarks) VALUES
      ('P','194C','Individual','1.00','Individual - 1% TDS'),
      ('H','194C','HUF (Hindu Undivided Family)','1.00','HUF - 1% TDS'),
      ('C','194C','Company','2.00','Company - 2% TDS'),
      ('F','194C','Firm/LLP','2.00','Partnership Firm - 2% TDS'),
      ('A','194C','Association of Persons (AOP)','2.00','AOP - 2% TDS'),
      ('B','194C','Body of Individuals (BOI)','2.00','BOI - 2% TDS'),
      ('T','194C','Trust','2.00','Trust - 2% TDS'),
      ('L','194C','Local Authority','2.00','Local Authority - 2% TDS'),
      ('J','194C','Artificial Juridical Person','2.00','AJP - 2% TDS'),
      ('G','194C','Government','2.00','Government - 2% TDS'),
      ('X','194C','No PAN Provided','20.00','PAN not furnished - 20% TDS as per Sec 206AA'),
      ('P','194Q','Individual','0.10','Purchase of goods - 0.1% TDS u/s 194Q'),
      ('H','194Q','HUF','0.10','Purchase of goods - 0.1% TDS u/s 194Q'),
      ('C','194Q','Company','0.10','Purchase of goods - 0.1% TDS u/s 194Q'),
      ('F','194Q','Firm/LLP','0.10','Purchase of goods - 0.1% TDS u/s 194Q'),
      ('A','194Q','AOP','0.10','Purchase of goods - 0.1% TDS u/s 194Q'),
      ('B','194Q','BOI','0.10','Purchase of goods - 0.1% TDS u/s 194Q'),
      ('T','194Q','Trust','0.10','Purchase of goods - 0.1% TDS u/s 194Q'),
      ('X','194Q','No PAN Provided','5.00','No PAN - 5% TDS u/s 206AA')
    `);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS descriptions (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      metal_type TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hallmark_expenses (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER REFERENCES profiles(id),
      date DATE,
      bill_no TEXT,
      voucher_type TEXT,
      description TEXT,
      taxable_value NUMERIC,
      tax_percent NUMERIC DEFAULT 0,
      cgst NUMERIC,
      sgst NUMERIC,
      igst NUMERIC,
      round_off NUMERIC,
      total_value NUMERIC,
      tds NUMERIC,
      net_value NUMERIC,
      linked_voucher_id INTEGER,
      linked_voucher_ids INTEGER[],
      linked_chittai_id INTEGER,
      linked_chittai_ids INTEGER[],
      photo_url TEXT,
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hallmark_expense_items (
      id SERIAL PRIMARY KEY,
      hallmark_expense_id INTEGER REFERENCES hallmark_expenses(id) ON DELETE CASCADE,
      sl_no INTEGER,
      description TEXT,
      quantity NUMERIC,
      rate NUMERIC,
      tax_percent NUMERIC,
      amount NUMERIC,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Upload sessions table (replaces in-memory Map) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      bill_no TEXT,
      company TEXT,
      folder TEXT,
      bill_date TEXT,
      photo_url TEXT,
      photo_urls TEXT[] DEFAULT '{}',
      done BOOLEAN DEFAULT false,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Cancelled bills ──
  await pool.query(`
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
  `);

  // ── Photo bill entries ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS photo_bill_entries (
      id         SERIAL PRIMARY KEY,
      profile_id INTEGER,
      bill_no    VARCHAR(100),
      date       DATE,
      remarks    TEXT,
      photo_url  TEXT,
      photo_urls TEXT[],
      created_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Activity log ──
  await pool.query(`
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
  `);

  // ── Sequences ──
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS payment_voucher_seq START 1`);
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS receipt_voucher_seq START 1`);

  // ── Additive column migrations ──
  const alterIfNotExists = async (sql) => { try { await pool.query(sql); } catch (_) {} };

  await alterIfNotExists(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS linked_labour_id INTEGER REFERENCES labour(id)`);
  await alterIfNotExists(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS linked_chittai_id INTEGER REFERENCES chittai(id)`);
  await alterIfNotExists(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS linked_purchase_id INTEGER REFERENCES purchases(id)`);
  await alterIfNotExists(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await alterIfNotExists(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS voucher_no TEXT`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS linked_purchase_id INTEGER REFERENCES purchases(id)`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS linked_voucher_id INTEGER REFERENCES vouchers(id)`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS photo_urls TEXT[]`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS taxable_total NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS cgst NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS sgst NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS igst NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS round_off NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS total NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS tds NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS bill_value_after_deduction NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS photo_url TEXT`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS photo_urls TEXT[]`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS is_accounted BOOLEAN DEFAULT false`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS remaining_value NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT false`);
  await alterIfNotExists(`ALTER TABLE labour_items ADD COLUMN IF NOT EXISTS tax_percent NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS payment_voucher_id INTEGER REFERENCES vouchers(id)`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS photo_url TEXT`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS photo_urls TEXT[]`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS is_accounted BOOLEAN DEFAULT false`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS linked_purchase_ids INTEGER[]`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS remaining_value NUMERIC`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS linked_voucher_ids INTEGER[]`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS linked_chittai_ids INTEGER[]`);
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS voucher_type TEXT`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS photo_url TEXT`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS remarks TEXT`);
  await alterIfNotExists(`ALTER TABLE todos ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium'`);
  await alterIfNotExists(`ALTER TABLE todos ADD COLUMN IF NOT EXISTS photo TEXT`);
  await alterIfNotExists(`ALTER TABLE todos ADD COLUMN IF NOT EXISTS replies JSONB DEFAULT '[]'`);
  await alterIfNotExists(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS can_delete BOOLEAN DEFAULT FALSE`);
  await alterIfNotExists(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS reset_key TEXT`);
  await alterIfNotExists(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ledger_types TEXT[] DEFAULT '{}'`);
  await alterIfNotExists(`ALTER TABLE hallmark_expenses ADD COLUMN IF NOT EXISTS photo_urls TEXT[]`);
  await alterIfNotExists(`ALTER TABLE hallmark_expenses ADD COLUMN IF NOT EXISTS is_accounted BOOLEAN DEFAULT false`);
  await alterIfNotExists(`ALTER TABLE hallmark_expenses ADD COLUMN IF NOT EXISTS remaining_value NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS mc_receipt_id INTEGER REFERENCES labour(id)`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS gold_rate NUMERIC`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS mc_pct NUMERIC`);
  await alterIfNotExists(`ALTER TABLE cancelled_bills ADD COLUMN IF NOT EXISTS fields_data JSONB`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS is_accounted BOOLEAN DEFAULT false`);
  await alterIfNotExists(`ALTER TABLE cancelled_bills ADD COLUMN IF NOT EXISTS is_accounted BOOLEAN DEFAULT false`);

  // Backfill mc_receipt_id for issue vouchers that already have a matching MC receipt
  await pool.query(`
    UPDATE labour iv
    SET mc_receipt_id = (
      SELECT rv.id FROM labour rv
      WHERE rv.voucher_type = 'Receipt Voucher'
        AND rv.deleted_at IS NULL
        AND rv.receipt_bill_no LIKE 'MC/%'
        AND (rv.issue_number = iv.issue_number
             OR rv.issue_number LIKE iv.issue_number || ',%'
             OR rv.issue_number LIKE '%,' || iv.issue_number
             OR rv.issue_number LIKE '%,' || iv.issue_number || ',%')
      ORDER BY rv.id DESC LIMIT 1
    )
    WHERE iv.voucher_type = 'ISSUE VOUCHER'
      AND UPPER(iv.labour_item_type) = 'OTHERS'
      AND iv.mc_receipt_id IS NULL
      AND iv.deleted_at IS NULL
  `).catch(() => {});

  // ── Soft delete columns ──
  await alterIfNotExists(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await alterIfNotExists(`ALTER TABLE labour ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await alterIfNotExists(`ALTER TABLE chittai ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await alterIfNotExists(`ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await alterIfNotExists(`ALTER TABLE hallmark_expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await alterIfNotExists(`ALTER TABLE todos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

  // Generate reset_key for users missing one
  const usersWithoutKey = await pool.query(`SELECT id FROM auth_users WHERE reset_key IS NULL`);
  for (const row of usersWithoutKey.rows) {
    await pool.query(`UPDATE auth_users SET reset_key=$1 WHERE id=$2`, [generateResetKey(), row.id]);
  }

  // Fix photo_urls columns that may have been created as JSONB
  for (const table of ["purchases", "labour", "chittai", "hallmark_expenses"]) {
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = '${table}' AND column_name = 'photo_urls' AND udt_name IN ('jsonb','json')
        ) THEN
          ALTER TABLE ${table} ALTER COLUMN photo_urls TYPE TEXT[]
          USING CASE
            WHEN photo_urls IS NULL THEN NULL::TEXT[]
            WHEN jsonb_typeof(photo_urls::jsonb) = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(photo_urls::jsonb))
            ELSE NULL::TEXT[]
          END;
        END IF;
      END $$;
    `);
  }

  // Fix INTEGER[] columns that were mistakenly created as JSONB
  for (const col of ["linked_voucher_ids", "linked_chittai_ids", "linked_purchase_ids"]) {
    const check = await pool.query(
      `SELECT udt_name FROM information_schema.columns WHERE table_name='purchases' AND column_name=$1`,
      [col],
    );
    if (check.rows[0] && (check.rows[0].udt_name === "jsonb" || check.rows[0].udt_name === "json")) {
      await pool.query(`ALTER TABLE purchases DROP COLUMN ${col}`);
      await pool.query(`ALTER TABLE purchases ADD COLUMN ${col} INTEGER[]`);
    }
  }

  // Drop stray items jsonb column on purchases
  await pool.query(`ALTER TABLE purchases DROP COLUMN IF EXISTS items`);

  // Clean expired upload sessions
  await pool.query(`DELETE FROM upload_sessions WHERE expires_at < NOW()`);
}

async function initDB() {
  console.log("[DB] Initializing old company database...");
  await companyStore.run(1, initDB_internal);
  if (newPool !== oldPool) {
    console.log("[DB] Initializing new company database...");
    await companyStore.run(2, initDB_internal);
  }
  console.log("[DB] Ready");
}

module.exports = { pool, oldPool, newPool, companyStore, initDB, generateResetKey };
