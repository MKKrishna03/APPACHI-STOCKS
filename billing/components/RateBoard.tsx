"use client";

import { useEffect, useState } from "react";

type RateEntry = {
  id: string;
  rate_date: string;
  session: "AM" | "PM";
  gold_rate: string;
  silver_rate: string;
};

export default function RateBoard({
  variant = "header",
  collapsed = false,
  onNavigate,
}: {
  variant?: "header" | "sidebar";
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<RateEntry | null>(null);
  const [history, setHistory] = useState<RateEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [date, setDate] = useState("");
  const [session, setSession] = useState<"AM" | "PM">("AM");
  const [goldRate, setGoldRate] = useState("");
  const [silverRate, setSilverRate] = useState("");
  const [loading, setLoading] = useState(false);
  const [ratesLoading, setRatesLoading] = useState(true);

  async function loadRates() {
    setRatesLoading(true);
    try {
      const res = await fetch("/billing/api/rates");
      const data = await res.json();
      setCurrent(data.current);
      setHistory(data.history);
      setDate(data.auto.date);
      setSession(data.auto.session);
    } finally {
      setRatesLoading(false);
    }
  }

  useEffect(() => {
    loadRates();
  }, []);

  useEffect(() => {
    if (open) loadRates();
  }, [open]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!goldRate || !silverRate) return;
    setLoading(true);
    await fetch("/billing/api/rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, session, goldRate, silverRate }),
    });
    setGoldRate("");
    setSilverRate("");
    setLoading(false);
    await loadRates();
  }

  async function handleDelete(id: string) {
    await fetch(`/billing/api/rates/${id}`, { method: "DELETE" });
    await loadRates();
  }

  return (
    <>
      {variant === "sidebar" ? (
        <button
          onClick={() => {
            setOpen(true);
            onNavigate?.();
          }}
          title="Rate Board"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full text-left"
          style={{ color: "var(--foreground)" }}
        >
          <span className="text-base w-4 text-center">₹</span>
          {!collapsed && <span className="flex-1">Rate Board</span>}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium border transition-all duration-150 hover:shadow-md active:scale-[0.97]"
          style={{
            borderColor: "var(--primary)",
            color: "var(--primary)",
            background: "rgba(184, 134, 11, 0.08)",
          }}
        >
          Rate Board
          {current && (
            <span className="ml-2 text-amber-100/70">
              G ₹{current.gold_rate} · S ₹{current.silver_rate}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full max-w-3xl h-[85vh] flex overflow-hidden animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Main panel */}
            <div className="flex-1 flex flex-col min-w-0">
              <div
                className="flex items-center justify-between px-5 py-4 border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <h2 className="heading text-lg font-semibold">Rate Board</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="text-lg leading-none transition-colors"
                  style={{ color: "var(--muted)" }}
                >
                  ✕
                </button>
              </div>

              <div className="p-5 flex flex-col gap-5 overflow-y-auto">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Add Rate</h3>
                  <form onSubmit={handleSave} className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium">Date</label>
                        <input
                          type="date"
                          className="input-field"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium">
                          Session
                        </label>
                        <select
                          className="input-field"
                          value={session}
                          onChange={(e) =>
                            setSession(e.target.value as "AM" | "PM")
                          }
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium">
                          Gold rate (₹/g)
                        </label>
                        <input
                          className="input-field"
                          value={goldRate}
                          onChange={(e) => setGoldRate(e.target.value)}
                          placeholder="e.g. 7250"
                          inputMode="decimal"
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium">
                          Silver rate (₹/g)
                        </label>
                        <input
                          className="input-field"
                          value={silverRate}
                          onChange={(e) => setSilverRate(e.target.value)}
                          placeholder="e.g. 90"
                          inputMode="decimal"
                          required
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary w-fit"
                    >
                      {loading ? "Saving..." : "Update rate"}
                    </button>
                  </form>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Rate</h3>
                  {ratesLoading ? (
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      Loading...
                    </p>
                  ) : current ? (
                    <div className="card px-3 py-2 text-sm flex justify-between">
                      <span>
                        Gold ₹{current.gold_rate} · Silver ₹
                        {current.silver_rate}
                      </span>
                      <span style={{ color: "var(--muted)" }}>
                        {current.rate_date} · {current.session}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      No rate set yet.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Rate History sidebar */}
            <div
              className="border-l flex flex-col shrink-0 transition-all duration-200"
              style={{
                borderColor: "var(--border)",
                width: sidebarOpen ? "18rem" : "2.5rem",
              }}
            >
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-4 text-sm font-semibold shrink-0 transition-colors hover:bg-black/[0.03]"
              >
                <span>{sidebarOpen ? "◀" : "▶"}</span>
                {sidebarOpen && <span>Rate History</span>}
              </button>

              {sidebarOpen && (
                <div className="overflow-y-auto px-3 pb-4 flex-1">
                  <table className="w-full text-sm">
                    <thead
                      className="text-left sticky top-0"
                      style={{ background: "var(--card)" }}
                    >
                      <tr>
                        <th className="px-2 py-2">Date</th>
                        <th className="px-2 py-2">Sess</th>
                        <th className="px-2 py-2">Gold</th>
                        <th className="px-2 py-2">Silver</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 py-4 text-center"
                            style={{ color: "var(--muted)" }}
                          >
                            {ratesLoading
                              ? "Loading..."
                              : "No rates recorded yet."}
                          </td>
                        </tr>
                      )}
                      {history.map((h) => (
                        <tr
                          key={h.id}
                          className="border-t table-row-hover transition-colors"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <td className="px-2 py-2 whitespace-nowrap">
                            {h.rate_date}
                          </td>
                          <td className="px-2 py-2">{h.session}</td>
                          <td className="px-2 py-2">₹{h.gold_rate}</td>
                          <td className="px-2 py-2">₹{h.silver_rate}</td>
                          <td className="px-2 py-2 text-right">
                            <button
                              onClick={() => handleDelete(h.id)}
                              className="link-danger"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
