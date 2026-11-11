// Purchase Pro — bill photos (Cloudinary) + AI scan.
// Same approach as the old Purchase: PC upload or phone upload via QR code,
// then OCR text (browser Tesseract) → Groq text model, falling back to the
// Groq vision model on the image. Photos go to their own "purchase_pro/" folder.

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

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

// ── AI scan (prompts copied from the old Purchase) ──────────────────────
const GST_CHECK = 'Also extract the buyer/recipient GSTIN from the bill (the one in the "Bill To" / buyer address block, NOT the supplier GSTIN). Put it in a field called "buyer_gstin". Return it exactly as printed.';
const SHAPE = `{
  "bill_no": "", "date": "YYYY-MM-DD or empty", "supplier_name": "", "supplier_gstin": "", "buyer_gstin": "",
  "taxable_value": null, "cgst": null, "sgst": null, "igst": null, "round_off": null, "total_value": null, "tds": null, "net_value": null,
  "items": [{"description":"","huid":"","pcs":null,"gross_wt":null,"less_wt":null,"net_wt":null,"rate":null,"tax_pct":null,"amount":null}]
}`;
const VISION_PROMPT = `You are a bill/invoice OCR assistant for an Indian jewellery business. Extract fields from this bill image and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
${SHAPE}
Use null for missing numbers. ${GST_CHECK} Extract all line items you can see. Weights are in grams.`;
const TEXT_PROMPT = `You are a bill/invoice data extraction assistant for an Indian jewellery business. Extract fields from the following raw OCR text of a bill and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
${SHAPE}
Use null for missing numbers. date format: YYYY-MM-DD. Extract all line items you can see. Weights are in grams. ${GST_CHECK}

OCR TEXT:
`;

async function groq(body) {
  if (!process.env.GROQ_API_KEY) throw new Error('AI scan is not set up (GROQ_API_KEY missing).');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${String(process.env.GROQ_API_KEY).trim()}` },
    body: JSON.stringify({ temperature: 0, ...body }),
  });
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
const isGone = (e) => /\b(404|400)\b/.test(e.message) && /model|image|vision|support/i.test(e.message);

async function groqText(prompt) {
  const ids = await groqModels();
  const list = [...TEXT_PREF.filter(m => !ids.length || ids.includes(m)), ...ids.filter(m => /gpt-oss|llama|qwen/i.test(m) && !TEXT_PREF.includes(m) && !/guard|whisper|tts|vision|scout|maverick/i.test(m))];
  let last;
  for (const model of list.length ? list : TEXT_PREF) {
    try { return await groq({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }); }
    catch (e) { last = e; if (!isGone(e)) throw e; }
  }
  throw last || new Error('No AI text model available on Groq.');
}
async function groqVision(prompt, mime, b64) {
  const ids = (await groqModels()).filter(m => VISION_RE.test(m));
  if (!ids.length) throw new Error('Groq has no photo-reading model right now. Retake the photo straight and clear so the text scan can read it.');
  let last;
  for (const model of ids) {
    try { return await groq({ model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }] }] }); }
    catch (e) { last = e; if (!isGone(e)) throw e; }
  }
  throw new Error('Groq could not read the photo (' + (last?.message || 'no model').slice(0, 120) + '). Retake it straight and clear so the text scan can read it.');
}

function parseJSON(raw) {
  try { return JSON.parse(String(raw).replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim()); } catch { return {}; }
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
  }

  const folderFor = (firm) => `purchase_pro/${Number(firm) === 1 ? 'aj' : 'ajpvt'}/bills`;

  // PC upload (gated)
  api.post('/photos', upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file received.' });
      if (!OK_MIME.test(req.file.mimetype)) return res.status(400).json({ error: 'Only photos (JPG, PNG, WEBP, HEIC) or PDF.' });
      const url = await uploadBuffer(req.file.buffer, req.file.mimetype, { folder: folderFor(req.body.firm), publicId: safeId(req.body.label) });
      res.json({ url });
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
      let raw;
      if (ocr_text && String(ocr_text).trim().length > 40) {
        raw = await groqText(TEXT_PROMPT + String(ocr_text).slice(0, 12000));
      } else {
        if (!image_url || !/^https:\/\/res\.cloudinary\.com\//.test(image_url)) return res.status(400).json({ error: 'Upload a bill photo first.' });
        const img = await fetch(image_url);
        if (!img.ok) return res.status(400).json({ error: 'Could not read the photo.' });
        const ct = img.headers.get('content-type') || 'image/jpeg';
        const mime = ct.startsWith('image/png') ? 'image/png' : ct.startsWith('image/webp') ? 'image/webp' : 'image/jpeg';
        raw = await groqVision(VISION_PROMPT, mime, Buffer.from(await img.arrayBuffer()).toString('base64'));
      }
      const fields = parseJSON(raw);
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
      const url = await uploadBuffer(req.file.buffer, req.file.mimetype, { folder: folderFor(s.firm), publicId: safeId(s.label) });
      // Append atomically so two quick uploads don't overwrite each other.
      await db.execute({
        sql: `UPDATE pp_upload_sessions SET urls = json_insert(urls, '$[#]', ?) WHERE token = ?`,
        args: [url, s.token],
      });
      const n = await db.execute({ sql: 'SELECT json_array_length(urls) AS n FROM pp_upload_sessions WHERE token = ?', args: [s.token] });
      res.json({ url, count: Number(n.rows[0].n) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { init, publicRouter: pub };
}

module.exports = { registerPhotos };
