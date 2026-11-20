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

// ---------------------------------------------------------------------------
// HTTP security headers (audit §3.6). Applied to EVERY route — including the
// Orchard admin pages served through the catch-all proxy — with values that
// keep Orchard Core working:
//   • script-src/style-src allow 'unsafe-inline' (Orchard admin views and
//     Next.js hydration inject inline scripts/styles) and 'unsafe-eval' only
//     in non-production builds.
//   • form-action allows https: so payment-gateway hand-offs keep working.
//   • frame-ancestors 'self' blocks clickjacking while keeping admin frames
//     served from the same origin.
// Override the CSP for special deployments with ABRIT_CSP; disable all
// headers with ABRIT_SECURITY_HEADERS=off (documented escape hatch).
// ---------------------------------------------------------------------------
const isProduction = process.env.NODE_ENV === "production";
const headersEnabled = (process.env.ABRIT_SECURITY_HEADERS ?? "on").toLowerCase() !== "off";
const csp = (process.env.ABRIT_CSP ?? "").trim() || [
  "default-src 'self'",
  // Orchard Core admin + Next.js require inline scripts/styles; dev builds
  // additionally require eval (React refresh machinery).
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  // Payment hand-offs navigate the browser to the PSP; form posts to https
  // origins must remain possible.
  "form-action 'self' https:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isProduction
    ? [
        // Only emitted by production builds; harmless behind a TLS proxy.
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  ...(headersEnabled
    ? {
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }
    : {}),
};

export default nextConfig;
