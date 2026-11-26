// Purchase Pro — "Looks unusual": entries that are probably a typing mistake,
// a duplicate, or worth a second look. Rules only (no AI guessing), so every
// alarm says exactly why. Shown as a Checker tab; a false alarm is cleared
// with the Verified tick like every other check.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const rs = (n) => '₹' + r2(n).toLocaleString('en-IN');
const gm = (n) => r3(n).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' g';
const days = (a, b) => Math.abs(Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000));
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const billNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
const gstOf = (b) => (Number(b.cgst) || 0) + (Number(b.sgst) || 0) + (Number(b.igst) || 0);
const KL = { PURCHASE: 'Purchase', EXPENSE: 'Expense', HALLMARK: 'Hallmark', LABOUR: 'Labour', CREDIT_NOTE: 'Credit note', DEBIT_NOTE: 'Debit note' };
const HOME = '33'; // Tamil Nadu

// by: Map(party_id → entries), c: computeParty result per party (for weight balance)
function findUnusual({ by, parties, today, computeParty }) {
  const out = [];
  const add = (rule, id, pid, date, what, detail, href) => out.push({ id: `${rule}:${id}`, rule, party_id: pid, party_name: parties.get(pid)?.name || '—', date, what, detail, href });

  for (const [pid, e] of by) {
    const p = parties.get(pid) || {};
    const bills = e.bills.slice().sort((a, b) => (a.bill_date < b.bill_date ? -1 : a.bill_date > b.bill_date ? 1 : a.id - b.id));
    const label = (b) => `${KL[b.kind] || b.kind} bill ${b.bill_no}`;

    // 1. Same bill number entered twice
    const seen = new Map();
    for (const b of bills) {
      const k = b.kind + '|' + billNo(b.bill_no);
      if (!billNo(b.bill_no)) continue;
      if (seen.has(k)) { const o = seen.get(k); add('dup_bill', b.id, pid, b.bill_date, 'Bill entered twice?', `${label(b)} ${rs(b.net)} — same bill no as the one on ${o.bill_date} (${rs(o.net)})`, `#/bills/${b.id}`); }
      else seen.set(k, b);
    }

    // 2. Same payment twice (same amount within 3 days)
    const pays = e.payments.filter(x => x.direction === 'PAID').sort((a, b) => (a.pay_date < b.pay_date ? -1 : a.pay_date > b.pay_date ? 1 : a.id - b.id));
    for (let i = 1; i < pays.length; i++) for (let j = i - 1; j >= 0; j--) {
      if (days(pays[j].pay_date, pays[i].pay_date) > 3) break;
      if (Math.abs(pays[i].amount - pays[j].amount) < 0.01 && pays[i].amount >= 1000) { add('dup_pay', pays[i].id, pid, pays[i].pay_date, 'Payment entered twice?', `${rs(pays[i].amount)} on ${pays[i].pay_date} — same amount paid on ${pays[j].pay_date}${pays[i].reference && pays[i].reference === pays[j].reference ? ' (same reference)' : ''}`, `#/payments/${pays[i].id}`); break; }
    }

    // 3. Big round-off on a payment
    for (const x of pays) if (Math.abs(Number(x.round_off) || 0) > 100) add('round_off', x.id, pid, x.pay_date, 'Big round-off', `Payment ${rs(x.amount)} has round-off ${rs(x.round_off)}`, `#/payments/${x.id}`);

    // 4. GST type does not fit the supplier's state; CGST ≠ SGST
    const sc = p.state_code || (p.gstin ? String(p.gstin).slice(0, 2) : null);
    for (const b of bills) {
      const cs = (Number(b.cgst) || 0) + (Number(b.sgst) || 0), ig = Number(b.igst) || 0;
      if (sc === HOME && ig > 0) add('gst_type', b.id, pid, b.bill_date, 'IGST for a Tamil Nadu supplier', `${label(b)}: IGST ${rs(ig)} — should be CGST + SGST`, `#/bills/${b.id}`);
      else if (sc && sc !== HOME && cs > 0) add('gst_type', b.id, pid, b.bill_date, 'CGST/SGST for an other-state supplier', `${label(b)}: CGST+SGST ${rs(cs)} — should be IGST (state ${sc})`, `#/bills/${b.id}`);
      else if (Math.abs((Number(b.cgst) || 0) - (Number(b.sgst) || 0)) > 1) add('gst_split', b.id, pid, b.bill_date, 'CGST and SGST differ', `${label(b)}: CGST ${rs(b.cgst)} vs SGST ${rs(b.sgst)}`, `#/bills/${b.id}`);
    }

    // 5. GST charged but the supplier has no GSTIN (one alarm per supplier)
    const gstBills = bills.filter(b => gstOf(b) > 0);
    if (!p.gstin && gstBills.length) { const last = gstBills[gstBills.length - 1]; add('no_gstin', pid, pid, last.bill_date, 'GST paid, no GSTIN', `${gstBills.length} bill(s) with GST ${rs(gstBills.reduce((s, b) => s + gstOf(b), 0))} — add the supplier's GSTIN or the GST can't be claimed`, `#/suppliers`); }

    // 6. GST % different from this supplier's usual % (needs 3+ GST bills of that kind)
    for (const kind of Object.keys(KL)) {
      const list = gstBills.filter(b => b.kind === kind && b.taxable > 0);
      if (list.length < 3) continue;
      const pct = (b) => Math.round(gstOf(b) / b.taxable * 1000) / 10; // 1 decimal
      const count = new Map(); for (const b of list) count.set(pct(b), (count.get(pct(b)) || 0) + 1);
      const [usual, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n < 2) continue;
      for (const b of list) if (Math.abs(pct(b) - usual) > 0.3) add('gst_pct', b.id, pid, b.bill_date, 'GST % not usual', `${label(b)}: GST ${pct(b)}% — this supplier is usually ${usual}%`, `#/bills/${b.id}`);
    }

    // 7. Rate per gram far from this supplier's nearby bills (purchase bills with weight)
    const wb = bills.filter(b => b.kind === 'PURCHASE' && b.net_wt > 0 && b.taxable > 0);
    if (wb.length >= 4) for (const b of wb) {
      const near = wb.filter(o => o !== b).sort((x, y) => days(x.bill_date, b.bill_date) - days(y.bill_date, b.bill_date)).slice(0, 5);
      const m = median(near.map(o => o.taxable / o.net_wt)), rate = b.taxable / b.net_wt;
      if (m > 0 && Math.abs(rate - m) / m > 0.15) add('rate', b.id, pid, b.bill_date, rate > m ? 'Rate much higher than usual' : 'Rate much lower than usual', `${label(b)}: ${rs(rate)}/g — this supplier's nearby bills ~${rs(m)}/g (${Math.round((rate - m) / m * 100)}%). Weight or amount typed wrong?`, `#/bills/${b.id}`);
    }

    // 8. Bill amount far above this supplier's normal (3× the median, 4+ bills of that kind)
    for (const kind of Object.keys(KL)) {
      const list = bills.filter(b => b.kind === kind && b.net > 0);
      if (list.length < 4) continue;
      for (const b of list) {
        const m = median(list.filter(o => o !== b).map(o => o.net));
        if (m > 0 && b.net > 3 * m && b.net - m > 10000) add('amount', b.id, pid, b.bill_date, 'Amount much bigger than usual', `${label(b)}: ${rs(b.net)} — this supplier's bills are usually ~${rs(m)}. Extra zero?`, `#/bills/${b.id}`);
      }
    }

    // 9. Dated in the future
    for (const b of bills) if (b.bill_date > today) add('future', 'b' + b.id, pid, b.bill_date, 'Future date', `${label(b)} is dated ${b.bill_date}`, `#/bills/${b.id}`);
    for (const x of e.payments) if (x.pay_date > today) add('future', 'p' + x.id, pid, x.pay_date, 'Future date', `Payment ${rs(x.amount)} is dated ${x.pay_date}`, `#/payments/${x.id}`);
    for (const i of e.issues) if (i.issue_date > today) add('future', 'i' + i.id, pid, i.issue_date, 'Future date', `Issue ${i.issue_no} is dated ${i.issue_date}`, '#/issues');

    // 10. More weight received back than was ever issued
    if (e.issues.length || e.receipts.length) {
      const c = computeParty(e, today);
      if (c.weight < -0.0005 && !(e.opening && e.opening.weight < 0)) {
        const last = [...e.receipts.map(r => r.receipt_date), ...e.bills.filter(b => b.kind === 'LABOUR').map(b => b.bill_date)].sort().pop() || today;
        add('excess_wt', pid, pid, last, 'Received more weight than issued', `${gm(-c.weight)} more received back than issued — an issue voucher missing, or weight typed wrong?`, `#/ledger/${pid}`);
      }
    }
  }
  return out;
}

module.exports = { findUnusual };
