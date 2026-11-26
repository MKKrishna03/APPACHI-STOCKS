// Purchase Pro — GSTR-2B check. The GST portal's GSTR-2B lists every bill our suppliers filed
// against our GSTIN. Matched here by plain rules (no AI, no guessing):
//   GSTIN → supplier, then bill number, then taxable value + tax.
// Results:
//   missing      — on GSTR-2B, not entered here (a bill we never got / never entered)
//   no_supplier  — on GSTR-2B, the GSTIN is not any supplier here
//   amtdiff      — found, but taxable value or tax differs by more than ₹1
//   numdiff      — found by GSTIN + amount + date, but the bill no is typed differently
//   datediff     — found, amounts match, date differs
//   ok           — everything matches
//   not_filed    — our bill with GST that is on no uploaded GSTR-2B (supplier has not filed it)

const { FIRM_GSTIN } = require('./firm');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { if (v == null || String(v).trim() === '') return 0; const n = Number(String(v).replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const normNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
const digitsOf = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$/;
// the bill's own number = its longest run of digits ("SJ/1021/26-27" → 1021)
const mainNo = (s) => (String(s || '').match(/\d+/g) || []).map(x => x.replace(/^0+/, '')).sort((a, b) => b.length - a.length)[0] || '';
// DD-MM-YYYY / DD/MM/YYYY / YYYY-MM-DD / Excel serial → YYYY-MM-DD
function isoDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})$/);   // 03-Oct-2026
  if (m) { const mo = 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m[2].toUpperCase()) / 3 + 1; if (mo > 0) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10);
  return '';
}
const days = (a, b) => (a && b ? Math.abs((new Date(a) - new Date(b)) / 86400000) : 999);

// ── GSTR-2B JSON (also GSTR-2A style "itms / itm_det") → docs ──
function fromJson(j) {
  const d = j && j.data ? j.data : j || {};
  const dd = d.docdata || d;
  const docs = [];
  const sumItems = (x) => {
    const its = x.items || (x.itms || []).map(i => i.itm_det || i) || [];
    const t = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    for (const i of its) { t.taxable += num(i.txval); t.igst += num(i.igst ?? i.iamt); t.cgst += num(i.cgst ?? i.camt); t.sgst += num(i.sgst ?? i.samt); t.cess += num(i.cess ?? i.csamt); }
    if (!its.length) { t.taxable = num(x.txval); t.igst = num(x.igst); t.cgst = num(x.cgst); t.sgst = num(x.sgst); t.cess = num(x.cess); }
    return t;
  };
  for (const [sec, list, kind] of [['b2b', dd.b2b, 'INV'], ['b2ba', dd.b2ba, 'INV'], ['cdnr', dd.cdnr, null], ['cdnra', dd.cdnra, null]]) {
    for (const s of list || []) {
      const rows = s.inv || s.nt || [];
      for (const x of rows) {
        const typ = kind || (String(x.typ || x.ntty || '').toUpperCase().startsWith('D') ? 'DN' : 'CN');
        docs.push({
          type: typ, gstin: String(s.ctin || '').toUpperCase().trim(), name: s.trdnm || '',
          no: String(x.inum || x.ntnum || x.nt_num || '').trim(), date: isoDate(x.dt || x.idt || x.nt_dt),
          value: num(x.val), ...sumItems(x), itc: String(x.itcavl || '').toUpperCase() === 'N' ? 'N' : 'Y',
          rev: String(x.rev || '').toUpperCase() === 'Y' ? 'Y' : 'N', filed: isoDate(s.supfildt || s.fldtr1), amended: sec.endsWith('a'),
        });
      }
    }
  }
  const p = String(d.rtnprd || d.ret_period || d.fp || '');
  const period = /^\d{6}$/.test(p) ? `${p.slice(2)}-${p.slice(0, 2)}` : '';
  return { docs, period, gstin: String(d.gstin || '').toUpperCase() };
}

