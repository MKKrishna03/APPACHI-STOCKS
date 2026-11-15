// Purchase Pro — bill photos (Cloudinary) + AI scan.
// Same approach as the old Purchase: PC upload or phone upload via QR code,
// then OCR text (browser Tesseract) → Groq text model, falling back to the
// Groq vision model on the image. Photos go to their own "purchase_pro/" folder.

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const OK_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

function uploadBuffer(buf, mimetype, { folder, publicId }) {
  const isPdf = mimetype === 'application/pdf';
  return new Promise((resolve, reject) => {
    const s = cloudinary.uploader.upload_stream({
      folder,
      ...(publicId ? { public_id: publicId } : {}),
      resource_type: isPdf ? 'raw' : 'image',
      ...(isPdf ? {} : { transformation: [{ width: 1800, height: 1800, crop: 'limit', quality: 'auto' }] }),
    }, (err, r) => (err ? reject(err) : resolve(r.secure_url)));
    s.end(buf);
  });
}

function safeId(...parts) {
  const s = parts.filter(Boolean).join('_').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
  return s ? `${s}_${Date.now().toString(36)}` : undefined;
}

// ── AI scan prompts ─────────────────────────────────────────────────────
const BILL_NO_HINT = 'bill_no is the invoice / bill number, printed next to a label like "Invoice No", "Inv No", "Bill No", "Tax Invoice No", "Voucher No" or "No." near the top of the bill (often in a box at the top right). Examples: "AJPL-35", "A-35", "NH-MC/06", "M57", "INV/26-27/112". Copy it exactly as printed, with letters, dashes and slashes. It is NOT the e-way bill no, GSTIN, PAN, order/challan no, HSN code, phone number or the date.';
const GST_CHECK = BILL_NO_HINT + ' Also extract the buyer/recipient GSTIN from the bill (the one in the "Bill To" / buyer address block, NOT the supplier GSTIN). Put it in a field called "buyer_gstin". Return it exactly as printed.';
const SHAPE = `{
  "bill_no": "", "date": "YYYY-MM-DD or empty", "supplier_name": "", "supplier_gstin": "", "buyer_gstin": "",
  "taxable_value": null, "cgst": null, "sgst": null, "igst": null, "round_off": null, "total_value": null, "tds": null, "net_value": null,
  "items": [{"description":"","hsn":"","huid":"","pcs":null,"gross_wt":null,"less_wt":null,"net_wt":null,"rate":null,"tax_pct":null,"amount":null}]
}`;
const ITEM_RULES = `Rules for items (one entry per printed row of the item table, in the same order, nothing invented):
- description: the row's description exactly as printed (e.g. "GOLD ORNAMENTS (JW)", "JOBWORK SERVICE CHARGES", "FINE GOLD (99.90)", "ADD: COPPER", "REFINING CHARGES"). Never merge two rows into one, and never skip a row.
- On labour / job-work / refining bills the metal rows (gold, silver, copper) carry the WEIGHT and usually no amount, and a separate charges row (JOBWORK / REFINING / MAKING CHARGES, SAC 9988xx) carries the AMOUNT. Keep them as separate items.
- CGST, SGST, IGST, round off, TDS, taxable value and total lines are NOT items: put them only in the top-level fields.
- hsn: the HSN/SAC code column (4-8 digits, e.g. 7113, 711319, 998892). Never put it in huid.
- huid: only a hallmark HUID: exactly 6 letters+digits with at least one letter (e.g. "AB12CD"). Leave "" if none.
- gross_wt / net_wt: weight in grams from the weight / quantity column of THAT row, with every decimal as printed (e.g. 325.860). If there is only one weight column use it for both. A service / charges row usually has no weight: use null.
- rate: rate if printed, else null. amount: the rupee amount printed on THAT row (null if that row has none). tax_pct: the FULL GST % (CGST 2.5% + SGST 2.5% = 5; IGST 3% = 3); use the same % on every row of the bill.
- Read digits carefully: never drop, add or swap digits; keep the decimal point where it is printed. Check: taxable_value = sum of item amounts, total_value = taxable_value + cgst + sgst + igst + round_off.
- date: the invoice date as YYYY-MM-DD (Indian bills print DD-MM-YYYY or DD/MM/YYYY).`;
const VISION_PROMPT = `You are reading a photo of a bill/invoice for an Indian jewellery business. Extract the fields and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
${SHAPE}
Use null for missing numbers. ${GST_CHECK}
${ITEM_RULES}`;
const TEXT_PROMPT = `You are a bill/invoice data extraction assistant for an Indian jewellery business. Extract fields from the following raw OCR text of a bill and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
${SHAPE}
Use null for missing numbers. The OCR text can have misread characters and broken columns; fix obvious OCR mistakes. ${GST_CHECK}
${ITEM_RULES}

OCR TEXT:
`;

