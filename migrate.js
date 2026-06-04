/**
 * One-time migration: TOTAL STOCKS.xlsx → Turso DB
 * Run: node migrate.js
 * Safe to re-run — skips rows that already exist (date + stock match).
 */

require('dotenv').config();
const XLSX   = require('xlsx');
const { createClient } = require('@libsql/client');

const db = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Sheet name → stock table ID
const SHEET_MAP = {
  'CASH':              'cash',
  'STEPS':             'steps',
  'CHITTAI':           'chittai',
  'DOOR OPEN':         'shop_opening',
  'DOOR CLOSING':      'shop_closing',
  'MOR CLEAN':         'morning_cleaning',
  'COLLECTION':        'collection',
  'PURSE':             'purse_bag_stock',
  'FAN CLEAN':         'fan_cleaning',
  'MAADI CLEAN':       'maadi_cleaning',
  'KOLUSU':            'kolusu_stock',
  'SL':                'sl_stock',
  'PATHIRAM':          'pathiram_stock',
  'PATHIRAM,SL BOX':   'pathiram_sl_box',
  'MET.MKT':           'metty_mookuthi',
  'TEA':               'tea',
  'RING':              'ring_stock',
  'CHAIN':             'chain_stock',
  'DROPS':             'drops_stock',
  'CHAIN ARR':         'chain_arrange',
  'DROPS ARR':         'drops_arrange',
  'SIL.ARR (MOR&EVE)': 'silver_arrange',
  'TRAY ARR':          'tray_arrange',
  'DUSTBIN CHECK':     'dustbin_checking',
  'DUSTBIN CLEAN':     'dustbin_cleaning',
  'EVENING CLEAN':     'evening_cleaning',
};

// Convert Excel date serial → "YYYY-MM-DD"
function toISO(serial) {
  if (!serial || typeof serial !== 'number' || serial < 1) return null;
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d || !d.y) return null;
  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
}

async function migrate() {
  const wb = XLSX.readFile('TOTAL STOCKS.xlsx');

  let totalInserted = 0;
  let totalSkipped  = 0;

  for (const [sheetName, catId] of Object.entries(SHEET_MAP)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      console.log(`⚠  Sheet "${sheetName}" not found — skipping`);
      continue;
    }

    // rows[0] = title, rows[1] = headers, rows[2+] = data
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const dataRows = rows.slice(2);

    if (!dataRows.length) {
      console.log(`⚪ ${sheetName} → ${catId}: no data rows`);
      continue;
    }

    // Load existing (date,stock) pairs so we can skip duplicates
    const existing = new Set();
    try {
      const res = await db.execute(`SELECT date, stock FROM stock_${catId}`);
      for (const row of res.rows) existing.add(`${row.date}|${row.stock}`);
    } catch (_) {
      // Table may not exist yet (chittai) — it will be created on server start,
      // but we can create it here too so the migration can run standalone.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS stock_${catId} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL, stock TEXT, name TEXT, entry_by TEXT,
          created_at TEXT DEFAULT (datetime('now','localtime'))
        )
      `);
    }

    let inserted = 0;
    let skipped  = 0;

    for (const row of dataRows) {
      const dateSerial = row[0];
      const stockAlias = row[1];

      // Skip rows with missing date or name
      if (!dateSerial || typeof dateSerial !== 'number') { skipped++; continue; }
      if (!stockAlias || typeof stockAlias !== 'string' || !stockAlias.trim()) { skipped++; continue; }

      const date  = toISO(dateSerial);
      if (!date) { skipped++; continue; }

      const stock   = stockAlias.trim();
      const entryBy = (row[2] && typeof row[2] === 'string') ? row[2].trim() : 'MIGRATE';

      const key = `${date}|${stock}`;
      if (existing.has(key)) { skipped++; continue; }

      await db.execute({
        sql:  `INSERT INTO stock_${catId} (date, stock, name, entry_by) VALUES (?, ?, ?, ?)`,
        args: [date, stock, '', entryBy],
      });

      existing.add(key);
      inserted++;
    }

    console.log(`✓  ${sheetName.padEnd(20)} → ${catId.padEnd(20)} | inserted: ${inserted}, skipped: ${skipped}`);
    totalInserted += inserted;
    totalSkipped  += skipped;
  }

  console.log(`\nDone. Total inserted: ${totalInserted}, total skipped: ${totalSkipped}`);
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
