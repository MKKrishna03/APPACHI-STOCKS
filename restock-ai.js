// Restocking — "Ask AI": plain questions (English / Tamil / Tanglish) about KOLUSU / SL stock,
// targets, what to order, orders, sales and slow stock. Read only — nothing is written.
// Same engine as Purchase Pro's Ask AI (purchase-pro/ai.js runAgent): the model gets small lookup
// tools and asks only for what it needs; every number is worked out here by restock-core.js,
// exactly like the Restocking page does.

const { runAgent, cleanHistory } = require('./purchase-pro/ai');

const DAY = 86400000;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const fmtG = (n) => r3(n).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' g';
const fmtN = (n) => Number(n || 0).toLocaleString('en-IN');
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9. ]+/g, ' ').replace(/\s+/g, ' ').trim();
const RESULT_CAP = 7000;

function cap(lines, head) {
  let out = head ? head + '\n' : '', n = 0;
  for (const l of lines) {
    if (out.length + l.length > RESULT_CAP) { out += `…and ${lines.length - n} more (narrow it down: group, product words or supplier).`; break; }
    out += l + '\n'; n++;
  }
  return out.trim() || 'none';
}

const STATUS_L = { ORDERED: 'ordered (not arrived)', ARRIVED: 'arrived', NOT_REQUIRED: 'not required' };

const TOOLS = [
  { type: 'function', function: { name: 'overview', description: 'Per counter (KOLUSU, SL): pieces to order, ranges short, ordered & waiting, arrived this week, products without target, slow-moving ranges, pieces in stock and total stock weight, last import date.', parameters: { type: 'object', properties: { counter: { type: 'string', enum: ['KOLUSU', 'SL'] } } } } },
  { type: 'function', function: { name: 'products', description: 'List products (one line each: group, supplier, target / in stock / need, sold in 30 & 180 days, order status). Filter by words in the product name, group, supplier, counter, and a state. Use for "what to order", "which products need…", "ordered items", "slow / not selling", "no target".', parameters: { type: 'object', properties: {
    search: { type: 'string', description: 'Words that must ALL be in the product or group name, e.g. "BOMBAY 6.5", "MUGAPPU"' },
    counter: { type: 'string', enum: ['KOLUSU', 'SL'] },
    supplier: { type: 'string', description: 'Supplier name (part is fine)' },
    state: { type: 'string', enum: ['need', 'ordered', 'arrived', 'not_required', 'no_target', 'slow', 'full', 'all'], description: 'need = still to order (not ordered yet); ordered = ordered, waiting; slow = slow-moving (in stock 180+ days, no sale in 180 days); full = target met' },
    sort: { type: 'string', enum: ['need', 'sold30', 'sold180', 'stock', 'name'] },
  } } } },
  { type: 'function', function: { name: 'product_detail', description: 'One product in full: every weight range with target / in stock / need / status, each in-stock piece (tag, weight, tag date, supplier), sold counts, suppliers, note.', parameters: { type: 'object', properties: { product: { type: 'string', description: 'Product name or distinctive words' }, counter: { type: 'string', enum: ['KOLUSU', 'SL'] } }, required: ['product'] } } },
  { type: 'function', function: { name: 'supplier_needs', description: 'Pieces still to order grouped by supplier (the supplier who sold the most of each product, as in the Restocking Excel export). Use for "what to order from X" or "which supplier has most to order".', parameters: { type: 'object', properties: { counter: { type: 'string', enum: ['KOLUSU', 'SL'] }, supplier: { type: 'string' } } } } },
  { type: 'function', function: { name: 'sales', description: 'EXACT sales: pieces and weight sold in the last N days (counted back from each group\'s import date), top-selling products, by group and by supplier. Filter by words / counter / supplier.', parameters: { type: 'object', properties: { days: { type: 'number', description: '7, 30, 90, 180, 365… (omit = all sales history)' }, search: { type: 'string' }, counter: { type: 'string', enum: ['KOLUSU', 'SL'] }, supplier: { type: 'string' } } } } },
  { type: 'function', function: { name: 'stock_totals', description: 'EXACT in-stock pieces and weight, by group (and by supplier). Filter by words / counter / supplier.', parameters: { type: 'object', properties: { search: { type: 'string' }, counter: { type: 'string', enum: ['KOLUSU', 'SL'] }, supplier: { type: 'string' } } } } },
];

