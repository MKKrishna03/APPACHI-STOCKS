// Purchase Pro — duplicate bill photo check.
// Every bill photo gets a fingerprint: an exact one (sha256 of the file) and a picture one
// (a 32×32 grey copy — the same photo stays nearly the same after WhatsApp re-compression,
// resizing or re-saving). Distance = average difference per pixel after taking out the overall
// brightness. Measured on our real bill photos (26 Nov 2026):
//   re-sent / recompressed / slightly brighter copies: 0.5 – 4.9 (average 2.3)
//   two different bills (same supplier's printed form):  7.3 and up
// So: the upload warning fires at ≤ UPLOAD_DIFF; "Looks unusual" needs ≤ SAME_DIFF AND the same
// supplier AND the same amount (or the exact same file). A fresh photo of the same paper bill
// from another angle is NOT caught — the duplicate-bill-number check catches that.

const crypto = require('crypto');
const sharp = require('sharp');

const SIDE = 32, SAME_DIFF = 5, UPLOAD_DIFF = 3.5;
const isPdf = (u) => /\.pdf(\?|$)/i.test(String(u || ''));

async function fingerprint(buf) {
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  let dh = null;
  try {
    const px = await sharp(buf).rotate().flatten({ background: '#ffffff' }).greyscale().resize(SIDE, SIDE, { fit: 'fill' }).raw().toBuffer();
    dh = Buffer.from(px).toString('base64');
  } catch { /* PDF / unreadable image: exact fingerprint only */ }
  return { sha, dh };
}
const decoded = new Map();
const pixels = (s) => { let p = decoded.get(s); if (!p) { p = Buffer.from(s, 'base64'); if (decoded.size > 5000) decoded.clear(); decoded.set(s, p); } return p; };
// average difference per pixel, overall brightness taken out (0 = identical … 255)
function distance(a, b) {
  if (!a || !b) return 999;
  const x = pixels(a), y = pixels(b);
  if (x.length !== y.length || x.length !== SIDE * SIDE) return 999;
  let mx = 0, my = 0;
  for (let i = 0; i < x.length; i++) { mx += x[i]; my += y[i]; }
  mx /= x.length; my /= y.length;
  let d = 0;
  for (let i = 0; i < x.length; i++) d += Math.abs((x[i] - mx) - (y[i] - my));
  return d / x.length;
}
const same = (x, y) => (x.sha && x.sha === y.sha) || distance(x.dh, y.dh) <= SAME_DIFF;

function registerPhotoHash({ db, nowIso }) {
  let ready = null;
  const table = () => ready || (ready = db.execute(`CREATE TABLE IF NOT EXISTS pp_photo_hash (url TEXT PRIMARY KEY, sha TEXT, dh TEXT, at TEXT)`));
  async function record(url, buf) {
    if (!url || !buf) return;
    try { await table(); const f = await fingerprint(buf); await db.execute({ sql: 'INSERT OR REPLACE INTO pp_photo_hash (url, sha, dh, at) VALUES (?,?,?,?)', args: [url, f.sha, f.dh, nowIso()] }); } catch {}
  }
  // url → { sha, dh } for every photo on a live bill, plus which bill it is on
  async function billPhotos() {
    await table();
    const [b, h] = await Promise.all([
      db.execute(`SELECT b.id, b.party_id, b.bill_no, b.bill_date, b.net, b.photos, p.name AS party FROM pp_bills b LEFT JOIN pp_parties p ON p.id = b.party_id WHERE b.deleted_at IS NULL AND COALESCE(b.is_mc, 0) = 0 AND b.photos IS NOT NULL AND b.photos != '[]'`),
      db.execute('SELECT url, sha, dh FROM pp_photo_hash'),
    ]);
    const hash = new Map(h.rows.map(r => [r.url, { sha: r.sha, dh: r.dh }]));
    const list = [];
    for (const r of b.rows) {
      let ph = []; try { ph = JSON.parse(r.photos || '[]'); } catch {}
      for (const u of ph) list.push({ url: u, bill: { id: r.id, party_id: r.party_id, bill_no: r.bill_no, bill_date: r.bill_date, net: Number(r.net) || 0, party: r.party }, fp: hash.get(u) || null });
    }
    return list;
  }
  // A just-uploaded photo: is it already on a bill?
  async function findDup(buf) {
    try {
      const f = await fingerprint(buf);
      const hit = (await billPhotos()).find(x => x.fp && ((f.sha && f.sha === x.fp.sha) || distance(f.dh, x.fp.dh) <= UPLOAD_DIFF));
      return hit ? hit.bill : null;
    } catch { return null; }
  }
  // Photos saved before this check existed: fingerprint them from a small Cloudinary copy, a few at a time
  let busy = false;
  async function backfill(max = 25) {
    if (busy) return; busy = true;
    try {
      const todo = (await billPhotos()).filter(x => !x.fp && !isPdf(x.url) && /^https:\/\/res\.cloudinary\.com\/.+\/upload\//.test(x.url)).slice(0, max);
      for (const x of todo) {
        try {
          const small = x.url.replace('/upload/', '/upload/w_600/');
          const r = await fetch(small); if (!r.ok) continue;
          await record(x.url, Buffer.from(await r.arrayBuffer()));
        } catch {}
      }
    } catch {} finally { busy = false; }
  }
  setTimeout(() => backfill(200), 60000).unref?.();
  setInterval(() => backfill(), 15 * 60000).unref?.();
  return { record, findDup, billPhotos, backfill };
}

// For "Looks unusual": bills that carry the same photo as an earlier bill — the exact same file,
// or the same picture on two bills of the same supplier with the same amount (bills printed from one
// template look alike, so a picture match alone is not enough)
function dupPhotoPairs(list) {
  const out = [], withFp = list.filter(x => x.fp);
  for (let i = 0; i < withFp.length; i++) for (let j = 0; j < i; j++) {
    const a = withFp[i], b = withFp[j];
    if (a.bill.id === b.bill.id) continue;
    const exact = a.fp.sha && a.fp.sha === b.fp.sha;
    if (!exact && !(same(a.fp, b.fp) && a.bill.party_id === b.bill.party_id && Math.abs(a.bill.net - b.bill.net) <= 1)) continue;
    const [first, later] = (a.bill.bill_date < b.bill.bill_date || (a.bill.bill_date === b.bill.bill_date && a.bill.id < b.bill.id)) ? [a, b] : [b, a];
    out.push({ later: later.bill, first: first.bill });
  }
  const seen = new Set();
  return out.filter(p => { const k = p.later.id + ':' + p.first.id; if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { registerPhotoHash, fingerprint, distance, dupPhotoPairs, SAME_DIFF };
