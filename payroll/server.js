// Supabase pooler is IPv4 — force Node to prefer IPv4 DNS resolution
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const { Pool, types } = require('pg');
const cors = require('cors');

// DATE columns (oid 1082) default to JS Date objects, which pg builds from local
// timezone parts — round-tripping through res.json() then shifts the calendar day
// whenever the server's TZ isn't UTC. Keep the raw 'YYYY-MM-DD' string instead.
types.setTypeParser(1082, val => val);

const path  = require('path');
const https = require('https');

// Mounted by the Stocks server at /payroll (see mountPayroll in ../server.js).
// A Router, not an app: the parent owns the port, sessions and auth gate.
const app = express.Router();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

const pool = new Pool({
  // PAYROLL_-prefixed so they can't collide with (or leak into) the other
  // apps' Postgres settings now that everything shares one process.
  host:     process.env.PAYROLL_PGHOST,
  port:     parseInt(process.env.PAYROLL_PGPORT || '5432'),
  database: process.env.PAYROLL_PGDATABASE,
  user:     process.env.PAYROLL_PGUSER,
  password: process.env.PAYROLL_PGPASSWORD,
  ssl:      { rejectUnauthorized: false }
});

// ── DB STARTUP — connect with retries, ensure all tables exist ───────────────
let dbReady = false;
(async function warmup() {
  for (let i = 1; i <= 20; i++) {
    try {
      await pool.query('SELECT 1');
      dbReady = true;

      // Ensure all tables exist (safe — IF NOT EXISTS on every statement)
      await pool.query(`ALTER TABLE advances ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);
      await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS joining_date DATE`);
      await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS leaving_date DATE`);
      await pool.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS allowance_deduction NUMERIC DEFAULT 0`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS summary_marked (
          month        VARCHAR(7) PRIMARY KEY,
          employee_ids TEXT[] NOT NULL DEFAULT '{}'
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pookadai_holidays (
          month VARCHAR(7) PRIMARY KEY,
          days  INTEGER[] NOT NULL DEFAULT '{}'
        )`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_timings (
          id               SERIAL PRIMARY KEY,
          employee_id      VARCHAR NOT NULL,
          date             DATE NOT NULL,
          is_scheduled     BOOLEAN DEFAULT FALSE,
          time_in          TIME,
          lunch_out        TIME,
          lunch_in         TIME,
          time_out         TIME,
          permission_out   TIME,
          permission_in    TIME,
          minus_in_mins    INTEGER DEFAULT 0,
          minus_out_mins   INTEGER DEFAULT 0,
          perm_taken_mins  INTEGER DEFAULT 0,
          mor_late_mins    INTEGER DEFAULT 0,
          lunch_late_mins  INTEGER DEFAULT 0,
          less_time_mins   INTEGER DEFAULT 0,
          minus_time_start TIME,
          minus_time_end   TIME,
          minus_direct_mins INTEGER DEFAULT 0,
          permissions_json JSONB DEFAULT '[]',
          UNIQUE(employee_id, date)
        )`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS permissions (
          id              SERIAL PRIMARY KEY,
          employee_id     VARCHAR NOT NULL,
          month           VARCHAR(7) NOT NULL,
          total_perm_mins INTEGER DEFAULT 0,
          free_perm_mins  INTEGER DEFAULT 180,
          net_perm_mins   INTEGER DEFAULT 0,
          earned_days     NUMERIC(5,2) DEFAULT 0,
          debited_days    NUMERIC(5,2) DEFAULT 0,
          finalized       BOOLEAN DEFAULT FALSE,
          notes           TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(employee_id, month)
        )`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS permission_settings (
          month      VARCHAR(7) PRIMARY KEY,
          sheet_url  TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS additional_incentives (
          id              SERIAL PRIMARY KEY,
          month           VARCHAR(7) NOT NULL,
          incentive_name  VARCHAR NOT NULL,
          employee_id     VARCHAR NOT NULL,
          employee_name   VARCHAR,
          alias_name      VARCHAR,
          account_number  VARCHAR,
          mop             VARCHAR,
          days            NUMERIC(6,2) DEFAULT 0,
          raw_amount      NUMERIC(10,2) DEFAULT 0,
          net_amount      NUMERIC(10,2) DEFAULT 0,
          included        BOOLEAN DEFAULT TRUE,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(month, incentive_name, employee_id)
        )`);

      // Monthly Incentive (/incentive.html): who is eligible, set by the owner
      await pool.query(`
        CREATE TABLE IF NOT EXISTS incentive_eligibility (
          employee_id VARCHAR PRIMARY KEY,
          eligible    BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query(`ALTER TABLE incentive_eligibility ADD COLUMN IF NOT EXISTS role VARCHAR`);
      await pool.query(`ALTER TABLE incentive_eligibility ADD COLUMN IF NOT EXISTS gold BOOLEAN NOT NULL DEFAULT FALSE`);
      await pool.query(`ALTER TABLE incentive_eligibility ADD COLUMN IF NOT EXISTS silver BOOLEAN NOT NULL DEFAULT FALSE`);
      // Mistake headings (owner adds them) and the mistakes recorded per staff/day
      await pool.query(`
        CREATE TABLE IF NOT EXISTS incentive_mistake_types (
          id         SERIAL PRIMARY KEY,
          name       VARCHAR NOT NULL UNIQUE,
          severity   VARCHAR(5) CHECK (severity IN ('MINOR','MAJOR')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      // headings no longer carry Minor/Major — that is chosen per penalty
      await pool.query('ALTER TABLE incentive_mistake_types ALTER COLUMN severity DROP NOT NULL');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS incentive_mistakes (
          id          SERIAL PRIMARY KEY,
          month       VARCHAR(7) NOT NULL,
          employee_id VARCHAR NOT NULL,
          day         INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
          type_id     INTEGER REFERENCES incentive_mistake_types(id),
          type_name   VARCHAR NOT NULL,
          severity    VARCHAR(5) NOT NULL CHECK (severity IN ('MINOR','MAJOR')),
          remark      TEXT,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS incentive_mistakes_month_idx ON incentive_mistakes (month, employee_id)`);
      // Rates / split (set once, owner can change) and the per-day sales weights from the uploaded reports
      await pool.query(`
        CREATE TABLE IF NOT EXISTS incentive_settings (
          key        VARCHAR PRIMARY KEY,
          value      NUMERIC NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pool.query(`
        INSERT INTO incentive_settings (key, value) VALUES
          ('gold_rate', 6.5), ('silver_rate', 1), ('pct_sales_backend', 90), ('pct_supervisor', 10)
        ON CONFLICT (key) DO NOTHING`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS incentive_sales_day (
          sale_date     DATE PRIMARY KEY,
          gold_sale     NUMERIC(12,3),
          silver_sale   NUMERIC(12,3),
          sale_detail   JSONB,
          sale_file     VARCHAR,
          sale_at       TIMESTAMPTZ,
          gold_return   NUMERIC(12,3),
          silver_return NUMERIC(12,3),
          return_detail JSONB,
          return_file   VARCHAR,
          return_at     TIMESTAMPTZ
        )`);

      console.log('Database ready');
      return;
    } catch (_) {
      console.log(`DB connecting... attempt ${i}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  console.log('DB warmup failed — will retry on first request');
})();

// ── SHARED PAYROLL CALCULATION ──────────────────────────────────────────────
const ADVANCE01_NAMES = ['BALAMURUGAN RASU', 'SELVENDRAN RASU', 'DHARMARAJAN'];

// Leave days for the month from an attMap entry; a leaver's unmarked days count as leave
function leaveDaysOfMonth(emp, a) {
  return (parseInt(a.L) || 0) + ((parseInt(a.H) || 0) * 0.5) + (emp._leaving ? (a.U || 0) : 0);
}
// Made INACTIVE starting this month (they worked part of it)
const isLeavingMonth = (emp, month) =>
  (emp.status || '').trim() === 'INACTIVE' && (emp.inactive_from || '').trim() === month;

function calcPayrollRow(emp, attMap, advMap, allowedLeave, daysInMonth, permMap, leaveAffectsPfEsic) {
  if (emp.type === 'OTHERS') {
    const mop    = (emp.mop || '').trim().toUpperCase();
    const gross  = parseFloat(emp.gross_pay) || 0;
    const pf_ee  = emp.pf_enable  ? (parseFloat(emp.ee)                       || 0) : 0;
    const esic_ip= emp.esic_enable? (parseFloat(emp.total_ip_contribution)     || 0) : 0;
    const labour = emp.pf_enable  ? 20 : 0;
    const advance= advMap[emp.employee_id] || 0;
    const net    = gross - pf_ee - esic_ip - labour - advance;
    return {
      employee_id: emp.employee_id, employee_name: emp.employee_name,
      alias_name: emp.alias_name || null, type: emp.type, gender: emp.gender, mop,
      gross_pay: gross,
      absent_days: 0, lop: 0, pf_ee, esic_ip, labour_act: labour,
      advance01: 0, advance, rnd: 0, net_salary: net, allowance: 0, allowance_deduction: 0
    };
  }

  const mop = (emp.mop || '').trim().toUpperCase();
  const a = attMap[emp.employee_id] || { P: 0, L: 0, H: 0, U: 0 };
  // Leaving month: days not marked (after they left) are unpaid, and the free leave doesn't apply
  if (emp._leaving) allowedLeave = 0;
  const absent = leaveDaysOfMonth(emp, a);
  const gross = parseFloat(emp.gross_pay) || 0;
  let pf_ee = emp.pf_enable ? (parseFloat(emp.ee) || 0) : 0;
  let esic_ip = emp.esic_enable ? (parseFloat(emp.total_ip_contribution) || 0) : 0;
  const labour = emp.pf_enable ? 20 : 0;
  const advance = advMap[emp.employee_id] || 0;
  const advance01 = ADVANCE01_NAMES.includes(emp.employee_name.toUpperCase()) ? 3000 : 0;

  const permDeductDays = (permMap && permMap[String(emp.employee_id)]) ? 1 : 0;

  let deductedDays = absent > allowedLeave ? absent - allowedLeave : 0;
  deductedDays += permDeductDays;
  const lop = deductedDays > 0 ? Math.round((gross / daysInMonth) * deductedDays) : 0;

  // Optional: PF & ESIC are recalculated on the payable gross (gross − LOP) instead of
  // the fixed stored contribution, since statutory dues are based on wages actually payable.
  if (leaveAffectsPfEsic && deductedDays > 0) {
    const payableGross = gross - lop;
    if (emp.pf_enable) {
      const basic = payableGross * 0.70;
      pf_ee = Math.round(basic * 0.12);
    }
    if (emp.esic_enable) {
      esic_ip = Math.ceil(payableGross * 0.0075);
    }
  }

  const fullAllowance = emp.allowance ? parseFloat(emp.allowance) : 0;
  const allowance_deduction = fullAllowance > 0 ? Math.round((fullAllowance / daysInMonth) * deductedDays) : 0;
  const rawAllowance = fullAllowance > 0
    ? Math.ceil((fullAllowance - allowance_deduction) / 10) * 10
    : 0;

  // If employee has allowance, advance01 is deducted from allowance, not from net
  const advance01Net = rawAllowance > 0 ? 0 : advance01;
  const allowance    = rawAllowance > 0 ? Math.max(0, rawAllowance - advance01) : 0;

  let net = gross - lop - pf_ee - esic_ip - labour - advance01Net - advance;
  const netRaw = net;
  net = (mop === 'CUB' || mop === 'BANK') ? Math.round(net) : Math.ceil(net / 10) * 10;
  const rnd = Math.round(net - netRaw);

  return {
    employee_id: emp.employee_id, employee_name: emp.employee_name,
    alias_name: emp.alias_name || null, type: emp.type, gender: emp.gender, mop,
    gross_pay: gross, absent_days: deductedDays, lop, pf_ee, esic_ip,
    labour_act: labour, advance01, advance, rnd, net_salary: net, allowance, allowance_deduction
  };
}

// ── POOKADAI (flower shop) ──────────────────────────────────────────────────
// Not a real employee: the monthly bill for daily pooja flowers. Rs.290 every
// day the shop is open, plus Rs.180 extra on Tuesdays & Fridays. Shop holidays
// (picked when generating payroll, saved with it) drop that day's amount(s).
const POOKADAI_NAME      = 'POOKADAI';
const POOKADAI_DAILY     = 290;
const POOKADAI_TUE_FRI   = 180;
const isPookadai = r => [r.alias_name, r.employee_name]
  .some(n => (n || '').toUpperCase().trim() === POOKADAI_NAME);

function calcPookadai(month, holidays) {
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const off = new Set((holidays || []).map(Number));
  let days = 0, extraDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (off.has(d)) continue;
    days++;
    const dow = new Date(yr, mo - 1, d).getDay();
    if (dow === 2 || dow === 5) extraDays++;
  }
  return { days, extraDays, amount: days * POOKADAI_DAILY + extraDays * POOKADAI_TUE_FRI };
}

async function getPookadaiHolidays(month) {
  const r = await pool.query(`SELECT days FROM pookadai_holidays WHERE month=$1`, [month]);
  return r.rows[0] ? r.rows[0].days : [];
}

// Replace the POOKADAI row's gross with the flower amount, keeping any other
// deductions (advance etc.) the row already had.
function applyPookadai(rows, month, holidays) {
  const { amount } = calcPookadai(month, holidays);
  rows.forEach(r => {
    if (!isPookadai(r)) return;
    const otherDeductions = (parseFloat(r.gross_pay) || 0) - (parseFloat(r.net_salary) || 0);
    r.gross_pay  = amount;
    r.net_salary = amount - otherDeductions;
  });
  return rows;
}

// Last calendar day of `month` ('YYYY-MM') as a 'YYYY-MM-DD' string — used to
// exclude employees who joined after the month being viewed/generated.
function monthEndDate(month) {
  const [yr, mo] = month.split('-').map(Number);
  const days = new Date(yr, mo, 0).getDate();
  return `${month}-${String(days).padStart(2, '0')}`;
}

async function fetchPayrollInputs(month) {
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();

  // Fetch permission sheet URL from DB for this month (non-fatal if missing)
  let permCsv = null;
  try {
    const csvUrl = await getPermSheetUrl(month);
    if (csvUrl) {
      permCsv = await Promise.race([
        httpsGetFollow(csvUrl),
        new Promise(resolve => setTimeout(() => resolve(null), 5000))
      ]);
    }
  } catch (_) { /* sheet unavailable — skip permission deduction */ }

  const [emps, att, advs, dbPerms] = await Promise.all([
    // Includes those who left this month (inactive_from = month); kept below only if they worked part of it
    pool.query(
      `SELECT * FROM employees
       WHERE (status = 'ACTIVE' OR (TRIM(status) = 'INACTIVE' AND inactive_from >= $1))
         AND (joining_date IS NULL OR joining_date <= $2)`,
      [month, monthEndDate(month)]
    ),
    pool.query(`SELECT * FROM attendance WHERE year=$1 AND month=$2`, [yr, mo]),
    pool.query(
      `SELECT employee_id, SUM(amount) as total FROM advances WHERE month=$1 GROUP BY employee_id`,
      [month]
    ),
    pool.query(`SELECT employee_id, debited_days FROM permissions WHERE month=$1`, [month])
  ]);

  const attMap = {};
  att.rows.forEach(row => {
    let P = 0, L = 0, H = 0, U = 0;
    for (let d = 1; d <= 31; d++) {
      const val = row[`day_${d}`];
      if (!val) { if (d <= daysInMonth) U++; continue; }
      if (val === 'P') P++;
      else if (val[0] === 'L') L++;
      else if (val[0] === 'H') H++;
    }
    attMap[row.employee_id] = { P, L, H, U };
  });

  // Leavers: only paid in their leaving month if attendance was marked (and never cost-centre OTHERS rows)
  const empRows = emps.rows.filter(e => {
    if (!isLeavingMonth(e, month)) return true;
    const a = attMap[e.employee_id];
    if (e.type === 'OTHERS' || !a || !(a.P + a.L + a.H)) return false;
    e._leaving = true;
    return true;
  });

  const advMap = {};
  advs.rows.forEach(a => { advMap[a.employee_id] = parseFloat(a.total) || 0; });

  // permMap: empId → true if employee gets 1 day deducted
  // Priority: DB declared data → Google Sheet fallback
  const permMap = {};
  if (dbPerms.rows.length > 0) {
    dbPerms.rows.forEach(r => {
      if (parseFloat(r.debited_days) >= 1) permMap[String(r.employee_id)] = true;
    });
  } else if (permCsv) {
    try {
      permCsv.trim().split('\n').slice(1)
        .map(line => parseCSVRow(line))
        .filter(c => c[0] && c[0].trim())
        .forEach(c => {
          const empId     = c[0].trim();
          const totalPerm = parseMins(c[2]) - 180;
          if (totalPerm >= PERM_DEDUCT_MINS) permMap[empId] = true;
        });
    } catch (_) {}
  }

  return { emps: empRows, attMap, advMap, daysInMonth, permMap };
}

// ── ADD EMPLOYEE ─────────────────────────────────────────────────────────────
app.post('/api/employees', async (req, res) => {
  const data = req.body;
  const sql = `INSERT INTO employees
    (type, employee_id, employee_name, account_number, gender, designation, mop, gross_pay,
     pf_enable, esic_enable, gross_g, epf, eps, edli, g12_percent, ee, edli_8_33_percent,
     eps_value, g3_67_percent, er, total_ip_contribution, total_employer_contribution,
     labour_act, allowance, salary_after_deduction, alias_name, joining_date, leaving_date)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`;

  const values = [
    data.type, data.employee_id, data.employee_name, data.account_number,
    data.gender, data.designation, data.mop, data.gross_pay,
    data.pf_enable ? true : false, data.esic_enable ? true : false,
    data.basic, data.epf, data.eps, data.edli,
    data.ee, data.ee, data.eps_value, data.eps_value,
    data.er, data.er,
    data.total_ip_contribution, data.total_employer_contribution,
    data.labour_act || null, data.allowance, data.salary_after_deduction,
    data.alias_name || null, data.joining_date || null, data.leaving_date || null
  ];

  try {
    await pool.query(sql, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET ALL EMPLOYEES ─────────────────────────────────────────────────────────
app.get('/api/employees', async (req, res) => {
  const { active, month } = req.query;
  let sql, params = [];
  if (active && month) {
    // Month-aware: an employee disabled starting a later month should still show
    // up when viewing an earlier month they were active in (e.g. Attendance),
    // but one who joined after this month should not show at all.
    // Most employees have no joining_date, so for them the first month with any
    // marked attendance or a saved payroll stands in as their start month. One with
    // no records at all only shows for the current month onward (new joiner).
    const dayCols = Array.from({ length: 31 }, (_, i) => `day_${i + 1}`).join(', ');
    sql = `SELECT e.* FROM employees e
           LEFT JOIN (
             SELECT eid, MIN(m) AS first_month FROM (
               SELECT employee_id::text AS eid, year::text || '-' || LPAD(month::text, 2, '0') AS m
                 FROM attendance WHERE COALESCE(${dayCols}) IS NOT NULL
               UNION ALL
               SELECT employee_id::text, month FROM payroll
             ) x GROUP BY eid
           ) f ON f.eid = e.employee_id::text
           LEFT JOIN (
             SELECT DISTINCT employee_id::text AS eid FROM attendance
             WHERE year::text || '-' || LPAD(month::text, 2, '0') = $1 AND COALESCE(${dayCols}) IS NOT NULL
           ) cur ON cur.eid = e.employee_id::text
           -- inactive_from is the month they left: still listed that month only if
           -- they worked part of it (attendance marked), otherwise hidden.
           WHERE (TRIM(e.status) = 'ACTIVE'
                  OR (TRIM(e.status) = 'INACTIVE' AND (
                        e.inactive_from > $1
                        OR (e.inactive_from = $1 AND cur.eid IS NOT NULL)
                     )))
             AND (
               e.joining_date <= $2
               OR (e.joining_date IS NULL AND (
                     f.first_month <= $1
                     OR (f.first_month IS NULL AND $1 >= to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM'))
                  ))
             )`;
    params = [month, monthEndDate(month)];
  } else if (active) {
    sql = `SELECT * FROM employees WHERE TRIM(status) = 'ACTIVE'`;
  } else {
    sql = 'SELECT * FROM employees';
  }
  try {
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET SINGLE EMPLOYEE ───────────────────────────────────────────────────────
app.get('/api/employees/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM employees WHERE employee_id = $1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE EMPLOYEE STATUS ────────────────────────────────────────────────────
app.put('/api/employees/status/:id', async (req, res) => {
  const { status, month } = req.body;
  const field = status === 'INACTIVE' ? 'inactive_from' : 'active_from';
  const sql = `UPDATE employees SET status=$1, ${field}=$2 WHERE employee_id=$3`;
  try {
    await pool.query(sql, [status, month, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE EMPLOYEE ───────────────────────────────────────────────────────────
app.put('/api/employees/:id', async (req, res) => {
  const data = req.body;
  const sql = `UPDATE employees SET status=$1, type=$2, employee_name=$3, account_number=$4, gender=$5,
    designation=$6, mop=$7, gross_pay=$8, pf_enable=$9, esic_enable=$10, gross_g=$11, epf=$12, eps=$13,
    edli=$14, g12_percent=$15, ee=$16, edli_8_33_percent=$17, eps_value=$18, g3_67_percent=$19, er=$20,
    total_ip_contribution=$21, total_employer_contribution=$22, labour_act=$23, allowance=$24,
    salary_after_deduction=$25, alias_name=$26, joining_date=$27, leaving_date=$28 WHERE employee_id=$29`;

  const values = [
    data.status, data.type, data.employee_name, data.account_number, data.gender,
    data.designation, data.mop, data.gross_pay,
    data.pf_enable ? true : false, data.esic_enable ? true : false,
    data.basic, data.epf, data.eps, data.edli,
    data.ee, data.ee, data.eps_value, data.eps_value,
    data.er, data.er,
    data.total_ip_contribution, data.total_employer_contribution,
    data.labour_act || null, data.allowance, data.salary_after_deduction,
    data.alias_name || null, data.joining_date || null, data.leaving_date || null, req.params.id
  ];

  try {
    await pool.query(sql, values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE EMPLOYEE ───────────────────────────────────────────────────────────
app.delete('/api/employees/:id', async (req, res) => {
  const id = req.params.id;
  try {
    await Promise.all([
      pool.query('DELETE FROM attendance WHERE employee_id = $1', [id]),
      pool.query('DELETE FROM advances WHERE employee_id = $1', [id]),
      pool.query('DELETE FROM payroll WHERE employee_id = $1', [id])
    ]);
    await pool.query('DELETE FROM employees WHERE employee_id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SAVE DAILY ATTENDANCE ─────────────────────────────────────────────────────
app.post('/api/attendance/daily', async (req, res) => {
  const { rows } = req.body;
  if (!rows || rows.length === 0) return res.json({ success: true });

  // Group by (employee_id, year, month) — one upsert per employee row
  const groups = new Map();
  for (const r of rows) {
    const day = parseInt(r.day);
    if (day < 1 || day > 31) continue;
    const [yr, mo] = String(r.month).split('-').map(Number);
    const key = `${r.employee_id}|${yr}|${mo}`;
    if (!groups.has(key)) groups.set(key, { employee_id: r.employee_id, year: yr, month: mo, days: {} });
    // Half-day codes carry a 3rd char for AM/PM (e.g. 'HRA', 'HUP'); full-day/present codes stay 2/1 chars.
    // 'CLEAR' (Bulk Clear) wipes the day back to unmarked.
    const code = r.status === 'CLEAR'
      ? null
      : r.status === 'P'
      ? 'P'
      : r.status === 'H'
        ? 'H' + (r.remark === 'Reserved' ? 'R' : 'U') + (r.period === 'PM' ? 'P' : 'A')
        : r.status + (r.remark === 'Reserved' ? 'R' : 'U');
    groups.get(key).days[day] = code;
  }

  const client = await pool.connect();
  try {
    // Hard guard: never record attendance for an employee in or after their
    // inactive_from month, whatever the page sends. Clearing (null) is still allowed.
    const ids = [...new Set([...groups.values()].map(g => String(g.employee_id)))];
    const inact = await client.query(
      `SELECT employee_id::text AS eid, inactive_from FROM employees
       WHERE employee_id::text = ANY($1) AND TRIM(status) = 'INACTIVE' AND inactive_from IS NOT NULL`,
      [ids]
    );
    const inactiveFrom = new Map(inact.rows.map(r => [r.eid, r.inactive_from]));
    let blocked = 0;
    for (const [key, g] of groups) {
      const from = inactiveFrom.get(String(g.employee_id));
      if (!from || `${g.year}-${String(g.month).padStart(2, '0')}` < from) continue;
      for (const d of Object.keys(g.days)) {
        if (g.days[d] !== null) { delete g.days[d]; blocked++; }
      }
      if (Object.keys(g.days).length === 0) groups.delete(key);
    }

    await client.query('BEGIN');
    for (const g of groups.values()) {
      const dayNums = Object.keys(g.days);
      const dayCols = dayNums.map(d => `day_${d}`);
      const vals    = [g.employee_id, g.year, g.month, ...dayNums.map(d => g.days[d])];
      const phs     = vals.map((_, i) => `$${i + 1}`).join(', ');
      const upd     = dayCols.map(col => `${col}=EXCLUDED.${col}`).join(', ');
      await client.query(
        `INSERT INTO attendance (employee_id, year, month, ${dayCols.join(', ')})
         VALUES (${phs})
         ON CONFLICT (employee_id, year, month) DO UPDATE SET ${upd}`,
        vals
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, blocked });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── GET DAILY ATTENDANCE ──────────────────────────────────────────────────────
app.get('/api/attendance/daily', async (req, res) => {
  const { month } = req.query;
  const [yr, mo] = month.split('-').map(Number);
  try {
    const result = await pool.query(
      'SELECT * FROM attendance WHERE year=$1 AND month=$2', [yr, mo]
    );
    // Unpivot wide row → one entry per recorded day (keeps frontend unchanged)
    const rows = [];
    for (const att of result.rows) {
      for (let d = 1; d <= 31; d++) {
        const val = att[`day_${d}`];
        if (!val) continue;
        let status = 'P', remark = '', period = '';
        if      (val === 'LR') { status = 'L'; remark = 'Reserved';   }
        else if (val === 'LU') { status = 'L'; remark = 'Unreserved'; }
        else if (val.startsWith('HR')) { status = 'H'; remark = 'Reserved';   period = val[2] === 'P' ? 'PM' : 'AM'; }
        else if (val.startsWith('HU')) { status = 'H'; remark = 'Unreserved'; period = val[2] === 'P' ? 'PM' : 'AM'; }
        rows.push({ employee_id: att.employee_id, day: d, status, remark, period });
      }
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE ATTENDANCE DAY ─────────────────────────────────────────────────────
app.delete('/api/attendance/daily', async (req, res) => {
  const { month, day } = req.query;
  const dayNum = parseInt(day);
  if (dayNum < 1 || dayNum > 31) return res.status(400).json({ error: 'Invalid day' });
  const [yr, mo] = month.split('-').map(Number);
  try {
    await pool.query(
      `UPDATE attendance SET day_${dayNum}=NULL WHERE year=$1 AND month=$2`, [yr, mo]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADD ADVANCE ───────────────────────────────────────────────────────────────
app.post('/api/advances', async (req, res) => {
  const data = req.body;
  const sql = `INSERT INTO advances (employee_id, month, amount, mop, reason, date, submitted_at)
               VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING id`;
  try {
    const result = await pool.query(sql, [data.employee_id, data.month, data.amount, data.mop, data.reason, data.date]);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BULK ADVANCES ─────────────────────────────────────────────────────────────
// All rows in one call share the exact same NOW() — PostgreSQL holds it constant
// within a single statement, so the whole batch gets one submitted_at timestamp.
app.post('/api/advances/bulk', async (req, res) => {
  const { rows } = req.body;
  if (!rows || rows.length === 0) return res.json({ success: true });

  const cols = 6;
  const placeholders = rows.map((_, i) =>
    `($${i * cols + 1}, $${i * cols + 2}, $${i * cols + 3}, $${i * cols + 4}, $${i * cols + 5}, $${i * cols + 6}, NOW())`
  ).join(', ');
  const flatValues = rows.flatMap(r => [r.employee_id, r.month, r.amount, r.mop, r.reason, r.date]);
  const sql = `INSERT INTO advances (employee_id, month, amount, mop, reason, date, submitted_at) VALUES ${placeholders}`;

  try {
    await pool.query(sql, flatValues);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LAST SUBMITTED BATCH ──────────────────────────────────────────────────────
// Returns every row from the most recent save (all share the same submitted_at).
app.get('/api/advances/last-batch', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM advances
      WHERE submitted_at = (
        SELECT MAX(submitted_at) FROM advances WHERE submitted_at IS NOT NULL
      )
      ORDER BY id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET ADVANCES (optional month / date / sort filters) ──────────────────────
app.get('/api/advances', async (req, res) => {
  const { month, date, sort } = req.query;
  const conditions = [];
  const params     = [];
  if (month) { params.push(month); conditions.push(`month=$${params.length}`); }
  if (date)  { params.push(date);  conditions.push(`date::date=$${params.length}`); }
  const where   = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const orderBy = sort === 'latest' ? 'ORDER BY id DESC' : 'ORDER BY date, id';
  try {
    const result = await pool.query(`SELECT * FROM advances ${where} ${orderBy}`, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE ADVANCE BY ID ──────────────────────────────────────────────────────
app.delete('/api/advances/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM advances WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET AVAILABLE ADVANCE ─────────────────────────────────────────────────────
const PERM_DEDUCT_MINS = 960; // 16:00 = 1 day

app.get('/api/advances/available', async (req, res) => {
  const month = req.query.month;
  try {
    const [yr, mo] = month.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();

    // Fetch permission sheet URL from DB for this month (non-fatal if missing)
    let permCsv = null;
    try {
      const csvUrl = await getPermSheetUrl(month);
      if (csvUrl) {
        permCsv = await Promise.race([
          httpsGetFollow(csvUrl),
          new Promise(resolve => setTimeout(() => resolve(null), 5000))
        ]);
      }
    } catch (_) { /* sheet unavailable — skip permission deduction */ }

    // Fetch DB data in parallel
    const [empsRes, attRes, advsRes] = await Promise.all([
      pool.query(
        `SELECT employee_id, employee_name, alias_name, salary_after_deduction, type FROM employees
         WHERE (status = 'ACTIVE' OR (status = 'INACTIVE' AND inactive_from > $1))
           AND (joining_date IS NULL OR joining_date <= $2)
           AND (type != 'OTHERS' OR employee_name = 'BATHROOM MUNIYANDI')`,
        [month, monthEndDate(month)]
      ),
      pool.query(`SELECT * FROM attendance WHERE year=$1 AND month=$2`, [yr, mo]),
      pool.query(
        `SELECT employee_id, SUM(amount) as total_advance FROM advances WHERE month=$1 GROUP BY employee_id`,
        [month]
      )
    ]);

    // Build permission map: employee_id → TOTAL column minutes (c[2])
    const permMap = {};
    if (permCsv) {
      try {
        const lines = permCsv.trim().split('\n');
        lines.slice(1)
          .map(line => parseCSVRow(line))
          .filter(c => c[0] && c[0].trim())
          .forEach(c => {
            const empId  = c[0].trim();
            const totalM = parseMins(c[2]);  // TOTAL column
            if (totalM >= PERM_DEDUCT_MINS) permMap[empId] = totalM;
          });
      } catch (_) { /* sheet parse error — skip deduction */ }
    }

    const attMap = {};
    attRes.rows.forEach(row => {
      let present_days = 0, half_days = 0;
      for (let d = 1; d <= 31; d++) {
        const val = row[`day_${d}`];
        if (val === 'P') present_days++;
        else if (val && val[0] === 'H') half_days++;
      }
      attMap[row.employee_id] = { present_days, half_days };
    });
    const advMap = {};
    advsRes.rows.forEach(a => { advMap[a.employee_id] = parseFloat(a.total_advance); });

    const result = empsRes.rows.map(emp => {
      const netSalary = parseFloat(emp.salary_after_deduction) || 0;  // net (after PF/ESIC/Labour)
      let earned, permDeductDays = 0, permDeductSalary = 0, workingDays = null;

      if ((emp.type || '').toUpperCase() === 'OTHERS') {
        earned = netSalary;
      } else {
        const a = attMap[emp.employee_id] || { present_days: 0, half_days: 0 };
        const present = parseInt(a.present_days) || 0;
        const half    = parseInt(a.half_days)    || 0;

        // If this month's permission >= 16:00 → deduct exactly 1 working day
        const thisMonthPermMins = permMap[String(emp.employee_id)] || 0;
        permDeductDays = thisMonthPermMins >= PERM_DEDUCT_MINS ? 1 : 0;
        permDeductSalary = permDeductDays * (netSalary / daysInMonth);

        workingDays = Math.max(0, (present + half / 2) - permDeductDays);
        earned = Math.round((netSalary / daysInMonth) * workingDays);
      }

      const totalAdv = parseFloat(advMap[emp.employee_id] || 0);
      return {
        employee_id:        emp.employee_id,
        employee_name:      emp.employee_name,
        alias_name:         emp.alias_name || null,
        working_days:       workingDays,
        earned_salary:      earned.toFixed(2),
        perm_deduct_days:   permDeductDays,
        perm_deduct_salary: permDeductSalary.toFixed(2),
        total_advance:      totalAdv.toFixed(2),
        available_advance:  (earned - totalAdv).toFixed(2)
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GENERATE PAYROLL ──────────────────────────────────────────────────────────
app.get('/api/payroll/generate', async (req, res) => {
  const { month } = req.query;
  const leaveAffectsPfEsic = req.query.leaveAffectsPfEsic === 'true';
  try {
    const { emps, attMap, advMap, daysInMonth, permMap } = await fetchPayrollInputs(month);
    const result = emps.map(emp => calcPayrollRow(emp, attMap, advMap, 4, daysInMonth, permMap, leaveAffectsPfEsic));
    const holidays = req.query.pookadaiHolidays !== undefined
      ? String(req.query.pookadaiHolidays).split(',').filter(Boolean).map(Number)
      : await getPookadaiHolidays(month);
    res.json(applyPookadai(result, month, holidays));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GENERATE CUSTOM PAYROLL ───────────────────────────────────────────────────
app.post('/api/payroll/generate-custom', async (req, res) => {
  const { month, overrides, leaveAffectsPfEsic, pookadaiHolidays } = req.body;
  try {
    const { emps, attMap, advMap, daysInMonth, permMap } = await fetchPayrollInputs(month);
    const result = emps.map(emp => {
      const allowedLeave = parseFloat(overrides[emp.employee_id] ?? 4);
      return calcPayrollRow(emp, attMap, advMap, allowedLeave, daysInMonth, permMap, !!leaveAffectsPfEsic);
    });
    const holidays = Array.isArray(pookadaiHolidays) ? pookadaiHolidays : await getPookadaiHolidays(month);
    res.json(applyPookadai(result, month, holidays));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STATUTORY SALARY REPORT (PF/ESIC filing-style report, per month) ─────────
app.get('/api/salary-report', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    const { emps, attMap, permMap, daysInMonth } = await fetchPayrollInputs(month);

    const advRes = await pool.query(
      `SELECT employee_id, UPPER(TRIM(mop)) AS mop, SUM(amount) AS amt
       FROM advances WHERE month=$1 GROUP BY employee_id, UPPER(TRIM(mop))`,
      [month]
    );
    const advByMop = {};
    advRes.rows.forEach(r => {
      const bucket = advByMop[r.employee_id] || (advByMop[r.employee_id] = { BANK: 0, CASH: 0 });
      const key = (r.mop === 'CUB' || r.mop === 'BANK') ? 'BANK' : 'CASH';
      bucket[key] += parseFloat(r.amt) || 0;
    });

    let permIncMap = {};
    try {
      const { incentiveList } = await computePermissionIncentive(month);
      incentiveList.forEach(r => { permIncMap[String(r.employee_id)] = r.incentiveAmt; });
    } catch (_) { /* no permission sheet configured for this month — skip */ }

    let leaveIncMap = {};
    try {
      const leaveList = await computeLeaveIncentiveList(month);
      leaveList.forEach(r => { leaveIncMap[String(r.employee_id)] = r.incentiveAmt; });
    } catch (_) { /* skip */ }

    // The saved payroll (Payroll History) is the source of truth once generated:
    // it carries Custom-payroll free-leave overrides (e.g. 0 free days instead of 4)
    // and the cash rounding to ₹10, neither of which can be recomputed here.
    const savedRows = await fetchPayrollHistory(month);
    const savedMap = {};
    savedRows.forEach(r => { savedMap[String(r.employee_id)] = r; });
    const num = v => parseFloat(v) || 0;
    const r2  = v => Math.round(v * 100) / 100;

    const permanentStaff = [];
    const temporaryStaff = [];
    const esicList = [];

    emps.forEach(emp => {
      const saved       = savedMap[String(emp.employee_id)];
      // Once the month's payroll is saved, the report covers exactly those employees.
      if (savedRows.length && !saved) return;
      // The month's own gross (as saved), not today's — salaries change over time.
      const gross       = saved ? num(saved.gross) : num(emp.gross_pay);
      const grossChanged = gross !== num(emp.gross_pay);
      const adv         = advByMop[emp.employee_id] || { BANK: 0, CASH: 0 };
      const incPerm     = permIncMap[String(emp.employee_id)]  || 0;
      const incLeave    = leaveIncMap[String(emp.employee_id)] || 0;
      const displayName = emp.employee_name || emp.alias_name; // official name on the statutory report

      // Permanent/Temporary is decided by pf_enable, not `type` — some pf_enable
      // employees are internally tagged type='OTHERS' (e.g. RAMAPRIYADEVI), while
      // true cash-only workers and cost-centers (AACHI, CHURCH, ...) have pf_enable=false.
      // For a saved month, use whether PF/Labour Act was actually deducted that month.
      const onPf = saved ? (num(saved.pf_ee) > 0 || num(saved.labour_act) > 0) : !!emp.pf_enable;
      if (!onPf) {
        const a = attMap[emp.employee_id] || { P: 0, L: 0, H: 0 };
        const absent        = leaveDaysOfMonth(emp, a);
        const deductedDays  = Math.max(0, absent - (emp._leaving ? 0 : 4));
        const leaveDeduction = deductedDays > 0 ? Math.round((gross / daysInMonth) * deductedDays) : 0;
        // Adv 01 (flat ₹3000, always cash) applies here too — e.g. DHARMARAJAN is a
        // cash-only worker (pf_enable=false) but is still one of the named Adv 01 employees.
        const advance01      = ADVANCE01_NAMES.includes((emp.employee_name || '').toUpperCase()) ? 3000 : 0;
        const tempLeaveDed   = saved ? num(saved.lop) : leaveDeduction;
        const salary         = gross - tempLeaveDed;
        const salaryPaid     = saved ? num(saved.net_salary) : salary - adv.BANK - adv.CASH - advance01;
        temporaryStaff.push({
          employee_id: emp.employee_id, name: displayName, employee_name: emp.employee_name,
          mop: (emp.mop || '').trim().toUpperCase(),
          gross_pay: gross, leave_deduction: tempLeaveDed, salary,
          advance: saved ? num(saved.advance) + num(saved.advance01) : adv.BANK + adv.CASH + advance01,
          salary_paid: salaryPaid, incentive1: incPerm, incentive2: incLeave
        });
        return;
      }

      const row            = calcPayrollRow(emp, attMap, {}, 4, daysInMonth, permMap, false);
      if (saved && num(saved.allowance) > 0) {
        row.allowance           = num(saved.allowance);
        row.allowance_deduction = num(saved.allowance_deduction);
      }
      const leaveDeduction  = saved ? num(saved.lop) : row.lop;

      // Statutory columns: the employee's stored PF/ESIC figures, unless the saved
      // payroll was generated with "leave affects PF/ESIC" — then PF/ESIC were
      // recalculated on payable gross (gross − LOP), and the wage/employer columns
      // are re-derived with the same formulas as the Employee page.
      const pf = {
        gross_g: num(emp.gross_g), epf: num(emp.epf), eps: num(emp.eps), edli: num(emp.edli),
        g12_percent: num(emp.g12_percent), ee: num(emp.ee),
        edli_8_33_percent: num(emp.edli_8_33_percent), eps_value: num(emp.eps_value),
        g3_67_percent: num(emp.g3_67_percent), er: num(emp.er)
      };
      let esiIp  = emp.esic_enable ? num(emp.total_ip_contribution) : 0;
      let esiEr  = num(emp.total_employer_contribution);
      let labour = num(emp.labour_act);
      let sad    = num(emp.salary_after_deduction);
      if (saved) {
        const payable = gross - leaveDeduction;
        // PF/ESIC were recalculated on payable gross if the saved figure isn't the full-gross one
        const pfOnPayable  = num(saved.pf_ee)   !== Math.round(gross * 0.70 * 0.12) && leaveDeduction > 0;
        const esiOnPayable = num(saved.esic_ip) !== Math.ceil(gross * 0.0075)       && leaveDeduction > 0;
        if (num(saved.pf_ee) > 0 && (pfOnPayable || grossChanged || num(saved.pf_ee) !== pf.ee)) {
          const wage  = (pfOnPayable ? payable : gross) * 0.70;
          const edli  = wage > 15000 ? 15000 : wage;
          const ee    = num(saved.pf_ee);
          const epsV  = Math.round(edli * 0.0833);
          const er    = edli * 0.0833 > 1250
            ? Math.round(wage * 0.0367)
            : Math.round(wage * 0.0367 + wage * 0.0833 - epsV);
          Object.assign(pf, {
            gross_g: r2(wage), epf: r2(wage), eps: r2(wage), edli: r2(edli),
            g12_percent: ee, ee, edli_8_33_percent: epsV, eps_value: epsV, g3_67_percent: er, er
          });
        }
        if (num(saved.esic_ip) !== esiIp || grossChanged) {
          esiEr = Math.round((esiOnPayable ? payable : gross) * 0.0325);
        }
        esiIp  = num(saved.esic_ip);
        labour = num(saved.labour_act);
        sad    = gross - pf.ee - esiIp - labour;
      }

      // Adv 01 (flat ₹3000 for BALAMURUGAN RASU / SELVENDRAN RASU / DHARMARAJAN) is always
      // settled in cash. If the employee has an allowance, calcPayrollRow already deducts it
      // from their cash allowance (reflected in the ALLOWANCE row below) — don't double-count
      // it here. Otherwise it comes straight off their cash-in-hand, not the bank transfer.
      const hasAllowance   = (parseFloat(emp.allowance) || 0) > 0;
      const advance01Cash  = (!hasAllowance && row.advance01 > 0) ? row.advance01 : 0;
      const advanceCashTotal = adv.CASH + advance01Cash;
      // Saved net salary is Payroll History's Net Salary (already net of all
      // advances and rounded); otherwise derive By Bank from SAD.
      const paidSalary     = sad - leaveDeduction;
      const byBank         = saved ? num(saved.net_salary) : paidSalary - adv.BANK - advanceCashTotal;

      // basic/hra are never persisted as their own columns — gross_g IS the basic/PF-wage
      // value (set at employee-creation time as gross*0.70), so HRA is simply the remainder.
      const basic = grossChanged ? r2(gross * 0.70) : num(emp.gross_g);
      const hra   = gross - basic;

      permanentStaff.push({
        employee_id: emp.employee_id, name: displayName, employee_name: emp.employee_name,
        mop: (emp.mop || '').trim().toUpperCase(),
        gross_pay: gross,
        basic, hra,
        ...pf,
        esi: esiIp,
        labour_act: labour,
        salary_after_deduction: sad, leave_deduction: leaveDeduction, paid_salary: paidSalary,
        by_bank: byBank, advance_bank: adv.BANK, advance_cash: advanceCashTotal,
        incentive1: incPerm, incentive2: incLeave
      });

      if (saved ? esiIp > 0 : emp.esic_enable) {
        esicList.push({
          employee_id: emp.employee_id, name: displayName, employee_name: emp.employee_name,
          gross_pay: gross,
          ip_contribution: esiIp,
          employer_contribution: esiEr
        });
      }

      // Cash allowance payout — paid separately from the bank salary above, when present
      if (row.allowance > 0) {
        const fullAllowance = parseFloat(emp.allowance) || 0;
        temporaryStaff.push({
          employee_id: emp.employee_id, name: displayName + ' (ALLOWANCE)', employee_name: emp.employee_name,
          mop: 'CASH',
          gross_pay: fullAllowance, leave_deduction: row.allowance_deduction || 0,
          salary: fullAllowance - (row.allowance_deduction || 0),
          // Adv 01 comes off the allowance (not the bank salary) for allowance holders
          advance: saved ? num(saved.advance01) : row.advance01,
          salary_paid: row.allowance, incentive1: 0, incentive2: 0
        });
      }
    });

    const sum = (arr, key) => arr.reduce((s, r) => s + (parseFloat(r[key]) || 0), 0);
    const account1  = sum(permanentStaff, 'ee') + sum(permanentStaff, 'er');
    const account10 = sum(permanentStaff, 'eps_value');
    const ipTotal   = sum(esicList, 'ip_contribution');
    const erTotal   = sum(esicList, 'employer_contribution');

    res.json({
      month, permanentStaff, esicList, temporaryStaff,
      summary: {
        account1, account10, epf_total: account1 + account10,
        ip_total: ipTotal, er_total: erTotal, total_contribution: ipTotal + erTotal
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SAVE PAYROLL ──────────────────────────────────────────────────────────────
app.post('/api/payroll/save', async (req, res) => {
  const { month, rows } = req.body;
  if (!rows || rows.length === 0) return res.json({ success: true });

  const cols = 14;
  const placeholders = rows.map((_, i) =>
    '(' + Array.from({ length: cols }, (__, j) => `$${i * cols + j + 1}`).join(', ') + ')'
  ).join(', ');
  const flatValues = rows.flatMap(r => [
    r.employee_id, month, r.gross_pay, r.lop, r.advance01, r.advance, r.net_salary,
    r.pf_ee || 0, r.esic_ip || 0, r.labour_act || 0, r.absent_days || 0, r.rnd || 0, r.allowance || 0,
    r.allowance_deduction || 0
  ]);
  const sql = `INSERT INTO payroll
    (employee_id, month, gross, lop, advance01, advance, net_salary, pf_ee, esic_ip, labour_act, absent_days, rnd, allowance, allowance_deduction)
    VALUES ${placeholders}
    ON CONFLICT (employee_id, month) DO UPDATE SET
      gross=EXCLUDED.gross, lop=EXCLUDED.lop, advance01=EXCLUDED.advance01,
      advance=EXCLUDED.advance, net_salary=EXCLUDED.net_salary,
      pf_ee=EXCLUDED.pf_ee, esic_ip=EXCLUDED.esic_ip, labour_act=EXCLUDED.labour_act,
      absent_days=EXCLUDED.absent_days, rnd=EXCLUDED.rnd, allowance=EXCLUDED.allowance,
      allowance_deduction=EXCLUDED.allowance_deduction`;

  try {
    await pool.query(sql, flatValues);
    if (Array.isArray(req.body.pookadaiHolidays)) {
      const days = [...new Set(req.body.pookadaiHolidays.map(Number).filter(d => d >= 1 && d <= 31))].sort((a, b) => a - b);
      await pool.query(
        `INSERT INTO pookadai_holidays (month, days) VALUES ($1, $2)
         ON CONFLICT (month) DO UPDATE SET days = EXCLUDED.days`,
        [month, days]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Saved POOKADAI holidays for a month + the per-day rates, for the holiday picker
app.get('/api/pookadai-holidays', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    res.json({ days: await getPookadaiHolidays(month), daily: POOKADAI_DAILY, tueFri: POOKADAI_TUE_FRI });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE PAYROLL ────────────────────────────────────────────────────────────
app.delete('/api/payroll', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    await pool.query('DELETE FROM payroll WHERE month=$1', [month]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PAYROLL HISTORY ───────────────────────────────────────────────────────────
app.get('/api/payroll/months', async (req, res) => {
  try {
    const result = await pool.query(`SELECT DISTINCT month FROM payroll ORDER BY month DESC`);
    res.json(result.rows.map(r => r.month));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Saved payroll rows for a month, exactly as Payroll History shows them (incl. the
// backward-compat fill-ins for old records). The Salary Report reads the same rows
// so the two can never disagree.
async function fetchPayrollHistory(month) {
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const result = await pool.query(
    `SELECT p.*, e.employee_name, e.alias_name, e.type, e.gender, e.mop, e.account_number,
            e.ee AS emp_pf_ee, e.total_ip_contribution AS emp_esic_ip,
            e.allowance AS emp_allowance,
            e.pf_enable, e.esic_enable
     FROM payroll p
     JOIN employees e ON p.employee_id = e.employee_id
     WHERE p.month=$1 ORDER BY e.employee_name`,
    [month]
  );
  const rows = result.rows.map(r => {
    const gross      = parseFloat(r.gross) || 0;
    const lop        = parseFloat(r.lop)   || 0;
    const empAllowance = parseFloat(r.emp_allowance) || 0;

    // For old records (allowance=0 but employee has allowance), recompute from stored lop/gross
    let allowance = parseFloat(r.allowance) || 0;
    if (!allowance && empAllowance) {
      const deductedDays = gross > 0 ? (lop * daysInMonth) / gross : 0;
      const rawAllowance = Math.ceil(((empAllowance / daysInMonth) * (daysInMonth - deductedDays)) / 10) * 10;
      const storedAdv01  = parseFloat(r.advance01) || 0;
      allowance = Math.max(0, rawAllowance - storedAdv01);
    }

    // Same backward-compat recompute for records saved before allowance_deduction was persisted
    let allowance_deduction = parseFloat(r.allowance_deduction) || 0;
    if (!allowance_deduction && empAllowance) {
      const deductedDays = gross > 0 ? (lop * daysInMonth) / gross : 0;
      allowance_deduction = Math.round((empAllowance / daysInMonth) * deductedDays);
    }

    return {
      ...r,
      gross_pay:   gross,
      pf_ee:       parseFloat(r.pf_ee)      || (r.pf_enable   ? parseFloat(r.emp_pf_ee)   || 0 : 0),
      esic_ip:     parseFloat(r.esic_ip)    || (r.esic_enable ? parseFloat(r.emp_esic_ip) || 0 : 0),
      labour_act:  parseFloat(r.labour_act) || (r.pf_enable   ? 20 : 0),
      absent_days: parseFloat(r.absent_days) || 0,
      rnd:         parseFloat(r.rnd)         || 0,
      allowance,
      allowance_deduction,
    };
  });
  return rows;
}

app.get('/api/payroll/history', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    res.json(await fetchPayrollHistory(month));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PAYSLIP DATA ─────────────────────────────────────────────────────────────
app.get('/api/payslip-data', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  try {
    const [payrollRes, attRes, permRes] = await Promise.all([
      pool.query(
        `SELECT p.*, e.employee_name, e.alias_name, e.type, e.mop, e.account_number,
                e.ee AS emp_pf_ee, e.total_ip_contribution AS emp_esic_ip,
                e.allowance AS emp_allowance, e.pf_enable, e.esic_enable, e.status, e.inactive_from
         FROM payroll p
         JOIN employees e ON p.employee_id = e.employee_id
         WHERE p.month = $1 ORDER BY e.employee_name`,
        [month]
      ),
      pool.query(`SELECT * FROM attendance WHERE year=$1 AND month=$2`, [yr, mo]),
      pool.query(`SELECT employee_id, net_perm_mins, earned_days, debited_days FROM permissions WHERE month=$1`, [month])
    ]);

    const permMap = {};
    permRes.rows.forEach(r => { permMap[String(r.employee_id)] = r; });

    const attMap = {};
    attRes.rows.forEach(row => { attMap[row.employee_id] = row; });

    const rows = payrollRes.rows.map(r => {
      const gross       = parseFloat(r.gross)       || 0;
      const lop         = parseFloat(r.lop)         || 0;
      const absent_days = parseFloat(r.absent_days) || 0;
      const pf_ee       = parseFloat(r.pf_ee)       || (r.pf_enable   ? parseFloat(r.emp_pf_ee)   || 0 : 0);
      const esic_ip     = parseFloat(r.esic_ip)     || (r.esic_enable ? parseFloat(r.emp_esic_ip) || 0 : 0);
      const labour_act  = parseFloat(r.labour_act)  || (r.pf_enable   ? 20 : 0);
      const advance01   = parseFloat(r.advance01)   || 0;
      const advance     = parseFloat(r.advance)     || 0;
      const net_salary  = parseFloat(r.net_salary)  || 0;
      const rnd         = parseFloat(r.rnd)         || 0;

      // Split absent_days into leave deduction vs permission deduction
      const att = attMap[r.employee_id];
      // Leaving month: the unmarked days after they left are leave too
      const leaving = isLeavingMonth(r, month);
      let rawLeaveDays = 0;
      if (att) {
        for (let d = 1; d <= 31; d++) {
          const val = att[`day_${d}`];
          if (!val) { if (leaving && d <= daysInMonth) rawLeaveDays += 1; continue; }
          if (val === 'LR' || val === 'LU') rawLeaveDays += 1;
          else if (val.startsWith('HR') || val.startsWith('HU')) rawLeaveDays += 0.5;
        }
      }
      // permDeductDays is always 0 or 1 (binary flag from permission sheet).
      // If absent_days - (rawLeaveDays - 4) > 1, allowedLeave was 0 (no-free checkbox),
      // meaning all raw leave days were deducted as leave, not permission.
      const leaveDeduct4 = Math.max(0, rawLeaveDays - 4);
      const permDeduct4  = absent_days - leaveDeduct4;
      let leaveDeductDays, permDeductDays;
      if (permDeduct4 >= 0 && permDeduct4 <= 1) {
        leaveDeductDays = leaveDeduct4;
        permDeductDays  = permDeduct4;
      } else {
        leaveDeductDays = rawLeaveDays;
        permDeductDays  = Math.max(0, absent_days - rawLeaveDays);
      }
      const dayRate  = gross > 0 ? Math.round(gross / daysInMonth) : 0;
      let lopLeave = leaveDeductDays > 0 ? Math.round(dayRate * leaveDeductDays) : 0;
      let lopPerm  = permDeductDays  > 0 ? Math.round(dayRate * permDeductDays)  : 0;
      // Pin the leave/permission split to the actually-stored LOP total (rounding
      // each share independently can drift a rupee or two from the saved payroll figure).
      if (lopLeave + lopPerm !== lop) {
        if (leaveDeductDays > 0 && permDeductDays > 0) lopLeave = lop - lopPerm;
        else if (leaveDeductDays > 0) lopLeave = lop;
        else if (permDeductDays > 0) lopPerm = lop;
      }

      // Allowance: use the amount actually saved with the payroll (same as shown in
      // Payroll History) instead of re-deriving it from lop/gross, so the two screens
      // never disagree. Only recompute for old records saved before this was persisted.
      const empAllowance = parseFloat(r.emp_allowance) || 0;
      let allowanceDeduction = parseFloat(r.allowance_deduction) || 0;
      let allowance = parseFloat(r.allowance) || 0;
      let allowanceNet = 0, allowanceLop = 0, allowanceRnd = 0;
      if (empAllowance > 0) {
        if (!allowanceDeduction) {
          const deductedDays = gross > 0 ? (lop * daysInMonth) / gross : 0;
          allowanceDeduction = Math.round((empAllowance / daysInMonth) * deductedDays);
        }
        const rawAllowance = Math.ceil((empAllowance - allowanceDeduction) / 10) * 10;
        allowanceRnd = Math.round(rawAllowance - (empAllowance - allowanceDeduction));
        allowanceLop = allowanceDeduction;
        allowanceNet = allowance > 0 ? allowance : Math.max(0, rawAllowance - advance01);
        if (!allowance) allowance = allowanceNet;
      }

      const perm = permMap[String(r.employee_id)];

      return {
        employee_id: r.employee_id,
        name:        r.alias_name || r.employee_name,
        type:        r.type,
        mop:         (r.mop || 'CASH').trim().toUpperCase(),
        account_number: r.account_number || '',
        gross_pay: gross, pf_ee, esic_ip, labour_act,
        absent_days, lop, leaveDeductDays, permDeductDays, lopLeave, lopPerm,
        advance01, advance, rnd, net_salary,
        allowanceBase: empAllowance, allowanceLop, allowanceNet, allowanceRnd,
        net_perm_mins:  perm ? (parseFloat(perm.net_perm_mins)  || 0) : null,
        earned_days:    perm ? (parseFloat(perm.earned_days)    || 0) : null,
        debited_days:   perm ? (parseFloat(perm.debited_days)   || 0) : null,
      };
    });

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────
app.get('/api/dashboard/stats', async (req, res) => {
  const { month } = req.query;
  try {
    const [empRes, advRes, adv01Res] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS active,
                COUNT(*) FILTER (WHERE UPPER(TRIM(gender))='MALE')::int AS male,
                COUNT(*) FILTER (WHERE UPPER(TRIM(gender))='FEMALE')::int AS female
         FROM employees WHERE status='ACTIVE' AND type='STAFF' AND employee_name != 'RAMAPRIYADEVI'`
      ),
      month
        ? pool.query('SELECT SUM(amount) as total FROM advances WHERE month=$1', [month])
        : Promise.resolve({ rows: [{ total: 0 }] }),
      month
        ? pool.query('SELECT SUM(advance01) as total FROM payroll WHERE month=$1', [month])
        : Promise.resolve({ rows: [{ total: 0 }] })
    ]);

    const active = empRes.rows[0].active;
    const male   = empRes.rows[0].male;
    const female = empRes.rows[0].female;

    // Attendance query runs separately so a migration error never breaks employee counts
    let lopTotal = 0;
    if (month) {
      try {
        const { emps, attMap, daysInMonth } = await fetchPayrollInputs(month);
        emps.forEach(emp => {
          if (emp.type === 'OTHERS') return;
          const a = attMap[emp.employee_id] || { L: 0, H: 0 };
          const absent = leaveDaysOfMonth(emp, a), free = emp._leaving ? 0 : 4;
          if (absent > free) {
            lopTotal += Math.round((parseFloat(emp.gross_pay) / daysInMonth) * (absent - free));
          }
        });
      } catch (_) { /* attendance table not yet migrated — show 0 */ }
    }

    res.json({
      active,
      male,
      female,
      advanceTotal: (parseFloat(advRes.rows[0].total) || 0) + (parseFloat(adv01Res.rows[0].total) || 0),
      lopTotal
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MONTH SUMMARY ─────────────────────────────────────────────────────────────
// One-off: these employees joined mid-month, so their LOP shouldn't count toward
// the Month Summary deduction total for this month only.
const SKIP_LOP_IN_SUMMARY = {
  '2026-07': ['SETHU NATCHIYAR', 'SILAMBARASAN', 'THIRUSELVI', 'KANIMOZHI', 'PANDISELVI', 'PANDISELVI II', 'ABINAYA']
};

// Save the Summary's mid-month ticks for a month (the full list each time)
app.post('/api/summary-marked', async (req, res) => {
  const { month, employee_ids } = req.body;
  if (!month || !Array.isArray(employee_ids)) return res.status(400).json({ error: 'month and employee_ids required' });
  try {
    await pool.query(
      `INSERT INTO summary_marked (month, employee_ids) VALUES ($1, $2)
       ON CONFLICT (month) DO UPDATE SET employee_ids = EXCLUDED.employee_ids`,
      [month, [...new Set(employee_ids.map(String))]]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leave/Permission incentive days-in-month divisor fix applies from August 2026
// onward — July 2026 keeps computing with the old base/30 formula.
const INCENTIVE_FIX_FROM = '2026-08';
const incentiveFixActive = month => month >= INCENTIVE_FIX_FROM;

app.get('/api/month-summary', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const incFixed = incentiveFixActive(month);

  try {
    const [lopRes, attRes, empsRes, permRes, addIncRes, addIncRowsRes, markedRes] = await Promise.all([
      pool.query(
        `SELECT p.employee_id, p.lop, e.employee_name, e.alias_name FROM payroll p
         JOIN employees e ON p.employee_id = e.employee_id
         WHERE p.month = $1`,
        [month]
      ),
      pool.query(`SELECT * FROM attendance WHERE year=$1 AND month=$2`, [yr, mo]),
      pool.query(
        `SELECT employee_id, employee_name, alias_name, salary_after_deduction, allowance, mop
         FROM employees
         WHERE (status='ACTIVE' OR (TRIM(status)='INACTIVE' AND inactive_from > $2)) AND type != 'OTHERS'
           AND (joining_date IS NULL OR joining_date <= $1)`,
        [monthEndDate(month), month]
      ),
      pool.query(
        `SELECT p.earned_days, e.employee_name, e.alias_name, e.salary_after_deduction, e.allowance, e.mop
         FROM permissions p
         JOIN employees e ON e.employee_id::text = p.employee_id
         WHERE p.month = $1`,
        [month]
      ),
      pool.query(
        `SELECT incentive_name, COALESCE(SUM(net_amount) FILTER (WHERE included), 0) AS total
         FROM additional_incentives WHERE month=$1
         GROUP BY incentive_name ORDER BY incentive_name`,
        [month]
      ),
      pool.query(
        `SELECT incentive_name, employee_name, alias_name, mop, days, net_amount, included
         FROM additional_incentives WHERE month=$1
         ORDER BY incentive_name, COALESCE(alias_name, employee_name)`,
        [month]
      ),
      pool.query(`SELECT employee_ids FROM summary_marked WHERE month=$1`, [month])
    ]);

    // Per-employee inputs behind each total, so the Excel export can rebuild
    // every figure with live formulas.
    const nameOf = r => (r.alias_name || r.employee_name || '').trim();
    const mopOf  = r => (r.mop || 'CASH').trim().toUpperCase();
    const baseOf = r => (parseFloat(r.salary_after_deduction) || 0) + (parseFloat(r.allowance) || 0);
    const detail = { daysInMonth, leaveDivisor: incFixed ? daysInMonth : 30,
                     deduction: [], leave: [], timing: [], additional: [] };

    const attMap = {};
    attRes.rows.forEach(r => { attMap[r.employee_id] = r; });

    // Employees ticked in the Summary as joined/left mid-month: their whole LOP
    // moves out of Total Deduction. Months never ticked fall back to the old
    // hard-coded list (July 2026).
    const markedIds = markedRes.rows[0]
      ? new Set(markedRes.rows[0].employee_ids.map(String))
      : null;
    const skipLopNames = new Set((SKIP_LOP_IN_SUMMARY[month] || []).map(n => n.toUpperCase()));
    const leaveDaysOf = empId => {
      const att = attMap[empId];
      let days = 0;
      if (att) {
        for (let d = 1; d <= 31; d++) {
          const val = att[`day_${d}`];
          if (!val) continue;
          if (val === 'LR' || val === 'LU') days += 1;
          else if (val.startsWith('HR') || val.startsWith('HU')) days += 0.5;
        }
      }
      return days;
    };
    const isMarked = (empId, nm) => markedIds ? markedIds.has(String(empId)) : skipLopNames.has(nm.toUpperCase());
    let totalLop = 0, joinLeaveDeduction = 0;
    lopRes.rows.forEach(r => {
      const nm  = nameOf(r);
      const lop = parseFloat(r.lop) || 0;
      const marked = isMarked(r.employee_id, nm);
      totalLop += lop;
      if (marked) joinLeaveDeduction += lop;
      detail.deduction.push({ employee_id: r.employee_id, name: nm, lop,
                              leaveDays: leaveDaysOf(r.employee_id), marked });
    });
    detail.deduction.sort((a, b) => a.name.localeCompare(b.name));

    // Tick list: active employees (from attendance, so it shows before payroll
    // is saved) plus anyone in the saved payroll, with > 6 leaves or already ticked.
    // lop is null until that month's payroll is saved.
    const lopById = {};
    lopRes.rows.forEach(r => { lopById[String(r.employee_id)] = parseFloat(r.lop) || 0; });
    const seen = new Set();
    detail.midMonth = [];
    [...lopRes.rows, ...empsRes.rows].forEach(r => {
      const id = String(r.employee_id);
      if (seen.has(id)) return;
      seen.add(id);
      const nm = nameOf(r);
      const leaveDays = leaveDaysOf(r.employee_id);
      const marked = isMarked(id, nm);
      if (leaveDays > 6 || marked) {
        detail.midMonth.push({ employee_id: id, name: nm, leaveDays, marked,
                               lop: id in lopById ? lopById[id] : null });
      }
    });
    detail.midMonth.sort((a, b) => b.leaveDays - a.leaveDays || a.name.localeCompare(b.name));
    totalLop = Math.round(totalLop);
    joinLeaveDeduction = Math.round(joinLeaveDeduction);
    const totalDeduction = totalLop - joinLeaveDeduction;

    // Leave incentive total
    let leaveIncentive = 0;
    for (const emp of empsRes.rows) {
      const displayName = (emp.alias_name || emp.employee_name || '').toUpperCase().trim();
      if (displayName === 'RAMAPRIYADEVI') continue;
      const att = attMap[emp.employee_id];
      let leave_days = 0;
      if (att) {
        for (let d = 1; d <= 31; d++) {
          const val = att[`day_${d}`];
          if (!val) continue;
          if (val === 'LR' || val === 'LU') leave_days += 1;
          else if (val.startsWith('HR') || val.startsWith('HU')) leave_days += 0.5;
        }
      }
      const incentive_days = Math.max(0, 4 - leave_days);
      detail.leave.push({ name: nameOf(emp), mop: mopOf(emp), base: baseOf(emp), leaveDays: leave_days });
      if (incentive_days > 0) {
        const base    = (parseFloat(emp.salary_after_deduction) || 0) + (parseFloat(emp.allowance) || 0);
        const divisor = incFixed ? daysInMonth : 30;
        const trueRaw = (base / divisor) * incentive_days;
        const raw     = Math.round(trueRaw);
        const mop     = (emp.mop || 'CASH').trim().toUpperCase();
        leaveIncentive += (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(trueRaw / 10) * 10;
      }
    }

    // Timing (permission) incentive total from permissions table
    let timingIncentive = 0;
    permRes.rows.forEach(r => {
      const daysEarned = parseFloat(r.earned_days) || 0;
      detail.timing.push({ name: nameOf(r), mop: mopOf(r), base: baseOf(r), earnedDays: daysEarned });
      if (daysEarned >= 1) {
        const base = (parseFloat(r.salary_after_deduction) || 0) + (parseFloat(r.allowance) || 0);
        const trueRaw = (base / daysInMonth) * daysEarned;
        const raw  = Math.round(trueRaw);
        const mop  = (r.mop || 'CASH').trim().toUpperCase();
        timingIncentive += (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(trueRaw / 10) * 10;
      }
    });

    const additionalIncentives = addIncRes.rows.map(r => ({
      name: r.incentive_name,
      total: Math.round(parseFloat(r.total) || 0)
    }));
    const additionalIncentiveTotal = additionalIncentives.reduce((s, r) => s + r.total, 0);
    addIncRowsRes.rows.forEach(r => {
      detail.additional.push({ incentive: r.incentive_name, name: nameOf(r), mop: mopOf(r),
                               days: parseFloat(r.days) || 0, net: parseFloat(r.net_amount) || 0,
                               included: !!r.included });
    });

    const balance = totalDeduction - leaveIncentive - timingIncentive - additionalIncentiveTotal;

    res.json({ totalLop, joinLeaveDeduction, totalDeduction, leaveIncentive, timingIncentive,
               additionalIncentives, balance, detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LEAVE INCENTIVE ───────────────────────────────────────────────────────────
async function computeLeaveIncentiveList(month) {
  if (!month) { const e = new Error('month required'); e.status = 400; throw e; }
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const incFixed = incentiveFixActive(month);
  {
    const [empsRes, attRes] = await Promise.all([
      pool.query(
        `SELECT employee_id, employee_name, alias_name, account_number, salary_after_deduction, allowance, mop
         FROM employees
         WHERE (status='ACTIVE' OR (TRIM(status)='INACTIVE' AND inactive_from > $2)) AND type != 'OTHERS'
           AND (joining_date IS NULL OR joining_date <= $1)`,
        [monthEndDate(month), month]
      ),
      pool.query(`SELECT * FROM attendance WHERE year=$1 AND month=$2`, [yr, mo])
    ]);

    const attMap = {};
    attRes.rows.forEach(row => { attMap[row.employee_id] = row; });

    const result = [];
    for (const emp of empsRes.rows) {
      const displayName = (emp.alias_name || emp.employee_name || '').toUpperCase().trim();
      if (displayName === 'RAMAPRIYADEVI') continue;

      const att = attMap[emp.employee_id];
      let leave_days = 0;
      if (att) {
        for (let d = 1; d <= 31; d++) {
          const val = att[`day_${d}`];
          if (!val) continue;
          if (val === 'LR' || val === 'LU') leave_days += 1;
          else if (val.startsWith('HR') || val.startsWith('HU')) leave_days += 0.5;
        }
      }
      const incentive_days = Math.max(0, 4 - leave_days);
      if (incentive_days > 0) {
        const mop     = (emp.mop || 'CASH').trim().toUpperCase();
        const base    = (parseFloat(emp.salary_after_deduction) || 0) + (parseFloat(emp.allowance) || 0);
        const divisor = incFixed ? daysInMonth : 30;
        const trueRaw = (base / divisor) * incentive_days;
        const raw     = Math.round(trueRaw);
        const net     = (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(trueRaw / 10) * 10;
        result.push({
          employee_id: emp.employee_id,
          name: emp.alias_name || emp.employee_name,
          employee_name: emp.employee_name,
          account_number: emp.account_number || '',
          days: incentive_days,
          mop, base_salary: base, incentiveAmt: net
        });
      }
    }
    result.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
    return result;
  }
}

app.get('/api/leave-incentive', async (req, res) => {
  const { month } = req.query;
  try {
    const result = await computeLeaveIncentiveList(month);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── ADDITIONAL INCENTIVE (DB-backed, ad-hoc named incentives) ────────────────

// GET /api/additional-incentive/declarations — list of past declared batches
app.get('/api/additional-incentive/declarations', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT month, incentive_name,
              MAX(created_at) AS declared_at,
              COUNT(*) FILTER (WHERE included) AS employee_count,
              COALESCE(SUM(net_amount) FILTER (WHERE included), 0) AS total_amount
       FROM additional_incentives
       GROUP BY month, incentive_name
       ORDER BY MAX(created_at) DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/additional-incentive?month=&name= — rows for one declared batch
app.get('/api/additional-incentive', async (req, res) => {
  const { month, name } = req.query;
  if (!month || !name) return res.status(400).json({ error: 'month and name required' });
  try {
    const result = await pool.query(
      `SELECT * FROM additional_incentives WHERE month=$1 AND incentive_name=$2 ORDER BY employee_name`,
      [month, name]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/additional-incentive/bulk — declare (replace) a batch for month+name
app.post('/api/additional-incentive/bulk', async (req, res) => {
  const { month, incentive_name, rows } = req.body;
  if (!month || !incentive_name || !rows || !rows.length) {
    return res.status(400).json({ error: 'month, incentive_name and rows required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM additional_incentives WHERE month=$1 AND incentive_name=$2`,
      [month, incentive_name]
    );
    for (const r of rows) {
      await client.query(
        `INSERT INTO additional_incentives
           (month, incentive_name, employee_id, employee_name, alias_name,
            account_number, mop, days, raw_amount, net_amount, included)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          month, incentive_name, String(r.employee_id),
          r.employee_name || null, r.alias_name || null,
          r.account_number || null, r.mop || null,
          r.days || 0, r.raw_amount || 0, r.net_amount || 0,
          r.included !== undefined ? r.included : true
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, saved: rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/additional-incentive?month=&name=
app.delete('/api/additional-incentive', async (req, res) => {
  const { month, name } = req.query;
  if (!month || !name) return res.status(400).json({ error: 'month and name required' });
  try {
    await pool.query(
      `DELETE FROM additional_incentives WHERE month=$1 AND incentive_name=$2`,
      [month, name]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── UNRESERVED LEAVES ─────────────────────────────────────────────────────────
app.get('/api/dashboard/unreserved-leaves', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.json([]);
  const [yr, mo] = month.split('-').map(Number);
  try {
    const [empsRes, attRes] = await Promise.all([
      pool.query(
        `SELECT employee_id, employee_name, alias_name FROM employees
         WHERE (status='ACTIVE' OR (TRIM(status)='INACTIVE' AND inactive_from > $2)) AND (joining_date IS NULL OR joining_date <= $1)`,
        [monthEndDate(month), month]
      ),
      pool.query(`SELECT * FROM attendance WHERE year=$1 AND month=$2`, [yr, mo])
    ]);

    const attMap = {};
    attRes.rows.forEach(row => { attMap[row.employee_id] = row; });

    const result = [];
    for (const emp of empsRes.rows) {
      const att = attMap[emp.employee_id];
      let leave_days = 0, half_days = 0;
      if (att) {
        for (let d = 1; d <= 31; d++) {
          const val = att[`day_${d}`];
          if (!val) continue;
          if (val === 'LU') leave_days++;
          else if (val.startsWith('HU')) half_days++;
        }
      }
      if (leave_days + half_days * 0.5 > 0) {
        result.push({ name: emp.alias_name || emp.employee_name, val: leave_days + half_days * 0.5 });
      }
    }
    result.sort((a, b) => b.val - a.val);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PERMISSION INCENTIVE (Google Sheet → DB join) ────────────────────────────
const PERM_INCENTIVE_MINS = 960; // 16:00 hours = threshold for 1 day earned

async function computePermissionIncentive(month) {
    let daysInMonth = 30;
    if (month) {
      const [yr, mo] = month.split('-').map(Number);
      daysInMonth = new Date(yr, mo, 0).getDate();
    }
    const incFixed = incentiveFixActive(month || '');

    // ── DB FIRST: use declared permission data if available ──────────────────
    if (month) {
      const dbRows = await pool.query(
        `SELECT p.employee_id, p.earned_days, p.debited_days,
                p.net_perm_mins, p.total_perm_mins,
                e.employee_name, e.alias_name,
                e.salary_after_deduction AS base_salary, e.allowance, e.mop, e.account_number
         FROM permissions p
         JOIN employees e ON e.employee_id::text = p.employee_id
         WHERE p.month = $1`,
        [month]
      );

      if (dbRows.rows.length > 0) {
        const incentiveList = dbRows.rows
          .filter(r => parseFloat(r.earned_days) >= 1)
          .map(r => {
            const daysEarned = parseFloat(r.earned_days) || 0;
            const base       = (parseFloat(r.base_salary) || 0) + (parseFloat(r.allowance) || 0);
            const trueRaw    = (base / daysInMonth) * daysEarned;
            const raw        = Math.round(trueRaw);
            const mop        = (r.mop || '').trim().toUpperCase();
            const net        = (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(trueRaw / 10) * 10;
            const netMins    = parseFloat(r.net_perm_mins) || 0;
            return {
              employee_id:   parseInt(r.employee_id),
              name:          r.alias_name || r.employee_name,
              employee_name: r.employee_name,
              totalPermMins: netMins, totalPerm: fmtMins(netMins),
              daysEarned, base_salary: base, incentiveAmt: net, rawAmt: raw,
              mop, account_number: r.account_number || ''
            };
          });

        const deductionList = dbRows.rows
          .filter(r => parseFloat(r.debited_days) >= 1)
          .map(r => {
            const totalMins = parseFloat(r.total_perm_mins) || 0;
            const netMins   = parseFloat(r.net_perm_mins)   || 0;
            return {
              employee_id:   parseInt(r.employee_id),
              name:          r.alias_name || r.employee_name,
              totalMins, total: fmtMins(totalMins),
              totalPermMins: netMins, totalPerm: fmtMins(netMins)
            };
          });

        return { incentiveList, deductionList };
      }
    }

    // ── SHEET FALLBACK: no declared DB data for this month ───────────────────
    const csvUrl = month ? await getPermSheetUrl(month) : null;
    if (!csvUrl) { const e = new Error('No Google Sheet link set for this month.'); e.status = 400; throw e; }

    const empAct = month ? await pool.query(
      `SELECT employee_id::text AS eid, employee_name FROM employees
       WHERE (status = 'ACTIVE' OR (status = 'INACTIVE' AND inactive_from > $1))
         AND (joining_date IS NULL OR joining_date <= $2)`,
      [month, monthEndDate(month)]
    ) : { rows: [] };
    const activeIds = new Set(empAct.rows.map(e => e.eid));

    const csv  = await httpsGetFollow(csvUrl);
    const seen = new Set();
    const allRows = csv.trim().split('\n').slice(1)
      .map(line => parseCSVRow(line))
      .filter(c => c[0] && c[1] && c[0].trim() && c[1].trim())
      .map(c => {
        const id   = parseInt(c[0].trim());
        const name = c[1].trim();
        if (month && !activeIds.has(String(id))) return null;
        const totalM  = parseMins(c[2]);
        const permM   = totalM - 180;
        return { id, name, totalM, permM };
      })
      .filter(r => r !== null)
      .filter(r => { const k = String(r.id); if (seen.has(k)) return false; seen.add(k); return true; });

    const incentiveRows = allRows.filter(r => r.permM <= -PERM_INCENTIVE_MINS);
    const deductionRows = allRows.filter(r => r.permM > 0).sort((a, b) => b.permM - a.permM);

    let empMap = {};
    if (incentiveRows.length) {
      const ids    = incentiveRows.map(r => r.id);
      const empRes = await pool.query(
        `SELECT employee_id, employee_name, alias_name, salary_after_deduction AS base_salary, allowance, mop, account_number
         FROM employees WHERE employee_id = ANY($1)`, [ids]
      );
      empRes.rows.forEach(e => { empMap[e.employee_id] = e; });
    }

    const incentiveList = incentiveRows.map(r => {
      const emp        = empMap[r.id] || {};
      const daysEarned = Math.floor(Math.abs(r.permM) / PERM_INCENTIVE_MINS);
      const base       = (parseFloat(emp.base_salary) || 0) + (parseFloat(emp.allowance) || 0);
      const trueRaw    = (base / daysInMonth) * daysEarned;
      const raw        = Math.round(trueRaw);
      const mop        = (emp.mop || '').trim().toUpperCase();
      const net        = (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(trueRaw / 10) * 10;
      return {
        employee_id: r.id, name: emp.alias_name || r.name,
        employee_name: emp.employee_name || r.name,
        totalPermMins: r.permM, totalPerm: fmtMins(r.permM),
        daysEarned, base_salary: base, incentiveAmt: net, rawAmt: raw,
        mop, account_number: emp.account_number || ''
      };
    });

    const deductionList = deductionRows.map(r => ({
      employee_id: r.id, name: r.name,
      totalMins: r.totalM, total: fmtMins(r.totalM),
      totalPermMins: r.permM, totalPerm: fmtMins(r.permM)
    }));

  return { incentiveList, deductionList };
}

app.get('/api/permission-incentive', async (req, res) => {
  const { month } = req.query;
  try {
    const result = await computePermissionIncentive(month);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── STAFF DATA (single-employee snapshot for a month) ────────────────────────
app.get('/api/staff-data', async (req, res) => {
  const { month, employee_id } = req.query;
  if (!month || !employee_id) return res.status(400).json({ error: 'month and employee_id required' });
  try {
    const empRes = await pool.query(`SELECT * FROM employees WHERE employee_id = $1`, [employee_id]);
    const emp = empRes.rows[0];
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const [yr, mo] = month.split('-').map(Number);
    const attRowRes = await pool.query(
      `SELECT * FROM attendance WHERE year=$1 AND month=$2 AND employee_id=$3`,
      [yr, mo, emp.employee_id]
    );
    const attRow = attRowRes.rows[0];
    let lastFilledDay = 0;
    if (attRow) {
      for (let d = 1; d <= 31; d++) {
        if (attRow[`day_${d}`]) lastFilledDay = d;
      }
    }
    const lastFilledDate = lastFilledDay > 0
      ? `${yr}-${String(mo).padStart(2, '0')}-${String(lastFilledDay).padStart(2, '0')}`
      : null;

    const { attMap, advMap, daysInMonth, permMap } = await fetchPayrollInputs(month);
    emp._leaving = isLeavingMonth(emp, month) && (emp.type || '').toUpperCase() !== 'OTHERS';
    const payrollRow = calcPayrollRow(emp, attMap, advMap, 4, daysInMonth, permMap, false);

    const att          = attMap[emp.employee_id] || { P: 0, L: 0, H: 0 };
    const halfDays     = parseInt(att.H) || 0;
    const presentDays  = (parseInt(att.P) || 0) + (halfDays * 0.5);
    const absentDays   = leaveDaysOfMonth(emp, att);
    const isOthers     = (emp.type || '').toUpperCase() === 'OTHERS';

    // LOP override for Staff Data: once absence exceeds 6 days in the month, LOP is
    // charged on the FULL absent day count — the normal 4-day free allowance no longer
    // applies (it only applies for 6 or fewer absent days, e.g. 6.5 absent days → LOP on 6.5).
    const permDeductDaysForLop = (!isOthers && permMap[String(emp.employee_id)]) ? 1 : 0;
    const deductedDays = isOthers
      ? 0
      : (absentDays > 6 || emp._leaving ? absentDays : Math.max(0, absentDays - 4)) + permDeductDaysForLop;
    const lopAmount = deductedDays > 0 ? Math.round((payrollRow.gross_pay / daysInMonth) * deductedDays) : 0;

    // PF & ESIC scale down with LOP too (same "Leave Affects PF & ESIC" math as Payroll):
    // both are recalculated on the payable gross (gross − LOP), not the fixed stored contribution,
    // so they move together with Net Pay instead of staying flat while LOP eats into the salary.
    let pfAmount = payrollRow.pf_ee, esicAmount = payrollRow.esic_ip;
    if (deductedDays > 0) {
      const payableGross = payrollRow.gross_pay - lopAmount;
      if (emp.pf_enable)   pfAmount   = Math.round(payableGross * 0.70 * 0.12);
      if (emp.esic_enable) esicAmount = Math.ceil(payableGross * 0.0075);
    }

    const netPayBeforeAdvance = (() => {
      const raw = payrollRow.gross_pay - lopAmount - pfAmount - esicAmount - payrollRow.labour_act;
      return (payrollRow.mop === 'CUB' || payrollRow.mop === 'BANK') ? Math.round(raw) : Math.ceil(raw / 10) * 10;
    })();

    // Allowance, recomputed with the overridden deductedDays (same formula as calcPayrollRow)
    // so the Allowance section stays consistent with the LOP figure above.
    const fullAllowance = parseFloat(emp.allowance) || 0;
    let allowanceDeduction = 0, allowanceNet = 0;
    if (fullAllowance > 0) {
      allowanceDeduction = Math.round((fullAllowance / daysInMonth) * deductedDays);
      const rawAllowance = Math.ceil((fullAllowance - allowanceDeduction) / 10) * 10;
      allowanceNet = Math.max(0, rawAllowance - (payrollRow.advance01 || 0));
    }

    // Available salary — same formula as /api/advances/available
    const netSalary = parseFloat(emp.salary_after_deduction) || 0;
    let availableSalary;
    if ((emp.type || '').toUpperCase() === 'OTHERS') {
      availableSalary = netSalary - (advMap[emp.employee_id] || 0);
    } else {
      const permDeductDays = permMap[String(emp.employee_id)] ? 1 : 0;
      const workingDays    = Math.max(0, presentDays - permDeductDays);
      const earnedSalary   = Math.round((netSalary / daysInMonth) * workingDays);
      availableSalary = earnedSalary - (advMap[emp.employee_id] || 0);
    }

    const [leaveList, permIncentive, permRowRes] = await Promise.all([
      computeLeaveIncentiveList(month),
      computePermissionIncentive(month),
      pool.query(`SELECT * FROM permissions WHERE month=$1 AND employee_id=$2`, [month, String(employee_id)])
    ]);

    const leaveInc = leaveList.find(r => String(r.employee_id) === String(employee_id));
    const permInc  = permIncentive.incentiveList.find(r => String(r.employee_id) === String(employee_id));
    const permRow  = permRowRes.rows[0];

    // Permission timing — DB first (month "declared" via Permissions page); otherwise fall back
    // to the live Google Sheet, same source /api/permissions uses, since most months only get
    // declared to the DB at month-end.
    let permTiming;
    if (permRow) {
      permTiming = {
        total_perm_mins: parseFloat(permRow.total_perm_mins) || 0,
        free_perm_mins:  parseFloat(permRow.free_perm_mins)  || 0,
        net_perm_mins:   parseFloat(permRow.net_perm_mins)   || 0,
        earned_days:     parseFloat(permRow.earned_days)     || 0,
        debited_days:    parseFloat(permRow.debited_days)    || 0
      };
    } else {
      permTiming = { total_perm_mins: 0, free_perm_mins: 0, net_perm_mins: 0, earned_days: 0, debited_days: 0 };
      try {
        const csvUrl = await getPermSheetUrl(month);
        if (csvUrl) {
          const csv = await Promise.race([
            httpsGetFollow(csvUrl),
            new Promise(resolve => setTimeout(() => resolve(null), 5000))
          ]);
          if (csv) {
            const row = csv.trim().split('\n').slice(1)
              .map(line => parseCSVRow(line))
              .find(c => c[0] && c[0].trim() === String(employee_id));
            if (row) {
              const FREE_MINS = 180, INCENTIVE_MINS = 960; // same defaults as the Permissions page
              const totalM = parseMins(row[2]); // Column C = TOTAL
              const netM   = totalM - FREE_MINS;
              permTiming = {
                total_perm_mins: totalM,
                free_perm_mins:  FREE_MINS,
                net_perm_mins:   netM,
                earned_days:  netM <= -INCENTIVE_MINS ? Math.floor(Math.abs(netM) / INCENTIVE_MINS) : 0,
                debited_days: netM >=  INCENTIVE_MINS ? Math.floor(netM / INCENTIVE_MINS) : 0
              };
            }
          }
        }
      } catch (_) { /* sheet unavailable — leave zeros */ }
    }

    res.json({
      employee_id: emp.employee_id,
      employee_name: emp.employee_name,
      alias_name: emp.alias_name || null,
      type: emp.type,
      mop: payrollRow.mop,
      last_filled_date: lastFilledDate, // last day attendance was recorded for this employee this month

      gross_pay: payrollRow.gross_pay,
      pf_ee: pfAmount,
      esic_ip: esicAmount,
      labour_act: payrollRow.labour_act,
      // Net Pay here is the take-home before advance recovery (gross − LOP − PF − ESIC − LA),
      // not payrollRow.net_salary — that also nets out this month's advance, which is shown separately.
      net_salary: netPayBeforeAdvance,
      advance: (payrollRow.advance01 || 0) + (payrollRow.advance || 0),
      lop_days: deductedDays,
      lop_amount: lopAmount,
      available_salary: Math.round(availableSalary),

      // Allowance — same LOP-proportional calc as Payroll (calcPayrollRow), using the
      // overridden deductedDays above. Only present when the employee has a base allowance configured.
      has_allowance: fullAllowance > 0,
      allowance: allowanceNet,
      allowance_deduction: allowanceDeduction,

      present_days: presentDays,
      absent_days: absentDays,
      permission_days_debited: permTiming.debited_days,
      permission_incentive_days: permInc ? permInc.daysEarned : 0,
      permission_incentive_amount: permInc ? permInc.incentiveAmt : 0,
      leave_incentive_days: leaveInc ? leaveInc.days : 0,
      leave_incentive_amount: leaveInc ? leaveInc.incentiveAmt : 0,

      permission_timing: {
        ...permTiming,
        total_perm_fmt: fmtMins(permTiming.total_perm_mins),
        free_perm_fmt:  fmtMins(permTiming.free_perm_mins),
        net_perm_fmt:   fmtMins(permTiming.net_perm_mins)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PERMISSIONS (live from Google Sheets) ────────────────────────────────────
function httpsGetFollow(url, hops) {
  hops = hops === undefined ? 5 : hops;
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) {
        res.resume();
        return httpsGetFollow(res.headers.location, hops - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCSVRow(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseMins(s) {
  if (!s || !s.trim()) return 0;
  const neg = s.trim().startsWith('-');
  const parts = s.trim().replace('-', '').split(':');
  return (neg ? -1 : 1) * ((parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0));
}

function fmtMins(m) {
  if (!m) return '0:00';
  const neg = m < 0, a = Math.abs(m);
  return (neg ? '-' : '+') + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0');
}

// Convert any Google Sheets URL (edit/share/gviz) to a CSV export URL
// Targets the sheet tab by gid (if present in URL) or by name (default: PERMISSIONS)
function toSheetCsvUrl(url, sheetName) {
  url = url.trim();
  if (url.includes('gviz/tq') && url.includes('tqx=out:csv')) return url;
  if (url.includes('gviz/tq')) return url + (url.includes('?') ? '&' : '?') + 'tqx=out:csv';
  const idMatch = url.match(/spreadsheets\/d\/([^\/\?#]+)/);
  if (!idMatch) throw new Error('Invalid Google Sheets URL — could not extract spreadsheet ID');
  const sheetId = idMatch[1];
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  if (gidMatch) {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gidMatch[1]}`;
  }
  // No gid — target by sheet tab name (defaults to PERMISSIONS)
  const tabName = encodeURIComponent(sheetName || 'PERMISSIONS');
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${tabName}`;
}

async function getPermSheetUrl(month) {
  try {
    const r = await pool.query('SELECT sheet_url FROM permission_settings WHERE month=$1', [month]);
    if (r.rows.length) return toSheetCsvUrl(r.rows[0].sheet_url);
  } catch (_) {}
  return null;
}

// GET /api/permission-settings?month=YYYY-MM
app.get('/api/permission-settings', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    const r = await pool.query('SELECT sheet_url FROM permission_settings WHERE month=$1', [month]);
    res.json({ sheet_url: r.rows[0]?.sheet_url || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/permission-settings
app.post('/api/permission-settings', async (req, res) => {
  const { month, sheet_url } = req.body;
  if (!month || !sheet_url) return res.status(400).json({ error: 'month and sheet_url required' });
  try {
    toSheetCsvUrl(sheet_url); // validate URL is parseable
    await pool.query(
      `INSERT INTO permission_settings (month, sheet_url, updated_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (month) DO UPDATE SET sheet_url=EXCLUDED.sheet_url, updated_at=NOW()`,
      [month, sheet_url.trim()]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/permissions-debug-csv', async (req, res) => {
  const { month } = req.query;
  try {
    const csvUrl = month ? await getPermSheetUrl(month) : null;
    if (!csvUrl) return res.status(400).json({ error: 'no url' });
    const csv = await httpsGetFollow(csvUrl);
    const lines = csv.trim().split('\n').slice(0, 5);
    res.json({ header: parseCSVRow(lines[0]), rows: lines.slice(1).map(l => parseCSVRow(l)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/permissions', async (req, res) => {
  const { month } = req.query;
  try {
    const csvUrl = month ? await getPermSheetUrl(month) : null;
    if (!csvUrl) return res.status(400).json({ error: 'No Google Sheet link set for this month. Use "Set Sheet Link" to add one.' });

    // Employees active during this month: ACTIVE ones, plus INACTIVE ones who left after this month,
    // excluding anyone who joined after this month.
    const empRes = await pool.query(
      `SELECT employee_id::text AS eid, employee_name, alias_name
       FROM employees
       WHERE (status = 'ACTIVE' OR (status = 'INACTIVE' AND inactive_from > $1))
         AND (joining_date IS NULL OR joining_date <= $2)`,
      [month, monthEndDate(month)]
    );
    const activeMap = {};
    empRes.rows.forEach(e => { activeMap[e.eid] = e; });

    const csv  = await httpsGetFollow(csvUrl);
    const seen = new Set();
    const rows = csv.trim().split('\n').slice(1)
      .map(line => parseCSVRow(line))
      .filter(c => c[0] && c[1] && c[0].trim() && c[1].trim())
      .map(c => {
        const id  = c[0].trim();
        const emp = activeMap[id];
        if (!emp) return null; // inactive for this month — exclude
        const name      = emp.employee_name;  // name from DB, not sheet
        const alias     = emp.alias_name || '';
        const totalM    = parseMins(c[2]);    // Column C = TOTAL
        const balanceM  = parseMins(c[4]);    // Column E = BALANCE
        const thisMonthM = totalM - balanceM;
        return { id, name, alias,
          balance: fmtMins(balanceM), thisMonth: fmtMins(thisMonthM), total: fmtMins(totalM),
          balanceMins: balanceM, thisMonthMins: thisMonthM, totalMins: totalM };
      })
      .filter(r => r !== null && r.thisMonthMins !== 0)
      .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STAFF TIMINGS (Time Entry) ────────────────────────────────────────────────

app.get('/api/staff-timings', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const result = await pool.query(
      `SELECT st.*, e.employee_name, e.alias_name, e.gender, e.type
       FROM staff_timings st
       JOIN employees e ON e.employee_id::text = st.employee_id
       WHERE st.date = $1
       ORDER BY e.employee_name`, [date]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/staff-timings/bulk', async (req, res) => {
  const { date, rows } = req.body;
  if (!date || !rows || !rows.length) return res.status(400).json({ error: 'date and rows required' });
  try {
    for (const r of rows) {
      await pool.query(
        `INSERT INTO staff_timings
          (employee_id, date, is_scheduled, time_in, lunch_out, lunch_in, time_out,
           permission_out, permission_in, minus_in_mins, minus_out_mins,
           perm_taken_mins, mor_late_mins, lunch_late_mins, less_time_mins,
           minus_time_start, minus_time_end, minus_direct_mins, permissions_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (employee_id, date) DO UPDATE SET
           is_scheduled=EXCLUDED.is_scheduled, time_in=EXCLUDED.time_in,
           lunch_out=EXCLUDED.lunch_out, lunch_in=EXCLUDED.lunch_in,
           time_out=EXCLUDED.time_out, permission_out=EXCLUDED.permission_out,
           permission_in=EXCLUDED.permission_in,
           minus_in_mins=EXCLUDED.minus_in_mins, minus_out_mins=EXCLUDED.minus_out_mins,
           perm_taken_mins=EXCLUDED.perm_taken_mins, mor_late_mins=EXCLUDED.mor_late_mins,
           lunch_late_mins=EXCLUDED.lunch_late_mins, less_time_mins=EXCLUDED.less_time_mins,
           minus_time_start=EXCLUDED.minus_time_start, minus_time_end=EXCLUDED.minus_time_end,
           minus_direct_mins=EXCLUDED.minus_direct_mins,
           permissions_json=EXCLUDED.permissions_json`,
        [r.employee_id, date, r.is_scheduled || false,
         r.time_in || null, r.lunch_out || null, r.lunch_in || null,
         r.time_out || null, r.permission_out || null, r.permission_in || null,
         r.minus_in_mins || 0, r.minus_out_mins || 0,
         r.perm_taken_mins || 0, r.mor_late_mins || 0,
         r.lunch_late_mins || 0, r.less_time_mins || 0,
         r.minus_time_start || null, r.minus_time_end || null, r.minus_direct_mins || 0,
         JSON.stringify(r.permissions_json || [])]
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/staff-timings/monthly-totals', async (req, res) => {
  const { month, before } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    const params = [month + '-01'];
    const dateCond = before ? `AND date < $${params.push(before)}` : '';
    const result = await pool.query(
      `SELECT employee_id,
              COALESCE(SUM(minus_in_mins + minus_out_mins), 0)::int AS cumulative_mins
       FROM staff_timings
       WHERE DATE_TRUNC('month', date) = DATE_TRUNC('month', $1::date)
         ${dateCond}
       GROUP BY employee_id`,
      params
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/staff-timings/report', async (req, res) => {
  const { employee_id, from, to, date } = req.query;
  try {
    const cond = []; const params = [];
    if (date)        { params.push(date);        cond.push(`st.date = $${params.length}`); }
    if (employee_id) { params.push(employee_id); cond.push(`st.employee_id = $${params.length}`); }
    if (from)        { params.push(from);         cond.push(`st.date >= $${params.length}`); }
    if (to)          { params.push(to);           cond.push(`st.date <= $${params.length}`); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const result = await pool.query(
      `SELECT st.*, e.employee_name, e.alias_name, e.gender, e.type
       FROM staff_timings st
       JOIN employees e ON e.employee_id::text = st.employee_id
       ${where}
       ORDER BY st.date DESC, e.employee_name`,
      params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PERMISSIONS TABLE (DB-backed monthly declaration) ────────────────────────

// GET /api/permissions-month?month=YYYY-MM
// Returns all declared permission rows for a month (joined with employee names)
app.get('/api/permissions-month', async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    const result = await pool.query(
      `SELECT p.*, e.employee_name, e.alias_name
       FROM permissions p
       JOIN employees e ON e.employee_id::text = p.employee_id
       WHERE p.month = $1
       ORDER BY e.employee_name`,
      [month]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/permissions-month/months
// Returns list of months that have declared permission data
app.get('/api/permissions-month/months', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT month FROM permissions ORDER BY month DESC`
    );
    res.json(result.rows.map(r => r.month));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/permissions-month/bulk
// Upsert (declare/update) permission records for a month
app.post('/api/permissions-month/bulk', async (req, res) => {
  const { month, rows } = req.body;
  if (!month || !rows || rows.length === 0) return res.json({ success: true });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `INSERT INTO permissions
           (employee_id, month, total_perm_mins, free_perm_mins, net_perm_mins,
            earned_days, debited_days, finalized, notes, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (employee_id, month) DO UPDATE SET
           total_perm_mins = EXCLUDED.total_perm_mins,
           free_perm_mins  = EXCLUDED.free_perm_mins,
           net_perm_mins   = EXCLUDED.net_perm_mins,
           earned_days     = EXCLUDED.earned_days,
           debited_days    = EXCLUDED.debited_days,
           finalized       = EXCLUDED.finalized,
           notes           = EXCLUDED.notes,
           updated_at      = NOW()`,
        [
          String(r.employee_id),
          month,
          r.total_perm_mins  || 0,
          r.free_perm_mins   !== undefined ? r.free_perm_mins : 180,
          r.net_perm_mins    || 0,
          r.earned_days      || 0,
          r.debited_days     || 0,
          r.finalized        || false,
          r.notes            || null
        ]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, saved: rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/permissions-month?month=YYYY-MM[&employee_id=ID]
app.delete('/api/permissions-month', async (req, res) => {
  const { month, employee_id } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    if (employee_id) {
      await pool.query(
        'DELETE FROM permissions WHERE month=$1 AND employee_id=$2',
        [month, employee_id]
      );
    } else {
      await pool.query('DELETE FROM permissions WHERE month=$1', [month]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Monthly Incentive: eligibility per staff ─────────────────────────────────
app.get('/api/incentive/eligibility', async (req, res) => {
  try {
    const r = await pool.query('SELECT employee_id, eligible, role, gold, silver FROM incentive_eligibility');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const INCENTIVE_ROLES = ['Backend', 'Supervisor', 'Sales', 'Driver'];
// Body: { items: [{ employee_id, eligible, role, gold, silver }] } — saves all in one transaction
app.put('/api/incentive/eligibility', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: 'items required' });
  const clean = items
    .map(x => ({ id: String(x.employee_id ?? '').trim(), ok: x.eligible === true, role: INCENTIVE_ROLES.includes(x.role) ? x.role : null,
                 gold: x.gold === true, silver: x.silver === true }))
    .filter(x => x.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const x of clean) {
      await client.query(
        `INSERT INTO incentive_eligibility (employee_id, eligible, role, gold, silver, updated_at) VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (employee_id) DO UPDATE SET eligible = EXCLUDED.eligible, role = EXCLUDED.role,
           gold = EXCLUDED.gold, silver = EXCLUDED.silver, updated_at = NOW()`,
        [x.id, x.ok, x.role, x.gold, x.silver]);
    }
    await client.query('COMMIT');
    res.json({ success: true, saved: clean.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── Monthly Incentive: attendance check for a month ─────────────────────────
// Rules (owner, 2026-11-12):
//   P            → earning day
//   LR / LU      → leave, counts 1 toward the limit, day = ₹0
//   H?? (half)   → counts 0.5 toward the limit, but the WHOLE day = ₹0
//   limit        → total leave > 4  ⇒ whole month ₹0
//   not eligible in Staff List ⇒ ₹0
//   minor mistake → that day ₹0;  4th minor (count > 3) ⇒ whole month ₹0
//   major mistake ⇒ whole month ₹0
const INCENTIVE_LEAVE_LIMIT = 4;
const INCENTIVE_MINOR_ALLOWED = 3;
function incentiveDayStats(row, daysInMonth) {
  let present = 0, full = 0, half = 0, other = 0;
  const codes = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const v = String(row['day_' + d] ?? '').trim().toUpperCase();
    codes.push(v);
    if (v === 'P') present++;
    else if (v === 'LR' || v === 'LU') full++;
    else if (v.startsWith('H')) half++;
    else other++;                       // blank or unknown code — no incentive
  }
  const leave = full + half * 0.5;
  return { present, full, half, other, leave, overLimit: leave > INCENTIVE_LEAVE_LIMIT, codes };
}

// One place for the attendance + penalty rules; used by Attendance Check AND the calculation
async function computeIncentiveAttendance(month) {
  const [yr, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  {
    const [att, emps, elig, mis] = await Promise.all([
      pool.query('SELECT * FROM attendance WHERE year=$1 AND month=$2', [yr, mo]),
      pool.query('SELECT employee_id, employee_name, alias_name, gender, type, status FROM employees'),
      pool.query('SELECT employee_id, eligible, role, gold, silver FROM incentive_eligibility'),
      pool.query('SELECT employee_id, day, severity FROM incentive_mistakes WHERE month=$1', [month]),
    ]);
    const empMap = new Map(emps.rows.map(e => [String(e.employee_id).trim(), e]));
    const elMap = new Map(elig.rows.map(e => [String(e.employee_id).trim(), e]));
    const misMap = new Map();   // id -> { minorDays:Set, minor:n, major:n }
    for (const m of mis.rows) {
      const id = String(m.employee_id).trim();
      if (!misMap.has(id)) misMap.set(id, { minorDays: new Set(), minor: 0, major: 0 });
      const x = misMap.get(id);
      if (m.severity === 'MAJOR') x.major++; else { x.minor++; x.minorDays.add(Number(m.day)); }
    }
    const out = [];
    for (const row of att.rows) {
      const id = String(row.employee_id).trim();
      const e = empMap.get(id);
      if (!e || String(e.type || '').trim().toUpperCase() === 'OTHERS') continue;
      const s = incentiveDayStats(row, daysInMonth);
      if (s.other === daysInMonth) continue;   // empty row — not working that month
      const el = elMap.get(id) || {};
      const eligible = el.eligible === true;
      const mx = misMap.get(id) || { minorDays: new Set(), minor: 0, major: 0 };
      const minorOver = mx.minor > INCENTIVE_MINOR_ALLOWED;
      // present days that were NOT zeroed by a minor mistake
      const presentAfterMistakes = s.codes.filter((c, i) => c === 'P' && !mx.minorDays.has(i + 1)).length;
      const result = !eligible ? 'NOT_ELIGIBLE'
        : s.overLimit ? 'OVER_LIMIT'
        : mx.major ? 'MAJOR_MISTAKE'
        : minorOver ? 'MINOR_LIMIT'
        : 'OK';
      out.push({
        employee_id: id,
        name: String(e.employee_name || '').trim(),
        alias: String(e.alias_name || '').trim(),
        gender: String(e.gender || '').trim().toUpperCase(),
        status: String(e.status || '').trim().toUpperCase(),
        eligible, role: el.role || null, gold: el.gold === true, silver: el.silver === true,
        present: s.present, full_leave: s.full, half_days: s.half, other_days: s.other,
        leave: s.leave, over_limit: s.overLimit,
        minor_mistakes: mx.minor, major_mistakes: mx.major, minor_days: [...mx.minorDays].sort((a, b) => a - b),
        earning_days: result === 'OK' ? presentAfterMistakes : 0,
        result,
        codes: s.codes,
      });
    }
    return { month, days_in_month: daysInMonth, leave_limit: INCENTIVE_LEAVE_LIMIT, minor_allowed: INCENTIVE_MINOR_ALLOWED, staff: out };
  }
}
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
app.get('/api/incentive/attendance', async (req, res) => {
  const month = String(req.query.month || '');
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  try { res.json(await computeIncentiveAttendance(month)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive: settings (rates + split) ─────────────────────────────
const INCENTIVE_SETTING_KEYS = ['gold_rate', 'silver_rate', 'pct_sales_backend', 'pct_supervisor'];
async function getIncentiveSettings() {
  const r = await pool.query('SELECT key, value FROM incentive_settings');
  const s = { gold_rate: 6.5, silver_rate: 1, pct_sales_backend: 90, pct_supervisor: 10 };
  for (const x of r.rows) if (INCENTIVE_SETTING_KEYS.includes(x.key)) s[x.key] = Number(x.value);
  return s;
}
app.get('/api/incentive/settings', async (req, res) => {
  try { res.json(await getIncentiveSettings()); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/incentive/settings', async (req, res) => {
  const b = req.body || {};
  const v = {};
  for (const k of INCENTIVE_SETTING_KEYS) {
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${k} must be a number 0 or more` });
    v[k] = Math.round(n * 1000) / 1000;
  }
  if (Math.abs(v.pct_sales_backend + v.pct_supervisor - 100) > 0.001) return res.status(400).json({ error: 'Sales + Backend % and Supervisor % must add up to 100' });
  try {
    for (const k of INCENTIVE_SETTING_KEYS)
      await pool.query(`INSERT INTO incentive_settings (key, value, updated_at) VALUES ($1,$2,NOW())
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [k, v[k]]);
    res.json(await getIncentiveSettings());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive: read the uploaded Excel reports ──────────────────────
// Sale Bill Detail List (one row per item; bill-level fields only on a bill's first row)
//   • whole bill left out if Discount > 100
//   • whole bill left out if a chit was closed on it (Chit Nos / Chit Amount)
//   • item left out if Product / Product Group contains COIN, or the word FT (99.50 FT, 99.99 FT …)
//   • weight used = item Net Wt, split by Ornaments Type (GOLD / SILVER)
// Sales Return: whole file subtracted — Gold Net Wt / Silver Net Wt per Bill Date
const ExcelJS = require('exceljs');
const cellVal = v => (v && typeof v === 'object' && !(v instanceof Date)) ? (v.result ?? v.text ?? (v.richText ? v.richText.map(x => x.text).join('') : null)) : v;
const num = v => { const n = Number(String(cellVal(v) ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
function parseDMY(v) {
  v = cellVal(v);
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  const m = String(v ?? '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
const r3 = n => Math.round(n * 1000) / 1000;

async function readIncentiveReport(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Empty Excel file');
  // find the header row
  let hdrRow = 0, hdr = [];
  for (let i = 1; i <= Math.min(10, ws.rowCount); i++) {
    const vals = ws.getRow(i).values.slice(1).map(x => String(cellVal(x) ?? '').trim());
    if (vals.includes('Bill No') && (vals.includes('Ornaments Type') || vals.includes('Bill Date'))) { hdrRow = i; hdr = vals; break; }
  }
  if (!hdrRow) throw new Error('Not a Sale Bill Detail List or Sales Return report (header row not found)');
  const col = name => hdr.indexOf(name);
  const rows = [];
  for (let i = hdrRow + 1; i <= ws.rowCount; i++) rows.push(ws.getRow(i).values.slice(1));
  const get = (r, name) => { const c = col(name); return c < 0 ? null : cellVal(r[c]); };

  if (hdr.includes('Ornaments Type')) {
    for (const need of ['Sales Person 1', 'Net Wt', 'Date', 'Discount', 'Product'])
      if (col(need) < 0) throw new Error(`Sales report is missing the "${need}" column`);
    const items = rows.filter(r => String(get(r, 'Sales Person 1') ?? '').trim() && String(get(r, 'Bill No') ?? '').trim());
    // bill-level facts
    const bills = new Map();
    for (const r of items) {
      const b = String(get(r, 'Bill No')).trim();
      if (!bills.has(b)) bills.set(b, { disc: 0, chit: false });
      const B = bills.get(b);
      B.disc = Math.max(B.disc, num(get(r, 'Discount')));
      if (String(get(r, 'Chit Nos') ?? '').trim() || num(get(r, 'Chit Amount')) > 0) B.chit = true;
    }
    const days = {};
    for (const r of items) {
      const date = parseDMY(get(r, 'Date'));
      if (!date) throw new Error('A row has no readable Date');
      const d = days[date] ||= { gold: 0, silver: 0, all_gold: 0, all_silver: 0, bills: new Set(), drop: { discount: new Set(), chit: new Set(), coin_ft: 0 }, drop_wt: { gold: 0, silver: 0 },
        cat: { discount: { gold: 0, silver: 0 }, chit: { gold: 0, silver: 0 }, coin: { gold: 0, silver: 0 } },
        value: { gold: 0, silver: 0 }, person: {}, discSeen: new Set(), hours: {}, hourSeen: new Set(), staff: {}, custSeen: new Set() };
      // daily staff sales report (like the owner's sheet): ALL items, no filters.
      // A bill counts as one customer for the salesperson on its first row.
      {
        const sp = String(get(r, 'Sales Person 1') ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
        const bn = String(get(r, 'Bill No')).trim();
        const P = d.staff[sp] ||= { c: 0, gq: 0, gw: 0, sq: 0, sw: 0 };
        if (!d.custSeen.has(bn)) { d.custSeen.add(bn); P.c++; }
        const ty = String(get(r, 'Ornaments Type') ?? '').trim().toUpperCase(), wt = num(get(r, 'Net Wt'));
        if (ty === 'GOLD') { P.gq++; P.gw += wt; } else if (ty === 'SILVER') { P.sq++; P.sw += wt; }
      }
      // bill time (e.g. "10:52 AM") → hour of day, for "sales by hour"
      {
        const tm = String(get(r, 'Created Time') ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?/i);
        if (tm) {
          let hh = Number(tm[1]) % 12; if (tm[3] && tm[3].toUpperCase() === 'PM') hh += 12; if (!tm[3]) hh = Number(tm[1]);
          const H = d.hours[hh] ||= { bills: 0, gold: 0, silver: 0 };
          const bn = String(get(r, 'Bill No')).trim();
          if (!d.hourSeen.has(bn)) { d.hourSeen.add(bn); H.bills++; }
          const ty = String(get(r, 'Ornaments Type') ?? '').trim().toUpperCase(), wt = num(get(r, 'Net Wt'));
          if (ty === 'GOLD') H.gold += wt; else if (ty === 'SILVER') H.silver += wt;
        }
      }
      const type = String(get(r, 'Ornaments Type') ?? '').trim().toUpperCase();
      const w = num(get(r, 'Net Wt'));
      const b = String(get(r, 'Bill No')).trim(), B = bills.get(b);
      d.bills.add(b);
      if (type === 'GOLD') d.all_gold += w; else if (type === 'SILVER') d.all_silver += w;
      // sales value before tax (item level) — for "incentive cost vs sales"
      const val = col('I.Taxable Amt') >= 0 ? num(get(r, 'I.Taxable Amt')) : num(get(r, 'Amount'));
      if (type === 'GOLD') d.value.gold += val; else if (type === 'SILVER') d.value.silver += val;
      // discount > ₹100 bills (not chit) per salesperson — for "discount leak"
      if (!B.chit && B.disc > 100) {
        const sp = String(get(r, 'Sales Person 1') ?? '').trim().replace(/\s+/g, ' ').toUpperCase() || '—';
        const P = d.person[sp] ||= { bills: 0, disc: 0, gold: 0, silver: 0 };
        if (!d.discSeen.has(b)) { d.discSeen.add(b); P.bills++; P.disc += B.disc; }
        if (type === 'GOLD') P.gold += w; else if (type === 'SILVER') P.silver += w;
      }
      let drop = '';
      // a bill that is both chit and discount>100 is shown under Chit (owner checks chit totals by hand)
      if (B.chit) { d.drop.chit.add(b); drop = 'chit'; }
      else if (B.disc > 100) { d.drop.discount.add(b); drop = 'discount'; }
      else if (/COIN|\bFT\b/i.test(`${get(r, 'Product') ?? ''} ${get(r, 'Product Group Name') ?? ''}`)) { d.drop.coin_ft++; drop = 'coin'; }
      if (drop) {
        const m = type === 'GOLD' ? 'gold' : type === 'SILVER' ? 'silver' : '';
        if (m) { d.drop_wt[m] += w; d.cat[drop][m] += w; }
        continue;
      }
      if (type === 'GOLD') d.gold += w; else if (type === 'SILVER') d.silver += w;
    }
    const out = {};
    for (const [date, d] of Object.entries(days)) out[date] = {
      gold: r3(d.gold), silver: r3(d.silver),
      detail: { bills: d.bills.size, all_gold: r3(d.all_gold), all_silver: r3(d.all_silver),
                dropped_discount_bills: d.drop.discount.size, dropped_chit_bills: d.drop.chit.size, dropped_coin_ft_items: d.drop.coin_ft,
                dropped_gold: r3(d.drop_wt.gold), dropped_silver: r3(d.drop_wt.silver),
                discount_gold: r3(d.cat.discount.gold), discount_silver: r3(d.cat.discount.silver),
                chit_gold: r3(d.cat.chit.gold), chit_silver: r3(d.cat.chit.silver),
                coin_gold: r3(d.cat.coin.gold), coin_silver: r3(d.cat.coin.silver),
                value_gold: r2(d.value.gold), value_silver: r2(d.value.silver),
                staff_sales: Object.fromEntries(Object.entries(d.staff).map(([k, p]) => [k, { c: p.c, gq: p.gq, gw: r3(p.gw), sq: p.sq, sw: r3(p.sw) }])),
                hours: Object.fromEntries(Object.entries(d.hours).map(([h, x]) => [h, { bills: x.bills, gold: r3(x.gold), silver: r3(x.silver) }])),
                disc_people: Object.fromEntries(Object.entries(d.person).map(([k, p]) => [k, { bills: p.bills, disc: r2(p.disc), gold: r3(p.gold), silver: r3(p.silver) }])) },
    };
    return { kind: 'sale', days: out };
  }

  for (const need of ['Bill Date', 'Gold Net Wt', 'Silver Net Wt'])
    if (col(need) < 0) throw new Error(`Sales return report is missing the "${need}" column`);
  const days = {};
  for (const r of rows) {
    if (!String(get(r, 'Bill No') ?? '').trim()) continue;          // total row has no bill no
    const date = parseDMY(get(r, 'Bill Date'));
    if (!date) continue;
    const d = days[date] ||= { gold: 0, silver: 0, bills: 0 };
    d.gold += num(get(r, 'Gold Net Wt')); d.silver += num(get(r, 'Silver Net Wt')); d.bills++;
  }
  const out = {};
  for (const [date, d] of Object.entries(days)) out[date] = { gold: r3(d.gold), silver: r3(d.silver), detail: { bills: d.bills } };
  return { kind: 'return', days: out };
}

// Upload one report (raw .xlsx body). The date(s) come from inside the file.
// ?month=YYYY-MM limits which dates are accepted; an empty return file can be tied to ?date=
app.post('/api/incentive/upload', express.raw({ type: () => true, limit: '20mb' }), async (req, res) => {
  const month = String(req.query.month || '');
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const file = String(req.get('x-file-name') || 'upload.xlsx').slice(0, 200);
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'No file received' });
  try {
    const rep = await readIncentiveReport(req.body);
    let dates = Object.keys(rep.days).sort();
    // A sales return with no returns that day: allow tying it to a chosen date
    if (!dates.length && rep.kind === 'return') {
      const d = String(req.query.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !d.startsWith(month)) return res.status(400).json({ error: 'This sales return file has no returns. Choose its date to save it as 0.' });
      rep.days[d] = { gold: 0, silver: 0, detail: { bills: 0 } }; dates = [d];
    }
    if (!dates.length) return res.status(400).json({ error: 'No sale rows found in this file' });
    const outside = dates.filter(d => !d.startsWith(month));
    if (outside.length) return res.status(400).json({ error: `File has dates outside ${month}: ${outside.join(', ')}` });
    for (const d of dates) {
      const x = rep.days[d];
      if (rep.kind === 'sale')
        await pool.query(`INSERT INTO incentive_sales_day (sale_date, gold_sale, silver_sale, sale_detail, sale_file, sale_at)
                          VALUES ($1,$2,$3,$4,$5,NOW())
                          ON CONFLICT (sale_date) DO UPDATE SET gold_sale=EXCLUDED.gold_sale, silver_sale=EXCLUDED.silver_sale,
                            sale_detail=EXCLUDED.sale_detail, sale_file=EXCLUDED.sale_file, sale_at=NOW()`,
          [d, x.gold, x.silver, JSON.stringify(x.detail), file]);
      else
        await pool.query(`INSERT INTO incentive_sales_day (sale_date, gold_return, silver_return, return_detail, return_file, return_at)
                          VALUES ($1,$2,$3,$4,$5,NOW())
                          ON CONFLICT (sale_date) DO UPDATE SET gold_return=EXCLUDED.gold_return, silver_return=EXCLUDED.silver_return,
                            return_detail=EXCLUDED.return_detail, return_file=EXCLUDED.return_file, return_at=NOW()`,
          [d, x.gold, x.silver, JSON.stringify(x.detail), file]);
    }
    res.json({ kind: rep.kind, dates, days: rep.days });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// One day = Sales report + Sales return, saved together (or Sales + "no sales return" confirmed).
// Body = sale file bytes followed by return file bytes; X-Sale-Len splits them.
app.post('/api/incentive/upload-day', express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
  const month = String(req.query.month || '');
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const body = req.body;
  const saleLen = Number(req.get('x-sale-len'));
  const noReturn = req.query.no_return === '1';
  const saleName = decodeURIComponent(String(req.get('x-sale-name') || 'sales.xlsx')).slice(0, 200);
  const retName = decodeURIComponent(String(req.get('x-return-name') || '')).slice(0, 200);
  if (!body || !body.length || !Number.isInteger(saleLen) || saleLen <= 0 || saleLen > body.length) return res.status(400).json({ error: 'Sales file missing' });
  if (!noReturn && saleLen === body.length) return res.status(400).json({ error: 'Choose the Sales Return file, or tick "No sales return"' });
  if (noReturn && saleLen !== body.length) return res.status(400).json({ error: 'Untick "No sales return" or remove the return file' });
  try {
    let sale, ret = null;
    try { sale = await readIncentiveReport(body.subarray(0, saleLen)); } catch (e) { throw new Error('Sales file: ' + e.message); }
    if (sale.kind !== 'sale') throw new Error('The file in "Sales report" is a Sales Return file');
    const sDates = Object.keys(sale.days).sort();
    if (!sDates.length) throw new Error('No sale rows found in the Sales report');
    if (sDates.length > 1) throw new Error(`Sales report has more than one date (${sDates.join(', ')}). Upload one day at a time.`);
    const d = sDates[0];
    if (!d.startsWith(month)) throw new Error(`Sales report is for ${d.split('-').reverse().join('-')}, not this month`);
    const x = sale.days[d];
    let r = { gold: 0, silver: 0, detail: { bills: 0, none: true } };
    if (!noReturn) {
      try { ret = await readIncentiveReport(body.subarray(saleLen)); } catch (e) { throw new Error('Return file: ' + e.message); }
      if (ret.kind !== 'return') throw new Error('The file in "Sales return" is a Sales report, not a return');
      const rDates = Object.keys(ret.days);
      const other = rDates.filter(k => k !== d);
      if (other.length) throw new Error(`Sales return is for ${other.map(k => k.split('-').reverse().join('-')).join(', ')} but the Sales report is for ${d.split('-').reverse().join('-')}`);
      if (ret.days[d]) r = ret.days[d]; else r = { gold: 0, silver: 0, detail: { bills: 0 } };
    }
    const row = await pool.query(`INSERT INTO incentive_sales_day (sale_date, gold_sale, silver_sale, sale_detail, sale_file, sale_at,
                                    gold_return, silver_return, return_detail, return_file, return_at)
                      VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,NOW())
                      ON CONFLICT (sale_date) DO UPDATE SET gold_sale=EXCLUDED.gold_sale, silver_sale=EXCLUDED.silver_sale,
                        sale_detail=EXCLUDED.sale_detail, sale_file=EXCLUDED.sale_file, sale_at=NOW(),
                        gold_return=EXCLUDED.gold_return, silver_return=EXCLUDED.silver_return,
                        return_detail=EXCLUDED.return_detail, return_file=EXCLUDED.return_file, return_at=NOW()
                      RETURNING (xmax <> 0) AS replaced`,
      [d, x.gold, x.silver, JSON.stringify(x.detail), saleName, r.gold, r.silver, JSON.stringify(r.detail), noReturn ? null : retName || 'return.xlsx']);
    res.json({ date: d, sale: x, ret: r, no_return: noReturn, replaced: row.rows[0].replaced });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Latest uploaded day (any month)
async function lastIncentiveUpload() {
  const q = await pool.query(`SELECT to_char(sale_date,'YYYY-MM-DD') d, sale_file, return_file, (return_detail->>'none') = 'true' AS no_return,
                                     GREATEST(sale_at, COALESCE(return_at, sale_at)) AS at
                              FROM incentive_sales_day WHERE sale_at IS NOT NULL ORDER BY sale_date DESC LIMIT 1`);
  return q.rows[0] || null;
}

// Remove one day's sales or return upload
app.delete('/api/incentive/sales-day/:date/:kind', async (req, res) => {
  const { date, kind } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !['sale', 'return'].includes(kind)) return res.status(400).json({ error: 'Bad request' });
  try {
    if (kind === 'sale') await pool.query('UPDATE incentive_sales_day SET gold_sale=NULL, silver_sale=NULL, sale_detail=NULL, sale_file=NULL, sale_at=NULL WHERE sale_date=$1', [date]);
    else await pool.query('UPDATE incentive_sales_day SET gold_return=NULL, silver_return=NULL, return_detail=NULL, return_file=NULL, return_at=NULL WHERE sale_date=$1', [date]);
    await pool.query('DELETE FROM incentive_sales_day WHERE sale_date=$1 AND sale_at IS NULL AND return_at IS NULL', [date]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive: the calculation ──────────────────────────────────────
// For every day that has a sales upload:
//   gold pool   = (gold sold − gold returned)   × gold_rate
//   silver pool = (silver sold − silver returned) × silver_rate
//   each pool → pct_sales_backend % to Sales + Backend, pct_supervisor % to Supervisor
//   a group's share is split EQUALLY among staff who EARN that day:
//     role in the group, Gold (or Silver) switch on, month result OK, day = P, no minor penalty that day
//   staff who don't earn that day are simply left out, so the others get more. Driver gets nothing.
const INC_GROUPS = [['sales_backend', ['Sales', 'Backend'], 'pct_sales_backend'], ['supervisor', ['Supervisor'], 'pct_supervisor']];
const r2 = n => Math.round(n * 100) / 100;
async function computeIncentive(month) {
  const [yr, mo] = month.split('-').map(Number);
  const [att, settings, sd] = await Promise.all([
    computeIncentiveAttendance(month),
    getIncentiveSettings(),
    pool.query(`SELECT to_char(sale_date,'YYYY-MM-DD') d, gold_sale, silver_sale, sale_detail, sale_file, gold_return, silver_return, return_detail, return_file
                FROM incentive_sales_day WHERE sale_date >= $1 AND sale_date < ($1::date + INTERVAL '1 month') ORDER BY sale_date`, [`${month}-01`]),
  ]);
  const dim = att.days_in_month;
  const staff = att.staff.map(x => ({ ...x, days: Array(dim).fill(0), gold_days: Array(dim).fill(0), silver_days: Array(dim).fill(0), total: 0 }));
  const days = [];
  for (const row of sd.rows) {
    const day = Number(row.d.slice(8, 10));
    const hasSale = row.gold_sale != null || row.silver_sale != null;
    const g = Math.max(0, Number(row.gold_sale || 0) - Number(row.gold_return || 0));
    const s = Math.max(0, Number(row.silver_sale || 0) - Number(row.silver_return || 0));
    const info = {
      date: row.d, day, has_sale: hasSale, has_return: row.gold_return != null || row.silver_return != null,
      gold_sale: Number(row.gold_sale || 0), silver_sale: Number(row.silver_sale || 0),
      gold_return: Number(row.gold_return || 0), silver_return: Number(row.silver_return || 0),
      gold_final: r3(g), silver_final: r3(s),
      gold_pool: hasSale ? r2(g * settings.gold_rate) : 0, silver_pool: hasSale ? r2(s * settings.silver_rate) : 0,
      sale_detail: row.sale_detail, sale_file: row.sale_file, return_detail: row.return_detail, return_file: row.return_file,
      groups: {}, unpaid: 0,
    };
    if (hasSale) {
      for (const metal of ['gold', 'silver']) {
        const poolAmt = info[metal + '_pool'];
        for (const [gk, roles, pk] of INC_GROUPS) {
          const share = poolAmt * settings[pk] / 100;
          const earners = staff.filter(x => x.result === 'OK' && roles.includes(x.role) && x[metal]
            && x.codes[day - 1] === 'P' && !x.minor_days.includes(day));
          // Everyone in the team gets the SAME amount: share ÷ earners, rounded UP to the paisa
          // (owner's rule — the few extra paise are paid on top of the pool)
          const paise = Math.round(share * 100);
          const each = earners.length ? Math.ceil(paise / earners.length) / 100 : 0;
          (info.groups[gk] ||= {})[metal] = { share: r2(share), earners: earners.length, each };
          if (!earners.length) { info.unpaid += share; continue; }
          for (const x of earners) { x[metal + '_days'][day - 1] += each; x.days[day - 1] += each; }
        }
      }
    }
    info.unpaid = r2(info.unpaid);
    days.push(info);
  }
  for (const x of staff) {
    x.days = x.days.map(r2); x.gold_days = x.gold_days.map(r2); x.silver_days = x.silver_days.map(r2);
    x.gold_total = r2(x.gold_days.reduce((a, b) => a + b, 0));
    x.silver_total = r2(x.silver_days.reduce((a, b) => a + b, 0));
    x.total = r2(x.days.reduce((a, b) => a + b, 0));
  }
  return { month, days_in_month: dim, leave_limit: att.leave_limit, minor_allowed: att.minor_allowed, settings, days, staff };
}
app.get('/api/incentive/calc', async (req, res) => {
  const month = String(req.query.month || '');
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  try {
    const [c, last] = await Promise.all([computeIncentive(month), lastIncentiveUpload()]);
    res.json({ ...c, last_upload: last });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive dashboard: one month in full + last 6 months' totals ──
app.get('/api/incentive/dashboard', async (req, res) => {
  const month = String(req.query.month || '');
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  try {
    const [yr, mo] = month.split('-').map(Number);
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(yr, mo - 6 + i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
    const [c, last, pen, penHist, have] = await Promise.all([
      computeIncentive(month), lastIncentiveUpload(),
      pool.query('SELECT employee_id, day, type_name, severity FROM incentive_mistakes WHERE month=$1 ORDER BY day', [month]),
      pool.query(`SELECT m.month, m.employee_id, COALESCE(NULLIF(e.alias_name,''), e.employee_name) AS name, m.type_name, m.severity
                  FROM incentive_mistakes m LEFT JOIN employees e ON TRIM(e.employee_id::text) = TRIM(m.employee_id::text)
                  WHERE m.month = ANY($1) ORDER BY m.month`, [months]),
      pool.query(`SELECT to_char(sale_date,'YYYY-MM') m, COUNT(*)::int n FROM incentive_sales_day
                  WHERE sale_at IS NOT NULL AND sale_date >= $1 AND sale_date < ($2::date + INTERVAL '1 month') GROUP BY 1`, [`${months[0]}-01`, `${month}-01`]),
    ]);
    const withData = new Map(have.rows.map(r => [r.m, r.n]));
    const trend = await Promise.all(months.map(async m => {
      if (!withData.has(m)) return { month: m, days: 0, paid: 0, gold_pool: 0, silver_pool: 0 };
      const x = m === month ? c : await computeIncentive(m);
      return { month: m, days: withData.get(m), paid: r2(x.staff.reduce((a, s) => a + s.total, 0)),
               gold_pool: r2(x.days.reduce((a, d) => a + d.gold_pool, 0)), silver_pool: r2(x.days.reduce((a, d) => a + d.silver_pool, 0)) };
    }));
    res.json({ ...c, last_upload: last, penalties: pen.rows, penalty_history: penHist.rows, trend });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive: daily staff sales report (printable, with signatures) ──
// Who is listed: Eligible in Staff List AND Female AND (Role = Sales OR made bills that day).
// Numbers: ALL items of the day (no discount/chit/coin filter, no returns) — same as the owner's sheet.
app.get('/api/incentive/daily-report', async (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  try {
    const [yy, mm, dd] = date.split('-').map(Number);
    const [day, attq, emp] = await Promise.all([
      pool.query(`SELECT sale_detail, sale_file, sale_at FROM incentive_sales_day WHERE sale_date=$1`, [date]),
      pool.query(`SELECT TRIM(employee_id::text) AS id, day_${dd} AS code FROM attendance WHERE year=$1 AND month=$2`, [yy, mm]),
      pool.query(`SELECT e.employee_id, e.employee_name, e.alias_name, e.gender, i.role
                  FROM employees e JOIN incentive_eligibility i ON TRIM(i.employee_id::text) = TRIM(e.employee_id::text)
                  WHERE i.eligible = true AND UPPER(TRIM(e.gender)) = 'FEMALE' AND UPPER(COALESCE(e.type,'')) <> 'OTHERS'`),
    ]);
    const row = day.rows[0];
    if (!row || !row.sale_detail) return res.json({ date, uploaded: false, rows: [] });
    const sales = row.sale_detail.staff_sales;
    if (!sales) return res.json({ date, uploaded: true, needs_reupload: true, rows: [] });
    const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const byNorm = new Map(Object.entries(sales).map(([k, v]) => [norm(k), { name: k, ...v }]));
    const used = new Set(), rows = [];
    const attCode = new Map(attq.rows.map(a => [a.id, String(a.code || '').trim().toUpperCase()]));
    // that day's attendance → status shown when she sold nothing
    const dayStatus = code => !code ? '' : (code === 'LR' || code === 'LU') ? 'LEAVE' : code.startsWith('H') ? 'HALF' : code === 'P' ? 'PRESENT' : code;
    for (const e of emp.rows) {
      const keys = [norm(e.alias_name), norm(e.employee_name)].filter(Boolean);
      const k = keys.find(x => byNorm.has(x) && !used.has(x));
      const s = k ? byNorm.get(k) : null;
      if (e.role !== 'Sales' && !s) continue;                 // non-Sales role only when she made bills that day
      if (k) used.add(k);
      rows.push({ employee_id: e.employee_id, name: e.alias_name || e.employee_name, bill_name: s ? s.name : null, role: e.role,
                  att: dayStatus(attCode.get(String(e.employee_id).trim())),
                  c: s ? s.c : 0, gq: s ? s.gq : 0, gw: s ? s.gw : 0, sq: s ? s.sq : 0, sw: s ? s.sw : 0 });
    }
    // bill names that did not match anyone listed (shown as a note so nothing is silently lost)
    const unmatched = [...byNorm.entries()].filter(([k]) => !used.has(k)).map(([, v]) => ({ name: v.name, c: v.c, gw: v.gw, sw: v.sw }));
    res.json({ date, uploaded: true, file: row.sale_file, rows, unmatched });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive: Excel export of one month (staff grid + daily sales) ──
app.get('/api/incentive/export', async (req, res) => {
  const month = String(req.query.month || '');
  if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  try {
    const c = await computeIncentive(month), dim = c.days_in_month;
    const [yr, mo] = month.split('-').map(Number);
    const title = new Date(yr, mo - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    const wb = new ExcelJS.Workbook();
    const bold = { bold: true }, money = '#,##0.00', grams = '#,##0.000';

    // Sheet 1: staff × day (like the Calculation grid)
    const ws = wb.addWorksheet('Staff incentive', { views: [{ state: 'frozen', xSplit: 6, ySplit: 2 }] });
    ws.addRow([`Monthly Incentive — ${title}`]).font = { bold: true, size: 14 };
    ws.addRow(['Emp ID', 'Name', 'Role', 'Gold ₹', 'Silver ₹', 'Total ₹', ...Array.from({ length: dim }, (_, i) => i + 1)]).font = bold;
    const roleRank = r => ({ Sales: 0, Backend: 1, Supervisor: 2, Driver: 3 }[r] ?? 4);
    const list = c.staff.filter(x => x.eligible).sort((a, b) => (b.result === 'OK') - (a.result === 'OK') || roleRank(a.role) - roleRank(b.role) || String(a.alias || a.name).localeCompare(String(b.alias || b.name)));
    for (const x of list) {
      const row = ws.addRow([x.employee_id, x.alias || x.name, x.role || '', x.gold_total, x.silver_total, x.total, ...x.days.map(v => v || null)]);
      if (x.result !== 'OK') row.getCell(2).note = '₹0 this month (' + x.result + ')';
    }
    const tot = ws.addRow(['', 'TOTAL', '', ...['gold_total', 'silver_total', 'total'].map(k => r2(list.reduce((a, x) => a + x[k], 0))),
      ...Array.from({ length: dim }, (_, i) => r2(list.reduce((a, x) => a + x.days[i], 0)) || null)]);
    tot.font = bold;
    ws.getColumn(2).width = 22; ws.getColumn(3).width = 12;
    for (let i = 4; i <= 6 + dim; i++) { ws.getColumn(i).numFmt = money; ws.getColumn(i).width = i <= 6 ? 12 : 9; }

    // Sheet 2: daily sales summary
    const ds = wb.addWorksheet('Daily sales', { views: [{ state: 'frozen', ySplit: 1 }] });
    ds.addRow(['Date', 'Gold sales g', 'Gold return g', 'Gold discount g', 'Gold chit g', 'Gold coin g', 'Gold final g', 'Gold pool ₹',
               'Silver sales g', 'Silver return g', 'Silver discount g', 'Silver chit g', 'Silver coin g', 'Silver final g', 'Silver pool ₹', 'Total pool ₹']).font = bold;
    for (const x of c.days.filter(d => d.has_sale)) {
      const d = x.sale_detail || {};
      ds.addRow([x.date.split('-').reverse().join('-'),
        d.all_gold ?? x.gold_sale, x.gold_return, d.discount_gold || 0, d.chit_gold || 0, d.coin_gold || 0, x.gold_final, x.gold_pool,
        d.all_silver ?? x.silver_sale, x.silver_return, d.discount_silver || 0, d.chit_silver || 0, d.coin_silver || 0, x.silver_final, x.silver_pool,
        r2(x.gold_pool + x.silver_pool)]);
    }
    ds.getColumn(1).width = 12;
    for (let i = 2; i <= 16; i++) { ds.getColumn(i).width = 14; ds.getColumn(i).numFmt = [8, 15, 16].includes(i) ? money : grams; }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Incentive-${month}.xlsx"`);
    await wb.xlsx.write(res); res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive: which months have data (for the month picker) ────────
app.get('/api/incentive/months', async (req, res) => {
  try {
    const dayCols = Array.from({ length: 31 }, (_, i) => `day_${i + 1}`).join(', ');
    const [a, m] = await Promise.all([
      pool.query(`SELECT year::int AS y, month::int AS m, COUNT(*)::int AS n FROM attendance
                  WHERE COALESCE(${dayCols}) IS NOT NULL GROUP BY 1, 2`),
      pool.query('SELECT month, COUNT(*)::int AS n FROM incentive_mistakes GROUP BY month'),
    ]);
    const out = {};
    for (const r of a.rows) out[`${r.y}-${String(r.m).padStart(2, '0')}`] = { staff: r.n, penalties: 0 };
    for (const r of m.rows) (out[r.month] ||= { staff: 0, penalties: 0 }).penalties = r.n;
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive: mistake headings ─────────────────────────────────────
app.get('/api/incentive/mistake-types', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name FROM incentive_mistake_types ORDER BY name');
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/incentive/mistake-types', async (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) return res.status(400).json({ error: 'Name is required (max 120 letters)' });
  try {
    const dup = await pool.query('SELECT id FROM incentive_mistake_types WHERE LOWER(name) = LOWER($1)', [name]);
    if (dup.rows.length) return res.status(409).json({ error: 'This penalty heading already exists' });
    const r = await pool.query('INSERT INTO incentive_mistake_types (name) VALUES ($1) RETURNING id, name', [name]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Monthly Incentive: mistakes recorded ────────────────────────────────────
app.get('/api/incentive/mistakes', async (req, res) => {
  const month = String(req.query.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  try {
    const r = await pool.query(
      'SELECT id, employee_id, day, type_id, type_name, severity, remark, created_at FROM incentive_mistakes WHERE month=$1 ORDER BY day, id', [month]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/incentive/mistakes', async (req, res) => {
  const b = req.body || {};
  const month = String(b.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
  const [yr, mo] = month.split('-').map(Number);
  const day = Number(b.day);
  if (!Number.isInteger(day) || day < 1 || day > new Date(yr, mo, 0).getDate()) return res.status(400).json({ error: 'Pick a valid date in this month' });
  const employee_id = String(b.employee_id || '').trim();
  if (!employee_id) return res.status(400).json({ error: 'Pick a staff' });
  const remark = String(b.remark || '').trim().slice(0, 500);
  const severity = String(b.severity || '').toUpperCase();
  if (!['MINOR', 'MAJOR'].includes(severity)) return res.status(400).json({ error: 'Choose Minor or Major' });
  try {
    const [t, e] = await Promise.all([
      pool.query('SELECT id, name, severity FROM incentive_mistake_types WHERE id=$1', [Number(b.type_id)]),
      pool.query('SELECT 1 FROM employees WHERE TRIM(employee_id::text) = $1', [employee_id]),
    ]);
    if (!t.rows.length) return res.status(400).json({ error: 'Pick a penalty heading' });
    if (!e.rows.length) return res.status(400).json({ error: 'Staff not found in Payroll' });
    const ty = t.rows[0];
    const r = await pool.query(
      `INSERT INTO incentive_mistakes (month, employee_id, day, type_id, type_name, severity, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, employee_id, day, type_id, type_name, severity, remark, created_at`,
      [month, employee_id, day, ty.id, ty.name, severity, remark || null]);
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/incentive/mistakes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const r = await pool.query('DELETE FROM incentive_mistakes WHERE id=$1', [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Already removed' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = app;
