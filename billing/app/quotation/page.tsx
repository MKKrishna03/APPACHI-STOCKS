"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import CustomSelect from "@/components/CustomSelect";
import { getStaffName } from "@/lib/staffIdentity";

type Product = {
  id: string;
  name: string;
  category: "Gold" | "Silver";
  purity: string | null;
  wastage_tier_1: string | null;
  wastage_tier_2: string | null;
  wastage_tier_3: string | null;
};

type CurrentRate = {
  gold_rate: string;
  silver_rate: string;
} | null;

type ScrapEntry = {
  category: "" | "Gold" | "Silver";
  scrapName: string;
  scrapWeight: string;
};

type LinkedScrap = {
  id: string;
  category: string;
  scrap_name: string;
  scrap_weight: string;
  status: "pending" | "estimated" | "locked";
  total: string | null;
};

const SCRAP_STATUS_LABEL: Record<LinkedScrap["status"], string> = {
  pending: "Pending",
  estimated: "Estimated",
  locked: "Locked",
};

const SCRAP_STATUS_STYLE: Record<LinkedScrap["status"], { background: string; color: string }> = {
  pending: {
    background: "color-mix(in srgb, var(--accent) 15%, transparent)",
    color: "var(--accent)",
  },
  estimated: {
    background: "color-mix(in srgb, #2f9e44 15%, transparent)",
    color: "#2f9e44",
  },
  locked: {
    background: "color-mix(in srgb, var(--primary) 15%, transparent)",
    color: "var(--primary)",
  },
};

type Item = {
  category: string;
  productId: string;
  productName: string;
  purity: string | null;
  weight: number;
  wastagePercent: number;
  wastageWeight: number;
  rate: number;
  mc: number;
  gst: number;
  amount: number;
};

type QuotationItem = {
  product_name: string | null;
  weight: string | null;
};

type QuotationScrap = {
  status: "pending" | "estimated" | "locked";
  total: string | null;
};

type Quotation = {
  id: string;
  quotation_number: string;
  revision: number;
  items: QuotationItem[];
  scraps: QuotationScrap[];
  total: string | null;
  less: string | null;
  net_total: string | null;
};

function parseNum(value: string) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

function convertExistingItem(item: {
  category: string;
  product_id: string | null;
  product_name: string;
  purity: string | null;
  weight: string;
  wastage_percent: string;
  wastage_weight: string;
  rate: string;
  mc: string;
}): Item {
  const w = Number(item.weight);
  const wastageWt = Number(item.wastage_weight);
  const r = Number(item.rate);
  const mcNum = Number(item.mc);
  const totalWeight = w + wastageWt;
  const value = totalWeight * r;
  const gstBase = value + mcNum;
  const gst = gstBase * 0.03;
  const amount = gstBase + gst;
  return {
    category: item.category,
    productId: item.product_id ?? "",
    productName: item.product_name,
    purity: item.purity,
    weight: w,
    wastagePercent: Number(item.wastage_percent),
    wastageWeight: wastageWt,
    rate: r,
    mc: mcNum,
    gst,
    amount,
  };
}

function productSummary(items: QuotationItem[]) {
  if (items.length === 0) return "No products yet";
  if (items.length === 1) return items[0].product_name || "-";
  return `${items[0].product_name} +${items.length - 1} more`;
}

function weightSummary(items: QuotationItem[]) {
  const sum = items.reduce((total, i) => total + Number(i.weight || 0), 0);
  return sum.toFixed(3);
}

function scrapValue(scraps: QuotationScrap[]) {
  return scraps
    .filter((s) => s.status === "locked")
    .reduce((sum, s) => sum + Number(s.total ?? 0), 0);
}

// True when a linked scrap was locked after this quotation was last
// saved, so its stored net total doesn't reflect the scrap deduction yet.
function needsScrapRefresh(q: Quotation) {
  if (q.items.length === 0 || q.total == null) return false;
  const scrapTotal = scrapValue(q.scraps);
  if (scrapTotal <= 0) return false;
  const expectedNet = Number(q.total) - Number(q.less ?? 0) - scrapTotal;
  const storedNet = Number(q.net_total ?? 0);
  return Math.abs(expectedNet - storedNet) > 0.01;
}

