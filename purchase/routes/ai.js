const express = require("express");
const { logger } = require("../middleware/logger");

const router = express.Router();

const OUR_GST = process.env.OUR_GSTIN;

// Normalise a GST string for comparison — strip spaces, uppercase
function normaliseGST(s) {
  if (!s) return "";
  return s.replace(/\s/g, "").toUpperCase();
}

// Check if an extracted GST string matches ours (with tolerance for common OCR errors: O vs 0, I vs 1)
function gstMatches(extracted) {
  const a = normaliseGST(extracted);
  const b = normaliseGST(OUR_GST);
  if (!a) return false;
  if (a === b) return true;
  // Allow up to 2 character differences for OCR noise
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
    if (diff > 2) return false;
  }
  return true;
}

const GST_CHECK = `Also extract the buyer/recipient GSTIN from the bill (the one in the "Bill To" / buyer address block, NOT the supplier GSTIN). Put it in a field called "buyer_gstin". Return it exactly as printed.`;
const GST_CHECK_TEXT = `Also extract the buyer/recipient GSTIN from the bill (the "Bill To" party, NOT the vendor/supplier GSTIN). Put it in a field called "buyer_gstin". Return it exactly as printed.`;

const AI_SCAN_PROMPTS = {
  purchase: `You are a bill/invoice OCR assistant. Extract fields from this bill image and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "bill_no": "",
  "date": "YYYY-MM-DD or empty",
  "supplier_name": "",
  "buyer_gstin": "",
  "taxable_value": null,
  "cgst": null,
  "sgst": null,
  "igst": null,
  "round_off": null,
  "total_value": null,
  "tds": null,
  "net_value": null,
  "items": [{"description":"","huid":"","pcs":null,"gross_wt":null,"less_wt":null,"net_wt":null,"rate":null,"amount":null}]
}
Use null for missing numbers. ${GST_CHECK} Extract all jewellery line items you can see.`,

  labclose: `You are a labour receipt OCR assistant. Extract fields from this receipt image and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "receipt_bill_no": "",
  "date": "YYYY-MM-DD or empty",
  "party_name": "",
  "buyer_gstin": "",
  "taxable_total": null,
  "cgst": null,
  "sgst": null,
  "igst": null,
  "round_off": null,
  "total": null,
  "tds": null,
  "bill_value_after_deduction": null,
  "items": [{"description":"","pcs":null,"gross_wt":null,"less_wt":null,"net_wt":null,"labour_charge":null,"amount":null}]
}
Use null for missing numbers. ${GST_CHECK}`,

  chittai: `You are a chittai/advance slip OCR assistant. Extract fields from this slip image and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "chittai_no": "",
  "date": "YYYY-MM-DD or empty",
  "party_name": "",
  "buyer_gstin": "",
  "weight": null,
  "rate": null,
  "value": null,
  "others": null,
  "rnd": null,
  "total": null,
  "tds": null,
  "rtgs_amount": null
}
Use null for missing numbers. "rnd" is round-off/rounding amount if present. ${GST_CHECK}`,

  hallmark: `You are a hallmark expense bill OCR assistant. Extract fields from this bill image and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "bill_no": "",
  "date": "YYYY-MM-DD or empty",
  "party_name": "",
  "buyer_gstin": "",
  "taxable_value": null,
  "cgst": null,
  "sgst": null,
  "igst": null,
  "round_off": null,
  "total_value": null,
  "tds": null,
  "net_value": null,
  "items": [{"description":"","pcs":null,"gross_wt":null,"net_wt":null,"rate":null,"amount":null}]
}
Use null for missing numbers. ${GST_CHECK}`,

  note: `You are a credit/debit note OCR assistant. Extract fields from this note image and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "bill_no": "",
  "date": "YYYY-MM-DD or empty",
  "party_name": "",
  "buyer_gstin": "",
  "taxable_value": null,
  "cgst": null,
  "sgst": null,
  "igst": null,
  "round_off": null,
  "total_value": null,
  "tds": null,
  "net_value": null,
  "items": [{"description":"","pcs":null,"gross_wt":null,"net_wt":null,"rate":null,"amount":null}]
}
Use null for missing numbers. ${GST_CHECK}`,
};