async function groq(body, retry = true) {
  if (!process.env.GROQ_API_KEY) throw new Error('AI scan is not set up (GROQ_API_KEY missing).');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(process.env.GROQ_API_KEY).trim()}` },
    body: JSON.stringify({ temperature: 0, ...body }),
  });
  if (res.status === 429 && retry) {
    // per-minute limit: wait what Groq asks (up to 30 s) and try once more
    const wait = Math.min(30, Math.max(1, parseFloat(res.headers.get('retry-after')) || 6));
    await res.text().catch(() => {});
    await new Promise(r => setTimeout(r, wait * 1000));
    return groq(body, false);
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(res.status === 429 ? 'AI is busy (quota). Try again in a minute.' : `AI error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '{}';
}
// Groq retires models often — pick from what the account can use right now (cached 1 hour).
let modelCache = { at: 0, ids: [] };
async function groqModels() {
  if (Date.now() - modelCache.at < 3600000 && modelCache.ids.length) return modelCache.ids;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${String(process.env.GROQ_API_KEY).trim()}` } });
    const d = await r.json();
    modelCache = { at: Date.now(), ids: (d.data || []).filter(m => m.active !== false).map(m => m.id) };
  } catch {}
  return modelCache.ids;
}
const TEXT_PREF = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
const VISION_RE = /(vision|-vl\b|-vl-|scout|maverick|llama-4|gemma-?3|pixtral|multimodal)/i;
// retired / not allowed / blocked for this project → try the next model
const isGone = (e) => /\b(404|400|403)\b/.test(e.message) && /model|image|vision|support|blocked|access|permission/i.test(e.message);
const BLOCKED_MSG = 'Groq has blocked the AI models for this project. Open console.groq.com → Settings → Project → Limits and allow llama-3.3-70b-versatile and meta-llama/llama-4-scout-17b-16e-instruct.';
const allBlocked = (e) => e && /blocked at the project level/i.test(e.message);

async function groqText(prompt) {
  const ids = await groqModels();
  const list = [...TEXT_PREF.filter(m => !ids.length || ids.includes(m)), ...ids.filter(m => /gpt-oss|llama|qwen/i.test(m) && !TEXT_PREF.includes(m) && !/guard|whisper|tts|vision|scout|maverick/i.test(m))];
  let last;
  for (const model of list.length ? list : TEXT_PREF) {
    try { return await groq({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }); }
    catch (e) { last = e; if (!isGone(e)) throw e; }
  }
  if (allBlocked(last)) { const err = new Error(BLOCKED_MSG); err.gone = true; throw err; }
  if (last) last.gone = true;
  throw last || Object.assign(new Error('No AI text model available on Groq.'), { gone: true });
}
async function groqVision(prompt, mime, b64) {
  // qwen3.x models read photos too (tested on our bills: far better than the browser OCR text)
  const all = await groqModels();
  const ids = [...all.filter(m => /qwen/i.test(m) && !/guard/i.test(m)), ...all.filter(m => VISION_RE.test(m) && !/qwen/i.test(m))];
  if (!ids.length) throw new Error('Groq has no photo-reading model right now. Retake the photo straight and clear so the text scan can read it.');
  let last;
  for (const model of ids) {
    try { return await groq({ model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }] }); }
    catch (e) { last = e; if (!isGone(e)) throw e; }
  }
  if (allBlocked(last)) throw new Error(BLOCKED_MSG);
  throw new Error('Groq could not read the photo (' + (last?.message || 'no model').slice(0, 120) + '). Retake it straight and clear so the text scan can read it.');
}

function parseJSON(raw) {
  const s = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '');
  try { return JSON.parse(s.replace(/^\s*```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim()); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}'); // JSON with some words around it
  try { return a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : {}; } catch { return {}; }
}

