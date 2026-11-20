// Next.js routes take precedence. Unknown paths belong to Orchard Core.
// Resolve the upstream at request time so a rebuilt image is environment-neutral.
//
// SECURITY (full-remediation audit §2.1 + final-remediation P1-2):
//   * The upstream ORIGIN is pinned to the configured ORCHARD_PROXY_TARGET.
//     The request path is rebuilt from the catch-all segments and every
//     segment is percent-encoded, so no "//", "\", "%2F%2F" or Host-header
//     trick can ever change the target origin (SSRF hardening).
//   * HOST-HEADER TRUST (P1-2, completed in FSR-6): the Host and
//     X-Forwarded-Host sent upstream are derived ONLY from the validated
//     proxy target or the operator's ABRIT_TRUSTED_PUBLIC_HOSTS allowlist.
//     A poisoned incoming Host cannot influence what the CMS sees or where
//     redirects point — in ANY trust mode (enabling the trusted-proxy flag
//     alone is deliberately NOT enough; see chooseUpstreamHost).
//   * FORWARDED-HEADER CONTRACT (FSR-6): x-forwarded-proto is always exactly
//     http/https; x-real-ip is only forwarded as a bare valid IP literal;
//     x-forwarded-port only as a bare numeric port; x-forwarded-for only in
//     trusted-proxy mode (the edge contract requires the edge to REPLACE it);
//     the RFC 7239 `Forwarded` header is never forwarded in any mode.
//   * REDIRECTS (P1-2, hardened in FSR-6): absolute Locations are only honored
//     when they point at the trusted CMS origin set (target origin + allowlisted
//     public hosts) and are rewritten to a RELATIVE path that can never
//     re-serialize as a network-path reference — "//evil.test",
//     "\\evil.test", "/\evil.test" and "http://cms//evil.test" all reduce to
//     a safe internal "/". The incoming request origin is never used as an
//     allowlist base for redirect decisions.
//   * Only standard web methods are forwarded; everything else is a 405.
//   * Portal-internal headers (x-abrit-service-token, authorization, the
//     abrit_session cookie) are never forwarded to the CMS.
//   * The request body is streamed with a byte cap; the upstream call has a
//     timeout; the CMS-down path returns a branded, controlled response.
export const dynamic = "force-dynamic";

import { isIP } from "node:net";

// Methods the CMS behind this proxy may serve. Anything else (OPTIONS,
// CONNECT, TRACE, …) is refused before any upstream connection is made.
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

/** Upstream request timeout. Long enough for slow admin uploads, short
 *  enough to free workers when the CMS hangs. Env-tunable, clamped. */
const PROXY_TIMEOUT_MS = (() => {
  const raw = Number(process.env.ORCHARD_PROXY_TIMEOUT_MS);
  const value = Number.isFinite(raw) && raw > 0 ? raw : 60_000;
  return Math.min(Math.max(Math.round(value), 1_000), 600_000);
})();

/** Maximum proxied request body in bytes (Orchard media uploads are larger
 *  than the 1 MiB JSON cap — this is a separate, generous guard). */
const PROXY_MAX_BODY_BYTES = (() => {
  const raw = Number(process.env.ABRIT_PROXY_MAX_BODY_BYTES);
  const value = Number.isFinite(raw) && raw > 0 ? raw : 64 * 1024 * 1024;
  return Math.min(Math.max(Math.round(value), 1024), 1024 * 1024 * 1024);
})();

// Hop-by-hop headers (RFC 9110 §7.6.1) must never be forwarded in either
// direction; content-length is dropped because bodies are re-streamed.
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

class ProxyBodyTooLargeError extends Error {
  constructor() {
    super("Proxied request body exceeds the configured limit");
    this.name = "ProxyBodyTooLargeError";
  }
}

/** Wraps a body stream with a hard byte cap; aborts the stream when exceeded. */
function limitBodyStream(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new ProxyBodyTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

/** Removes the portal session cookie (internal credential) from a Cookie
 *  header while preserving every other cookie the CMS needs (its own auth). */
function stripPortalSessionCookie(headers: Headers): void {
  const cookie = headers.get("cookie");
  if (!cookie) return;
  const kept = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.split("=", 1)[0] !== "abrit_session");
  if (kept.length === cookie.split(";").filter((p) => p.trim().length > 0).length) return;
  if (kept.length === 0) headers.delete("cookie");
  else headers.set("cookie", kept.join("; "));
}

