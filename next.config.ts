import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Architecture: Next.js serves the public site + customer portal + auth and
// all /api routes. The REAL Orchard Core administration runs as its own
// application on ORCHARD_PROXY_TARGET and
// owns /admin plus its module static assets (/TheAdmin, /OrchardCore.*,
// /AbrITAdminTheme, /media, ...) and identity pages (/Login, /Logoff, ...).
//
// Unknown paths are handled by the runtime catch-all route. A build-time
// rewrite would freeze the target into routes-manifest.json.
// ---------------------------------------------------------------------------

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
};

export default nextConfig;