const AI_TEXT_PROMPTS = {
  purchase: `You are a bill/invoice data extraction assistant for an Indian jewellery business. Extract fields from the following raw OCR text of a bill and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "bill_no": "",
  "date": "",
  "vendor_name": "",
  "vendor_gstin": "",
  "our_gstin": "",
  "buyer_gstin": "",
  "taxable_value": null,
  "cgst": null,
  "sgst": null,
  "igst": null,
  "total": null,
  "net_value": null,
  "items": [{"description":"","huid":"","pcs":null,"gross_wt":null,"less_wt":null,"net_wt":null,"rate":null,"amount":null}]
}
Use null for missing numbers. date format: YYYY-MM-DD. Extract all jewellery line items you can see. ${GST_CHECK_TEXT}

OCR TEXT:
`,
  labclose: `You are a labour receipt data extraction assistant. Extract fields from the following raw OCR text and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "receipt_bill_no": "",
  "date": "",
  "vendor_name": "",
  "vendor_gstin": "",
  "buyer_gstin": "",
  "taxable_value": null,
  "cgst": null,
  "sgst": null,
  "igst": null,
  "total": null,
  "net_value": null,
  "items": [{"description":"","pcs":null,"gross_wt":null,"less_wt":null,"net_wt":null,"rate":null,"amount":null}]
}
Use null for missing numbers. date format: YYYY-MM-DD. ${GST_CHECK_TEXT}

OCR TEXT:
`,
  chittai: `You are a chittai/advance slip data extraction assistant. Extract fields from the following raw OCR text and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "chittai_no": "",
  "date": "",
  "vendor_name": "",
  "vendor_gstin": "",
  "buyer_gstin": "",
  "gross_wt": null,
  "less_wt": null,
  "net_wt": null,
  "rate": null,
  "amount": null,
  "advance": null,
  "balance": null,
  "rnd": null
}
Use null for missing numbers. date format: YYYY-MM-DD. "rnd" is round-off amount if present. ${GST_CHECK_TEXT}

OCR TEXT:
`,
  hallmark: `You are a hallmark expense bill data extraction assistant. Extract fields from the following raw OCR text and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "bill_no": "",
  "date": "",
  "vendor_name": "",
  "vendor_gstin": "",
  "our_gstin": "",
  "buyer_gstin": "",
  "taxable_value": null,
  "cgst": null,
  "sgst": null,
  "igst": null,
  "total": null,
  "net_value": null,
  "items": [{"description":"","huid":"","pcs":null,"gross_wt":null,"net_wt":null,"rate":null,"amount":null}]
}
Use null for missing numbers. date format: YYYY-MM-DD. ${GST_CHECK_TEXT}

OCR TEXT:
`,
  note: `You are a credit/debit note data extraction assistant. Extract fields from the following raw OCR text and return ONLY valid JSON (no markdown, no explanation).
Return this structure:
{
  "bill_no": "",
  "date": "",
  "vendor_name": "",
  "vendor_gstin": "",
  "our_gstin": "",
  "buyer_gstin": "",
  "taxable_value": null,
  "cgst": null,
  "sgst": null,
  "igst": null,
  "total": null,
  "net_value": null,
  "items": [{"description":"","huid":"","pcs":null,"gross_wt":null,"less_wt":null,"net_wt":null,"rate":null,"amount":null}]
}
Use null for missing numbers. date format: YYYY-MM-DD. ${GST_CHECK_TEXT}

OCR TEXT:
`,
};

async function groqTextScan(prompt) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "{}";
}

async function groqVisionScan(prompt, mimeType, b64) {
  const VISION_MODELS = ["meta-llama/llama-4-scout-17b-16e-instruct"];
  let lastErr;
  for (const model of VISION_MODELS) {
    try {
      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  {
                    type: "image_url",
                    image_url: { url: `data:${mimeType};base64,${b64}` },
                  },
                ],
              },
            ],
            temperature: 0,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 429) throw new Error(`429: ${body}`);
        lastErr = new Error(`Groq vision ${res.status}: ${body}`);
        continue;
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "{}";
    } catch (err) {
      lastErr = err;
      if ((err.message || "").includes("429")) throw err;
    }
  }
  throw lastErr || new Error("Groq vision scan failed.");
}

function parseJSON(raw) {
  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

// Backend resolves gst_valid by checking buyer_gstin / our_gstin extracted by AI
function resolveGSTValid(fields) {
  const candidates = [fields.buyer_gstin, fields.our_gstin].filter(Boolean);
  fields.gst_valid =
    candidates.length > 0 && candidates.some((g) => gstMatches(g));
  return fields;
}

router.post("/ai-scan-text", async (req, res) => {
  try {
    const { ocr_text, form_type } = req.body;
    if (!ocr_text) return res.status(400).json({ error: "ocr_text required" });
    const basePrompt = AI_TEXT_PROMPTS[form_type] || AI_TEXT_PROMPTS.purchase;
    const raw = await groqTextScan(basePrompt + ocr_text);
    const fields = resolveGSTValid(parseJSON(raw));
    logger.info("ai-text-scan", {
      form_type,
      keys: Object.keys(fields).join(","),
      buyer_gstin: fields.buyer_gstin,
      gst_valid: fields.gst_valid,
    });
    res.json({ fields });
  } catch (err) {
    logger.error("ai-text-scan-error", { message: err.message });
    const is429 = err.message?.includes("429");
    res.status(is429 ? 429 : 500).json({
      error: is429
        ? "AI quota exceeded. Try again in a few minutes."
        : err.message,
    });
  }
});

router.post("/ai-scan", async (req, res) => {
  try {
    const { image_url, form_type } = req.body;
    if (!image_url)
      return res.status(400).json({ error: "image_url required" });
    const prompt = AI_SCAN_PROMPTS[form_type] || AI_SCAN_PROMPTS.purchase;

    const imgResp = await fetch(image_url);
    if (!imgResp.ok)
      return res.status(400).json({ error: "Could not fetch image" });
    const contentType = imgResp.headers.get("content-type") || "image/jpeg";
    const mimeType = contentType.startsWith("image/png")
      ? "image/png"
      : contentType.startsWith("image/webp")
        ? "image/webp"
        : "image/jpeg";
    const buf = Buffer.from(await imgResp.arrayBuffer());
    const b64 = buf.toString("base64");

    const raw = await groqVisionScan(prompt, mimeType, b64);
    const fields = resolveGSTValid(parseJSON(raw));
    logger.info("ai-scan", {
      form_type,
      buyer_gstin: fields.buyer_gstin,
      gst_valid: fields.gst_valid,
    });
    res.json({ fields });
  } catch (err) {
    logger.error("ai-scan-error", { message: err.message });
    const is429 = err.message?.includes("429");
    res.status(is429 ? 429 : 500).json({
      error: is429
        ? "AI quota exceeded. Try again in a few minutes."
        : err.message,
    });
  }
});

module.exports = router;
