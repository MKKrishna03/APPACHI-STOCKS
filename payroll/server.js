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
      await pool.query(`ALTER TABLE payroll ADD COLUMN IF NOT EXISTS allowance_deduction NUMERIC DEFAULT 0`);

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
  const a = attMap[emp.employee_id] || { P: 0, L: 0, H: 0 };
  const absent = (parseInt(a.L) || 0) + ((parseInt(a.H) || 0) * 0.5);
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
    pool.query(
      `SELECT * FROM employees
       WHERE (status = 'ACTIVE' OR (status = 'INACTIVE' AND inactive_from > $1))
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
    let P = 0, L = 0, H = 0;
    for (let d = 1; d <= 31; d++) {
      const val = row[`day_${d}`];
      if (!val) continue;
      if (val === 'P') P++;
      else if (val[0] === 'L') L++;
      else if (val[0] === 'H') H++;
    }
    attMap[row.employee_id] = { P, L, H };
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

  return { emps: emps.rows, attMap, advMap, daysInMonth, permMap };
}

// ── ADD EMPLOYEE ─────────────────────────────────────────────────────────────
app.post('/api/employees', async (req, res) => {
  const data = req.body;
  const sql = `INSERT INTO employees
    (type, employee_id, employee_name, account_number, gender, designation, mop, gross_pay,
     pf_enable, esic_enable, gross_g, epf, eps, edli, g12_percent, ee, edli_8_33_percent,
     eps_value, g3_67_percent, er, total_ip_contribution, total_employer_contribution,
     labour_act, allowance, salary_after_deduction, alias_name, joining_date)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`;

  const values = [
    data.type, data.employee_id, data.employee_name, data.account_number,
    data.gender, data.designation, data.mop, data.gross_pay,
    data.pf_enable ? true : false, data.esic_enable ? true : false,
    data.basic, data.epf, data.eps, data.edli,
    data.ee, data.ee, data.eps_value, data.eps_value,
    data.er, data.er,
    data.total_ip_contribution, data.total_employer_contribution,
    data.labour_act || null, data.allowance, data.salary_after_deduction,
    data.alias_name || null, data.joining_date || null
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
    sql = `SELECT * FROM employees
           WHERE (TRIM(status) = 'ACTIVE' OR (TRIM(status) = 'INACTIVE' AND inactive_from > $1))
             AND (joining_date IS NULL OR joining_date <= $2)`;
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
    salary_after_deduction=$25, alias_name=$26, joining_date=$27 WHERE employee_id=$28`;

  const values = [
    data.status, data.type, data.employee_name, data.account_number, data.gender,
    data.designation, data.mop, data.gross_pay,
    data.pf_enable ? true : false, data.esic_enable ? true : false,
    data.basic, data.epf, data.eps, data.edli,
    data.ee, data.ee, data.eps_value, data.eps_value,
    data.er, data.er,
    data.total_ip_contribution, data.total_employer_contribution,
    data.labour_act || null, data.allowance, data.salary_after_deduction,
    data.alias_name || null, data.joining_date || null, req.params.id
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
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
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
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GENERATE CUSTOM PAYROLL ───────────────────────────────────────────────────
app.post('/api/payroll/generate-custom', async (req, res) => {
  const { month, overrides, leaveAffectsPfEsic } = req.body;
  try {
    const { emps, attMap, advMap, daysInMonth, permMap } = await fetchPayrollInputs(month);
    const result = emps.map(emp => {
      const allowedLeave = parseFloat(overrides[emp.employee_id] ?? 4);
      return calcPayrollRow(emp, attMap, advMap, allowedLeave, daysInMonth, permMap, !!leaveAffectsPfEsic);
    });
    res.json(result);
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
        const absent        = (parseInt(a.L) || 0) + ((parseInt(a.H) || 0) * 0.5);
        const deductedDays  = Math.max(0, absent - 4);
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
    res.json({ success: true });
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
                e.allowance AS emp_allowance, e.pf_enable, e.esic_enable
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
      let rawLeaveDays = 0;
      if (att) {
        for (let d = 1; d <= 31; d++) {
          const val = att[`day_${d}`];
          if (!val) continue;
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
          const absent = (parseInt(a.L) || 0) + ((parseInt(a.H) || 0) * 0.5);
          if (absent > 4) {
            lopTotal += Math.round((parseFloat(emp.gross_pay) / daysInMonth) * (absent - 4));
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
    const [lopRes, attRes, empsRes, permRes, addIncRes] = await Promise.all([
      pool.query(
        `SELECT p.lop, e.employee_name, e.alias_name FROM payroll p
         JOIN employees e ON p.employee_id = e.employee_id
         WHERE p.month = $1`,
        [month]
      ),
      pool.query(`SELECT * FROM attendance WHERE year=$1 AND month=$2`, [yr, mo]),
      pool.query(
        `SELECT employee_id, employee_name, alias_name, salary_after_deduction, allowance, mop
         FROM employees
         WHERE status='ACTIVE' AND type != 'OTHERS'
           AND (joining_date IS NULL OR joining_date <= $1)`,
        [monthEndDate(month)]
      ),
      pool.query(
        `SELECT p.earned_days, e.salary_after_deduction, e.allowance, e.mop
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
      )
    ]);

    const skipLopNames = new Set((SKIP_LOP_IN_SUMMARY[month] || []).map(n => n.toUpperCase()));
    const totalDeduction = Math.round(lopRes.rows.reduce((s, r) => {
      const nm = (r.alias_name || r.employee_name || '').toUpperCase().trim();
      if (skipLopNames.has(nm)) return s;
      return s + (parseFloat(r.lop) || 0);
    }, 0));

    const attMap = {};
    attRes.rows.forEach(r => { attMap[r.employee_id] = r; });

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
      if (incentive_days > 0) {
        const base    = (parseFloat(emp.salary_after_deduction) || 0) + (parseFloat(emp.allowance) || 0);
        const divisor = incFixed ? daysInMonth : 30;
        const trueRaw = (base / divisor) * incentive_days;
        const raw     = Math.round(trueRaw);
        const mop     = (emp.mop || 'CASH').trim().toUpperCase();
        leaveIncentive += (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(raw / 10) * 10;
      }
    }

    // Timing (permission) incentive total from permissions table
    let timingIncentive = 0;
    permRes.rows.forEach(r => {
      const daysEarned = parseFloat(r.earned_days) || 0;
      if (daysEarned >= 1) {
        const base = (parseFloat(r.salary_after_deduction) || 0) + (parseFloat(r.allowance) || 0);
        const trueRaw = (base / daysInMonth) * daysEarned;
        const raw  = Math.round(trueRaw);
        const mop  = (r.mop || 'CASH').trim().toUpperCase();
        timingIncentive += (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(raw / 10) * 10;
      }
    });

    const additionalIncentives = addIncRes.rows.map(r => ({
      name: r.incentive_name,
      total: Math.round(parseFloat(r.total) || 0)
    }));
    const additionalIncentiveTotal = additionalIncentives.reduce((s, r) => s + r.total, 0);

    const balance = totalDeduction - leaveIncentive - timingIncentive - additionalIncentiveTotal;

    res.json({ totalDeduction, leaveIncentive, timingIncentive, additionalIncentives, balance });
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
         WHERE status='ACTIVE' AND type != 'OTHERS'
           AND (joining_date IS NULL OR joining_date <= $1)`,
        [monthEndDate(month)]
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
        const net     = (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(raw / 10) * 10;
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
         WHERE status='ACTIVE' AND (joining_date IS NULL OR joining_date <= $1)`,
        [monthEndDate(month)]
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
            const net        = (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(raw / 10) * 10;
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
      const net        = (mop === 'CUB' || mop === 'BANK') ? raw : Math.ceil(raw / 10) * 10;
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
    const payrollRow = calcPayrollRow(emp, attMap, advMap, 4, daysInMonth, permMap, false);

    const att          = attMap[emp.employee_id] || { P: 0, L: 0, H: 0 };
    const halfDays     = parseInt(att.H) || 0;
    const presentDays  = (parseInt(att.P) || 0) + (halfDays * 0.5);
    const absentDays   = (parseInt(att.L) || 0) + (halfDays * 0.5);
    const isOthers     = (emp.type || '').toUpperCase() === 'OTHERS';

    // LOP override for Staff Data: once absence exceeds 6 days in the month, LOP is
    // charged on the FULL absent day count — the normal 4-day free allowance no longer
    // applies (it only applies for 6 or fewer absent days, e.g. 6.5 absent days → LOP on 6.5).
    const permDeductDaysForLop = (!isOthers && permMap[String(emp.employee_id)]) ? 1 : 0;
    const deductedDays = isOthers
      ? 0
      : (absentDays > 6 ? absentDays : Math.max(0, absentDays - 4)) + permDeductDaysForLop;
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

module.exports = app;
