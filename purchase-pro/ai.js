// Purchase Pro — "Ask AI": answer plain questions (English / Tamil / Tanglish)
// from the live Purchase Pro data, using Groq. Read only — nothing is written.
//
// The model does not need a phrase bank: it already understands language.
// What it needs is our data. Groq's free tier allows only ~8k tokens a minute,
// so the whole book cannot be sent. Instead the model gets small "lookup"
// tools (suppliers, open bills, open issues, entries, month totals) and asks
// only for what the question needs. Every number comes fresh from the DB.

const { groqModels } = require('./photos');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const KL = { PURCHASE: 'Purchase', EXPENSE: 'Expense', HALLMARK: 'Hallmark', LABOUR: 'Labour', CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note' };
const SIGN = { PURCHASE: 1, EXPENSE: 1, HALLMARK: 1, LABOUR: 1, CREDIT_NOTE: -1, DEBIT_NOTE: -1 };
const EPS_W = 0.0005;

const ASK_PREF = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile'];
const RESULT_CAP = 7000;  // characters per tool result (~2k tokens) — keeps us under the per-minute limit
const MAX_ROUNDS = 4;

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const fmtG = (n) => r3(n).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' g';
const fmtRs = (n) => '₹' + r2(n).toLocaleString('en-IN');

// Loose supplier match: full name / alias / any word of 3+ letters ("padma", "knr", "shudh").
function matchParties(text, parties) {
  const q = norm(text);
  if (!q) return [];
  const words = q.split(' ').filter(w => w.length >= 3);
  const scored = [];
  for (const [pid, p] of parties) {
    if (p.deleted_at) continue;
    const n = norm(p.name), a = norm(p.alias);
    let s = 0;
    if (n === q || a === q) s = 100;
    else if (n.includes(q) || (a && a.includes(q))) s = 50;
    else s = words.filter(w => ` ${n} ${a} `.includes(` ${w}`)).length * 10;
    if (s) scored.push([s, pid]);
  }
  scored.sort((x, y) => y[0] - x[0]);
  return scored.length ? scored.filter(x => x[0] === scored[0][0]).map(x => x[1]) : [];
}

function cap(lines, head) {
  let out = head ? head + '\n' : '', n = 0;
  for (const l of lines) {
    if (out.length + l.length > RESULT_CAP) { out += `…and ${lines.length - n} more (narrow it down: supplier or dates).`; break; }
    out += l + '\n'; n++;
  }
  return out.trim() || 'none';
}

const TOOLS = [
  { type: 'function', function: { name: 'suppliers', description: 'Supplier / worker balances: money we owe or advance, overdue amount, open bill count, gold & silver still with them, last bill & payment dates. Use for totals, "who do we owe most", balances, gold/silver with workers.', parameters: { type: 'object', properties: { supplier: { type: 'string', description: 'Optional: supplier name (can be partial / misspelt). Leave empty for all.' }, details: { type: 'boolean', description: 'Also return city, GSTIN, PAN, phone, TDS mode.' } } } } },
  { type: 'function', function: { name: 'open_bills', description: 'Bills not yet fully paid, with amount still due and age in days.', parameters: { type: 'object', properties: { supplier: { type: 'string' } } } } },
  { type: 'function', function: { name: 'open_issues', description: 'Issue vouchers whose gold/silver is not yet received back from the worker.', parameters: { type: 'object', properties: { supplier: { type: 'string' }, metal: { type: 'string', enum: ['GOLD', 'SILVER'], description: 'ONLY if the owner says gold or silver. Otherwise leave out.' } } } } },
  { type: 'function', function: { name: 'entries', description: 'List individual entries (bills, payments, issue vouchers, receipts), newest first. Each bill shows taxable, GST, TDS, net, weight, paid status, photo / accountant status.', parameters: { type: 'object', properties: { supplier: { type: 'string' }, type: { type: 'string', enum: ['bill', 'payment', 'issue', 'receipt'] }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, search: { type: 'string', description: 'Text to find, e.g. a bill number or "no photo"' } } } } },
  { type: 'function', function: { name: 'month_totals', description: 'ONLY to compare months side by side (month-by-month table). For one period, or any bill type / payment mode question, use totals instead.', parameters: { type: 'object', properties: { supplier: { type: 'string' } } } } },
  { type: 'function', function: { name: 'totals', description: 'EXACT sums for any period (and optionally one supplier / bill type): how much billed, paid, GST, TDS, weight bought, gold/silver issued, number of bills/payments — plus a per-supplier breakdown (who we paid most / bought most from). ALWAYS use this for "how much / how many / total / most" questions instead of adding entries yourself.', parameters: { type: 'object', properties: { supplier: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD (omit = from the start)' }, to: { type: 'string', description: 'YYYY-MM-DD (omit = up to today)' }, kind: { type: 'string', enum: ['PURCHASE', 'EXPENSE', 'HALLMARK', 'LABOUR', 'CREDIT_NOTE', 'DEBIT_NOTE'], description: 'ONLY if the owner names a type ("purchase bills", "labour bills"). Plain "bills" = all types: leave this out.' }, min_amount: { type: 'number', description: 'Only bills with net amount at least this (also lists them)' }, mode: { type: 'string', enum: ['CASH', 'NEFT/RTGS', 'UPI', 'CHEQUE', 'OTHER'], description: 'Only payments made this way (cash, bank, UPI, cheque)' } } } } },
  { type: 'function', function: { name: 'pending_checks', description: 'The Checker: payments without bill, gold/silver not received back, bills without photo, bills not given to accountant, supplier statements not matched, TDS looks missed, entries that look unusual — counts and the items.', parameters: { type: 'object', properties: { which: { type: 'string', enum: ['all', 'no_bill', 'open_issues', 'no_photo', 'not_accounted', 'not_confirmed', 'tds_missed', 'unusual', 'gst_missing'] } } } } },
];

// Filters the model may only use when the owner actually said the word (models like to add "gold only").
const SAID = {
  GOLD: /gold|thang|தங்க/i, SILVER: /silver|velli|வெள்ளி/i,
  PURCHASE: /purchase|kolmudhal|கொள்முதல்/i, EXPENSE: /expense|selav|செலவ/i, HALLMARK: /hallmark|\bhm\b/i, LABOUR: /labour|labor|kooli|கூலி/i,
  CREDIT_NOTE: /credit/i, DEBIT_NOTE: /debit/i,
  CASH: /cash|ரொக்க|panam/i, 'NEFT/RTGS': /neft|rtgs|bank/i, UPI: /upi|gpay|phonepe|paytm/i, CHEQUE: /cheque|check/i, OTHER: /other/i,
};
function makeTools({ by, parties, computeParty, metalOf, pending, said = '' }) {
  const allow = (v) => (v && SAID[v] && SAID[v].test(said) ? v : undefined);
  const today = todayIST();
  const name = (pid) => parties.get(pid)?.name || '—';
  const comp = new Map();
  const C = (pid) => { if (!comp.has(pid)) comp.set(pid, computeParty(by.get(pid), today)); return comp.get(pid); };
  // MC ledgers (our own making-charge cycle) stay out of "all suppliers" figures, same as the
  // dashboard — but are found when asked for by name ("Vimal MC").
  const isMc = (e) => e.bills.some(b => Number(b.is_mc) === 1) || e.issues.some(i => String(i.item_type || '').toUpperCase() === 'OTHERS');
  const mc = new Set([...by].filter(([, e]) => isMc(e)).map(([pid]) => pid));
  const pick = (supplier) => {
    if (!supplier || /^(all|any|every|suppliers?)$/i.test(String(supplier).trim())) return { ids: [...by.keys()].filter(pid => !mc.has(pid)) };
    const ids = matchParties(supplier, parties).filter(pid => by.has(pid));
    const any = matchParties(supplier, parties);
    if (!ids.length) return { none: any.length ? `${any.map(name).join(', ')}: no entries yet.` : `No supplier matches "${supplier}".` };
    return { ids, note: `Matched: ${ids.map(name).join(', ')}${ids.some(pid => mc.has(pid)) ? ' (MC ledger)' : ''}` };
  };

  return {
    suppliers({ supplier, details }) {
      const s = pick(supplier); if (s.none) return s.none;
      const rows = [];
      let owe = 0, adv = 0, gold = 0, silver = 0;
      for (const pid of s.ids) {
        const c = C(pid), e = by.get(pid), p = parties.get(pid) || {};
        const g = r3(c.issues.filter(i => i.remaining > EPS_W && metalOf(i) === 'GOLD').reduce((t, i) => t + i.remaining, 0));
        const sv = r3(c.issues.filter(i => i.remaining > EPS_W && metalOf(i) === 'SILVER').reduce((t, i) => t + i.remaining, 0));
        if (c.money > 0) owe += c.money; else adv += -c.money; gold += g; silver += sv;
        const lb = e.bills.reduce((m, b) => (b.bill_date > m ? b.bill_date : m), ''), lp = e.payments.reduce((m, x) => (x.pay_date > m ? x.pay_date : m), '');
        const bal = c.money > 0.005 ? `we owe ${fmtRs(c.money)}` : c.money < -0.005 ? `advance ${fmtRs(-c.money)}` : 'settled';
        rows.push([Math.abs(c.money), `${name(pid)} | ${bal}${c.buckets.d60p > 0 ? ` | over 60 days ${fmtRs(c.buckets.d60p)}` : ''} | open bills ${c.open_bills}${g ? ` | gold pending ${fmtG(g)}` : ''}${sv ? ` | silver pending ${fmtG(sv)}` : ''} | last bill ${lb || '-'} | last payment ${lp || '-'}${details ? ` | ${p.city || ''} | GSTIN ${p.gstin || 'none'} | PAN ${p.pan || 'none'} | phone ${p.phone || '-'} | TDS ${p.tds_mode || ''}` : ''}`]);
      }
      rows.sort((a, b) => b[0] - a[0]);
      return cap(rows.map(r => r[1]), `${s.note ? s.note + '\n' : ''}TOTAL (${s.ids.length}): we owe ${fmtRs(owe)}, advance ${fmtRs(adv)}, gold pending ${fmtG(r3(gold))}, silver pending ${fmtG(r3(silver))}`);
    },
    open_bills({ supplier }) {
      const s = pick(supplier); if (s.none) return s.none;
      const rows = []; let tot = 0;
      for (const pid of s.ids) for (const b of C(pid).bills) if (b.sign > 0 && b.due > 0.005) { tot += b.due; rows.push([b.days, `${b.bill_date} | ${name(pid)} | ${KL[b.kind]} bill ${b.bill_no} | net ${fmtRs(b.net)} | due ${fmtRs(b.due)} | ${b.days} days`]); }
      rows.sort((a, b) => b[0] - a[0]);
      return cap(rows.map(r => r[1]), `${s.note ? s.note + '\n' : ''}${rows.length} open bills, total due ${fmtRs(tot)} (oldest first)`);
    },
    open_issues({ supplier, metal }) {
      metal = allow(metal);
      const s = pick(supplier); if (s.none) return s.none;
      const rows = []; const tot = { GOLD: 0, SILVER: 0 };
      for (const pid of s.ids) for (const i of C(pid).issues) {
        const m = metalOf(i);
        if (i.remaining <= EPS_W || (metal && m !== metal)) continue;
        tot[m] += i.remaining;
        rows.push([i.days, `${i.issue_date} | ${name(pid)} | ${m} ${i.issue_no} | issued ${fmtG(r3(i.net_wt))} | pending ${fmtG(i.remaining)} | ${i.days} days`]);
      }
      rows.sort((a, b) => b[0] - a[0]);
      return cap(rows.map((r, k) => (k === 0 ? 'OLDEST → ' : '') + r[1]), `${s.note ? s.note + '\n' : ''}${rows.length} open vouchers${metal ? ` (${metal} only)` : ' (gold + silver)'} | gold pending ${fmtG(r3(tot.GOLD))} | silver pending ${fmtG(r3(tot.SILVER))} | sorted OLDEST FIRST`);
    },
    entries({ supplier, type, from, to, search }) {
      const s = pick(supplier); if (s.none) return s.none;
      const rows = [];
      const inR = (d) => (!from || d >= from) && (!to || d <= to);
      for (const pid of s.ids) {
        const c = C(pid);
        if (!type || type === 'bill') for (const b of c.bills) if (inR(b.bill_date)) rows.push([b.bill_date, `${b.bill_date} | ${name(pid)} | ${KL[b.kind]} bill ${b.bill_no} | taxable ${fmtRs(b.taxable)} | GST ${fmtRs((b.cgst || 0) + (b.sgst || 0) + (b.igst || 0))}${b.tds ? ` | TDS ${fmtRs(b.tds)}` : ''} | net ${fmtRs(b.net)}${b.net_wt ? ` | ${fmtG(r3(b.net_wt))}` : ''} | ${b.sign > 0 ? b.status + (b.due > 0.005 ? ` due ${fmtRs(b.due)}` : '') : 'note'}${b.photos.length ? '' : ' | NO PHOTO'}${b.accounted_at ? ' | given to accountant' : ''}`]);
        if (!type || type === 'payment') for (const x of c.payments) if (inR(x.pay_date)) rows.push([x.pay_date, `${x.pay_date} | ${name(pid)} | ${x.direction === 'PAID' ? 'Paid' : 'Received'} ${fmtRs(x.amount)} | ${x.mode || ''}${x.reference ? ' ' + x.reference : ''}${x.direction === 'PAID' && x.unused > 1 ? ` | ${fmtRs(x.unused)} has NO BILL yet` : ''}`]);
        if (!type || type === 'issue') for (const i of c.issues) if (inR(i.issue_date)) rows.push([i.issue_date, `${i.issue_date} | ${name(pid)} | ${metalOf(i)} issue ${i.issue_no} | ${fmtG(r3(i.net_wt))} | ${[i.item_type, i.description].filter(Boolean).join(' ')} | ${i.status}${i.remaining > EPS_W ? ` pending ${fmtG(i.remaining)}` : ''}`]);
        if (!type || type === 'receipt') for (const r of c.receipts) if (inR(r.receipt_date)) rows.push([r.receipt_date, `${r.receipt_date} | ${name(pid)} | Receipt ${r.receipt_no || ''} | ${fmtG(r3(r.net_wt))} received`]);
      }
      let list = rows.sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(r => r[1]);
      if (search) { const q = norm(search); list = list.filter(l => norm(l).includes(q)); }
      return cap(list, `${s.note ? s.note + '\n' : ''}${list.length} entries (newest first)`);
    },
    month_totals({ supplier }) {
      const s = pick(supplier); if (s.none) return s.none;
      const M = new Map();
      const g = (d) => { const k = d.slice(0, 7); if (!M.has(k)) M.set(k, { n: 0, billed: 0, paid: 0, gst: 0, tds: 0, gold: 0, silver: 0 }); return M.get(k); };
      for (const pid of s.ids) {
        const e = by.get(pid);
        for (const b of e.bills) { const m = g(b.bill_date), sg = SIGN[b.kind] || 1; m.n++; m.billed += sg * (Number(b.net) || 0); m.gst += sg * ((b.cgst || 0) + (b.sgst || 0) + (b.igst || 0)); m.tds += Number(b.tds) || 0; }
        for (const x of e.payments) if (x.direction === 'PAID') g(x.pay_date).paid += Number(x.amount) || 0;
        for (const i of e.issues) g(i.issue_date)[metalOf(i) === 'GOLD' ? 'gold' : 'silver'] += Number(i.net_wt) || 0;
      }
      const lines = [...M.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, m]) => `${k} | ${m.n} bills | billed ${fmtRs(m.billed)} | paid ${fmtRs(m.paid)} | GST ${fmtRs(m.gst)} | TDS ${fmtRs(m.tds)} | gold issued ${fmtG(r3(m.gold))} | silver issued ${fmtG(r3(m.silver))}`);
      return cap(lines, s.note || '');
    },
    totals({ supplier, from, to, kind, min_amount, mode }) {
      kind = allow(kind); mode = allow(mode);
      const s = pick(supplier); if (s.none) return s.none;
      const inR = (d) => (!from || d >= from) && (!to || d <= to);
      const T = { bills: 0, billed: 0, taxable: 0, gst: 0, tds: 0, wt: 0, pays: 0, paid: 0, recv: 0, gold: 0, silver: 0 };
      const per = [], big = [], K = {};
      for (const pid of s.ids) {
        const e = by.get(pid), P = { name: name(pid), bills: 0, billed: 0, paid: 0, gold: 0, silver: 0 };
        for (const b of e.bills) {
          if (!inR(b.bill_date) || (kind && b.kind !== kind)) continue;
          const sg = SIGN[b.kind] || 1, net = Number(b.net) || 0;
          if (min_amount && net < min_amount) continue;
          T.bills++; T.billed += sg * net; T.taxable += sg * (Number(b.taxable) || 0); T.gst += sg * ((b.cgst || 0) + (b.sgst || 0) + (b.igst || 0)); T.tds += Number(b.tds) || 0; T.wt += Number(b.net_wt) || 0;
          P.bills++; P.billed += sg * net;
          const k = K[b.kind] || (K[b.kind] = { n: 0, net: 0, gst: 0, tds: 0 });
          k.n++; k.net += sg * net; k.gst += sg * ((b.cgst || 0) + (b.sgst || 0) + (b.igst || 0)); k.tds += Number(b.tds) || 0;
          if (min_amount) big.push([net, `${b.bill_date} | ${name(pid)} | ${KL[b.kind]} bill ${b.bill_no} | net ${fmtRs(net)}`]);
        }
        if (!kind && !min_amount) {
          for (const x of e.payments) if (inR(x.pay_date)) {
            // split payments (cash + bank…) count each part under its own mode
            let parts = []; try { parts = JSON.parse(x.parts || '[]'); } catch {}
            const amt = mode ? (parts.length ? parts.filter(q => q.mode === mode).reduce((s, q) => s + (Number(q.amount) || 0), 0) : (x.mode === mode ? Number(x.amount) || 0 : 0)) : Number(x.amount) || 0;
            if (!amt) continue;
            if (x.direction === 'PAID') { T.pays++; T.paid += amt; P.paid += amt; } else T.recv += amt;
          }
          for (const i of e.issues) if (inR(i.issue_date)) { const k = metalOf(i) === 'GOLD' ? 'gold' : 'silver'; T[k] += Number(i.net_wt) || 0; P[k] += Number(i.net_wt) || 0; }
        }
        if (P.bills || P.paid || P.gold || P.silver) per.push(P);
      }
      const period = `${from ? fmtD(from) : 'the start'} to ${to ? fmtD(to) : 'today'}`;
      const head = [
        `${s.note ? s.note + '\n' : ''}PERIOD ${period}${mode ? ` | payments by ${mode} only` : ''}${kind ? ` | only ${KL[kind]} bills` : ''}${min_amount ? ` | only bills of ${fmtRs(min_amount)} or more` : ''}`,
        mode ? '' : `${kind ? KL[kind] + ' bills' : 'ALL BILLS (every type)'}: ${T.bills} | billed (net) ${fmtRs(T.billed)} | taxable ${fmtRs(T.taxable)} | GST ${fmtRs(T.gst)} | TDS ${fmtRs(T.tds)} | weight on bills ${fmtG(T.wt)}`,
        kind || mode ? '' : `By type: ${Object.entries(K).map(([k, v]) => `${KL[k] || k} ${v.n} bills ${fmtRs(v.net)} (GST ${fmtRs(v.gst)}, TDS ${fmtRs(v.tds)})`).join('; ') || 'none'}`,
        !kind && !min_amount ? `${mode ? `PAYMENTS BY ${mode} ONLY` : 'Payments made'}: ${T.pays} | paid ${fmtRs(T.paid)}${T.recv ? ` | money received back ${fmtRs(T.recv)}` : ''} | gold issued ${fmtG(T.gold)} | silver issued ${fmtG(T.silver)}` : '',
      ].filter(Boolean).join('\n');
      const lines = min_amount
        ? big.sort((a, b) => b[0] - a[0]).map(x => x[1])
        : [`-- per supplier (most billed first) --`, ...per.sort((a, b) => b.billed - a.billed || b.paid - a.paid).map(p => `${p.name} | ${p.bills} bills ${fmtRs(p.billed)} | paid ${fmtRs(p.paid)}${p.gold ? ` | gold issued ${fmtG(p.gold)}` : ''}${p.silver ? ` | silver issued ${fmtG(p.silver)}` : ''}`)];
      return cap(lines, head);
    },
    async pending_checks({ which }) {
      const p = await pending();
      const L = { no_bill: 'Payments without bill', open_issues: 'Gold / silver not received back', no_photo: 'Bills without photo', not_accounted: 'Bills not given to accountant', not_confirmed: `Supplier statements not matched (${p.conf_month || 'last month'})`, tds_missed: 'TDS looks missed', unusual: 'Entries that look unusual', gst_missing: 'Bills on GSTR-2B (filed by supplier) not entered here' };
      const keys = !which || which === 'all' ? Object.keys(L) : [which];
      const item = (k, x) => {
        if (k === 'no_bill') return `${x.date} | ${x.party_name} | paid ${fmtRs(x.amount)} | no bill for ${fmtRs(x.unused)} | ${x.days} days`;
        if (k === 'open_issues') return `${x.date} | ${x.party_name} | ${x.issue_no} | pending ${fmtG(x.remaining)} | ${x.days} days`;
        if (k === 'not_confirmed') return `${x.party_name} | ${x.month}`;
        if (k === 'unusual') return `${x.date} | ${x.party_name} | ${x.what}: ${x.detail}`;
        if (k === 'gst_missing') return `${x.date} | ${x.party_name || x.gstin} | bill ${x.no} | taxable ${fmtRs(x.taxable)} | GST ${fmtRs(x.tax)} | GSTR-2B ${x.period}`;
        return `${x.date} | ${x.party_name} | ${x.bill_no || ''} | ${fmtRs(x.amount ?? x.net)}`;
      };
      const out = [];
      for (const k of keys) {
        const list = (p[k] || []).filter(x => !x.check);
        out.push(`${L[k]}: ${list.length}`);
        if (keys.length === 1 || list.length <= 8) for (const x of list.slice(0, keys.length === 1 ? 60 : 8)) out.push('  ' + item(k, x));
      }
      return cap(out, 'PENDING (items ticked Verified are left out)');
    },
  };
}
const fmtD = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

const addM = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const lastDay = (m) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
const SYSTEM = (today, firm) => {
  const m = today.slice(0, 7), lm = addM(m, -1);
  const fy = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  return `You are the purchase assistant of APPACHI JEWELLERY (jewellery shop, Tamil Nadu). Firm: ${firm}. Today: ${today}.
Dates: "this month" = ${m}-01 to ${today}. "Last month" = ${lm}-01 to ${lastDay(lm)}. "This year / this FY" = ${fy}-04-01 to ${today}. "Today" = ${today}.
Use the lookup tools to get the facts, then answer. Rules:
- For any total / sum / count / "most" question use the totals tool (exact) — never add up entries yourself. For "total bills" give both the number of bills and the amount.
- "Bills" means ALL bill types (purchase + expense + hallmark + labour) unless the owner names one type. Give the all-types figure; add the by-type split only if useful.
- Balances (what we owe, advance, gold/silver still with workers): suppliers tool. Checker items (no bill, no photo, not given to accountant…): pending_checks tool.`;
};
const SYSTEM_RULES = `
- The owner may write in English, Tamil, or Tanglish (Tamil in English letters). Reply in the same style.
- Short and direct: the answer (number / name) first, then at most a few lines or a short list. No long paragraphs.
- Money as ₹ with Indian commas (₹1,25,000). Weight in grams, 3 decimals. Dates like 14 Nov 2026.
- "We owe" = we must pay them. "Advance" = we paid more than the bills. "Pending" gold/silver = still with the worker.
- Names may be loose or misspelt; tools match them. Always pass the supplier name to tools in ENGLISH letters (if the owner typed Tamil script, transliterate: பத்மா → Padma). Say which supplier you used if it was unclear.
- Only use numbers from the tools. If the tools don't have it, say so. Never guess.
- Plain text only: no markdown tables, no ** bold, no # headings.`;

// ═══════════ Shared AI engine (also used by Restocking: /restock-ai.js) ═══════════
// groq() in photos.js returns only the text; tool calls need the whole message
async function groqRaw(body) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(process.env.GROQ_API_KEY).trim()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error('429 AI is busy (per-minute limit). Try again in a minute.');
    throw new Error(`AI error ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()).choices?.[0]?.message || {};
}
// One model call; on quota / retired model, falls to the next model.
async function callModel(messages, toolDefs, force) {
  const ids = await groqModels();
  const list = ASK_PREF.filter(m => !ids.length || ids.includes(m));
  let last;
  for (const model of list.length ? list : ASK_PREF) {
    const body = { model, messages, temperature: 0.1, max_tokens: 1200 };
    if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
    if (toolDefs) { body.tools = toolDefs; body.tool_choice = force ? 'required' : 'auto'; }
    try { return await groqRaw(body); }
    catch (e) { last = e; if (!/\b(404|400|403|413|429)\b|quota|busy|too large|rate/i.test(e.message)) throw e; }
  }
  throw last || new Error('No AI model available on Groq.');
}
// Chat history from the page (so "and with KNR?" works) — kept short
function cleanHistory(h) {
  return (Array.isArray(h) ? h : []).slice(-6)
    .filter(x => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string')
    .map(x => ({ role: x.role, content: x.content.slice(0, 600) }));
}
// Ask → the model looks things up with the tools (as many rounds as it needs) → answer.
// A first answer with no lookup is not trusted: asked again, this time a lookup is required.
async function runAgent({ system, toolDefs, impls, history, question }) {
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: question }];
  const used = [];
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const defs = round < MAX_ROUNDS ? toolDefs : null;
    let msg = await callModel(messages, defs);
    if (round === 0 && !(msg.tool_calls || []).length) { try { msg = await callModel(messages, toolDefs, true); } catch {} }
    const tc = msg.tool_calls || [];
    if (!tc.length) return { answer: String(msg.content || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim() || 'No answer — try asking another way.', used };
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: tc });
    for (const t of tc) {
      let args = {}; try { args = JSON.parse(t.function.arguments || '{}'); } catch {}
      const fn = impls[t.function.name];
      let out;
      try { out = fn ? String(await fn(args || {})) : 'Unknown tool.'; } catch (err) { out = 'Lookup failed: ' + err.message; }
      used.push(t.function.name + (Object.keys(args || {}).length ? JSON.stringify(args) : ''));
      messages.push({ role: 'tool', tool_call_id: t.id, content: out });
    }
  }
  return { answer: 'That needed too many lookups — ask a narrower question.', used };
}

function registerAi({ api, db, firms, accounts, computeParty, metalOf }) {
  const firmIds = new Set(firms.map(f => f.id));
  const call = (messages) => callModel(messages, null);

  api.post('/ai/ask', async (req, res) => {
    try {
      const firm = Number(req.body?.firm);
      const question = String(req.body?.question || '').trim().slice(0, 600);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      if (!question) return res.status(400).json({ error: 'Type a question.' });
      if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'AI is not set up (GROQ_API_KEY missing).' });
      const history = cleanHistory(req.body?.history);
      const [by, parties] = await Promise.all([accounts.loadFirm(firm, null, true), accounts.partiesMap()]);
      const today = todayIST();
      let pend = null; // Checker lists, only worked out if the question needs them
      const pending = () => pend || (pend = accounts.collectPending(firm, today, addM(today.slice(0, 7), -1)));
      const said = [...history.filter(h => h.role === 'user').map(h => h.content), question].join(' ');
      const tools = makeTools({ by, parties, computeParty, metalOf, pending, said });
      res.json(await runAgent({ system: SYSTEM(today, firms.find(f => f.id === firm).name) + SYSTEM_RULES, toolDefs: TOOLS, impls: tools, history, question }));
    } catch (e) { res.status(500).json({ error: e.message.replace(/^\d{3} /, '') }); }
  });

  // ═══════════ Monthly summary ═══════════
  // Facts are worked out in code (exact numbers); the AI only writes them up as a short note.
  // Saved per month; written again only when that month's numbers change (or on Rewrite).
  let sumReady = null;
  const sumTable = () => sumReady || (sumReady = db.execute(`CREATE TABLE IF NOT EXISTS pp_ai_summaries (
    firm INTEGER NOT NULL, month TEXT NOT NULL, facts_hash TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (firm, month))`));
  const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
  const mName = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const PEND_L = { no_bill: 'payments without bill', open_issues: 'issue vouchers not received back', no_photo: 'bills without photo', not_accounted: 'bills not given to accountant', not_confirmed: 'supplier statements not matched', tds_missed: 'bills where TDS looks missed', unusual: 'entries that look unusual', gst_missing: 'bills on GSTR-2B not entered here' };

  async function monthFacts(firm, month) {
    const today = todayIST(), cur = today.slice(0, 7) === month;
    const upto = cur ? today : monthEnd(month);
    const [by, parties, pend] = await Promise.all([accounts.loadFirm(firm), accounts.partiesMap(), accounts.collectPending(firm, upto, month)]);
    const name = (pid) => parties.get(pid)?.name || '—';
    const inM = (d, m = month) => d && d.slice(0, 7) === m;
    const tot = (m) => {
      const t = { bills: 0, billed: 0, paid: 0, gst: 0, tds: 0, gold: 0, silver: 0, kinds: {} };
      for (const [, e] of by) {
        for (const b of e.bills) if (inM(b.bill_date, m)) { const s = SIGN[b.kind] || 1; t.bills++; t.billed += s * (Number(b.net) || 0); t.gst += s * ((b.cgst || 0) + (b.sgst || 0) + (b.igst || 0)); t.tds += Number(b.tds) || 0; t.kinds[b.kind] = (t.kinds[b.kind] || 0) + s * (Number(b.net) || 0); }
        for (const x of e.payments) if (x.direction === 'PAID' && inM(x.pay_date, m)) t.paid += Number(x.amount) || 0;
        for (const i of e.issues) if (inM(i.issue_date, m)) t[metalOf(i) === 'GOLD' ? 'gold' : 'silver'] += Number(i.net_wt) || 0;
      }
      return t;
    };
    const t = tot(month), p = tot(addM(month, -1));
    // per supplier: billed / paid in the month, and balance at month end (or today)
    const sup = [];
    let owe = 0, adv = 0, d60 = 0, goldOut = 0, silverOut = 0;
    for (const [pid, e] of by) {
      const cut = { bills: e.bills.filter(b => b.bill_date <= upto), payments: e.payments.filter(x => x.pay_date <= upto), issues: e.issues.filter(i => i.issue_date <= upto), receipts: e.receipts.filter(r => r.receipt_date <= upto), opening: e.opening && e.opening.as_of <= upto ? e.opening : null };
      const c = computeParty(cut, upto);
      if (c.money > 0) owe += c.money; else adv += -c.money;
      d60 += c.buckets.d60p;
      for (const i of c.issues) if (i.remaining > EPS_W) { if (metalOf(i) === 'GOLD') goldOut += i.remaining; else silverOut += i.remaining; }
      const billed = e.bills.filter(b => inM(b.bill_date)).reduce((s, b) => s + (SIGN[b.kind] || 1) * (Number(b.net) || 0), 0);
      const paid = e.payments.filter(x => x.direction === 'PAID' && inM(x.pay_date)).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      sup.push({ name: name(pid), billed, paid, d60p: c.buckets.d60p, oldest: c.oldest_due });
    }
    const top = (k, n = 5) => sup.filter(s => s[k] > 0.5).sort((a, b) => b[k] - a[k]).slice(0, n);
    // statements are matched after a month ends — not counted for the month still running
    const pendCounts = Object.entries(PEND_L).filter(([k]) => !(cur && k === 'not_confirmed')).map(([k, l]) => [l, (pend[k] || []).filter(x => !x.check).length]).filter(([, n]) => n > 0);
    const pct = (a, b) => (b > 0.5 ? ` (${a >= b ? '+' : ''}${Math.round((a - b) / b * 100)}% vs last month)` : '');
    const lines = [
      `Month: ${mName(month)}${cur ? ` — so far, up to ${today}` : ''}`,
      `Bills: ${t.bills}, total ${fmtRs(t.billed)}${pct(t.billed, p.billed)}. By type: ${Object.entries(t.kinds).map(([k, v]) => `${KL[k] || k} ${fmtRs(v)}`).join(', ') || 'none'}`,
      `Paid to suppliers: ${fmtRs(t.paid)}${pct(t.paid, p.paid)}`,
      // the comparison is worked out here — models get "bigger / smaller" wrong
      `Billed vs paid: ${Math.abs(t.paid - t.billed) < 1 ? 'paid equals billed' : t.paid > t.billed ? `PAID MORE than billed by ${fmtRs(t.paid - t.billed)} (bills still to be entered, or advance)` : `BILLED MORE than paid by ${fmtRs(t.billed - t.paid)}`}`,
      `GST on bills: ${fmtRs(t.gst)}. TDS deducted: ${fmtRs(t.tds)}`,
      `Issued to workers this month: gold ${fmtG(t.gold)}, silver ${fmtG(t.silver)}`,
      `Top billed: ${top('billed').map(s => `${s.name} ${fmtRs(s.billed)}`).join('; ') || 'none'}`,
      `Top paid: ${top('paid').map(s => `${s.name} ${fmtRs(s.paid)}`).join('; ') || 'none'}`,
      `At ${cur ? 'today' : 'month end'}: we owe ${fmtRs(owe)}, advance with suppliers ${fmtRs(adv)}, unpaid over 60 days ${fmtRs(d60)}`,
      `Over-60-day dues: ${top('d60p').map(s => `${s.name} ${fmtRs(s.d60p)} (since ${s.oldest})`).join('; ') || 'none'}`,
      `Still with workers: gold ${fmtG(goldOut)}, silver ${fmtG(silverOut)}. Oldest open vouchers: ${pend.open_issues.slice(0, 5).map(i => `${i.party_name} ${i.issue_no} ${fmtG(i.remaining)} ${i.days} days`).join('; ') || 'none'}`,
      `Pending checks: ${pendCounts.map(([l, n]) => `${n} ${l}`).join('; ') || 'nothing pending'}`,
    ];
    // what the dashboard card shows: big numbers + jobs to do (count of each pending check)
    const todo = Object.keys(PEND_L).filter(k => !(cur && k === 'not_confirmed')).map(k => ({ key: k, n: (pend[k] || []).filter(x => !x.check).length })).filter(x => x.n > 0);
    const nums = { bills: t.bills, billed: r2(t.billed), paid: r2(t.paid), owe: r2(owe), d60: r2(d60), gold: r3(goldOut), silver: r3(silverOut) };
    return { title: mName(month), current: cur, facts: lines.join('\n'), nums, todo, empty: !t.bills && !t.paid && !t.gold && !t.silver };
  }

  const hash = (s) => require('crypto').createHash('sha1').update(s).digest('hex');
  const SUM_SYS = `You write the monthly purchase summary for the owner of APPACHI JEWELLERY. Use ONLY the facts given — never add or change numbers.
Format (plain text, no markdown, no ** bold):
- First line: one sentence on the month, using the "Billed vs paid" fact exactly as given.
- Then 4 to 7 short lines starting with "• ": biggest suppliers, money we owe / overdue, gold & silver still with workers, what needs action.
- For pending checks, copy each count with its exact wording (e.g. "38 bills not given to accountant") — never rename them ("not given to accountant" is NOT "missing").
- Last line starting with "To do: " — the 1 to 3 most important actions.
Every line short. ₹ with Indian commas, grams with 3 decimals.`;

  api.get('/ai/summary', async (req, res) => {
    try {
      const firm = Number(req.query.firm);
      if (!firmIds.has(firm)) return res.status(400).json({ error: 'Pick the firm.' });
      const thisM = todayIST().slice(0, 7);
      let month = String(req.query.month || '');
      let f;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        // default: the month just gone; if it had nothing, this month so far
        month = addM(thisM, -1);
        f = await monthFacts(firm, month);
        if (f.empty) { month = thisM; f = null; }
      }
      if (month > thisM) return res.status(400).json({ error: 'That month has not come yet.' });
      f = f || await monthFacts(firm, month);
      const base = { month, title: f.title, current: f.current, prev: addM(month, -1), next: month < thisM ? addM(month, 1) : null };
      if (f.empty) return res.json({ ...base, empty: true });
      // The card is numbers + jobs, worked out in code — no AI note (owner: nobody reads paragraphs)
      if (req.query.note !== '1') return res.json({ ...base, nums: f.nums, todo: f.todo });
      await sumTable();
      const h = hash(f.facts);
      const saved = (await db.execute({ sql: 'SELECT * FROM pp_ai_summaries WHERE firm = ? AND month = ?', args: [firm, month] })).rows[0];
      if (saved && saved.facts_hash === h && req.query.fresh !== '1') return res.json({ ...base, text: saved.text, at: saved.at });
      if (!process.env.GROQ_API_KEY) return res.json({ ...base, text: f.facts, at: null });
      let text;
      try {
        const msg = await call([{ role: 'system', content: SUM_SYS }, { role: 'user', content: f.facts }], false);
        text = String(msg.content || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').split('\n').map(l => l.trim()).filter(Boolean).join('\n');
      } catch (e) {
        // AI busy: show the last note if there is one, else the plain figures
        return res.json({ ...base, text: saved ? saved.text : f.facts, at: saved?.at || null, note: saved ? 'AI busy — showing the last note.' : 'AI busy — showing the plain figures.' });
      }
      if (!text) text = f.facts;
      const at = new Date().toISOString();
      await db.execute({ sql: 'INSERT OR REPLACE INTO pp_ai_summaries (firm, month, facts_hash, text, at) VALUES (?,?,?,?,?)', args: [firm, month, h, text, at] });
      res.json({ ...base, text, at });
    } catch (e) { res.status(500).json({ error: e.message.replace(/^\d{3} /, '') }); }
  });
}

module.exports = { registerAi, makeTools, matchParties, runAgent, cleanHistory };
