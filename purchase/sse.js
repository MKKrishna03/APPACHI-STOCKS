// Server-Sent Events — one module shared across all routes
const clients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(msg);
    } catch {
      clients.delete(res);
    }
  }
}

function sseHandler(req, res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write("event: connected\ndata: {}\n\n");

  clients.add(res);

  // Keepalive ping every 25s so proxies / browsers don't close the connection
  const hb = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(hb);
      clients.delete(res);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(hb);
    clients.delete(res);
  });
}

module.exports = { broadcast, sseHandler };