// Clean what the AI returned: numbers as numbers, HSN codes never in the HUID box.
function tidyFields(f) {
  const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : null; };
  for (const k of ['taxable_value', 'cgst', 'sgst', 'igst', 'round_off', 'total_value', 'tds', 'net_value']) if (k in f) f[k] = num(f[k]);
  if (f.bill_no) f.bill_no = String(f.bill_no).trim().replace(/^(invoice|inv|bill)\s*(no\.?|number)?\s*[:.-]?\s*/i, '');
  if (Array.isArray(f.items)) {
    f.items = f.items.filter(it => it && typeof it === 'object').map(it => {
      for (const k of ['pcs', 'gross_wt', 'less_wt', 'net_wt', 'rate', 'tax_pct', 'amount']) it[k] = num(it[k]);
      const h = String(it.huid || '').replace(/\s/g, '').toUpperCase();
      it.huid = /^[A-Z0-9]{6}$/.test(h) && /[A-Z]/.test(h) ? h : '';
      if (it.description) it.description = String(it.description).trim().toUpperCase();
      return it;
    }).filter(it => it.description || it.net_wt || it.gross_wt || it.amount)
      // tax / total lines the AI sometimes lists as rows
      .filter(it => it.net_wt || it.gross_wt || !/^(C\s*GST|S\s*GST|I\s*GST|ROUND\s*OFF|ROUNDING|TDS|TCS|TAXABLE|SUB\s*TOTAL|GRAND\s*TOTAL|TOTAL|NET\s*(AMOUNT|PAYABLE))\b/i.test(it.description || ''));
    // GST % from the bill's own tax ÷ taxable (the AI often gives the CGST half, e.g. 9 for 18)
    const tax = (f.cgst || 0) + (f.sgst || 0) + (f.igst || 0);
    if (f.taxable_value > 0 && tax > 0) {
      const pct = (tax / f.taxable_value) * 100;
      const near = [0.25, 1.5, 3, 5, 12, 18, 28].find(r => Math.abs(r - pct) < Math.max(0.15, r * 0.03));
      if (near) f.items.forEach(it => { it.tax_pct = near; });
    }
  }
  return f;
}

// Our GSTIN: APPACHI JEWELLERY PVT LTD (firm.js). OUR_GSTIN_2 can add another if ever needed.
function gstMatches(extracted) {
  const norm = (s) => String(s || '').replace(/\s/g, '').toUpperCase();
  const a = norm(extracted);
  if (!a) return false;
  return [require('./firm').FIRM_GSTIN, process.env.OUR_GSTIN_2].filter(Boolean).map(norm).some(b => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    let diff = 0; // tolerate up to 2 OCR mistakes (O/0, I/1)
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 2) return false;
    return true;
  });
}

