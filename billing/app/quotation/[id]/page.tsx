"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type Item = {
  category: string;
  productId: string | null;
  productName: string;
  purity: string | null;
  weight: string;
  wastagePercent: string;
  wastageWeight: string;
  rate: string;
  mc: string;
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

function parseNum(value: string) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

export default function EditQuotationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEditMode = searchParams.get("mode") === "edit";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quotationNumber, setQuotationNumber] = useState("");
  const [less, setLess] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [linkedScraps, setLinkedScraps] = useState<LinkedScrap[]>([]);

  useEffect(() => {
    fetch(`/billing/api/quotations/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setQuotationNumber(data.quotation_number);
        setLess(isEditMode ? (data.less ?? "") : "");
        setLinkedScraps(data.scraps ?? []);

        const nextItems: Item[] = data.items.map((item: any) => {
          const currentPct = Number(item.wastage_percent);
          const tier1 = Number(item.product_wastage_tier_1);
          const tier2 = Number(item.product_wastage_tier_2);
          const tier3 = Number(item.product_wastage_tier_3);

          let nextPct = currentPct;
          if (
            !isEditMode &&
            currentPct === tier1 &&
            item.product_wastage_tier_2
          ) {
            nextPct = tier2;
          } else if (
            !isEditMode &&
            currentPct === tier2 &&
            item.product_wastage_tier_3
          ) {
            nextPct = tier3;
          }

          const w = Number(item.weight);
          return {
            category: item.category,
            productId: item.product_id,
            productName: item.product_name,
            purity: item.purity,
            weight: item.weight,
            wastagePercent: String(nextPct),
            wastageWeight: ((w * nextPct) / 100).toFixed(3),
            rate: item.rate,
            mc: item.mc,
          };
        });

        setItems(nextItems);
        setLoading(false);
      });
  }, [id, isEditMode]);

  function updateItem(index: number, patch: Partial<Item>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  function handleWeightChange(index: number, value: string) {
    const pct = parseNum(items[index].wastagePercent);
    const w = parseNum(value);
    updateItem(index, {
      weight: value,
      wastageWeight: ((w * pct) / 100).toFixed(3),
    });
  }

  function handleWastagePercentChange(index: number, value: string) {
    const w = parseNum(items[index].weight);
    const pct = parseNum(value);
    updateItem(index, {
      wastagePercent: value,
      wastageWeight: ((w * pct) / 100).toFixed(3),
    });
  }

  function computeItemAmounts(item: Item) {
    const totalWeight = parseNum(item.weight) + parseNum(item.wastageWeight);
    const value = totalWeight * parseNum(item.rate);
    const gstBase = value + parseNum(item.mc);
    const gst = gstBase * 0.03;
    const amount = gstBase + gst;
    return { gst, amount };
  }

  const computedItems = items.map((item) => ({
    ...item,
    ...computeItemAmounts(item),
  }));

  const totalWeightSum = items.reduce(
    (sum, i) => sum + parseNum(i.weight) + parseNum(i.wastageWeight),
    0
  );
  const gstSum = computedItems.reduce((sum, i) => sum + i.gst, 0);
  const totalSum = computedItems.reduce((sum, i) => sum + i.amount, 0);
  const scrapTotal = linkedScraps
    .filter((s) => s.status === "locked")
    .reduce((sum, s) => sum + Number(s.total ?? 0), 0);
  const netTotal = totalSum - parseNum(less) - scrapTotal;

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/billing/api/quotations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: computedItems.map((item) => ({
            category: item.category,
            productId: item.productId,
            productName: item.productName,
            purity: item.purity,
            weight: parseNum(item.weight),
            wastagePercent: parseNum(item.wastagePercent),
            wastageWeight: parseNum(item.wastageWeight),
            rate: parseNum(item.rate),
            mc: parseNum(item.mc),
            gst: item.gst,
            amount: item.amount,
          })),
          gst: gstSum,
          total: totalSum,
          less: parseNum(less),
          netTotal,
        }),
      });
      router.push("/quotation");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div
        className="max-w-md mx-auto w-full px-4 py-8"
        style={{ color: "var(--muted)" }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto w-full px-4 py-8 flex flex-col gap-5">
      <div>
        <div className="text-sm" style={{ color: "var(--muted)" }}>
          Quotation No.
        </div>
        <div className="heading text-2xl font-semibold">
          {quotationNumber}
        </div>
      </div>

      {linkedScraps.length > 0 && (
        <div className="card p-4 flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Linked Scrap</h3>
          {linkedScraps.map((s) => (
            <div key={s.id} className="flex justify-between items-center text-sm">
              <span>
                {s.category} · {s.scrap_name} · {Number(s.scrap_weight).toFixed(3)} g
                {s.status !== "pending" && ` · ₹${Number(s.total).toFixed(2)}`}
              </span>
              <span
                className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
                style={SCRAP_STATUS_STYLE[s.status]}
              >
                {SCRAP_STATUS_LABEL[s.status]}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card p-4 flex flex-col gap-2">
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Total weight</span>
          <span className="font-medium">{totalWeightSum.toFixed(3)} g</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>GST (3%)</span>
          <span className="font-medium">₹{gstSum.toFixed(2)}</span>
        </div>
        <div
          className="flex justify-between text-base font-semibold border-t pt-2"
          style={{ borderColor: "var(--border)" }}
        >
          <span>Total</span>
          <span>₹{totalSum.toFixed(2)}</span>
        </div>
        {scrapTotal > 0 && (
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--muted)" }}>Scrap Value (Less)</span>
            <span className="font-medium">-₹{scrapTotal.toFixed(2)}</span>
          </div>
        )}
        <div className="flex flex-col gap-1 pt-1">
          <label className="text-sm font-medium">Less</label>
          <input
            className="input-field"
            value={less}
            onChange={(e) => setLess(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
          />
        </div>
        <div
          className="flex justify-between text-lg font-semibold border-t pt-2"
          style={{ borderColor: "var(--border)", color: "var(--primary)" }}
        >
          <span>Net Total</span>
          <span>₹{netTotal.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {items.map((item, index) => (
          <div key={index} className="card p-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold">
              {item.category} · {item.productName}
            </h3>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Weight (g)</label>
              <input
                className="input-field"
                value={item.weight}
                onChange={(e) => handleWeightChange(index, e.target.value)}
                inputMode="decimal"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Wastage</label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="input-field"
                  value={item.wastagePercent}
                  onChange={(e) =>
                    handleWastagePercentChange(index, e.target.value)
                  }
                  placeholder="%"
                  inputMode="decimal"
                />
                <input
                  className="input-field"
                  value={item.wastageWeight}
                  onChange={(e) =>
                    updateItem(index, { wastageWeight: e.target.value })
                  }
                  placeholder="0.000"
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Rate (₹/g)</label>
              <input
                className="input-field"
                value={item.rate}
                onChange={(e) => updateItem(index, { rate: e.target.value })}
                inputMode="decimal"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">MC</label>
              <input
                className="input-field"
                value={item.mc}
                onChange={(e) => updateItem(index, { mc: e.target.value })}
                inputMode="decimal"
              />
            </div>

            <div
              className="flex justify-between text-xs"
              style={{ color: "var(--muted)" }}
            >
              <span>Amount</span>
              <span>₹{computedItems[index].amount.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}