export default function QuotationPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto w-full px-3 py-6" style={{ color: "var(--muted)" }}>
          Loading...
        </div>
      }
    >
      <QuotationPageContent />
    </Suspense>
  );
}

function QuotationPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingQuotationId = searchParams.get("quotationId");

  // --- Billing form state ---
  const [quotationNumber, setQuotationNumber] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [currentRate, setCurrentRate] = useState<CurrentRate>(null);
  const [saving, setSaving] = useState(false);
  const [less, setLess] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [linkedScraps, setLinkedScraps] = useState<LinkedScrap[]>([]);

  const [category, setCategory] = useState<"" | "Gold" | "Silver">("");
  const [productId, setProductId] = useState("");
  const [weight, setWeight] = useState("");
  const [wastagePercent, setWastagePercent] = useState("");
  const [wastageWeight, setWastageWeight] = useState("");
  const [rate, setRate] = useState("");
  const [mc, setMc] = useState("");

  const [showScraps, setShowScraps] = useState(false);
  const [scraps, setScraps] = useState<ScrapEntry[]>([]);

  // --- Saved quotations list state ---
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Quotation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Quotation | null>(null);

  async function loadQuotations() {
    const res = await fetch("/billing/api/quotations");
    const data = await res.json();
    setQuotations(data);
    setListLoading(false);
  }

  useEffect(() => {
    loadQuotations();
  }, []);

  function resetForm() {
    setLess("");
    setItems([]);
    setEditingIndex(null);
    setLinkedScraps([]);
    setCategory("");
    setProductId("");
    setWeight("");
    setWastagePercent("");
    setWastageWeight("");
    setMc("");
    setShowScraps(false);
    setScraps([]);
  }

  useEffect(() => {
    resetForm();
    if (existingQuotationId) {
      fetch(`/billing/api/quotations/${existingQuotationId}`)
        .then((res) => res.json())
        .then((data) => {
          setQuotationNumber(data.quotation_number);
          setLess(data.less ?? "");
          setItems((data.items ?? []).map(convertExistingItem));
          setLinkedScraps(data.scraps ?? []);
        });
    } else {
      fetch("/billing/api/quotations/next-number")
        .then((res) => res.json())
        .then((data) => setQuotationNumber(data.quotationNumber));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingQuotationId]);

  useEffect(() => {
    fetch("/billing/api/products")
      .then((res) => res.json())
      .then((data) => setProducts(data));

    fetch("/billing/api/rates")
      .then((res) => res.json())
      .then((data) => setCurrentRate(data.current));
  }, []);

  useEffect(() => {
    if (!category) {
      setRate("");
      return;
    }
    if (!currentRate) return;
    setRate(
      category === "Gold" ? currentRate.gold_rate : currentRate.silver_rate
    );
  }, [category, currentRate]);

  const filteredProducts = products.filter((p) => p.category === category);
  const selectedProduct = products.find((p) => p.id === productId);

  function handleCategoryChange(value: "" | "Gold" | "Silver") {
    setCategory(value);
    setProductId("");
    setWeight("");
    setWastagePercent("");
    setWastageWeight("");
    setMc("");
  }

  function handleProductChange(id: string) {
    setProductId(id);
    const product = products.find((p) => p.id === id);
    setWastagePercent(product?.wastage_tier_1 ?? "");
    setWeight("");
    setWastageWeight("");
    setMc("");
  }

  function handleWeightChange(value: string) {
    setWeight(value);
    const w = parseNum(value);
    const pct = parseNum(wastagePercent);
    setWastageWeight(((w * pct) / 100).toFixed(3));
  }

  function handleWastagePercentChange(value: string) {
    setWastagePercent(value);
    const w = parseNum(weight);
    const pct = parseNum(value);
    setWastageWeight(((w * pct) / 100).toFixed(3));
  }

  const entryTotalWeight = parseNum(weight) + parseNum(wastageWeight);
  const entryValue = entryTotalWeight * parseNum(rate);

  const pendingGstBase = entryValue + parseNum(mc);
  const pendingGst = productId && weight ? pendingGstBase * 0.03 : 0;
  const pendingAmount = productId && weight ? pendingGstBase + pendingGst : 0;
  const pendingWeight = productId && weight ? entryTotalWeight : 0;

  function buildItemFromEntry(): Item | null {
    if (!productId || !weight) return null;
    const w = parseNum(weight);
    const wastageWt = parseNum(wastageWeight);
    const r = parseNum(rate);
    const mcNum = parseNum(mc);
    const totalWeight = w + wastageWt;
    const value = totalWeight * r;
    const gstBase = value + mcNum;
    const itemGst = gstBase * 0.03;
    const amount = gstBase + itemGst;

    return {
      category,
      productId,
      productName: selectedProduct?.name ?? "",
      purity: selectedProduct?.purity ?? null,
      weight: w,
      wastagePercent: parseNum(wastagePercent),
      wastageWeight: wastageWt,
      rate: r,
      mc: mcNum,
      gst: itemGst,
      amount,
    };
  }

  function handleAddItem() {
    const newItem = buildItemFromEntry();
    if (!newItem) return;

    if (editingIndex !== null) {
      setItems((prev) =>
        prev.map((item, i) => (i === editingIndex ? newItem : item))
      );
      setEditingIndex(null);
    } else {
      setItems((prev) => [...prev, newItem]);
    }

    setCategory("");
    setProductId("");
    setWeight("");
    setWastagePercent("");
    setWastageWeight("");
    setMc("");
  }

  function handleEditItem(index: number) {
    const item = items[index];
    setCategory(item.category as "Gold" | "Silver");
    setProductId(item.productId);
    setWeight(String(item.weight));
    setWastagePercent(String(item.wastagePercent));
    setWastageWeight(String(item.wastageWeight));
    setRate(String(item.rate));
    setMc(String(item.mc));
    setEditingIndex(index);
  }

  function handleRemoveItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  }

  function handleShowScraps() {
    setShowScraps(true);
    if (scraps.length === 0) {
      setScraps([{ category: "", scrapName: "", scrapWeight: "" }]);
    }
  }

  function handleAddScrapRow() {
    setScraps((prev) => [...prev, { category: "", scrapName: "", scrapWeight: "" }]);
  }

  function updateScrap(index: number, patch: Partial<ScrapEntry>) {
    setScraps((prev) =>
      prev.map((scrap, i) => (i === index ? { ...scrap, ...patch } : scrap))
    );
  }

  function handleRemoveScrap(index: number) {
    setScraps((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setShowScraps(false);
      return next;
    });
  }

  const itemsExcludingEdit = items.filter((_, i) => i !== editingIndex);
  const totalWeightSum =
    itemsExcludingEdit.reduce((sum, i) => sum + i.weight + i.wastageWeight, 0) +
    pendingWeight;
  const gstSum =
    itemsExcludingEdit.reduce((sum, i) => sum + i.gst, 0) + pendingGst;
  const totalSum =
    itemsExcludingEdit.reduce((sum, i) => sum + i.amount, 0) + pendingAmount;
  const scrapTotal = linkedScraps
    .filter((s) => s.status === "locked")
    .reduce((sum, s) => sum + Number(s.total ?? 0), 0);
  const netTotal = totalSum - parseNum(less) - scrapTotal;

  const pendingItem = buildItemFromEntry();
  const finalItems = pendingItem ? [...itemsExcludingEdit, pendingItem] : items;

  async function handleSave() {
    if (finalItems.length === 0) return;
    setSaving(true);
    try {
      const validScraps = scraps
        .filter((s) => s.category && s.scrapName && s.scrapWeight)
        .map((s) => ({
          category: s.category,
          scrapName: s.scrapName,
          scrapWeight: parseNum(s.scrapWeight),
        }));

      const payload = {
        items: finalItems,
        gst: gstSum,
        total: totalSum,
        less: parseNum(less),
        netTotal,
        scraps: validScraps,
      };

      if (existingQuotationId) {
        await fetch(`/billing/api/quotations/${existingQuotationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        // Dropping the query params re-triggers the load effect, which
        // resets the form and fetches a fresh next-number.
        router.push("/quotation");
      } else {
        await fetch("/billing/api/quotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, salesPerson: getStaffName() }),
        });
        resetForm();
        fetch("/billing/api/quotations/next-number")
          .then((res) => res.json())
          .then((data) => setQuotationNumber(data.quotationNumber));
      }
      await loadQuotations();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/billing/api/quotations/${deleteTarget.id}`, {
        method: "DELETE",
      });
      setDeleteTarget(null);
      await loadQuotations();
    } finally {
      setDeleting(false);
    }
  }

  const refreshCount = quotations.filter(needsScrapRefresh).length;

  return (
    <div className="max-w-md mx-auto w-full px-3 py-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Quotation No.
          </div>
          <div className="heading text-xl font-semibold">
            {quotationNumber || "..."}
          </div>
        </div>
        <Link href="/quotation/scrap-first" className="btn-secondary text-xs px-3 py-1.5">
          Add Scrap First
        </Link>
      </div>

      {linkedScraps.length > 0 && (
        <div className="card p-3 flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
            Linked Scrap
          </h3>
          {linkedScraps.map((s) => (
            <div key={s.id} className="flex justify-between items-center text-sm">
              <span>
                {s.category} · {s.scrap_name} · {Number(s.scrap_weight).toFixed(3)} g
                {s.status !== "pending" && ` · ₹${Number(s.total).toFixed(2)}`}
              </span>
              <span
                className="text-[11px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap"
                style={SCRAP_STATUS_STYLE[s.status]}
              >
                {SCRAP_STATUS_LABEL[s.status]}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card p-3 flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between">
          <span style={{ color: "var(--muted)" }}>Total weight</span>
          <span className="font-medium">{totalWeightSum.toFixed(3)} g</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: "var(--muted)" }}>GST (3%)</span>
          <span className="font-medium">₹{gstSum.toFixed(2)}</span>
        </div>
        <div
          className="flex justify-between font-semibold border-t pt-1.5"
          style={{ borderColor: "var(--border)" }}
        >
          <span>Total</span>
          <span>₹{totalSum.toFixed(2)}</span>
        </div>
        {scrapTotal > 0 && (
          <div className="flex justify-between">
            <span style={{ color: "var(--muted)" }}>Scrap Value (Less)</span>
            <span className="font-medium">-₹{scrapTotal.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <label className="font-medium shrink-0">Less</label>
          <input
            className="input-field py-1"
            value={less}
            onChange={(e) => setLess(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
          />
        </div>
        <div
          className="flex justify-between text-base font-semibold border-t pt-1.5"
          style={{ borderColor: "var(--border)", color: "var(--primary)" }}
        >
          <span>Net Total</span>
          <span>₹{netTotal.toFixed(2)}</span>
        </div>
      </div>

      <div className="card p-3 flex flex-col gap-2">
        <h3 className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
          Add Product
        </h3>

        <div className="grid grid-cols-2 gap-2">
          <CustomSelect
            className="py-1.5 text-sm"
            value={category}
            onChange={(v) => handleCategoryChange(v as "" | "Gold" | "Silver")}
            placeholder="Type"
            options={[
              { value: "Gold", label: "Gold" },
              { value: "Silver", label: "Silver" },
            ]}
          />

          <CustomSelect
            className="py-1.5 text-sm"
            value={productId}
            onChange={handleProductChange}
            placeholder="Product"
            disabled={!category}
            options={filteredProducts.map((p) => ({
              value: p.id,
              label: `${p.name} ${p.purity ? `(${p.purity})` : ""}`,
            }))}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <input
            className="input-field py-1.5 text-sm"
            value={weight}
            onChange={(e) => handleWeightChange(e.target.value)}
            placeholder="Weight (g)"
            inputMode="decimal"
            disabled={!productId}
          />
          <input
            className="input-field py-1.5 text-sm"
            value={wastagePercent}
            onChange={(e) => handleWastagePercentChange(e.target.value)}
            placeholder="Wastage %"
            inputMode="decimal"
            disabled={!productId}
          />
          <input
            className="input-field py-1.5 text-sm"
            value={wastageWeight}
            onChange={(e) => setWastageWeight(e.target.value)}
            placeholder="WS wt (g)"
            inputMode="decimal"
            disabled={!productId}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            className="input-field py-1.5 text-sm"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="Rate (₹/g)"
            inputMode="decimal"
            disabled={!category}
          />
          <input
            className="input-field py-1.5 text-sm"
            value={mc}
            onChange={(e) => setMc(e.target.value)}
            placeholder="MC"
            inputMode="decimal"
          />
        </div>

        <div className="flex justify-between text-xs" style={{ color: "var(--muted)" }}>
          <span>Weight × Rate</span>
          <span>₹{entryValue.toFixed(2)}</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleAddItem}
            disabled={!productId || !weight}
            className="btn-secondary flex-1 py-1.5 text-sm"
          >
            {editingIndex !== null ? "Update Product" : "Add Product"}
          </button>
          {editingIndex !== null && (
            <button
              onClick={() => {
                setEditingIndex(null);
                setCategory("");
                setProductId("");
                setWeight("");
                setWastagePercent("");
                setWastageWeight("");
                setMc("");
              }}
              className="px-3 text-sm font-medium transition-colors hover:opacity-70"
              style={{ color: "var(--muted)" }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="card divide-y animate-scale-in" style={{ borderColor: "var(--border)" }}>
          {items.map((item, index) => (
            <div
              key={index}
              className="flex justify-between items-center px-3 py-2 text-sm"
              style={{
                background:
                  editingIndex === index
                    ? "color-mix(in srgb, var(--primary) 8%, transparent)"
                    : undefined,
              }}
            >
              <div>
                <div className="font-medium">{item.productName}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {item.weight.toFixed(3)}g · WS {item.wastagePercent}%
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">₹{item.amount.toFixed(2)}</span>
                <button onClick={() => handleEditItem(index)} className="link-accent">
                  Edit
                </button>
                <button onClick={() => handleRemoveItem(index)} className="link-danger">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showScraps && (
        <button
          onClick={handleShowScraps}
          className="btn-secondary flex items-center justify-center gap-1 py-1.5 text-sm"
        >
          <span className="text-base leading-none">+</span> Add Scrap
        </button>
      )}

      {showScraps && (
        <div className="card p-3 flex flex-col gap-3 animate-scale-in">
          <h3 className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
            Old Scrap
          </h3>

          {scraps.map((scrap, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 border-t pt-2"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="grid grid-cols-2 gap-2">
                <CustomSelect
                  className="py-1.5 text-sm"
                  value={scrap.category}
                  onChange={(v) =>
                    updateScrap(index, { category: v as "" | "Gold" | "Silver" })
                  }
                  placeholder="Type"
                  options={[
                    { value: "Gold", label: "Gold" },
                    { value: "Silver", label: "Silver" },
                  ]}
                />
                <input
                  className="input-field py-1.5 text-sm"
                  value={scrap.scrapWeight}
                  onChange={(e) =>
                    updateScrap(index, { scrapWeight: e.target.value })
                  }
                  placeholder="Weight (g)"
                  inputMode="decimal"
                />
              </div>

              <input
                className="input-field py-1.5 text-sm"
                value={scrap.scrapName}
                onChange={(e) => updateScrap(index, { scrapName: e.target.value })}
                placeholder="Scrap name e.g. Old Chain"
              />

              <button
                onClick={() => handleRemoveScrap(index)}
                className="link-danger self-end text-xs"
              >
                Remove
              </button>
            </div>
          ))}

          <button onClick={handleAddScrapRow} className="btn-secondary py-1.5 text-sm">
            + Add More Scrap
          </button>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || finalItems.length === 0}
        className="btn-primary"
      >
        {saving ? "Saving..." : "Save Quotation"}
      </button>

      <div className="flex items-center gap-2 mt-2">
        <h2 className="heading text-lg font-semibold">Saved Quotations</h2>
        {refreshCount > 0 && (
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{
              background: "color-mix(in srgb, var(--accent) 15%, transparent)",
              color: "var(--accent)",
            }}
          >
            {refreshCount} locked — needs update
          </span>
        )}
      </div>

      <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
        {!listLoading && quotations.length === 0 && (
          <div className="px-3 py-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            No saved quotations yet.
          </div>
        )}
        {listLoading && (
          <div className="px-3 py-6 text-center text-sm" style={{ color: "var(--muted)" }}>
            Loading...
          </div>
        )}
        {quotations.map((q) => (
          <div
            key={q.id}
            className="flex justify-between items-center px-3 py-2.5 table-row-hover cursor-pointer transition-colors"
            onClick={() => setMoveTarget(q)}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm" style={{ color: "var(--primary)" }}>
                  {q.quotation_number}
                </span>
                {needsScrapRefresh(q) && (
                  <span
                    title="Scrap locked after this quotation was saved — reopen and save to update the net total"
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap"
                    style={{
                      background: "color-mix(in srgb, var(--accent) 15%, transparent)",
                      color: "var(--accent)",
                    }}
                  >
                    Scrap Locked
                  </span>
                )}
              </div>
              <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
                {productSummary(q.items)} · {weightSummary(q.items)}g · Rev{" "}
                {String(q.revision).padStart(2, "0")}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(q);
              }}
              className="link-danger text-sm shrink-0 ml-2"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {moveTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 animate-fade-in"
          onClick={() => setMoveTarget(null)}
        >
          <div
            className="card w-full max-w-sm p-5 flex flex-col gap-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="heading text-lg font-semibold">
              {moveTarget.quotation_number}
            </h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              What do you want to do with this quotation?
            </p>
            {needsScrapRefresh(moveTarget) && (
              <p
                className="text-sm px-3 py-2 rounded-lg"
                style={{
                  background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                  color: "var(--accent)",
                }}
              >
                Its scrap's final estimate was locked after this quotation was last saved — reopen and save to update the net total.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {moveTarget.items.length === 0 ? (
                <button
                  onClick={() => {
                    router.push(
                      `/quotation?quotationId=${moveTarget.id}&quotationNumber=${encodeURIComponent(moveTarget.quotation_number)}`
                    );
                    setMoveTarget(null);
                  }}
                  className="btn-primary"
                >
                  Add Products to Quotation
                </button>
              ) : (
                <>
                  <button
                    onClick={() =>
                      router.push(`/quotation/${moveTarget.id}?mode=edit`)
                    }
                    className="btn-secondary"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => router.push(`/quotation/${moveTarget.id}`)}
                    className="btn-primary"
                  >
                    Move to Next Quotation
                  </button>
                </>
              )}
              {moveTarget.items.length > 0 && (
                <button
                  onClick={() => router.push(`/quotation/${moveTarget.id}/print`)}
                  className="btn-secondary"
                >
                  Print
                </button>
              )}
              <button
                onClick={() =>
                  router.push(
                    `/scrap/quotation?quotationId=${moveTarget.id}&quotationNumber=${encodeURIComponent(moveTarget.quotation_number)}`
                  )
                }
                className="btn-secondary"
              >
                Link the Scrap
              </button>
              <button
                onClick={() => setMoveTarget(null)}
                className="text-sm font-medium mt-1 transition-colors hover:opacity-70"
                style={{ color: "var(--muted)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 animate-fade-in"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="card w-full max-w-sm p-5 flex flex-col gap-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="heading text-lg font-semibold">Delete quotation?</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              This will permanently delete{" "}
              <span className="font-medium" style={{ color: "var(--foreground)" }}>
                {deleteTarget.quotation_number}
              </span>
              . This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="btn-danger-solid"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
