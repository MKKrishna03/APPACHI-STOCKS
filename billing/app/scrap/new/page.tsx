"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CustomSelect from "@/components/CustomSelect";

type CurrentRate = {
  gold_rate: string;
  silver_rate: string;
} | null;

function parseNum(value: string) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

export default function NewScrapPage() {
  const router = useRouter();
  const [currentRate, setCurrentRate] = useState<CurrentRate>(null);
  const [saving, setSaving] = useState(false);

  const [category, setCategory] = useState<"" | "Gold" | "Silver">("");
  const [scrapName, setScrapName] = useState("");
  const [scrapWeight, setScrapWeight] = useState("");
  const [scrapLess, setScrapLess] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
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

  const scrapWeightAfterLess = parseNum(scrapWeight) - parseNum(scrapLess);
  const total = scrapWeightAfterLess * parseNum(rate);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/billing/api/scraps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          scrapName,
          scrapWeight: parseNum(scrapWeight),
          scrapLess: parseNum(scrapLess),
          scrapWeightAfterLess,
          rate: parseNum(rate),
          total,
        }),
      });
      router.push("/scrap");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md mx-auto w-full px-4 py-8 flex flex-col gap-5">
      <div>
        <h1 className="heading text-2xl font-semibold">New Scrap</h1>
      </div>

      <div className="card p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Ornament Type</label>
          <CustomSelect
            value={category}
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
            onChange={(e) => setScrapName(e.target.value)}
            placeholder="e.g. Old Chain"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Scrap Weight (g)</label>
          <input
            className="input-field"
            value={scrapWeight}
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
            onChange={(e) => setScrapLess(e.target.value)}
            placeholder="0.000"
            inputMode="decimal"
          />
        </div>

        <div className="flex justify-between text-sm border-t pt-3" style={{ borderColor: "var(--border)" }}>
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
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            disabled={!category}
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

      <button
        onClick={handleSave}
        disabled={saving || !category || !scrapName || !scrapWeight}
        className="btn-primary"
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