const SYSTEM = (today) => `You are the restocking assistant of APPACHI JEWELLERY (silver anklets "KOLUSU" counter and the "SL" silver counter). Today: ${today}.
Data comes from the daily Tagging export (stock pieces, sold pieces) and the target weight ranges set per product. "Need" = target − pieces in stock in that range. "Ordered" = order placed, waiting for stock.
Use the lookup tools to get the facts, then answer. Rules:
- For totals / counts / "most" questions use overview, sales, stock_totals or supplier_needs (exact) — never add numbers up yourself.
- The owner may write in English, Tamil, or Tanglish. Reply in the same style. Pass product / group / supplier words to tools in ENGLISH letters (transliterate Tamil script: கொலுசு → KOLUSU, பாம்பே → BOMBAY).
- Short and direct: the answer first, then at most a short list (max ~10 lines; say how many more there are).
- Weights in grams, 3 decimals. Dates like 14 Nov 2026.
- Product names are long codes; you may drop the trailing size code when listing, but keep them recognisable.
- Only use numbers from the tools. If the tools don't have it, say so. Never guess.
- Plain text only: no markdown tables, no ** bold, no # headings.`;

function registerRestockAi({ app, loadRestock, getCore }) {
  function model(d, core) {
    const now = Date.now();
    const out = [];
    for (const c of core.COUNTERS) {
      const groups = d.groups.filter(g => (g.counter || 'KOLUSU') === c);
      const ps = core.build(groups, d.targets.filter(t => (t.counter || 'KOLUSU') === c), d.supplierMerge, d.lastSuppliers);
      const st = {};
      for (const x of d.statuses || []) if (x.counter === c && !(x.status === 'NOT_REQUIRED' && core.notReqEnded(x, groups, now))) st[x.product] = x;
      const notes = {};
      for (const n of d.notes || []) if (n.counter === c) notes[n.product] = n.note;
      for (const k of Object.keys(ps)) {
        const p = ps[k];
        p.note = notes[k] || '';
        p.skipped = (d.skipped || []).includes(k);
        p.rs = p.rangeStats.map(x => { const s = st[core.statusKey(k, x.r)] || st[k]; return { ...x, status: s ? s.status : '', arrived_at: s?.arrived_at || null }; });
        p.productStatus = !p.ranges.length && st[k] ? st[k].status : '';
        // what is still to order = need on ranges not ordered / not required
        p.toOrder = p.rs.reduce((t, x) => t + (x.status === 'ORDERED' || x.status === 'NOT_REQUIRED' ? 0 : x.need), 0);
        p.ordered = p.rs.filter(x => x.status === 'ORDERED').length;
        p.arrived = p.rs.filter(x => x.status === 'ARRIVED').length;
        p.notReq = p.productStatus === 'NOT_REQUIRED' || (p.rs.length && p.rs.every(x => x.status === 'NOT_REQUIRED'));
        p.slow = p.rs.some(x => x.dead);
        p.sold30 = p.rs.reduce((t, x) => t + (x.sold30 || 0), 0);
        p.sold180 = p.rs.reduce((t, x) => t + (x.sold180 || 0), 0);
        // supplier for ordering = most sold pieces (tie → more sold weight), else last tagged from (same as the export)
        const n = {}, w = {};
        for (const s of p.sold) if (s.supplier) { n[s.supplier] = (n[s.supplier] || 0) + 1; w[s.supplier] = (w[s.supplier] || 0) + (s.wt || 0); }
        p.orderSup = Object.keys(n).sort((a, b) => n[b] - n[a] || w[b] - w[a] || a.localeCompare(b))[0] || p.lastSupplier || '';
        out.push(p);
      }
    }
    return out;
  }

  // A counter filter only counts when the owner named the counter (models like to add "KOLUSU only")
  const SAID = { KOLUSU: /kolus|கொலுசு|anklet/i, SL: /(^|[^a-z])s\.?l([^a-z]|$)|எஸ்\s*எல்/i };
  function makeTools(all, core, said = '') {
    const okC = (c) => (c && SAID[c] && SAID[c].test(said) ? c : undefined);
    const words = (s) => norm(s).split(' ').filter(Boolean);
    const match = (p, search) => { const w = words(search); if (!w.length) return true; const h = ` ${norm(p.key)} ${norm(p.group)} `; return w.every(x => h.includes(x)); };
    const supOk = (p, sup) => { if (!sup) return true; const q = norm(sup); return [p.orderSup, p.lastSupplier, ...Object.keys(p.suppliers)].some(s => norm(s).includes(q)); };
    const pick = ({ search, counter, supplier }) => { counter = okC(counter); return all.filter(p => (!counter || p.counter === counter) && match(p, search) && supOk(p, supplier)); };
    const line = (p) => {
      const st = p.notReq ? 'not required' : [p.ordered ? `${p.ordered} range(s) ordered` : '', p.arrived ? `${p.arrived} arrived` : ''].filter(Boolean).join(', ');
      return `${p.key} | ${p.counter} · ${p.group} | supplier ${p.orderSup || 'none'} | ${p.ranges.length ? `target ${p.target} · in stock ${p.stock.length} · to order ${p.toOrder}` : `no target · in stock ${p.stock.length}`}${p.salesKnown ? ` | sold 30d ${p.sold30} · 180d ${p.sold180}` : ' | no sales data'}${st ? ' | ' + st : ''}${p.slow ? ' | SLOW-MOVING' : ''}`;
    };
    return {
      overview({ counter }) {
        counter = okC(counter);
        const sum = core.summary({ ...this._d }, Date.now()).filter(s => !counter || s.counter === counter);
        return sum.map(s => {
          const ps = all.filter(p => p.counter === s.counter);
          const pcs = ps.reduce((t, p) => t + p.stock.length, 0), wt = ps.reduce((t, p) => t + p.stock.reduce((u, x) => u + x.wt, 0), 0);
          return `${s.counter}: ${fmtN(s.toOrder)} pieces to order (${s.rangesShort} ranges short) | ${s.waiting} ranges ordered & waiting | ${s.arrivedWeek} arrived this week | ${s.unfixed} products without target | ${s.dead} slow-moving ranges | in stock ${fmtN(pcs)} pieces, ${fmtG(wt)} | ${ps.length} products | last import ${s.lastImport ? s.lastImport.slice(0, 10) : 'never'}`;
        }).join('\n');
      },
      products({ search, counter, supplier, state, sort }) {
        let list = pick({ search, counter, supplier });
        const S = state || 'all';
        const f = {
          need: (p) => p.toOrder > 0 && !p.notReq, ordered: (p) => p.ordered > 0, arrived: (p) => p.arrived > 0, not_required: (p) => p.notReq,
          no_target: (p) => !p.ranges.length && !p.skipped && !p.notReq, slow: (p) => p.slow, full: (p) => p.ranges.length && p.need === 0, all: () => true,
        }[S] || (() => true);
        list = list.filter(f);
        const by = { need: (a, b) => b.toOrder - a.toOrder, sold30: (a, b) => b.sold30 - a.sold30, sold180: (a, b) => b.sold180 - a.sold180, stock: (a, b) => b.stock.length - a.stock.length, name: (a, b) => a.key.localeCompare(b.key) }[sort || (S === 'need' ? 'need' : 'name')];
        list.sort((a, b) => by(a, b) || a.key.localeCompare(b.key));
        const tot = list.reduce((t, p) => t + p.toOrder, 0);
        const ranges = { need: (p) => p.rs.filter(x => x.need > 0 && x.status !== 'ORDERED' && x.status !== 'NOT_REQUIRED').length, ordered: (p) => p.ordered, arrived: (p) => p.arrived, slow: (p) => p.rs.filter(x => x.dead).length }[S];
        return cap(list.map(line), `${list.length} product(s)${S !== 'all' ? ` [${S}]` : ''}${ranges ? ` | ${fmtN(list.reduce((t, p) => t + ranges(p), 0))} range(s)` : ''} | total still to order ${fmtN(tot)} pieces`);
      },
      product_detail({ product, counter }) {
        let list = pick({ search: product, counter });
        if (!list.length) return `No product matches "${product}".`;
        const exact = list.find(p => norm(p.key) === norm(product));
        if (exact) list = [exact];
        if (list.length > 3) return cap(list.map(p => `${p.key} (${p.counter})`), `${list.length} products match — which one?`);
        return list.map(p => {
          const rs = p.rs.map(x => `  range ${x.r.size ? 'size ' + x.r.size + ' ' : ''}${r3(x.r.min_wt)}–${r3(x.r.max_wt)} g: target ${x.r.qty} | in stock ${x.have} | need ${x.need}${x.status ? ' | ' + (STATUS_L[x.status] || x.status) + (x.arrived_at ? ' ' + String(x.arrived_at).slice(0, 10) : '') : ''}${x.sold30 != null ? ` | sold 30d ${x.sold30} · 180d ${x.sold180}` : ''}${x.dead ? ' | SLOW-MOVING' : ''}`);
          const stock = p.stock.map(s => `  tag ${s.tag} | ${fmtG(s.wt)}${s.size ? ' | size ' + s.size : ''} | tagged ${s.date || '-'} | ${s.supplier || 'no supplier'}${s.inRange ? '' : ' | outside every range'}`);
          return [
            `${p.key} | ${p.counter} · ${p.group} | order from ${p.orderSup || 'none'} | all suppliers: ${Object.keys(p.suppliers).join(', ') || 'none'}`,
            p.ranges.length ? `Target ${p.target} | in stock ${p.stock.length} | need ${p.need} | still to order (not ordered yet) ${p.toOrder}` : `No target set${p.notReq ? ' (not required)' : ''} | in stock ${p.stock.length}`,
            p.salesKnown ? `Sold all-time ${p.sold.length} pieces (${fmtG(p.sold.reduce((t, s) => t + s.wt, 0))})` : 'No sales data in the imports',
            p.note ? `Note: ${p.note}` : '',
            rs.length ? 'Ranges:\n' + rs.join('\n') : '',
            stock.length ? `In-stock pieces (${stock.length}):\n` + stock.slice(0, 60).join('\n') + (stock.length > 60 ? `\n  …and ${stock.length - 60} more` : '') : 'No pieces in stock',
          ].filter(Boolean).join('\n');
        }).join('\n\n');
      },
      supplier_needs({ counter, supplier }) {
        const list = pick({ counter }).filter(p => p.toOrder > 0 && !p.notReq);
        const by = {};
        for (const p of list) { const s = p.orderSup || 'No supplier'; (by[s] = by[s] || []).push(p); }
        let sups = Object.keys(by).map(s => [s, by[s].reduce((t, p) => t + p.toOrder, 0), by[s]]).sort((a, b) => b[1] - a[1]);
        if (supplier) {
          const q = norm(supplier); sups = sups.filter(([s]) => norm(s).includes(q));
          if (!sups.length) return `Nothing to order from "${supplier}".`;
          return sups.map(([s, n, ps]) => cap(ps.sort((a, b) => b.toOrder - a.toOrder).map(p => `  ${p.key} (${p.counter}): ${p.toOrder}`), `${s}: ${fmtN(n)} pieces, ${ps.length} products`)).join('\n\n');
        }
        return cap(sups.map(([s, n, ps]) => `${s}: ${fmtN(n)} pieces, ${ps.length} products`), `Still to order: ${fmtN(sups.reduce((t, x) => t + x[1], 0))} pieces from ${sups.length} supplier(s)`);
      },
      sales({ days, search, counter, supplier }) {
        const list = pick({ search, counter });
        const q = supplier ? norm(supplier) : '';
        let n = 0, w = 0; const byP = {}, byG = {}, byS = {};
        let noData = 0;
        for (const p of list) {
          if (!p.salesKnown) { noData++; continue; }
          const from = days && p.asOf != null ? p.asOf - (days - 1) * DAY : null;
          for (const s of p.sold) {
            if (q && !norm(s.supplier).includes(q)) continue;
            const t = core.dmyDate(s.soldOn);
            if (from != null && (t == null || t < from)) continue;
            n++; w += s.wt;
            byP[p.key] = (byP[p.key] || 0) + 1; byG[p.group] = (byG[p.group] || 0) + 1; byS[s.supplier || 'No supplier'] = (byS[s.supplier || 'No supplier'] || 0) + 1;
          }
        }
        const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([x, c]) => `  ${x}: ${c}`);
        return cap([
          `-- top products --`, ...top(byP, 15), `-- by group --`, ...top(byG, 12), `-- by supplier --`, ...top(byS, 10),
        ], `SOLD ${days ? `in the last ${days} days` : 'all sales history'}: ${fmtN(n)} pieces, ${fmtG(w)}${noData ? ` | ${noData} matching product(s) have no sales data in their import` : ''}`);
      },
      stock_totals({ search, counter, supplier }) {
        const list = pick({ search, counter });
        const q = supplier ? norm(supplier) : '';
        let n = 0, w = 0; const byG = {}, byS = {};
        for (const p of list) for (const s of p.stock) {
          if (q && !norm(s.supplier).includes(q)) continue;
          n++; w += s.wt;
          const g = byG[p.counter + ' · ' + p.group] || (byG[p.counter + ' · ' + p.group] = [0, 0]); g[0]++; g[1] += s.wt;
          const k = s.supplier || 'No supplier'; const x = byS[k] || (byS[k] = [0, 0]); x[0]++; x[1] += s.wt;
        }
        const rows = (o, k) => Object.entries(o).sort((a, b) => b[1][0] - a[1][0]).slice(0, k).map(([x, v]) => `  ${x}: ${fmtN(v[0])} pcs, ${fmtG(v[1])}`);
        return cap([`-- by group --`, ...rows(byG, 40), `-- by supplier --`, ...rows(byS, 15)], `IN STOCK: ${fmtN(n)} pieces, ${fmtG(w)}`);
      },
    };
  }

  // Public page (owner's choice) → keep the AI from being spammed: 20 questions a minute per visitor
  const limiter = require('express-rate-limit')({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many questions — wait a minute.' } });
  app.post('/api/restock/ai/ask', limiter, require('express').json({ limit: '100kb' }), async (req, res) => {
    try {
      const question = String(req.body?.question || '').trim().slice(0, 600);
      if (!question) return res.status(400).json({ error: 'Type a question.' });
      if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'AI is not set up (GROQ_API_KEY missing).' });
      const history = cleanHistory(req.body?.history);
      const [d, core] = [await loadRestock(), getCore()];
      const all = model(d, core);
      const said = [...history.filter(h => h.role === 'user').map(h => h.content), question].join(' ');
      const tools = makeTools(all, core, said);
      tools._d = d;
      const impls = Object.fromEntries(Object.entries(tools).filter(([k]) => k !== '_d').map(([k, f]) => [k, f.bind(tools)]));
      res.json(await runAgent({ system: SYSTEM(todayIST()), toolDefs: TOOLS, impls, history, question }));
    } catch (e) { res.status(500).json({ error: e.message.replace(/^\d{3} /, '') }); }
  });

  return { model, makeTools };
}

module.exports = { registerRestockAi };