// ── GSTR-2B Excel (sheets as arrays of rows, from the browser) → docs ──
function fromSheets(sheets) {
  const docs = [];
  let period = '', gstin = '';
  for (const [name, rows] of Object.entries(sheets || {})) {
    if (!Array.isArray(rows)) continue;
    // header text anywhere: our GSTIN and the tax period (e.g. "Tax period: October 2026" / "102026")
    for (const r of rows.slice(0, 8)) for (const c of r || []) {
      const s = String(c || '');
      const g = s.toUpperCase().match(/\b[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}\b/); if (g && !gstin) gstin = g[0];
      const mm = s.match(/(January|February|March|April|May|June|July|August|September|October|November|December)[^0-9]{0,6}(\d{4})/i);
      if (mm && !period) period = `${mm[2]}-${String('january february march april may june july august september october november december'.split(' ').indexOf(mm[1].toLowerCase()) + 1).padStart(2, '0')}`;
    }
    const sec = name.toUpperCase().replace(/\s+/g, '');
    if (!/B2B/.test(sec) || /ISD|IMPG/.test(sec)) continue;
    const isNote = /CDN/.test(sec);
    const h = rows.findIndex(r => (r || []).some(c => /GSTIN of supplier/i.test(String(c || ''))));
    if (h === -1) continue;
    const width = Math.max(...rows.slice(h, h + 3).map(r => (r || []).length));
    const label = []; let carry = '';
    for (let j = 0; j < width; j++) {
      const top = String((rows[h] || [])[j] || '').trim();
      if (top) carry = top;
      label.push(`${top || carry} ${String((rows[h + 1] || [])[j] || '')} ${String((rows[h + 2] || [])[j] || '')}`.replace(/\s+/g, ' '));
    }
    const col = (re, not) => label.findIndex(l => re.test(l) && !(not && not.test(l)));
    const C = {
      gstin: col(/GSTIN of supplier/i), name: col(/Trade|Legal name/i), no: col(/(Invoice|Note) (number|no)/i, /original/i), type: col(/(Invoice|Note) type/i),
      date: col(/(Invoice|Note) date/i, /original|IRN|filing/i), value: col(/(Invoice|Note) value/i), taxable: col(/Taxable value/i),
      igst: col(/Integrated tax/i), cgst: col(/Central tax/i), sgst: col(/State\/?UT tax/i), cess: col(/Cess/i),
      itc: col(/ITC availability/i), rev: col(/Reverse charge/i), filed: col(/Filing date/i),
    };
    if (C.gstin < 0 || C.no < 0) continue;
    const byKey = new Map();
    for (const r of rows.slice(h + 1)) {
      const g = String((r || [])[C.gstin] || '').toUpperCase().trim();
      if (!GSTIN_RE.test(g)) continue;
      const no = String(r[C.no] || '').trim();
      if (!no) continue;
      const tcell = C.type >= 0 ? String(r[C.type] || '') : '';
      const type = isNote ? (/debit/i.test(tcell) ? 'DN' : 'CN') : 'INV';
      const k = `${type}|${g}|${normNo(no)}`;
      const at = (j) => (j >= 0 ? r[j] : '');
      // one row per tax rate → add the rows of one bill together
      const cur = byKey.get(k) || { type, gstin: g, name: String(at(C.name) || ''), no, date: isoDate(at(C.date)), value: num(at(C.value)), taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0,
        itc: /^n/i.test(String(at(C.itc))) ? 'N' : 'Y', rev: /^y/i.test(String(at(C.rev))) ? 'Y' : 'N', filed: isoDate(at(C.filed)), amended: /B2BA|CDNRA/.test(sec) };
      cur.taxable += num(at(C.taxable)); cur.igst += num(at(C.igst)); cur.cgst += num(at(C.cgst)); cur.sgst += num(at(C.sgst)); cur.cess += num(at(C.cess));
      byKey.set(k, cur);
    }
    docs.push(...byKey.values());
  }
  return { docs, period, gstin };
}

function normalise(body) {
  const r = body.json ? fromJson(body.json) : fromSheets(body.sheets);
  r.docs = r.docs.filter(d => d.gstin && d.no).map(d => ({ ...d, taxable: r2(d.taxable), igst: r2(d.igst), cgst: r2(d.cgst), sgst: r2(d.sgst), cess: r2(d.cess), value: r2(d.value) }));
  return r;
}

