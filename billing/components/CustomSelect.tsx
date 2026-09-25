"use client";

import { useEffect, useRef, useState } from "react";

export type CustomSelectOption = {
  value: string;
  label: string;
};

/**
 * Drop-in replacement for a native <select>. Some Android WebView / OEM
 * combinations (confirmed on a Vivo device running inside a Capacitor app)
 * render the native option picker blank instead of showing the option
 * list, effectively bricking the field. Rendering the dropdown as normal
 * page content instead of handing off to the OS picker sidesteps that
 * entirely, and works identically everywhere.
 */
export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select",
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: CustomSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`input-field w-full flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span style={{ color: selected ? "var(--foreground)" : "var(--muted)" }}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          style={{ flexShrink: 0, opacity: 0.6, transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          className="animate-scale-in absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg shadow-lg"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm" style={{ color: "var(--muted)" }}>
              No options
            </div>
          ) : (
            options.map((o) => (
              <div
                key={o.value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className="table-row-hover cursor-pointer px-3 py-2 text-sm"
                style={{ color: "var(--foreground)" }}
              >
                {o.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
