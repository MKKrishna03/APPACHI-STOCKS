// Pure helpers shared by server.js and the test suite — no DB/network access.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{4,6}$/;

// Employee IDs with admin privileges
const ADMIN_EMP_IDS = new Set([74]);

// Employee IDs with a narrow extra grant: the Stock Entry page (view +
// submit) only — not full OWNER access to Employees/Salary/Settings/SQL
// Editor. Checked separately from role everywhere it matters (page access
// in auth.js, POST /api/entry/submit in server.js), never folded into
// computeRole/ADMIN_EMP_IDS since that would grant everything OWNER has.
const STOCK_ENTRY_ACCESS_IDS = new Set([100, 112, 125]);

// Employee IDs with a narrow extra grant: the Reorder section only (Reorder,
// Availability Checking, Stock Check pages + /api/tag-reports). Same idea as
// STOCK_ENTRY_ACCESS_IDS — never folded into computeRole.
const REORDER_ACCESS_IDS = new Set([2]);

// Employee IDs who always autofill into Stock Entry for whatever they're
// actually assigned that day, regardless of Mark Done status — for staff
// who can't tap Mark Done during the day (e.g. no phone with them at work)
// so the owner isn't stuck hand-typing their name every night. Their
// dashboard "done" status is untouched — that only ever comes from a real
// Mark Done tap (done_marks table), so this never makes them look done to
// the rest of the team until they actually mark it themselves.
const ALWAYS_AUTOFILL_EMP_IDS = new Set([31]);

function computeRole(id, designation) {
  if (ADMIN_EMP_IDS.has(Number(id))) return 'OWNER';
  if (designation === 'COMPUTER') return 'COMPUTER';
  return 'STAFF';
}

// ─── Page access (set by the owner on the Home page, stored in page_access) ──
// OWNER always has everything. Everyone else only gets the pages ticked for
// them; a newly signed-up staff member has none until the owner ticks some.
// The ID sets above are only used once, to seed page_access for staff who
// were already using the app before this existed.
const PAGE_KEYS = ['stocks', 'stock_entry', 'reorder', 'restock', 'sales', 'billing', 'purchase', 'purchase_pro', 'payroll', 'incentive'];
// The Leaves admin page isn't in the tick list: OWNER + COMPUTER staff, as it
// always was (minus the Stock Entry ID grant, which never included it).
const _desig = new Map();   // emp id -> designation, for the Leaves rule
function setDesignations(rows) { _desig.clear(); for (const r of rows) _desig.set(Number(r.id), r.designation || ''); }
function hasLeaves(id, role) {
  if (role === 'OWNER') return true;
  return (role === 'COMPUTER' || _desig.get(Number(id)) === 'COMPUTER') && !STOCK_ENTRY_ACCESS_IDS.has(Number(id));
}
const _grants = new Map();   // emp id -> Set of page keys
function setGrants(rows) {
  _grants.clear();
  for (const r of rows) {
    const id = Number(r.emp_id);
    if (!_grants.has(id)) _grants.set(id, new Set());
    _grants.get(id).add(String(r.page));
  }
}
function setEmpGrants(id, pages) { _grants.set(Number(id), new Set(pages)); }
// Ticked pages only (what the owner's list shows and saves)
function tickedOf(id) {
  return PAGE_KEYS.filter(k => _grants.get(Number(id))?.has(k));
}
// Everything this person can open — ticked pages, plus Leaves by its own rule
function pagesOf(id, role) {
  const out = role === 'OWNER' ? PAGE_KEYS.slice() : tickedOf(id);
  if (hasLeaves(id, role)) out.push('leaves');
  return out;
}
function hasPage(id, role, key) {
  if (key === 'leaves') return hasLeaves(id, role);
  return role === 'OWNER' || !!_grants.get(Number(id))?.has(key);
}

function hasStockEntryAccess(id, role) {
  return hasPage(id, role, 'stock_entry');
}

function hasReorderAccess(id, role) {
  return hasPage(id, role, 'reorder');
}

// Employee IDs (besides OWNER) who may use Purchase Pro (/purchase-pro).
// Add a staff member's ID here to give them access.
const PURCHASE_ACCESS_IDS = new Set([]);

function hasPurchaseAccess(id, role) {
  return hasPage(id, role, 'purchase_pro');
}

function generateInviteCode() {
  // Excludes I, O, 0, 1 to avoid confusion
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─── Stock-swap eligibility decision rules (extracted from findSwapBlocker /
// findGiveUpCooldownBlocker in server.js so they're independently testable) ──

// Would someone with this gender be allowed into a stock that requires male staff?
function isGenderEligible(gender, requiresMale) {
  return !requiresMale || String(gender || '').toUpperCase() === 'MALE';
}

// Do two stocks' timing-slot arrays collide? 'any' never counts as a collision.
function hasTimingOverlap(timingA, timingB) {
  return (timingA || []).some(t => t !== 'any' && (timingB || []).includes(t));
}

// Given the city_category values of everyone who'd be on a same-city-only
// stock together, would that mix In City and Out of City staff?
function citiesConflict(cityValues) {
  return new Set(cityValues).size > 1;
}

// Is a stock someone gave up in a swap still "on cooldown" — i.e. they gave
// it up at some point and haven't marked it done since?
function isGiveUpOnCooldown(lastGivenUp, hasDoneSince) {
  return Boolean(lastGivenUp) && !hasDoneSince;
}

// Full-rotation rule for auto-assign: has someone whose last turn on a stock
// was `lastA` waited at least as long as someone whose last turn was
// `lastB`? (YYYY-MM-DD strings; null/undefined = never done = waited
// longest.) A stock may only move from B to A when this is true — otherwise
// A would be getting a repeat turn ahead of B.
function hasWaitedAtLeastAsLong(lastA, lastB) {
  if (!lastA) return true;
  if (!lastB) return false;
  return lastA <= lastB;
}

module.exports = {
  EMAIL_RE, PIN_RE, ADMIN_EMP_IDS, STOCK_ENTRY_ACCESS_IDS, REORDER_ACCESS_IDS, ALWAYS_AUTOFILL_EMP_IDS, computeRole, hasStockEntryAccess, hasReorderAccess, generateInviteCode,
  PURCHASE_ACCESS_IDS, hasPurchaseAccess,
  PAGE_KEYS, setGrants, setEmpGrants, pagesOf, tickedOf, hasPage, setDesignations,
  isGenderEligible, hasTimingOverlap, citiesConflict, isGiveUpOnCooldown, hasWaitedAtLeastAsLong,
};
