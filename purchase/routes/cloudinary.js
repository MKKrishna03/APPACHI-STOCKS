const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const cloudinaryPkg = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { pool, oldPool, companyStore } = require("../db");
const { logger } = require("../middleware/logger");

const router = express.Router();

cloudinaryPkg.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const BASE_FOLDERS = [
  "purchase_bills", "chittai_bills", "labour_receipts",
  "hallmark_bills", "expense_bills", "credit_notes", "debit_notes", "refinery_bills",
  "mc_bills", "cancelled_bills", "photo_bill_entries",
];
const PVT_FOLDERS = BASE_FOLDERS.map((f) => "pvtltd/" + f);
const ALLOWED_FOLDERS = new Set([...BASE_FOLDERS, ...PVT_FOLDERS]);
const ALL_FOLDERS = [...BASE_FOLDERS, ...PVT_FOLDERS];

// Returns "pvtltd/" for new company (id 2) or "" for old company (id 1).
// Falls back to "" when called outside request context (module load time).
function getCompanyPrefix() {
  const cid = companyStore.getStore();
  return cid === 1 ? "" : "pvtltd/";
}

// Returns only the folders that belong to the current company.
function getCompanyFolders() {
  const cid = companyStore.getStore();
  return cid === 1 ? BASE_FOLDERS : PVT_FOLDERS;
}

// Upload sessions are always stored in oldPool so the mobile upload page
// (which has no company context) can retrieve them regardless of company.
async function getSession(token) {
  const result = await oldPool.query(
    `SELECT * FROM upload_sessions WHERE token=$1 AND expires_at > NOW()`,
    [token],
  );
  return result.rows[0] || null;
}

/**
 * Build a human-readable Cloudinary public_id so photos can be identified
 * in the media library even if they are never linked to a DB record.
 * Example: "KNR_JEWELLERY_INV_001_2026_m1xqz" instead of "upltngphwa8olsyfymev".
 */
function buildPublicId(bill_no, company) {
  const raw_bill = (bill_no || "").trim();
  if (!raw_bill) return undefined; // no bill number → let Cloudinary assign its own ID
  const safe = (s) =>
    s.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/, "");
  const parts = [];
  const co = safe((company || "").trim()).slice(0, 25);
  if (co) parts.push(co);
  parts.push(safe(raw_bill).slice(0, 40));
  parts.push(Date.now().toString(36)); // compact, unique suffix (~7 chars)
  return parts.join("_");
}

