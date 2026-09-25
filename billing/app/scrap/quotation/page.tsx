"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Status = "pending" | "estimated" | "locked";

type Scrap = {
  id: string;
  category: "Gold" | "Silver";
  scrap_name: string;
  scrap_weight: string;
  scrap_less: string | null;
  scrap_weight_after_less: string | null;
  rate: string | null;
  total: string | null;
  status: Status;
};

function UnlinkedScrapPicker({
  quotationId,
  onLinked,
}: {
  quotationId: string;
  onLinked: (scrap: Scrap) => void;
}) {
  const [unlinkedScraps, setUnlinkedScraps] = useState<Scrap[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/billing/api/scraps?unlinked=true")
      .then((res) => res.json())
      .then((data) => {
        setUnlinkedScraps(data);
        setLoading(false);
      });
  }, []);

  async function handleLink(scrapId: string) {
    setLinkingId(scrapId);
    try {
      const res = await fetch(`/billing/api/scraps/${scrapId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkQuotationId: quotationId }),
      });
      if (res.ok) {
        const linked = await res.json();
        onLinked(linked);
      }
    } finally {
      setLinkingId(null);
    }
  }

  if (loading) {
    return <div style={{ color: "var(--muted)" }}>Loading...</div>;
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Link an Existing Scrap</h3>
      {unlinkedScraps.length === 0 && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          No unlinked scrap available. Record one via New Scrap first, or add
          it directly from the quotation.
        </p>
      )}
      {unlinkedScraps.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between border-t pt-3"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <div className="text-sm font-medium">
              {s.category} · {s.scrap_name}
            </div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {Number(s.scrap_weight).toFixed(3)} g · {STATUS_LABEL[s.status]}
            </div>
          </div>
          <button
            onClick={() => handleLink(s.id)}
            disabled={linkingId !== null}
            className="btn-secondary"
          >
            {linkingId === s.id ? "Linking..." : "Link"}
          </button>
        </div>
      ))}
    </div>
  );
}

function parseNum(value: string) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending Estimation",
  estimated: "Estimated",
  locked: "Locked (Final)",
};

const STATUS_STYLE: Record<Status, { bg: string; color: string }> = {
  pending: {
    bg: "color-mix(in srgb, var(--accent) 15%, transparent)",
    color: "var(--accent)",
  },
  estimated: {
    bg: "color-mix(in srgb, #2f9e44 15%, transparent)",
    color: "#2f9e44",
  },
  locked: {
    bg: "color-mix(in srgb, var(--primary) 15%, transparent)",
    color: "var(--primary)",
  },
};

function EstimateForm({
  scrap,
  onSaved,
}: {
  scrap: Scrap;
  onSaved: (updated: Scrap) => void;
}) {
  const [scrapLess, setScrapLess] = useState(scrap.scrap_less ?? "0");
  const [rate, setRate] = useState(scrap.rate ?? "");
  const [saving, setSaving] = useState<"save" | "advance" | null>(null);

  const isPending = scrap.status === "pending";
  const scrapWeightAfterLess = parseNum(String(scrap.scrap_weight)) - parseNum(scrapLess);
  const total = scrapWeightAfterLess * parseNum(rate);

  async function submit(advance: boolean) {
    setSaving(advance ? "advance" : "save");
    try {
      const res = await fetch(`/billing/api/scraps/${scrap.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: scrap.category,
          scrapName: scrap.scrap_name,
          scrapWeight: parseNum(String(scrap.scrap_weight)),
          scrapLess: parseNum(scrapLess),
          scrapWeightAfterLess,
          rate: parseNum(rate),
          total,
          markEstimated: isPending ? advance : true,
          lockEstimate: isPending ? false : advance,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        onSaved(updated);
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <h3 className="text-sm font-semibold">
          {scrap.category} · {scrap.scrap_name}
        </h3>
        <span
          className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
          style={STATUS_STYLE[scrap.status]}
        >
          {STATUS_LABEL[scrap.status]}
        </span>
      </div>

      <div className="flex justify-between text-sm">
        <span style={{ color: "var(--muted)" }}>Scrap Weight</span>
        <span className="font-medium">
          {Number(scrap.scrap_weight).toFixed(3)} g
        </span>
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
        <span style={{ color: "var(--muted)" }}>Weight After Less</span>
        <span className="font-medium">{scrapWeightAfterLess.toFixed(3)} g</span>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Rate (₹/g)</label>
        <input
          className="input-field"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="0.00"
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

      <div className="flex gap-2">
        <button
          onClick={() => submit(false)}
          disabled={saving !== null}
          className="btn-secondary flex-1"
        >
          {saving === "save"
            ? "Saving..."
            : isPending
              ? "Save Draft"
              : "Move to Next"}
        </button>
        <button
          onClick={() => submit(true)}
          disabled={saving !== null || !(parseNum(rate) > 0)}
          className="btn-primary flex-1"
        >
          {saving === "advance"
            ? "Saving..."
            : isPending
              ? "Mark as Estimated"
              : "Finalize"}
        </button>
      </div>
    </div>
  );
}

function LockedSummary({ scrap }: { scrap: Scrap }) {
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <h3 className="text-sm font-semibold">
          {scrap.category} · {scrap.scrap_name}
        </h3>
        <span
          className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
          style={STATUS_STYLE.locked}
        >
          {STATUS_LABEL.locked}
        </span>
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

      <Link href={`/scrap/${scrap.id}/print`} className="btn-secondary text-center">
        Print
      </Link>
    </div>
  );
}

export default function ScrapForQuotationPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto w-full px-4 py-8" style={{ color: "var(--muted)" }}>
          Loading...
        </div>
      }
    >
      <ScrapForQuotationContent />
    </Suspense>
  );
}

function ScrapForQuotationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quotationId = searchParams.get("quotationId");
  const quotationNumber = searchParams.get("quotationNumber");

  const [scraps, setScraps] = useState<Scrap[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!quotationId) {
      setLoading(false);
      return;
    }
    fetch(`/billing/api/quotations/${quotationId}`)
      .then((res) => res.json())
      .then((data) => {
        setScraps(data.scraps ?? []);
        setLoading(false);
      });
  }, [quotationId]);

  function handleUpdated(updated: Scrap) {
    setScraps((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function handleLinked(linked: Scrap) {
    setScraps((prev) => [...prev, linked]);
  }

  if (!quotationId) {
    return (
      <div className="max-w-md mx-auto w-full px-4 py-8" style={{ color: "var(--muted)" }}>
        Missing quotation reference.{" "}
        <button onClick={() => router.push("/quotation")} className="link-accent">
          Back to Quotations
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto w-full px-4 py-8 flex flex-col gap-5">
      <div>
        <div className="text-sm" style={{ color: "var(--muted)" }}>
          Scrap for Quotation
        </div>
        <div className="heading text-2xl font-semibold">
          {quotationNumber || "..."}
        </div>
      </div>

      {loading && (
        <div style={{ color: "var(--muted)" }}>Loading...</div>
      )}

      {!loading && scraps.length === 0 && (
        <UnlinkedScrapPicker quotationId={quotationId} onLinked={handleLinked} />
      )}

      {!loading &&
        scraps.map((scrap) =>
          scrap.status === "locked" ? (
            <LockedSummary key={scrap.id} scrap={scrap} />
          ) : (
            <EstimateForm key={scrap.id} scrap={scrap} onSaved={handleUpdated} />
          )
        )}
    </div>
  );
}
