const STORAGE_KEY = "appachi_staff_name";

// This app has no login of its own. The Stocks app (which does) passes
// its logged-in employee's name via a ?staff= query param when linking
// here — see nav.js / dashboard.html in APPACHI-STOCKS.
export function getStaffName(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStaffName(name: string) {
  if (typeof window === "undefined" || !name) return;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {}
}