function makeUploader(defaultFolder) {
  return multer({
    storage: new CloudinaryStorage({
      cloudinary: cloudinaryPkg,
      params: async (req, file) => {
        const isPdf = file.mimetype === "application/pdf";
        const prefix = getCompanyPrefix();
        let folder = prefix + defaultFolder;
        const session = req.params?.token ? await getSession(req.params.token) : null;
        // session.folder already contains the prefix (set when session was created)
        if (session && ALLOWED_FOLDERS.has(session.folder)) folder = session.folder;
        else if (req.body?.folder && ALLOWED_FOLDERS.has(req.body.folder)) folder = prefix + req.body.folder;
        else if (req.query?.folder && ALLOWED_FOLDERS.has(req.query.folder)) folder = prefix + req.query.folder;
        const bill_date = session?.bill_date || req.body?.bill_date || null;
        // Use bill_no + company from session (phone upload) or request body (PC upload)
        const bill_no = session?.bill_no || req.body?.bill_no || null;
        const company = session?.company || req.body?.company || null;
        const public_id = buildPublicId(bill_no, company);
        logger.info("cloudinary-upload", { folder, public_id: public_id || "(auto)", token: req.params?.token || null });
        return {
          folder,
          ...(public_id ? { public_id } : {}),
          resource_type: isPdf ? "raw" : "image",
          allowed_formats: isPdf ? ["pdf"] : ["jpg", "jpeg", "png", "webp", "heic"],
          ...(bill_date ? { context: `bill_date=${bill_date}` } : {}),
          ...(isPdf ? {} : {
            transformation: [{ width: 1600, height: 1600, crop: "limit", quality: "auto" }],
          }),
        };
      },
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
  });
}

const upload = makeUploader("purchase_bills");
const uploadChittai = makeUploader("chittai_bills");

// ── Upload sessions (DB-backed) ──

router.post("/upload-session", async (req, res) => {
  const { bill_no, company, folder, bill_date } = req.body;
  const token = crypto.randomBytes(8).toString("hex");
  const prefix = getCompanyPrefix();
  const baseFolder = BASE_FOLDERS.includes(folder) ? folder : "purchase_bills";
  const finalFolder = prefix + baseFolder;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await oldPool.query(
    `INSERT INTO upload_sessions (token, bill_no, company, folder, bill_date, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [token, bill_no || "", company || "", finalFolder, bill_date || null, expiresAt],
  );
  res.json({ token });
});

router.get("/upload-session/:token/status", async (req, res) => {
  const session = await getSession(req.params.token);
  if (!session) return res.json({ error: "Invalid or expired" });
  res.json({
    bill_no: session.bill_no, company: session.company,
    uploaded: (session.photo_urls || []).length > 0,
    photo_url: session.photo_url,
    photo_urls: session.photo_urls || [],
    count: (session.photo_urls || []).length,
    done: session.done,
  });
});

router.post("/upload-session/:token/upload", upload.single("photo"), async (req, res) => {
  const session = await getSession(req.params.token);
  if (!session) return res.status(404).json({ error: "Invalid or expired" });
  if (!req.file) return res.status(400).json({ error: "No file" });
  const url = req.file.path;
  const newUrls = [...(session.photo_urls || []), url];
  await oldPool.query(
    `UPDATE upload_sessions SET photo_url=COALESCE(photo_url, $1), photo_urls=$2 WHERE token=$3`,
    [url, newUrls, req.params.token],
  );
  res.json({ status: "SUCCESS", photo_url: url, count: newUrls.length });
});

router.post("/upload-session/:token/done", async (req, res) => {
  const session = await getSession(req.params.token);
  if (!session) return res.status(404).json({ error: "Invalid or expired" });
  await oldPool.query(`UPDATE upload_sessions SET done=true WHERE token=$1`, [req.params.token]);
  res.json({ status: "SUCCESS" });
});

// Accept a base64 data-URL and upload directly to Cloudinary (used by MC bill auto-save)
router.post("/upload-base64", async (req, res) => {
  const { data, folder, filename } = req.body;
  if (!data) return res.status(400).json({ error: "No data" });
  const prefix = getCompanyPrefix();
  const finalFolder = BASE_FOLDERS.includes(folder) ? prefix + folder : prefix + "mc_bills";
  try {
    const result = await cloudinaryPkg.uploader.upload(data, {
      folder: finalFolder,
      public_id: filename || undefined,
      resource_type: "image",
      transformation: [{ width: 1600, height: 2200, crop: "limit", quality: "auto:good" }],
    });
    res.json({ status: "SUCCESS", photo_url: result.secure_url, public_id: result.public_id });
  } catch (err) {
    logger.error("cloudinary-base64-upload", { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post("/chittai-upload", uploadChittai.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ status: "SUCCESS", photo_url: req.file.path });
});

// ── Cloudinary management ──

async function deleteCloudinaryPhoto(photo_url) {
  if (!photo_url) return;
  try {
    const clean = photo_url.split("?")[0];
    const match = clean.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (!match) return;
    const public_id = match[1].replace(/\.[^/.]+$/, "");
    const isPdf = /\.pdf$/i.test(clean);
    await cloudinaryPkg.uploader.destroy(public_id, { resource_type: isPdf ? "raw" : "image", invalidate: true });
  } catch (e) {
    logger.error("cloudinary-delete-fail", { message: e.message });
  }
}

async function deleteAllPhotos(row) {
  if (row.photo_url) await deleteCloudinaryPhoto(row.photo_url);
  if (row.photo_urls?.length) {
    for (const u of row.photo_urls) await deleteCloudinaryPhoto(u);
  }
}

function extractPublicIdFromUrl(url) {
  if (!url) return null;
  const clean = url.split("?")[0];
  const match = clean.match(/\/upload\/(?:v\d+\/)?(.+)$/);
  return match ? match[1].replace(/\.[^/.]+$/, "") : null;
}

async function fetchAllCloudinaryResources() {
  const auth = Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString("base64");
  let all = [];
  for (const folder of getCompanyFolders()) {
    for (const resource_type of ["image", "raw"]) {
      let nextCursor = null;
      do {
        const params = new URLSearchParams({ type: "upload", prefix: folder, max_results: 500, resource_type });
        if (nextCursor) params.append("next_cursor", nextCursor);
        const r = await fetch(
          `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/${resource_type}?${params}`,
          { headers: { Authorization: `Basic ${auth}` } },
        );
        const d = await r.json();
        (d.resources || []).forEach((res) => all.push({
          public_id: res.public_id, url: res.secure_url, created_at: res.created_at,
          folder, bytes: res.bytes, format: res.format, resource_type, is_pdf: resource_type === "raw",
        }));
        nextCursor = d.next_cursor || null;
      } while (nextCursor);
    }
  }
  return all;
}

async function getLinkedPublicIds() {
  const queries = await Promise.all([
    pool.query("SELECT photo_url FROM purchases WHERE photo_url IS NOT NULL"),
    pool.query("SELECT photo_url FROM labour WHERE photo_url IS NOT NULL"),
    pool.query("SELECT photo_url FROM chittai WHERE photo_url IS NOT NULL"),
    pool.query("SELECT photo_url FROM hallmark_expenses WHERE photo_url IS NOT NULL").catch(() => ({ rows: [] })),
    pool.query("SELECT photo_url FROM photo_bill_entries WHERE photo_url IS NOT NULL").catch(() => ({ rows: [] })),
    pool.query("SELECT unnest(photo_urls) AS u FROM purchases WHERE photo_urls IS NOT NULL").catch(() => ({ rows: [] })),
    pool.query("SELECT unnest(photo_urls) AS u FROM labour WHERE photo_urls IS NOT NULL").catch(() => ({ rows: [] })),
    pool.query("SELECT unnest(photo_urls) AS u FROM chittai WHERE photo_urls IS NOT NULL").catch(() => ({ rows: [] })),
    pool.query("SELECT unnest(photo_urls) AS u FROM hallmark_expenses WHERE photo_urls IS NOT NULL").catch(() => ({ rows: [] })),
    pool.query("SELECT unnest(photo_urls) AS u FROM photo_bill_entries WHERE photo_urls IS NOT NULL").catch(() => ({ rows: [] })),
  ]);
  const linked = new Set();
  function addUrl(url) {
    const pid = extractPublicIdFromUrl(url);
    if (pid) {
      linked.add(pid);
      [".pdf", ".jpg", ".jpeg", ".png", ".webp"].forEach((ext) => linked.add(pid + ext));
    }
  }
  queries.slice(0, 5).forEach((q) => q.rows.forEach((r) => addUrl(r.photo_url)));
  queries.slice(5).forEach((q) => q.rows.forEach((r) => addUrl(r.u)));
  return linked;
}

router.get("/cloudinary/all-photos", async (req, res) => {
  try {
    const auth = Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString("base64");
    let allResources = [];
    for (const resource_type of ["image", "raw"]) {
      for (const folder of getCompanyFolders()) {
        let nextCursor = null;
        do {
          const params = new URLSearchParams({ type: "upload", prefix: folder, max_results: 500, resource_type, context: "true" });
          if (nextCursor) params.append("next_cursor", nextCursor);
          const response = await fetch(
            `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/${resource_type}?${params}`,
            { headers: { Authorization: `Basic ${auth}` } },
          );
          const data = await response.json();
          allResources = allResources.concat((data.resources || []).map((r) => ({
            public_id: r.public_id, url: r.secure_url, created_at: r.created_at,
            bill_date: r.context?.custom?.bill_date || null, folder,
            bytes: r.bytes, format: r.format, ...(resource_type === "raw" ? { is_pdf: true } : {}),
          })));
          nextCursor = data.next_cursor || null;
        } while (nextCursor);
      }
    }
    allResources.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(allResources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/cloudinary/unlinked", async (req, res) => {
  try {
    const [all, linked] = await Promise.all([fetchAllCloudinaryResources(), getLinkedPublicIds()]);
    const unlinked = all.filter((r) => {
      const clean = r.public_id.replace(/\.[^/.]+$/, "");
      return !linked.has(r.public_id) && !linked.has(clean);
    });
    res.json(unlinked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cloudinary/delete-unlinked", async (req, res) => {
  try {
    const { public_ids } = req.body;
    if (!public_ids?.length) return res.json({ status: "SUCCESS", deleted: 0, failed: 0 });
    const auth = Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString("base64");
    const deleted = [], failed = [];
    async function deleteBatch(ids, resource_type) {
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const response = await fetch(
          `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/${resource_type}/upload`,
          { method: "DELETE", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify({ public_ids: batch }) },
        );
        const data = await response.json();
        if (data.deleted) Object.keys(data.deleted).forEach((k) => deleted.push(k));
        if (data.failed) Object.keys(data.failed).forEach((k) => failed.push(k));
      }
    }
    await deleteBatch(public_ids.filter((r) => r.resource_type !== "raw").map((r) => r.public_id), "image");
    await deleteBatch(public_ids.filter((r) => r.resource_type === "raw").map((r) => r.public_id), "raw");
    res.json({ status: "SUCCESS", deleted: deleted.length, failed: failed.length, deleted_ids: deleted, failed_ids: failed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/cloudinary/photo", async (req, res) => {
  const { photo_url, public_id, db_id, db_table } = req.body;
  if (!photo_url && !public_id) return res.status(400).json({ error: "photo_url or public_id required" });
  const VALID_TABLES = new Set(["purchases", "labour", "hallmark_expenses", "chittai"]);
  try {
    if (photo_url) {
      await deleteCloudinaryPhoto(photo_url);
    } else {
      const isPdf = /\.pdf$/i.test(public_id);
      await cloudinaryPkg.uploader.destroy(public_id, { resource_type: isPdf ? "raw" : "image", invalidate: true });
    }
    if (db_id && db_table && VALID_TABLES.has(db_table)) {
      const url = photo_url;
      await pool.query(`UPDATE ${db_table} SET photo_url = NULL WHERE id = $1 AND photo_url = $2`, [db_id, url]);
      await pool.query(`UPDATE ${db_table} SET photo_urls = array_remove(photo_urls, $1::text) WHERE id = $2 AND photo_urls IS NOT NULL`, [url, db_id]);
    }
    res.json({ status: "SUCCESS" });
  } catch (err) {
    logger.error("cloudinary-photo-delete", { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.patch("/cloudinary/move-photo", async (req, res) => {
  const { public_id, target_folder } = req.body;
  if (!public_id || !target_folder) return res.status(400).json({ error: "public_id and target_folder required" });
  const bareTarget = target_folder.replace(/^pvtltd\//, "");
  if (!BASE_FOLDERS.includes(bareTarget)) return res.status(400).json({ error: "Invalid target folder" });
  try {
    const filename = public_id.split("/").pop();
    const prefix = public_id.startsWith("pvtltd/") ? "pvtltd/" : "";
    const new_public_id = `${prefix}${bareTarget}/${filename}`;
    const isPdf = /\.pdf$/i.test(filename);
    const result = await cloudinaryPkg.uploader.rename(public_id, new_public_id, {
      resource_type: isPdf ? "raw" : "image", invalidate: true, overwrite: false,
    });
    const newUrl = result.secure_url;
    for (const pattern of [`%/${public_id}%`, `%/${public_id.replace(/\.[^/.]+$/, "")}%`]) {
      await pool.query(`UPDATE purchases SET photo_url=$1 WHERE photo_url LIKE $2`, [newUrl, pattern]);
      await pool.query(`UPDATE labour SET photo_url=$1 WHERE photo_url LIKE $2`, [newUrl, pattern]);
      await pool.query(`UPDATE chittai SET photo_url=$1 WHERE photo_url LIKE $2`, [newUrl, pattern]);
      await pool.query(`UPDATE hallmark_expenses SET photo_url=$1 WHERE photo_url LIKE $2`, [newUrl, pattern]).catch(() => {});
    }
    res.json({ status: "SUCCESS", new_public_id, new_url: newUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, deleteAllPhotos, deleteCloudinaryPhoto };
