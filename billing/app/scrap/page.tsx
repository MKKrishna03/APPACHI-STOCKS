"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Status = "pending" | "estimated" | "locked";

type Scrap = {
  id: string;
  scrap_number: string;
  category: "Gold" | "Silver";
  scrap_name: string;
  scrap_weight: string;
  scrap_less: string | null;
  scrap_weight_after_less: string | null;
  rate: string | null;
  total: string | null;
  status: Status;
  quotation_number: string | null;
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending",
  estimated: "Estimated",
  locked: "Locked",
};

const STATUS_STYLE: Record<Status, { background: string; color: string }> = {
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

export default function ScrapPage() {
  const router = useRouter();
  const [scraps, setScraps] = useState<Scrap[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Scrap | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionTarget, setActionTarget] = useState<Scrap | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  async function loadScraps() {
    const res = await fetch("/billing/api/scraps");
    const data = await res.json();
    setScraps(data);
    setLoading(false);
  }

  useEffect(() => {
    loadScraps();
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/billing/api/scraps/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await loadScraps();
    } finally {
      setDeleting(false);
    }
  }

  async function handleFinalize() {
    if (!actionTarget) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/billing/api/scraps/${actionTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: actionTarget.category,
          scrapName: actionTarget.scrap_name,
          scrapWeight: Number(actionTarget.scrap_weight),
          scrapLess: Number(actionTarget.scrap_less ?? 0),
          scrapWeightAfterLess: Number(actionTarget.scrap_weight_after_less ?? 0),
          rate: Number(actionTarget.rate ?? 0),
          total: Number(actionTarget.total ?? 0),
          lockEstimate: true,
        }),
      });
      if (res.ok) {
        setActionTarget(null);
        await loadScraps();
      }
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-8 flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <Link href="/scrap/quotation" className="btn-primary text-center">
          Scrap for the Quotation
        </Link>
        <Link href="/scrap/new" className="btn-secondary text-center">
          New Scrap
        </Link>
      </div>

      <h1 className="heading text-2xl font-semibold mt-4">Saved Scrap</h1>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead
            className="text-left"
            style={{ background: "var(--background)" }}
          >
            <tr>
              <th className="px-4 py-2">Scrap No.</th>
              <th className="px-4 py-2">Quotation No.</th>
              <th className="px-4 py-2">Ornament Type</th>
              <th className="px-4 py-2">Scrap Name</th>
              <th className="px-4 py-2">Weight</th>
              <th className="px-4 py-2">After Less</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!loading && scraps.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-6 text-center"
                  style={{ color: "var(--muted)" }}
                >
                  No saved scrap yet.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-6 text-center"
                  style={{ color: "var(--muted)" }}
                >
                  Loading...
                </td>
              </tr>
            )}
            {scraps.map((s) => (
              <tr
                key={s.id}
                className="border-t table-row-hover transition-colors cursor-pointer"
                style={{ borderColor: "var(--border)" }}
                onClick={() => setActionTarget(s)}
              >
                <td
                  className="px-4 py-2 font-medium"
                  style={{ color: "var(--primary)" }}
                >
                  {s.scrap_number}
                </td>
                <td className="px-4 py-2">{s.quotation_number ?? "—"}</td>
                <td className="px-4 py-2">{s.category}</td>
                <td className="px-4 py-2">{s.scrap_name}</td>
                <td className="px-4 py-2">
                  {Number(s.scrap_weight).toFixed(3)} g
                </td>
                <td className="px-4 py-2">
                  {s.scrap_weight_after_less != null
                    ? `${Number(s.scrap_weight_after_less).toFixed(3)} g`
                    : "—"}
                </td>
                <td className="px-4 py-2">
                  {s.rate != null ? `₹${Number(s.rate).toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-2">
                  {s.total != null ? `₹${Number(s.total).toFixed(2)}` : "—"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
                    style={STATUS_STYLE[s.status]}
                  >
                    {STATUS_LABEL[s.status]}
                  </span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(s);
                    }}
                    className="link-danger"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {actionTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 animate-fade-in"
          onClick={() => setActionTarget(null)}
        >
          <div
            className="card w-full max-w-sm p-5 flex flex-col gap-4 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start">
              <h2 className="heading text-lg font-semibold">
                {actionTarget.scrap_number}
              </h2>
              <span
                className="text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap"
                style={STATUS_STYLE[actionTarget.status]}
              >
                {STATUS_LABEL[actionTarget.status]}
              </span>
            </div>
            <div className="text-sm flex flex-col gap-1" style={{ color: "var(--muted)" }}>
              <span>
                {actionTarget.category} · {actionTarget.scrap_name} ·{" "}
                {Number(actionTarget.scrap_weight).toFixed(3)} g
              </span>
              {actionTarget.status !== "pending" && (
                <span>Total: ₹{Number(actionTarget.total).toFixed(2)}</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {actionTarget.status === "pending" && (
                <button
                  onClick={() => router.push(`/scrap/${actionTarget.id}`)}
                  className="btn-primary"
                >
                  Estimate
                </button>
              )}
              {actionTarget.status === "estimated" && (
                <>
                  <button
                    onClick={() => router.push(`/scrap/${actionTarget.id}`)}
                    className="btn-secondary"
                  >
                    Move to Next
                  </button>
                  <button
                    onClick={handleFinalize}
                    disabled={finalizing}
                    className="btn-primary"
                  >
                    {finalizing ? "Finalizing..." : "Finalize"}
                  </button>
                </>
              )}
              {actionTarget.status === "locked" && (
                <>
                  <button
                    onClick={() => router.push(`/scrap/${actionTarget.id}`)}
                    className="btn-secondary"
                  >
                    View
                  </button>
                  <button
                    onClick={() => router.push(`/scrap/${actionTarget.id}/print`)}
                    className="btn-primary"
                  >
                    Print
                  </button>
                </>
              )}
              <button
                onClick={() => setActionTarget(null)}
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
            <h2 className="heading text-lg font-semibold">Delete scrap?</h2>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              This will permanently delete{" "}
              <span
                className="font-medium"
                style={{ color: "var(--foreground)" }}
              >
                {deleteTarget.scrap_name}
              </span>
              . This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="btn-secondary"
              >
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
