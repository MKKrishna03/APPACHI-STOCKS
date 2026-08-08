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

module.exports = { EMAIL_RE, PIN_RE, ADMIN_EMP_IDS, computeRole, generateInviteCode };