// Branded RTL fallback for HTML navigations when the CMS is unreachable
// (audit UI-2: a bare "CMS is unavailable" string broke the product shell).
// API/asset requests keep a plain, cache-free error payload.
function cmsUnavailableHtml(code: string, heading: string): string {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>سرویس مدیریت در دسترس نیست — AbrIT</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Vazirmatn, "Segoe UI", Tahoma, sans-serif;
    background: #0b1220; color: #f8fafc;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .card {
    max-width: 420px; width: 100%;
    background: #111c31; border: 1px solid #26354d; border-radius: 16px;
    padding: 40px 32px; text-align: center;
  }
  .badge {
    width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 16px;
    background: rgba(29,78,216,.15); color: #60a5fa;
    display: flex; align-items: center; justify-content: center; font-size: 26px;
  }
  h1 { font-size: 18px; font-weight: 800; margin-bottom: 10px; }
  p { font-size: 13px; line-height: 2; color: #94a3b8; margin-bottom: 24px; }
  a {
    display: inline-block; background: #1d4ed8; color: #f8fafc;
    text-decoration: none; font-size: 13px; font-weight: 700;
    padding: 10px 24px; border-radius: 10px;
  }
  a:hover { background: #2563eb; }
  .hint { font-size: 11px; color: #64748b; margin-top: 16px; }
</style>
</head>
<body>
  <main class="card">
    <div class="badge">⚙️</div>
    <h1>${heading}</h1>
    <p>پنل مدیریت AbrIT پاسخ نمی‌دهد. لطفاً چند لحظه بعد دوباره تلاش کنید؛ اگر مشکل ادامه داشت با پشتیبانی تماس بگیرید.</p>
    <a href="/" >بازگشت به صفحه اصلی</a>
    <p class="hint">کد خطا: ${code}</p>
  </main>
</body>
</html>`;
}

function parseTarget(configured: string): URL | null {
  try {
    const target = new URL(configured);
    if (!(["http:", "https:"].includes(target.protocol)) || target.username || target.password) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}

/**
 * PUBLIC-FACING HOSTS the proxy may report to the CMS (P1-2).
 *
 * The CMS (Orchard) generates absolute URLs — redirects, canonical links,
 * password-reset links — from the Host / X-Forwarded-Host it receives.
 * Those values must describe the deployment's REAL public origin (what the
 * user's browser uses), never whatever an inbound request happens to carry.
 *
 * Trust chain, in order:
 *   1. ABRIT_TRUSTED_PUBLIC_HOSTS — explicit operator allowlist (comma or
 *      space separated, e.g. "portal.example.com, www.portal.example.com").
 *      Only hosts from this list may be forwarded upstream; a request whose
 *      Host is not on the list gets the first (primary) configured host.
 *   2. The inbound request Host — accepted ONLY when the operator has
 *      explicitly trusted the edge proxy via ABRIT_TRUST_PROXY_HEADERS=true
 *      (the documented production topology: an operator-controlled
 *      TLS-terminating reverse proxy in front of the portal that pins the
 *      public Host itself).
 *   3. Fallback (untrusted, the default): the proxy reports the TARGET host
 *      so the CMS keeps a stable, deployment-configured identity; nothing
 *      client-controlled is ever forwarded.
 */
function isOperatorTrustedProxy(): boolean {
  return (process.env.ABRIT_TRUST_PROXY_HEADERS ?? "").trim().toLowerCase() === "true";
}

/** Parses ABRIT_TRUSTED_PUBLIC_HOSTS into bare host / host:port entries. */
function configuredPublicHosts(): string[] {
  const configured = (process.env.ABRIT_TRUSTED_PUBLIC_HOSTS ?? "").trim();
  if (!configured) return [];
  const hosts: string[] = [];
  for (const entry of configured.split(/[\s,]+/)) {
    const host = entry.trim().toLowerCase();
    // Bare hostname or host:port only — scheme or userinfo tricks rejected.
    if (host && /^[a-z0-9.-]+(:\d+)?$/.test(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * Resolves the Host / X-Forwarded-Host values the proxy reports upstream
 * (P1-2, tightened in FSR-6).
 *
 * The ONLY way an inbound Host is promoted to the public host is the explicit
 * ABRIT_TRUSTED_PUBLIC_HOSTS allowlist — in EVERY mode. Enabling
 * ABRIT_TRUST_PROXY_HEADERS=true alone is deliberately NOT enough: a client
 * that reaches the portal directly (bypassing the edge proxy) must not be
 * able to poison the CMS's idea of the public origin. Without an allowlist
 * the proxy reports the deployment-configured target host.
 */
function chooseUpstreamHost(incomingHost: string | null, target: URL): { host: string; xfh: string } {
  const inbound = (incomingHost ?? "").trim().toLowerCase();

  // Explicit operator allowlist: only allowlisted hosts are forwarded.
  const allow = configuredPublicHosts();
  if (allow.length > 0) {
    if (inbound && allow.includes(inbound)) return { host: inbound, xfh: inbound };
    return { host: allow[0], xfh: allow[0] };
  }

  // No allowlist (untrusted AND trusted mode alike): forward the
  // deployment-configured target host — never a client-controlled value.
  return { host: target.host, xfh: target.host };
}

/**
 * Builds the upstream URL with an IMMUTABLE origin: the path is rebuilt from
 * the (already URL-decoded) catch-all segments, each re-encoded with
 * encodeURIComponent — so "//evil.com", "\\evil.com" or "%2F%2Fevil.com"
 * inputs can only ever become literal (encoded) path segments of the trusted
 * target, never a new authority. The query string is copied via the URL
 * setters, which cannot alter the origin either.
 */
function buildUpstreamUrl(target: URL, segments: string[], search: string): URL {
  const upstream = new URL(target);
  const basePath = target.pathname.replace(/\/+$/, "");
  const encodedSegments = segments
    .map((segment) => String(segment))
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment));
  const path = encodedSegments.length > 0 ? `${basePath}/${encodedSegments.join("/")}` : basePath || "/";
  upstream.pathname = path;
  upstream.search = search;
  return upstream;
}

/**
 * Redirect destinations the proxy considers TRUSTED (FSR-6): the configured
 * CMS origin itself plus the operator's allowlisted public hosts (the CMS
 * legitimately generates absolute URLs under the public host it was told
 * about via Host / X-Forwarded-Host). Both http and https forms of an
 * allowlisted host are trusted — the portal cannot know which scheme the
 * public edge terminates, and neither form can point outside the deployment.
 */
function trustedRedirectOrigins(target: URL): Set<string> {
  const origins = new Set([target.origin]);
  for (const host of configuredPublicHosts()) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  return origins;
}

/**
 * Reduces an upstream Location header to a SAFE RELATIVE reference (FSR-6).
 *
 * Rules:
 *   1. A raw Location that is already a safe relative reference (exactly one
 *      leading "/" — never "//" or "/\", no backslash anywhere, no control
 *      characters) is preserved untouched; the browser stays on the origin
 *      it already used.
 *   2. Everything else is parsed against the PINNED target origin. WHATWG
 *      parsing normalizes backslashes to slashes for special schemes, so
 *      "\\evil.test", "\evil.test" and "/\evil.test" all resolve to
 *      http://evil.test/… and fail the trusted-origin check below. Encoded
 *      slashes/backslashes stay percent-encoded path characters — they can
 *      never reintroduce an authority.
 *   3. Only trusted origins (trustedRedirectOrigins) survive, rewritten to
 *      `pathname + search + hash` — and only when that value cannot
 *      re-serialize as a network-path reference: it must not start with
 *      "//" and must not contain a backslash. Without this, a CMS Location
 *      like "http://cms:5000//evil.test/x" would come back out as
 *      "//evil.test/x" — a scheme-relative redirect to the attacker.
 *   4. Anything unparseable, untrusted or ambiguous is reduced to "/" — a
 *      safe internal destination, never an open redirect.
 */
function sanitizeUpstreamLocation(location: string, target: URL): { value: string; dropped: boolean } {
  const raw = location.trim();
  // Rule 1 — already a safe relative reference.
  if (/^\/(?!\/|\\)/.test(raw) && !raw.includes("\\") && !/[\r\n\t]/.test(raw)) {
    return { value: raw, dropped: false };
  }
  // Rule 2 — parse against the pinned target origin.
  let parsed: URL;
  try {
    parsed = new URL(raw, target);
  } catch {
    return { value: "/", dropped: true };
  }
  // Rule 3 — trusted origins only, never a network-path result.
  if (!trustedRedirectOrigins(target).has(parsed.origin)) {
    return { value: "/", dropped: true };
  }
  const relative = parsed.pathname + parsed.search + parsed.hash;
  if (relative.startsWith("//") || relative.includes("\\")) {
    return { value: "/", dropped: true };
  }
  return { value: relative, dropped: false };
}

async function proxy(request: Request, context: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const configured = process.env.ORCHARD_PROXY_TARGET;
  if (!configured) return new Response("CMS proxy target is not configured", { status: 503 });

  const target = parseTarget(configured);
  if (!target) return new Response("CMS proxy target is invalid", { status: 503 });

  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response("Method not allowed through the CMS proxy", {
      status: 405,
      headers: { Allow: [...ALLOWED_METHODS].join(", "), "Cache-Control": "no-store" },
    });
  }

  const incoming = new URL(request.url);
  const routeParams = await context.params;
  const rawSegments = Array.isArray(routeParams?.path) ? (routeParams.path as string[]) : [];
  const upstreamUrl = buildUpstreamUrl(target, rawSegments, incoming.search);

  // Defense in depth: the origin can never deviate from the configured target.
  if (upstreamUrl.origin !== target.origin) {
    return new Response("Invalid CMS proxy request", { status: 400 });
  }

  const headers = new Headers(request.headers);
  for (const header of HOP_BY_HOP) headers.delete(header);
  headers.delete("content-length");
  // Internal credentials never travel to the CMS.
  headers.delete("x-abrit-service-token");
  headers.delete("authorization");
  stripPortalSessionCookie(headers);
  // P1-2 + FSR-6: the upstream Host / X-Forwarded-Host are derived from
  // trusted configuration only — the inbound (possibly spoofed) Host is used
  // solely when the operator allowlisted it. A spoofed incoming Host can
  // never change what the CMS believes its public origin is, in ANY mode.
  const trustedProxy = isOperatorTrustedProxy();
  const upstreamHost = chooseUpstreamHost(request.headers.get("host"), target);
  headers.set("host", upstreamHost.host);
  headers.set("x-forwarded-host", upstreamHost.xfh);

  // FSR-6 — complete forwarded-header contract. Every header below is plain
  // client-settable input; the policy is explicit per mode (see the file
  // header). Nothing is ever passed through blindly, not even in
  // trusted-proxy mode:
  //   • x-forwarded-proto: always exactly "http" or "https" — the edge value
  //     when it validates, otherwise the pinned target scheme.
  //   • Forwarded (RFC 7239): always stripped — the documented edge contract
  //     uses the X-Forwarded-* family exclusively.
  //   • untrusted mode: x-forwarded-for / x-real-ip / x-forwarded-port are
  //     stripped (client-controlled values never reach the CMS).
  //   • trusted mode: x-forwarded-for passes on (the edge contract requires
  //     the edge to REPLACE it); x-real-ip only as a bare valid IP literal;
  //     x-forwarded-port only as a bare numeric port (1..65535).
  const edgeProto = (request.headers.get("x-forwarded-proto") ?? "").trim().toLowerCase();
  if (trustedProxy && (edgeProto === "http" || edgeProto === "https")) {
    headers.set("x-forwarded-proto", edgeProto);
  } else {
    headers.set("x-forwarded-proto", target.protocol.slice(0, -1));
  }
  headers.delete("forwarded");
  if (!trustedProxy) {
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    headers.delete("x-forwarded-port");
  } else {
    const edgeRealIp = (request.headers.get("x-real-ip") ?? "").trim();
    if (!(edgeRealIp.length > 0 && isIP(edgeRealIp) !== 0)) {
      headers.delete("x-real-ip");
    }
    const edgePort = (request.headers.get("x-forwarded-port") ?? "").trim();
    if (!/^\d{1,5}$/.test(edgePort) || Number(edgePort) < 1 || Number(edgePort) > 65535) {
      headers.delete("x-forwarded-port");
    }
  }

  const acceptsHtml = (request.headers.get("accept") ?? "").includes("text/html");
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body != null;

  // Cheap early rejection when the client declares an oversized body.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > PROXY_MAX_BODY_BYTES) {
    return new Response("Proxied request body too large", { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: hasBody ? limitBodyStream(request.body as ReadableStream<Uint8Array>, PROXY_MAX_BODY_BYTES) : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const responseHeaders = new Headers(upstream.headers);
    for (const header of HOP_BY_HOP) responseHeaders.delete(header);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding"); // Node fetch decodes upstream bodies.
    responseHeaders.delete("set-cookie");
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);
    const location = responseHeaders.get("location");
    if (location) {
      // FSR-6: redirects may ONLY target the trusted CMS origin set, and the
      // value handed to the browser can never degrade into a network-path
      // reference. See sanitizeUpstreamLocation for the full rule set.
      const sanitized = sanitizeUpstreamLocation(location, target);
      if (sanitized.dropped) {
        console.warn("[cms-proxy] dropped unsafe redirect Location:", location);
      }
      responseHeaders.set("location", sanitized.value);
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof ProxyBodyTooLargeError) {
      return new Response("Proxied request body too large", { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (!timedOut) console.error("CMS proxy request failed", error);
    // Branded fallback for browser navigations; plain payload for anything else.
    if (acceptsHtml) {
      return new Response(
        cmsUnavailableHtml(
          timedOut ? "CMS_TIMEOUT" : "CMS_UNAVAILABLE",
          timedOut ? "پاسخ سرویس مدیریت طولانی شد" : "سرویس مدیریت موقتاً در دسترس نیست",
        ),
        {
          status: timedOut ? 504 : 502,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        },
      );
    }
    return new Response(timedOut ? "CMS is unavailable (timeout)" : "CMS is unavailable", {
      status: timedOut ? 504 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