const KIND_OF = { INV: ['PURCHASE', 'EXPENSE', 'HALLMARK', 'LABOUR'], CN: ['CREDIT_NOTE'], DN: ['DEBIT_NOTE'] };
const gstOf = (b) => r2((Number(b.cgst) || 0) + (Number(b.sgst) || 0) + (Number(b.igst) || 0));

// periods: [{ period, docs }] (every uploaded GSTR-2B). by: Map(party → entries), parties: Map(id → party with gstin).
// Returns per period the matched docs, and the set of our bill ids found on any GSTR-2B.
function match(periods, by, parties) {
  const pidOf = new Map();
  for (const [id, p] of parties) if (p.gstin && !p.deleted_at) pidOf.set(String(p.gstin).toUpperCase(), id);
  const billsOf = (pid) => (by.get(pid) || { bills: [] }).bills;
  const found = new Map();   // bill id → { period, no }
  const out = [];
  // oldest period first, so a bill is credited to the first GSTR-2B it appears on
  for (const per of [...periods].sort((a, b) => (a.period < b.period ? -1 : 1))) {
    const rows = per.docs.map((d, i) => {
      const pid = pidOf.get(d.gstin);
      const tax = r2(d.igst + d.cgst + d.sgst);
      const base = { ...d, i, tax, period: per.period, party_id: pid || null, party_name: pid ? parties.get(pid).name : null };
      if (!pid) return { ...base, status: 'no_supplier' };
      const cands = billsOf(pid).filter(b => KIND_OF[d.type].includes(b.kind) && !found.has(b.id));
      const n = normNo(d.no), dg = digitsOf(d.no);
      // 1. same bill no  2. same number part + same taxable  3. same taxable (±₹1) and date within 3 days
      let b = cands.find(x => normNo(x.bill_no) === n), how = 'no';
      if (!b && dg.length >= 3) { b = cands.find(x => digitsOf(x.bill_no) === dg && Math.abs(x.taxable - d.taxable) <= 1); if (b) how = 'num'; }
      const mn = mainNo(d.no);
      if (!b && mn.length >= 2) { b = cands.find(x => mainNo(x.bill_no) === mn && Math.abs(x.taxable - d.taxable) <= 1); if (b) how = 'num'; }
      if (!b) { b = cands.find(x => Math.abs(x.taxable - d.taxable) <= 1 && Math.abs(gstOf(x) - tax) <= 1 && days(x.bill_date, d.date) <= 3); if (b) how = 'num'; }
      if (!b) return { ...base, status: 'missing' };
      found.set(b.id, { period: per.period, no: d.no });
      const bill = { id: b.id, bill_no: b.bill_no, bill_date: b.bill_date, kind: b.kind, taxable: r2(b.taxable), tax: gstOf(b), igst: r2(b.igst), cgst: r2(b.cgst), sgst: r2(b.sgst), total: r2(b.total) };
      const diffs = [];
      if (Math.abs(bill.taxable - d.taxable) > 1) diffs.push(`taxable ours ₹${bill.taxable} vs GSTR-2B ₹${d.taxable}`);
      if (Math.abs(bill.tax - tax) > 1) diffs.push(`GST ours ₹${bill.tax} vs GSTR-2B ₹${tax}`);
      else if ((bill.igst > 0) !== (d.igst > 0) && tax > 0) diffs.push(bill.igst > 0 ? 'we entered IGST, supplier filed CGST+SGST' : 'we entered CGST+SGST, supplier filed IGST');
      const status = diffs.length ? 'amtdiff' : how === 'num' ? 'numdiff' : b.bill_date !== d.date ? 'datediff' : 'ok';
      return { ...base, status, bill, diffs };
    });
    out.push({ period: per.period, rows });
  }
  return { periods: out, found };
}

