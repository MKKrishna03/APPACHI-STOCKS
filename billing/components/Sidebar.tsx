"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import RateBoard from "@/components/RateBoard";

const navItems = [
  { href: "/", label: "Dashboard", icon: "⌂" },
  { href: "/quotation", label: "Quotation", icon: "◆" },
  { href: "/products", label: "Products", icon: "✦" },
  { href: "/scrap", label: "Scrap", icon: "⟳" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
    } catch {}
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  function NavLinks({
    onNavigate,
    collapsed: linksCollapsed,
  }: {
    onNavigate?: () => void;
    collapsed?: boolean;
  }) {
    return (
      <>
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={item.label}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              style={
                active
                  ? {
                      background:
                        "color-mix(in srgb, var(--primary) 12%, transparent)",
                      color: "var(--primary)",
                    }
                  : { color: "var(--foreground)" }
              }
            >
              <span className="text-base w-4 text-center">{item.icon}</span>
              {!linksCollapsed && item.label}
            </Link>
          );
        })}
      </>
    );
  }

  return (
    <>
      {/* Mobile toggle — offset accounts for the header's own safe-area
          padding (see layout.tsx), so it doesn't overlap under a status bar
          inset instead of sitting just below the header. */}
      <button
        onClick={() => setOpen(true)}
        className="sm:hidden fixed left-3 z-30 w-9 h-9 rounded-lg flex items-center justify-center card"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 68px)" }}
        aria-label="Open menu"
      >
        ☰
      </button>

      {/* Desktop sidebar */}
      <aside
        className="hidden sm:flex flex-col shrink-0 border-r p-4 gap-1 sticky top-[57px] h-[calc(100vh-57px)] transition-all duration-200"
        style={{
          borderColor: "var(--border)",
          background: "var(--card)",
          width: collapsed ? "4rem" : "14rem",
        }}
      >
        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex items-center justify-center w-8 h-8 rounded-lg mb-2 self-end transition-colors hover:bg-black/[0.04]"
          style={{ color: "var(--muted)" }}
        >
          {collapsed ? "»" : "«"}
        </button>
        <NavLinks collapsed={collapsed} />
        <div
          className="border-t my-2"
          style={{ borderColor: "var(--border)" }}
        />
        <RateBoard variant="sidebar" collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div
          className="sm:hidden fixed inset-0 z-40 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <aside
            className="absolute left-0 top-0 h-full w-64 p-4 flex flex-col gap-1 animate-scale-in"
            style={{ background: "var(--card)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <span className="heading font-semibold">Menu</span>
              <button
                onClick={() => setOpen(false)}
                style={{ color: "var(--muted)" }}
              >
                ✕
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <div
              className="border-t my-2"
              style={{ borderColor: "var(--border)" }}
            />
            <RateBoard variant="sidebar" onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
