const express = require("express");
const { oldPool, oldPool: pool, newPool } = require("../db");

// Sync a profile row to newPool so FK constraints on chittai/purchases/etc. work for company 2.
async function syncProfileToNewDb(row) {
  if (newPool === oldPool) return;
  const cols = Object.keys(row);
  const vals = cols.map((_, i) => `$${i + 1}`);
  const updateCols = cols.filter((c) => c !== "id");
  await newPool
    .query(
      `INSERT INTO profiles (${cols.join(",")}) VALUES (${vals.join(",")})
       ON CONFLICT (id) DO UPDATE SET ${updateCols.map((c) => `${c}=EXCLUDED.${c}`).join(",")}`,
      Object.values(row),
    )
    .catch((err) => console.error("[DB] Profile sync to new DB failed:", err.message));
  await newPool
    .query(`SELECT setval('profiles_id_seq', GREATEST(currval('profiles_id_seq'), $1))`, [row.id])
    .catch(() => {});
}

const router = express.Router();

router.get("/profile/headers", (req, res) => {
  res.json([
    "COMPANY NAME", "ALIAS", "ADDRESS", "CITY", "PINCODE", "STATE",
    "STATE CODE", "GST NUMBER", "PAN NUMBER", "CONTACT NUMBER 01",
    "CONTACT NUMBER 02", "E-MAIL ID", "A/C HOLDER'S NAME", "BANK NAME",
    "ACCOUNT NUMBER", "IFSC CODE", "BRANCH",
  ]);
});

router.get("/profile/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, alias, company_name AS company, state_code, ledger_types, pan_number FROM profiles ORDER BY company_name",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/profiles/list", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, alias, company_name AS name, state_code, ledger_types FROM profiles ORDER BY company_name",
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/profile/:alias", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM profiles WHERE alias=$1", [req.params.alias]);
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    const r = result.rows[0];
    res.json({
      "COMPANY NAME": r.company_name,
      LEDGER_TYPES: r.ledger_types || [],
      ALIAS: r.alias,
      ADDRESS: r.address,
      CITY: r.city,
      PINCODE: r.pincode,
      STATE: r.state,
      "STATE CODE": r.state_code,
      "GST NUMBER": r.gst_number,
      "PAN NUMBER": r.pan_number,
      "CONTACT NUMBER 01": r.contact1,
      "CONTACT NUMBER 02": r.contact2,
      "E-MAIL ID": r.email,
      "A/C HOLDER'S NAME": r.ac_holder,
      "BANK NAME": r.bank_name,
      "ACCOUNT NUMBER": r.account_number,
      "IFSC CODE": r.ifsc_code,
      BRANCH: r.branch,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/profile", async (req, res) => {
  const d = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO profiles
        (alias,company_name,address,city,pincode,state,state_code,gst_number,pan_number,
         contact1,contact2,email,ac_holder,bank_name,account_number,ifsc_code,branch,ledger_types)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        d["ALIAS"], d["COMPANY NAME"], d["ADDRESS"], d["CITY"], d["PINCODE"],
        d["STATE"], d["STATE CODE"], d["GST NUMBER"], d["PAN NUMBER"],
        d["CONTACT NUMBER 01"], d["CONTACT NUMBER 02"], d["E-MAIL ID"],
        d["A/C HOLDER'S NAME"], d["BANK NAME"], d["ACCOUNT NUMBER"],
        d["IFSC CODE"], d["BRANCH"], d["LEDGER_TYPES"] || [],
      ],
    );
    await syncProfileToNewDb(result.rows[0]);
    res.json({ status: "SUCCESS" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/profile/:alias", async (req, res) => {
  const d = req.body;
  const alias = req.params.alias;
  try {
    await pool.query(
      `UPDATE profiles SET
        alias=$1, company_name=$2, address=$3, city=$4, pincode=$5, state=$6,
        state_code=$7, gst_number=$8, pan_number=$9, contact1=$10,
        contact2=$11, email=$12, ac_holder=$13, bank_name=$14,
        account_number=$15, ifsc_code=$16, branch=$17, ledger_types=$18, updated_at=NOW()
      WHERE alias=$19`,
      [
        d["ALIAS"], d["COMPANY NAME"], d["ADDRESS"], d["CITY"], d["PINCODE"],
        d["STATE"], d["STATE CODE"], d["GST NUMBER"], d["PAN NUMBER"],
        d["CONTACT NUMBER 01"], d["CONTACT NUMBER 02"], d["E-MAIL ID"],
        d["A/C HOLDER'S NAME"], d["BANK NAME"], d["ACCOUNT NUMBER"],
        d["IFSC CODE"], d["BRANCH"], d["LEDGER_TYPES"] || [], alias,
      ],
    );
    await pool.query(
      `UPDATE labour l SET company_name = p.company_name FROM profiles p WHERE l.profile_id = p.id AND p.alias = $1`,
      [d["ALIAS"]],
    );
    const updatedRow = await pool.query(`SELECT * FROM profiles WHERE alias=$1`, [d["ALIAS"]]);
    if (updatedRow.rows[0]) await syncProfileToNewDb(updatedRow.rows[0]);

    let duplicate_created = false;
    if (d["CREATE_DUPLICATE"] && d["DUPLICATE_ALIAS"]) {
      const dupAlias = d["DUPLICATE_ALIAS"];
      const exists = await pool.query("SELECT id FROM profiles WHERE alias=$1", [dupAlias]);
      let dupRow;
      if (exists.rows[0]) {
        const r = await pool.query(`UPDATE profiles SET ledger_types=$1, updated_at=NOW() WHERE alias=$2 RETURNING *`, [d["DUPLICATE_LEDGER_TYPES"] || [], dupAlias]);
        dupRow = r.rows[0];
      } else {
        const r = await pool.query(
          `INSERT INTO profiles
            (alias,company_name,address,city,pincode,state,state_code,gst_number,pan_number,
             contact1,contact2,email,ac_holder,bank_name,account_number,ifsc_code,branch,ledger_types)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
          [
            dupAlias, d["COMPANY NAME"] + " II", d["ADDRESS"], d["CITY"], d["PINCODE"],
            d["STATE"], d["STATE CODE"], d["GST NUMBER"], d["PAN NUMBER"],
            d["CONTACT NUMBER 01"], d["CONTACT NUMBER 02"], d["E-MAIL ID"],
            d["A/C HOLDER'S NAME"], d["BANK NAME"], d["ACCOUNT NUMBER"],
            d["IFSC CODE"], d["BRANCH"], d["DUPLICATE_LEDGER_TYPES"] || [],
          ],
        );
        dupRow = r.rows[0];
      }
      if (dupRow) await syncProfileToNewDb(dupRow);
      duplicate_created = true;
    }
    res.json({ status: "SUCCESS", duplicate_created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