// Our bills with GST in a month that are on no uploaded GSTR-2B (supplier has not filed / filed wrong GSTIN)
function notFiled(month, by, parties, found) {
  const res = [];
  for (const [pid, e] of by) {
    const p = parties.get(pid); if (!p || !p.gstin) continue;
    for (const b of e.bills) {
      if (!b.bill_date || b.bill_date.slice(0, 7) !== month || gstOf(b) <= 0 || found.has(b.id) || !(KIND_OF.INV.includes(b.kind) || b.kind === 'CREDIT_NOTE' || b.kind === 'DEBIT_NOTE')) continue;
      res.push({ id: b.id, party_id: pid, party_name: p.name, gstin: p.gstin, bill_no: b.bill_no, bill_date: b.bill_date, kind: b.kind, taxable: r2(b.taxable), tax: gstOf(b), total: r2(b.total) });
    }
  }
  return res.sort((a, b) => (a.bill_date < b.bill_date ? -1 : 1));
}

function registerGstr2b({ api, db, nowIso, who, accounts, firms }) {
  const firmIds = new Set(firms.map(f => f.id));
  let ready = null;
  const table = () => ready || (ready = db.execute(`CREATE TABLE IF NOT EXISTS pp_gstr2b (
    firm INTEGER NOT NULL, period TEXT NOT NULL, file_name TEXT, docs TEXT NOT NULL, uploaded_at TEXT NOT NULL, by_name TEXT, PRIMARY KEY (firm, period))`));
  async function allPeriods(firm) {
    await table();
    const r = await db.execute({ sql: 'SELECT period, file_name, docs, uploaded_at, by_name FROM pp_gstr2b WHERE firm = ? ORDER BY period', args: [firm] });
    return r.rows.map(x => ({ period: x.period, file_name: x.file_name, uploaded_at: x.uploaded_at, by_name: x.by_name, docs: JSON.parse(x.docs || '[]') }));
  }

  api.post('/gstr2b', async (req, res) => {
    try {
      const firm = Number(req.body?.firm);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      const n = normalise(req.body || {});
      if (n.gstin && n.gstin !== FIRM_GSTIN) return res.status(400).json({ error: `This GSTR-2B is for GSTIN ${n.gstin}, not ours (${FIRM_GSTIN}).` });
      const period = /^\d{4}-\d{2}$/.test(String(req.body?.period || '')) ? req.body.period : n.period;
      if (!period) return res.status(400).json({ error: 'Pick the month of this GSTR-2B.' });
      if (!n.docs.length) return res.status(422).json({ error: 'No bills found in this file. Download GSTR-2B from the GST portal as JSON (best) or Excel and upload that file.' });
      await table();
      await db.execute({ sql: 'INSERT OR REPLACE INTO pp_gstr2b (firm, period, file_name, docs, uploaded_at, by_name) VALUES (?,?,?,?,?,?)', args: [firm, period, String(req.body?.file_name || '').slice(0, 200), JSON.stringify(n.docs), nowIso(), who(req).name] });
      res.json({ period, count: n.docs.length, detected: n.period || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.delete('/gstr2b/:period', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      await table();
      await db.execute({ sql: 'DELETE FROM pp_gstr2b WHERE firm = ? AND period = ?', args: [firm, String(req.params.period)] });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Everything for one period, matched live against the bills entered right now
  api.get('/gstr2b', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      const [periods, by, parties] = await Promise.all([allPeriods(firm), accounts.loadFirm(firm), accounts.partiesMap()]);
      const list = periods.map(p => ({ period: p.period, file_name: p.file_name, uploaded_at: p.uploaded_at, by_name: p.by_name, count: p.docs.length }));
      if (!periods.length) return res.json({ periods: list, period: null });
      const period = list.some(p => p.period === req.query.period) ? req.query.period : list[list.length - 1].period;
      const m = match(periods, by, parties);
      const rows = m.periods.find(p => p.period === period).rows;
      res.json({ periods: list, period, rows, not_filed: notFiled(period, by, parties, m.found) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // For Checker / dashboard: bills on any GSTR-2B that are not entered here
  async function missingDocs(firm, by, parties) {
    let periods;
    try { periods = await allPeriods(firm); } catch { return []; }
    if (!periods.length) return [];
    const m = match(periods, by, parties);
    return m.periods.flatMap(p => p.rows.filter(r => r.status === 'missing' || r.status === 'no_supplier'));
  }
  return { missingDocs };
}

module.exports = { registerGstr2b, normalise, match, notFiled, fromJson, fromSheets };
