const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function log(level, msg, meta = {}) {
  if (LOG_LEVELS[level] > CURRENT_LEVEL) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(Object.keys(meta).length ? meta : {}),
  };
  const out = level === "error" ? console.error : console.log;
  out(JSON.stringify(entry));
}

const logger = {
  error: (msg, meta) => log("error", msg, meta),
  warn:  (msg, meta) => log("warn",  msg, meta),
  info:  (msg, meta) => log("info",  msg, meta),
  debug: (msg, meta) => log("debug", msg, meta),
};

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log(level, "http", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
      user: req.user?.user_id || null,
    });
  });
  next();
}

module.exports = { logger, requestLogger };
