const jwt = require("jsonwebtoken");

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required but not set.");
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = "3d";

// Routes that don't require authentication
const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/reset-password",
  "/auth/logout",
]);

// Prefix-based public paths (upload sessions used by mobile phones)
const PUBLIC_PREFIXES = [
  "/upload-session/",
];

function isPublic(path) {
  if (PUBLIC_PATHS.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function parseCookieJwt(req) {
  const raw = req.headers.cookie || "";
  const match = raw.split(";").find((c) => c.trim().startsWith("auth_jwt="));
  return match ? match.split("=").slice(1).join("=").trim() : null;
}

function requireAuth(req, res, next) {
  if (isPublic(req.path)) return next();

  // Accept token from Authorization header OR HttpOnly cookie
  let token = null;
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    token = parseCookieJwt(req);
  }

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    const isExpired = err.name === "TokenExpiredError";
    return res.status(401).json({
      error: isExpired ? "Session expired. Please log in again." : "Invalid session.",
    });
  }
}

function signToken(user) {
  return jwt.sign(
    { user_id: user.user_id, name: user.name, can_delete: user.can_delete || false },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY },
  );
}

module.exports = { requireAuth, signToken };
