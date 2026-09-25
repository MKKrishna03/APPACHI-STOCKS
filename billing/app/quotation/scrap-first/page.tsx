"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CustomSelect from "@/components/CustomSelect";
import { getStaffName } from "@/lib/staffIdentity";

function parseNum(value: string) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

export default function ScrapFirstPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [category, setCategory] = useState<"" | "Gold" | "Silver">("");
  const [scrapName, setScrapName] = useState("");
  const [scrapWeight, setScrapWeight] = useState("");

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/billing/api/quotations/scrap-first", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          scrapName,
          scrapWeight: parseNum(scrapWeight),
          salesPerson: getStaffName(),
        }),
      });
      if (res.ok) {
        router.push("/quotation");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md mx-auto w-full px-4 py-8 flex flex-col gap-5">
      <div>
        <h1 className="heading text-2xl font-semibold">Add Scrap First</h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          Records the customer's old scrap and reserves a new quotation
          number for it. Add products to the quotation whenever you're ready.
        </p>
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
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !category || !scrapName || !scrapWeight}
        className="btn-primary"
      >
        {saving ? "Saving..." : "Save & Reserve Quotation No."}
      </button>
    </div>
  );
}
