"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { buildScrapReceipt, sendToRawBT } from "@/lib/rawbtPrint";

type Scrap = {
  id: string;
  scrap_number: string;
  category: string;
  scrap_name: string;
  scrap_weight: string;
  scrap_less: string;
  scrap_weight_after_less: string;
  rate: string;
  total: string;
  quotation_number: string | null;
  status: string;
};

export default function PrintScrapPage() {
  const { id } = useParams<{ id: string }>();
  const [scrap, setScrap] = useState<Scrap | null>(null);

  useEffect(() => {
    fetch(`/billing/api/scraps/${id}`)
      .then((res) => res.json())
      .then((data) => setScrap(data));
  }, [id]);

  if (!scrap) {
    return (
      <div className="max-w-md mx-auto w-full px-4 py-8" style={{ color: "var(--muted)" }}>
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto w-full px-4 py-8 flex flex-col gap-5">
      <div className="flex gap-2 print:hidden">
        <button onClick={() => window.print()} className="btn-secondary">
          Print (Browser)
        </button>
        <button
          onClick={() => sendToRawBT(buildScrapReceipt(scrap))}
          className="btn-primary"
        >
          Print (Bluetooth)
        </button>
      </div>

      <div className="card p-6 flex flex-col gap-4">
        <div className="text-center border-b pb-3" style={{ borderColor: "var(--border)" }}>
          <div className="heading text-xl font-bold">Appachi Jewellery</div>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Scrap Estimation Slip
          </div>
        </div>

        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Scrap No.</span>
          <span className="font-medium">{scrap.scrap_number}</span>
        </div>
        {scrap.quotation_number && (
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--muted)" }}>Quotation No.</span>
            <span className="font-medium">{scrap.quotation_number}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Ornament Type</span>
          <span className="font-medium">{scrap.category}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Scrap Name</span>
          <span className="font-medium">{scrap.scrap_name}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Scrap Weight</span>
          <span className="font-medium">{Number(scrap.scrap_weight).toFixed(3)} g</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Less</span>
          <span className="font-medium">{Number(scrap.scrap_less).toFixed(3)} g</span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Weight After Less</span>
          <span className="font-medium">
            {Number(scrap.scrap_weight_after_less).toFixed(3)} g
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Rate</span>
          <span className="font-medium">₹{Number(scrap.rate).toFixed(2)}</span>
        </div>
        <div
          className="flex justify-between text-lg font-semibold border-t pt-3"
          style={{ borderColor: "var(--border)", color: "var(--primary)" }}
        >
          <span>Total</span>
          <span>₹{Number(scrap.total).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
