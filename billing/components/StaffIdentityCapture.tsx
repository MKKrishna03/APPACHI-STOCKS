"use client";

import { useEffect } from "react";
import { setStaffName } from "@/lib/staffIdentity";

/**
 * Captures ?staff=<name> from the URL (set by the Stocks app when it links
 * here) and remembers it in localStorage, since this app has no login of
 * its own. Mounted once in the root layout — Next's client-side navigation
 * between pages doesn't remount the layout, and localStorage already
 * persists the value, so a single capture on the initial hard navigation
 * from the Stocks app is enough.
 */
export default function StaffIdentityCapture() {
  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get("staff");
    if (name) setStaffName(name);
  }, []);

  return null;
}
