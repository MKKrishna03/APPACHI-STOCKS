"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import CustomSelect from "@/components/CustomSelect";

type Status = "pending" | "estimated" | "locked";

function parseNum(value: string) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

const STATUS_STYLE: Record<Status, { bg: string; color: string; label: string }> = {
  pending: {
    bg: "color-mix(in srgb, var(--accent) 15%, transparent)",
    color: "var(--accent)",
    label: "Pending Estimation",
  },
  estimated: {
    bg: "color-mix(in srgb, #2f9e44 15%, transparent)",
    color: "#2f9e44",
    label: "Estimated",
  },
  locked: {
    bg: "color-mix(in srgb, var(--primary) 15%, transparent)",
    color: "var(--primary)",
    label: "Locked (Final)",
  },
};

export default function EditScrapPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"draft" | "final" | null>(null);
  const [status, setStatus] = useState<Status>("estimated");
  const [scrapNumber, setScrapNumber] = useState("");
  const [quotationNumber, setQuotationNumber] = useState<string | null>(null);

  const [category, setCategory] = useState<"" | "Gold" | "Silver">("");
  const [scrapName, setScrapName] = useState("");
  const [scrapWeight, setScrapWeight] = useState("");
  const [scrapLess, setScrapLess] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    fetch(`/billing/api/scraps/${id}`)
      .then((res) => res.json())
      .then((data) => {
        setCategory(data.category);
        setScrapName(data.scrap_name);
        setScrapWeight(String(data.scrap_weight));
        setScrapLess(data.scrap_less != null ? String(data.scrap_less) : "0");
        setRate(data.rate != null ? String(data.rate) : "");
        setStatus(data.status);
        setScrapNumber(data.scrap_number);
        setQuotationNumber(data.quotation_number);
        setLoading(false);
      });
  }, [id]);

  const scrapWeightAfterLess = parseNum(scrapWeight) - parseNum(scrapLess);
  const total = scrapWeightAfterLess * parseNum(rate);
  const locked = status === "locked";

  async function handleSave(mode: "draft" | "final") {
    setSaving(mode);
    try {
      const res = await fetch(`/billing/api/scraps/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          scrapName,
          scrapWeight: parseNum(scrapWeight),
          scrapLess: parseNum(scrapLess),
          scrapWeightAfterLess,
          rate: parseNum(rate),
          total,
          markEstimated: mode === "final",
        }),
      });
      if (res.ok) {
        router.push("/scrap");
      }
    } finally {
      setSaving(null);
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
      <div className="flex justify-between items-start">
        <div>
          <h1 className="heading text-2xl font-semibold">{scrapNumber}</h1>
          {quotationNumber && (
            <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              Quotation {quotationNumber}
            </div>
          )}
        </div>
        <span
          className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
          style={{
            background: STATUS_STYLE[status].bg,
            color: STATUS_STYLE[status].color,
          }}
        >
          {STATUS_STYLE[status].label}
        </span>
      </div>

      {locked && (
        <div
          className="card p-3 text-sm"
          style={{ color: "var(--muted)" }}
        >
          This scrap's estimate is locked and can no longer be edited.
        </div>
      )}

      <div className="card p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Ornament Type</label>
          <CustomSelect
            value={category}
            disabled={locked}
            onChange={(v) => setCategory(v as "" | "Gold" | "Silver")}
            placeholder="Select category"
            options={[
              { value: "Gold", label: "Gold" },
              { value: "Silver", label: "Silver" },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Scrap Name</label>
          <input
            className="input-field"
            value={scrapName}
            disabled={locked}
            onChange={(e) => setScrapName(e.target.value)}
            placeholder="e.g. Old Chain"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Scrap Weight (g)</label>
          <input
            className="input-field"
            value={scrapWeight}
            disabled={locked}
            onChange={(e) => setScrapWeight(e.target.value)}
            placeholder="0.000"
            inputMode="decimal"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Scrap Less (g)</label>
          <input
            className="input-field"
            value={scrapLess}
            disabled={locked}
            onChange={(e) => setScrapLess(e.target.value)}
            placeholder="0.000"
            inputMode="decimal"
          />
        </div>

        <div
          className="flex justify-between text-sm border-t pt-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span style={{ color: "var(--muted)" }}>
            Scrap Weight After Less
          </span>
          <span className="font-medium">
            {scrapWeightAfterLess.toFixed(3)} g
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Rate (₹/g)</label>
          <input
            className="input-field"
            value={rate}
            disabled={locked}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
          />
        </div>

        <div
          className="flex justify-between text-lg font-semibold border-t pt-3"
          style={{ borderColor: "var(--border)", color: "var(--primary)" }}
        >
          <span>Total</span>
          <span>₹{total.toFixed(2)}</span>
        </div>
      </div>

      {status === "pending" && (
        <div className="flex gap-2">
          <button
            onClick={() => handleSave("draft")}
            disabled={saving !== null || !category || !scrapName || !scrapWeight}
            className="btn-secondary flex-1"
          >
            {saving === "draft" ? "Saving..." : "Save Draft"}
          </button>
          <button
            onClick={() => handleSave("final")}
            disabled={saving !== null || !(parseNum(rate) > 0)}
            className="btn-primary flex-1"
          >
            {saving === "final" ? "Saving..." : "Mark as Estimated"}
          </button>
        </div>
      )}

      {status === "estimated" && (
        <button
          onClick={() => handleSave("final")}
          disabled={saving !== null || !category || !scrapName || !scrapWeight}
          className="btn-primary"
        >
          {saving === "final" ? "Saving..." : "Save Changes"}
        </button>
      )}

      {locked && (
        <Link href={`/scrap/${id}/print`} className="btn-primary text-center">
          Print
        </Link>
      )}
    </div>
  );
}
