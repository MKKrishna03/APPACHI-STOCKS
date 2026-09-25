import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";

// Paper is a "79mm x 50mt" Star thermal roll (confirmed from the roll's own
// label) — 80mm-class paper, so 48 columns (top of the documented 42-48
// range) at normal width is used for the store name header and section
// dividers. Body rows (labels, values, Q No/date/name) all print at
// double-width (see `.width(2)` below), so 24 columns there — half of 48.
const HEADER_COLUMNS = 48;
const COLUMNS = 24;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Encoder = any;

function n(value: string | number | null | undefined): number {
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

function dashLine(columns = HEADER_COLUMNS): string {
  return "-".repeat(columns);
}

// Plain section divider — no blank line above/below, sits snug against the
// rows on either side of it. Explicitly forces normal width/height and the
// full HEADER_COLUMNS dash count, regardless of whatever size the row
// before it left the printer in — printRow always resets to normal size
// at its end, so relying on "whatever's active" previously meant this
// printed only 24 (half-width) dashes at normal size instead of a
// full-width line, stopping in the middle of the paper.
function separator(e: Encoder): Encoder {
  return e.width(1).height(1).line(dashLine());
}

// Label and value on the SAME line, with a guaranteed gap between them.
// align("right") turned out to anchor the value to the true right edge of
// the paper regardless of how much the label already printed — with a
// long label + a wide double-size value, the two would end up touching
// with zero gap (confirmed on an actual test print). Label and value are
// both width=2/height=1 here — same size, so manual space-count padding
// lines them up reliably, same trick as a monospace layout. (Values used
// to print at height=2, taller than the label; reduced to match after
// feedback that the values read too large.)
function printRow(e: Encoder, left: string, right: string): Encoder {
  const label = left ? " " + left : "";
  const gap = Math.max(2, COLUMNS - label.length - right.length);
  return e
    .width(2)
    .height(1)
    .bold(true)
    .text(label)
    .bold(false)
    .text(" ".repeat(gap))
    .bold(true)
    .text(right)
    .bold(false)
    .width(1)
    .height(1)
    .newline();
}

// Prints a headline figure much larger than the rest of the receipt — the
// one number a customer actually needs to read at a glance. Same manual-
// gap technique as printRow, since it has the same same-line/same-width,
// different-height layout.
function printBigAmount(e: Encoder, label: string, value: string): Encoder {
  const text = " " + label;
  const gap = Math.max(2, COLUMNS - text.length - value.length);
  return e
    .width(2)
    .height(1)
    .bold(true)
    .text(text)
    .bold(false)
    .text(" ".repeat(gap))
    .height(2)
    .bold(true)
    .text(value)
    .bold(false)
    .height(1)
    .newline();
}

// Uint8Array -> base64, byte-safe (btoa() needs a binary string, so this
// must NOT go through TextDecoder/UTF-8 — ESC/POS bytes aren't valid UTF-8).
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Hands ESC/POS bytes off to the RawBT app via its `rawbt:base64,` URL
 * scheme (https://rawbt.ru/intents.html). RawBT must be installed and the
 * Amigos Technology pocket printer must already be paired/selected inside
 * RawBT's own Bluetooth printer settings — this only triggers the print
 * job, it doesn't manage the Bluetooth connection itself.
 */
export function sendToRawBT(bytes: Uint8Array) {
  window.location.href = "rawbt:base64," + uint8ToBase64(bytes);
}

type QuotationReceiptItem = {
  product_name: string;
  weight: string;
  wastage_weight: string;
  rate: string;
  mc: string;
};

type QuotationReceiptScrap = {
  scrap_name: string;
  scrap_weight: string;
  scrap_less: string;
  scrap_weight_after_less: string;
  rate: string;
  total: string;
  status: "pending" | "estimated" | "locked";
};

export type QuotationReceiptData = {
  quotation_number: string;
  created_at: string;
  gst: string;
  total: string;
  less: string | null;
  sales_person: string | null;
  items: QuotationReceiptItem[];
  scraps: QuotationReceiptScrap[];
};

// Mirrors app/quotation/[id]/print/page.tsx's on-screen thermal slip layout.
export function buildQuotationReceipt(data: QuotationReceiptData): Uint8Array {
  const createdAt = new Date(data.created_at);
  const date = createdAt.toLocaleDateString("en-IN");
  const time = createdAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const items = data.items;
  const totalWeight = items.reduce((sum, i) => sum + n(i.weight) + n(i.wastage_weight), 0);
  const rate = n(items[0]?.rate);
  const value = totalWeight * rate;
  const mcSum = items.reduce((sum, i) => sum + n(i.mc), 0);
  const gst = n(data.gst);
  const totalAfterGst = n(data.total);
  const less = n(data.less);
  const newProductTotal = totalAfterGst - less;

  const lockedScraps = data.scraps.filter((s) => s.status === "locked");
  const oldScrapTotal = lockedScraps.reduce((sum, s) => sum + n(s.total), 0);
  const amount = newProductTotal - oldScrapTotal;

  let e: Encoder = new ReceiptPrinterEncoder({ columns: HEADER_COLUMNS })
    .initialize()
    .align("center")
    .bold(true)
    .line("APPACHI JEWELLERY")
    .bold(false)
    .align("left");

  // Q No / date+time / sales person: one clean, consistently-indented,
  // same-size block — no "SALES PERSON NAME" tag, just the name itself.
  e = e
    .width(2)
    .height(1)
    .text(" Q No: ")
    .bold(true)
    .line(data.quotation_number)
    .bold(false)
    .line(" " + date + "  " + time)
    .line(" " + (data.sales_person || ""));
  e = separator(e);

  for (const item of items) {
    e = printRow(e, item.product_name, n(item.weight).toFixed(3));
    e = printRow(e, "Wastage", n(item.wastage_weight).toFixed(3));
  }

  e = separator(e);
  e = printRow(e, "", totalWeight.toFixed(3));
  e = printRow(e, "Rate", rate.toFixed(2));
  e = separator(e);
  e = printRow(e, "", value.toFixed(2));
  e = printRow(e, "MC", mcSum.toFixed(2));
  e = printRow(e, "GST 3%", gst.toFixed(2));
  e = separator(e);
  e = printRow(e, "", totalAfterGst.toFixed(2));
  e = printRow(e, "Less", less.toFixed(2));
  e = separator(e);
  e = printRow(e, "", newProductTotal.toFixed(2));

  if (lockedScraps.length > 0) {
    e = e.width(1).height(1).align("center").line("SCRAP").align("left");
    for (const scrap of lockedScraps) {
      e = printRow(e, scrap.scrap_name, n(scrap.scrap_weight).toFixed(3));
      e = printRow(e, "Less", n(scrap.scrap_less).toFixed(3));
      e = separator(e);
      e = printRow(e, "", n(scrap.scrap_weight_after_less).toFixed(3));
      e = printRow(e, "", n(scrap.rate).toFixed(2));
      e = printRow(e, "", n(scrap.total).toFixed(2));
    }
  }

  e = separator(e);
  e = printRow(e, "NEW", newProductTotal.toFixed(2));
  e = printRow(e, "OLD", oldScrapTotal.toFixed(2));
  e = separator(e);
  e = printBigAmount(e, "AMOUNT", amount.toFixed(2));
  e = e.width(1).height(1).newline(3).cut();

  return e.encode();
}

export type ScrapReceiptData = {
  scrap_number: string;
  category: string;
  scrap_name: string;
  scrap_weight: string;
  scrap_less: string;
  scrap_weight_after_less: string;
  rate: string;
  total: string;
  quotation_number: string | null;
};

// Mirrors app/scrap/[id]/print/page.tsx's on-screen slip layout.
export function buildScrapReceipt(data: ScrapReceiptData): Uint8Array {
  let e: Encoder = new ReceiptPrinterEncoder({ columns: HEADER_COLUMNS })
    .initialize()
    .align("center")
    .bold(true)
    .line("APPACHI JEWELLERY")
    .bold(false)
    .line("Scrap Estimation Slip")
    .align("left");
  e = separator(e);

  e = printRow(e, "Scrap No.", data.scrap_number);
  if (data.quotation_number) {
    e = printRow(e, "Quotation No.", data.quotation_number);
  }
  e = printRow(e, "Ornament Type", data.category);
  e = printRow(e, "Scrap Name", data.scrap_name);
  e = printRow(e, "Scrap Weight", n(data.scrap_weight).toFixed(3) + " g");
  e = printRow(e, "Less", n(data.scrap_less).toFixed(3) + " g");
  e = printRow(e, "Wt After Less", n(data.scrap_weight_after_less).toFixed(3) + " g");
  e = printRow(e, "Rate", n(data.rate).toFixed(2));
  e = separator(e);
  e = printBigAmount(e, "TOTAL", n(data.total).toFixed(2));
  e = e.width(1).height(1).newline(3).cut();

  return e.encode();
}
