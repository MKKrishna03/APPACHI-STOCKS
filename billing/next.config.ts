import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Billing is mounted inside the Stocks Express server under /billing (see
  // server.js). Next auto-prefixes <Link>, router.push and its own assets, but
  // NOT raw fetch("/api/...") calls or plain <a href> — those are prefixed by
  // hand in the source.
  basePath: "/billing",
};

export default nextConfig;