function registerPhotos({ api, db, nowIso, who }) {
  async function init() {
    await db.execute(`CREATE TABLE IF NOT EXISTS pp_upload_sessions (
      token TEXT PRIMARY KEY, firm INTEGER, label TEXT, urls TEXT NOT NULL DEFAULT '[]',
      created_by TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    )`);
    await db.execute({ sql: 'DELETE FROM pp_upload_sessions WHERE expires_at < ?', args: [nowIso()] });
    // New photos wait here until the bill is saved; only then do they go to Cloudinary.
    await db.execute(`CREATE TABLE IF NOT EXISTS pp_temp_photos (
      id TEXT PRIMARY KEY, firm INTEGER, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
    )`);
    await cleanTemp();
  }
  // Never-saved photos are thrown away after 7 days.
  async function cleanTemp() {
    await db.execute({ sql: 'DELETE FROM pp_temp_photos WHERE created_at < ?', args: [new Date(Date.now() - 7 * 86400000).toISOString()] }).catch(() => {});
  }
  setInterval(cleanTemp, 6 * 3600000).unref();

  const folderFor = (firm) => `purchase_pro/${Number(firm) === 1 ? 'aj' : 'ajpvt'}/bills`;

  // ── Temporary photos ──
  // URL: /purchase-pro/api/temp/<id>[?crop=x,y,w,h]  (crop = fractions of the photo, 0–1)
  const TEMP_RE = /^\/purchase-pro\/api\/temp\/([a-f0-9]{24})(?:\.pdf)?(?:\?crop=([\d.]+),([\d.]+),([\d.]+),([\d.]+))?$/;
  async function storeTemp(file, firm) {
    let { buffer, mimetype } = file;
    if (mimetype !== 'application/pdf') {
      // phone photos are big — keep a clear 2400px JPG, turned the right way up
      try {
        buffer = await sharp(buffer).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        mimetype = 'image/jpeg';
      } catch {} // e.g. HEIC this sharp can't open — keep the original, Cloudinary converts it on save
    }
    if (buffer.length > 8 * 1024 * 1024) throw new Error('File is too big (over 8 MB).');
    const id = crypto.randomBytes(12).toString('hex');
    await db.execute({ sql: 'INSERT INTO pp_temp_photos (id, firm, mime, data, created_at) VALUES (?,?,?,?,?)', args: [id, Number(firm) || 2, mimetype, buffer, nowIso()] });
    return `/purchase-pro/api/temp/${id}${mimetype === 'application/pdf' ? '.pdf' : ''}`;
  }
  // Bytes of a temp photo with its crop applied, or null if it is not a (live) temp URL.
  async function readTemp(url) {
    const m = String(url).match(TEMP_RE);
    if (!m) return null;
    const r = await db.execute({ sql: 'SELECT mime, data FROM pp_temp_photos WHERE id = ?', args: [m[1]] });
    if (!r.rows[0]) throw new Error('A photo was not saved in time and has expired (photos are kept 7 days until the bill is saved). Please attach it again.');
    let buf = Buffer.from(r.rows[0].data), mime = r.rows[0].mime;
    if (m[2] && mime.startsWith('image/')) {
      const img = sharp(buf);
      const { width: W, height: H } = await img.metadata();
      const [x, y, w, h] = m.slice(2, 6).map(Number);
      const left = Math.max(0, Math.round(x * W)), top = Math.max(0, Math.round(y * H));
      const box = { left, top, width: Math.max(1, Math.min(W - left, Math.round(w * W))), height: Math.max(1, Math.min(H - top, Math.round(h * H))) };
      buf = await img.extract(box).jpeg({ quality: 88 }).toBuffer();
      mime = 'image/jpeg';
    }
    return { id: m[1], buf, mime };
  }
  const isTemp = (u) => TEMP_RE.test(String(u));
  // Called when a bill is saved: temp photos → Cloudinary, everything else kept as it is.
  async function finalizePhotos(urls, firm, label) {
    const out = [], done = [];
    for (const u of urls) {
      const t = await readTemp(u);
      if (!t) { if (/^https:\/\//.test(u)) out.push(u); continue; }
      out.push(await uploadBuffer(t.buf, t.mime, { folder: folderFor(firm), publicId: safeId(label) }));
      done.push(t.id);
    }
    for (const id of new Set(done)) await db.execute({ sql: 'DELETE FROM pp_temp_photos WHERE id = ?', args: [id] }).catch(() => {});
    return [...new Set(out)];
  }

  api.get('/temp/:id', async (req, res) => {
    try {
      const q = req.query.crop ? `?crop=${req.query.crop}` : '';
      const t = await readTemp(`/purchase-pro/api/temp/${req.params.id}${q}`).catch(() => null);
      if (!t) return res.status(404).send('Photo expired');
      res.set({ 'Content-Type': t.mime, 'Cache-Control': 'private, max-age=86400' }).send(t.buf);
    } catch (e) { res.status(500).send(e.message); }
  });

  // PC upload (gated) — kept temporary until the bill is saved
  api.post('/photos', upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file received.' });
      if (!OK_MIME.test(req.file.mimetype)) return res.status(400).json({ error: 'Only photos (JPG, PNG, WEBP, HEIC) or PDF.' });
      res.json({ url: await storeTemp(req.file, req.body.firm) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Phone upload session: the PC shows a QR code, the phone opens /purchase-pro/m/<token>.
  api.post('/upload-sessions', async (req, res) => {
    try {
      const token = crypto.randomBytes(12).toString('hex');
      const now = Date.now();
      await db.execute({
        sql: 'INSERT INTO pp_upload_sessions (token, firm, label, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?)',
        args: [token, Number(req.body?.firm) || 2, String(req.body?.label || '').slice(0, 80), who(req).id, new Date(now).toISOString(), new Date(now + 30 * 60000).toISOString()],
      });
      res.json({ token, url: `/purchase-pro/m/${token}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  api.get('/upload-sessions/:token', async (req, res) => {
    try {
      const r = await db.execute({ sql: 'SELECT urls, expires_at FROM pp_upload_sessions WHERE token = ?', args: [req.params.token] });
      if (!r.rows[0]) return res.status(404).json({ error: 'Upload link not found.' });
      res.json({ urls: JSON.parse(r.rows[0].urls || '[]'), expired: r.rows[0].expires_at < nowIso() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // AI scan (gated)
  api.post('/scan', async (req, res) => {
    try {
      const { image_url, ocr_text } = req.body || {};
      const temp = isTemp(image_url) ? await readTemp(image_url) : null;
      const okImg = temp ? temp.mime.startsWith('image/')
        : image_url && /^https:\/\/res\.cloudinary\.com\//.test(image_url) && !/\/raw\/|\.pdf($|\?)/i.test(image_url);
      async function vision() {
        let buf;
        if (temp) buf = await sharp(temp.buf).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        else {
          // always a clear JPG, max 1600px (a crop step in the URL still applies — relative coords)
          const src = image_url.includes('/image/upload/') ? image_url.replace('/image/upload/', '/image/upload/w_1600,h_1600,c_limit,q_85,f_jpg/') : image_url;
          const img = await fetch(src);
          if (!img.ok) throw new Error('Could not read the photo.');
          buf = Buffer.from(await img.arrayBuffer());
        }
        return parseJSON(await groqVision(VISION_PROMPT, 'image/jpeg', buf.toString('base64')));
      }
      const hasText = ocr_text && String(ocr_text).trim().length > 40;
      let fields;
      // 1st choice: the AI reads the photo itself. Browser OCR text of a phone photo is too garbled
      // (lost bill numbers, wrong weights, mixed-up rows) — it is only the fallback now.
      if (okImg) {
        try { fields = await vision(); } catch (e) { if (!hasText) throw e; }
        if (fields && !Object.keys(fields).length) fields = undefined;
      }
      if (fields === undefined) {
        if (!hasText) return res.status(400).json({ error: 'Upload a bill photo first.' });
        fields = parseJSON(await groqText(TEXT_PROMPT + String(ocr_text).slice(0, 12000)));
      }
      tidyFields(fields);
      fields.gst_valid = gstMatches(fields.buyer_gstin) || gstMatches(fields.our_gstin);
      res.json({ fields });
    } catch (e) { res.status(/quota/.test(e.message) ? 429 : 500).json({ error: e.message }); }
  });

  // ── Public (no login): the phone page + its upload endpoint. Token = access. ──
  const pub = express.Router();
  async function liveSession(token) {
    const r = await db.execute({ sql: 'SELECT * FROM pp_upload_sessions WHERE token = ? AND expires_at > ?', args: [String(token), nowIso()] });
    return r.rows[0] || null;
  }
  pub.get('/m/:token', (req, res) => res.sendFile(require('path').join(__dirname, 'mobile.html')));
  pub.get('/m/:token/info', async (req, res) => {
    const s = await liveSession(req.params.token).catch(() => null);
    if (!s) return res.status(404).json({ error: 'This upload link has expired. Make a new QR code on the computer.' });
    res.json({ label: s.label, count: JSON.parse(s.urls || '[]').length });
  });
  pub.post('/m/:token/photo', upload.single('photo'), async (req, res) => {
    try {
      const s = await liveSession(req.params.token);
      if (!s) return res.status(404).json({ error: 'This upload link has expired.' });
      if (!req.file || !OK_MIME.test(req.file.mimetype)) return res.status(400).json({ error: 'Only photos or PDF.' });
      const url = await storeTemp(req.file, s.firm); // goes to Cloudinary only when the bill is saved
      // Append atomically so two quick uploads don't overwrite each other.
      await db.execute({
        sql: `UPDATE pp_upload_sessions SET urls = json_insert(urls, '$[#]', ?) WHERE token = ?`,
        args: [url, s.token],
      });
      const n = await db.execute({ sql: 'SELECT json_array_length(urls) AS n FROM pp_upload_sessions WHERE token = ?', args: [s.token] });
      res.json({ url, count: Number(n.rows[0].n) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { init, publicRouter: pub, finalizePhotos, isTemp };
}

module.exports = { registerPhotos };
