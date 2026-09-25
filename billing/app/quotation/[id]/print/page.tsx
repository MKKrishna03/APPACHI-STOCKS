"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { buildQuotationReceipt, sendToRawBT } from "@/lib/rawbtPrint";

type Item = {
  product_name: string;
  weight: string;
  wastage_weight: string;
  rate: string;
  mc: string;
};

type Scrap = {
  scrap_name: string;
  scrap_weight: string;
  scrap_less: string;
  scrap_weight_after_less: string;
  rate: string;
  total: string;
  status: "pending" | "estimated" | "locked";
};

type Quotation = {
  quotation_number: string;
  created_at: string;
  gst: string;
  total: string;
  less: string | null;
  sales_person: string | null;
  items: Item[];
  scraps: Scrap[];
};

function n(value: string | null | undefined) {
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

export default function PrintQuotationPage() {
  const { id } = useParams<{ id: string }>();
  const [quotation, setQuotation] = useState<Quotation | null>(null);

  useEffect(() => {
    fetch(`/billing/api/quotations/${id}`)
      .then((res) => res.json())
      .then((data) => setQuotation(data));
  }, [id]);

  if (!quotation) {
    return (
      <div className="max-w-md mx-auto w-full px-4 py-8" style={{ color: "var(--muted)" }}>
        Loading...
      </div>
    );
  }

  const createdAt = new Date(quotation.created_at);
  const date = createdAt.toLocaleDateString("en-IN");
  const time = createdAt.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const items = quotation.items;
  const totalWeight = items.reduce((sum, i) => sum + n(i.weight) + n(i.wastage_weight), 0);
  const rate = n(items[0]?.rate);
  const value = totalWeight * rate;
  const mcSum = items.reduce((sum, i) => sum + n(i.mc), 0);
  const gst = n(quotation.gst);
  const totalAfterGst = n(quotation.total);
  const less = n(quotation.less);
  const newProductTotal = totalAfterGst - less;

  const lockedScraps = quotation.scraps.filter((s) => s.status === "locked");
  const oldScrapTotal = lockedScraps.reduce((sum, s) => sum + n(s.total), 0);
  const amount = newProductTotal - oldScrapTotal;

  return (
    <div className="max-w-md mx-auto w-full px-4 py-8 flex flex-col items-center gap-5">
      <div className="flex gap-2 print:hidden">
        <button onClick={() => window.print()} className="btn-secondary">
          Print (Browser)
        </button>
        <button
          onClick={() => sendToRawBT(buildQuotationReceipt(quotation))}
          className="btn-primary"
        >
          Print (Bluetooth)
        </button>
      </div>

      <div id="thermal-slip" className="border p-3 flex flex-col gap-1 font-mono text-[12px] leading-tight" style={{ borderColor: "var(--border)", width: "79mm" }}>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-bold" style={{ color: "var(--muted)" }}>Q No:</span>
          <span className="text-[13px] font-bold">{quotation.quotation_number}</span>
        </div>
        <div className="text-[11px]">{date}&nbsp;&nbsp;{time}</div>
        <div className="text-[12px]">{quotation.sales_person || ""}</div>

        <Hr />

        {items.map((item, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <Row left={item.product_name} right={n(item.weight).toFixed(3)} />
            <Row left="Wastage" right={n(item.wastage_weight).toFixed(3)} red />
          </div>
        ))}

        <Hr />
        <Row left="" right={totalWeight.toFixed(3)} bold />
        <Row left="Rate" right={rate.toFixed(2)} red />
        <Hr />
        <Row left="" right={value.toFixed(2)} />
        <Row left="MC" right={mcSum.toFixed(2)} red />
        <Row left="GST 3%" right={gst.toFixed(2)} red />
        <Hr />
        <Row left="" right={totalAfterGst.toFixed(2)} bold />
        <Row left="Less" right={less.toFixed(2)} red />
        <Hr />
        <Row left="" right={newProductTotal.toFixed(2)} bold />

        {lockedScraps.length > 0 && (
          <>
            <div className="text-center font-semibold mt-1">SCRAP</div>
            {lockedScraps.map((scrap, i) => (
              <div key={i} className="flex flex-col gap-0.5">
                <Row left={scrap.scrap_name} right={n(scrap.scrap_weight).toFixed(3)} />
                <Row left="Less" right={n(scrap.scrap_less).toFixed(3)} red />
                <Hr />
                <Row left="" right={n(scrap.scrap_weight_after_less).toFixed(3)} />
                <Row left="" right={n(scrap.rate).toFixed(2)} />
                <Row left="" right={n(scrap.total).toFixed(2)} />
              </div>
            ))}
          </>
        )}

        <Hr />
        <Row left="NEW" right={newProductTotal.toFixed(2)} bold />
        <Row left="OLD" right={oldScrapTotal.toFixed(2)} bold />
        <Hr />
        <Row left="AMOUNT" right={amount.toFixed(2)} bold />
      </div>
    </div>
  );
}

function Row({
  left,
  right,
  bold,
  red,
}: {
  left: string;
  right: string;
  bold?: boolean;
  red?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      {left && (
        <span className="text-[13px] font-bold" style={{ color: "var(--muted)" }}>
          {left}
        </span>
      )}
      <span
        className={bold ? "text-[14px] font-bold ml-auto" : "text-[13px] font-semibold ml-auto"}
        style={red ? { color: "#c0392b" } : undefined}
      >
        {right}
      </span>
    </div>
  );
}

function Hr() {
  return <div className="border-t" style={{ borderColor: "#000" }} />;
}
