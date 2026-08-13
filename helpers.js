// Pure helpers shared by server.js and the test suite — no DB/network access.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_RE = /^\d{4,6}$/;

// Employee IDs with admin privileges
const ADMIN_EMP_IDS = new Set([74]);

function computeRole(id, designation) {
  if (ADMIN_EMP_IDS.has(Number(id))) return 'OWNER';
  if (designation === 'COMPUTER') return 'COMPUTER';
  return 'STAFF';
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

module.exports = {
  EMAIL_RE, PIN_RE, ADMIN_EMP_IDS, computeRole, generateInviteCode,
  isGenderEligible, hasTimingOverlap, citiesConflict, isGiveUpOnCooldown,
};
