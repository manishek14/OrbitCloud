// Next.js routes take precedence. Unknown paths belong to Orchard Core.
// Resolve the upstream at request time so a rebuilt image is environment-neutral.
//
// SECURITY (full-remediation audit §2.1 + final-remediation P1-2):
//   * The upstream ORIGIN is pinned to the configured ORCHARD_PROXY_TARGET.
//     The request path is rebuilt from the catch-all segments and every
//     segment is percent-encoded, so no "//", "\", "%2F%2F" or Host-header
//     trick can ever change the target origin (SSRF hardening).
//   * HOST-HEADER TRUST (P1-2): the Host and X-Forwarded-Host sent upstream
//     are derived ONLY from the validated proxy target or the operator's
//     ABRIT_TRUSTED_PUBLIC_HOSTS allowlist — NEVER from the inbound request
//     unless ABRIT_TRUST_PROXY_HEADERS=true explicitly trusts the edge
//     proxy. A poisoned incoming Host cannot influence what the CMS sees
//     or where redirects point.
//   * REDIRECTS (P1-2): absolute Locations are only honored when they point
//     at the trusted CMS origin itself (rewritten to a relative path);
//     anything else is dropped. The incoming request origin is never used
//     as an allowlist base for redirect decisions.
//   * Only standard web methods are forwarded; everything else is a 405.
//   * Portal-internal headers (x-abrit-service-token, authorization, the
//     abrit_session cookie) are never forwarded to the CMS.
//   * The request body is streamed with a byte cap; the upstream call has a
//     timeout; the CMS-down path returns a branded, controlled response.
export const dynamic = "force-dynamic";

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
 * (P1-2). Never returns a client-controlled value unless the operator has
 * explicitly trusted the proxy layer or allowlisted the host.
 */
function chooseUpstreamHost(incomingHost: string | null, target: URL): { host: string; xfh: string } {
  const inbound = (incomingHost ?? "").trim().toLowerCase();

  // 1. Explicit operator allowlist: only allowlisted hosts are forwarded.
  const allow = configuredPublicHosts();
  if (allow.length > 0) {
    if (inbound && allow.includes(inbound)) return { host: inbound, xfh: inbound };
    return { host: allow[0], xfh: allow[0] };
  }

  // 2. Operator explicitly trusts the edge proxy to pin the public Host.
  if (isOperatorTrustedProxy()) {
    const host = inbound || target.host;
    return { host, xfh: host };
  }

  // 3. Default (untrusted): forward the deployment-configured target host.
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
  // P1-2: the upstream Host / X-Forwarded-Host are derived from trusted
  // configuration only — the inbound (possibly spoofed) Host is used solely
  // when the operator allowlisted it or explicitly trusted the edge proxy.
  // A spoofed incoming Host can never change what the CMS believes its
  // public origin is.
  const trustedProxy = isOperatorTrustedProxy();
  const upstreamHost = chooseUpstreamHost(request.headers.get("host"), target);
  headers.set("host", upstreamHost.host);
  headers.set("x-forwarded-host", upstreamHost.xfh);
  // The whole forwarded-header family is client-settable; an untrusted
  // deployment never passes client values through to the CMS.
  if (!trustedProxy) {
    headers.delete("x-forwarded-proto");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    headers.delete("forwarded");
    headers.set("x-forwarded-proto", target.protocol.slice(0, -1));
  } else if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));
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
      try {
        const redirect = new URL(location, target);
        // P1-2: redirects are only honored when they point at the TRUSTED CMS
        // origin (rewritten to a relative, host-independent path). Everything
        // else is dropped — the decision never involves the incoming request
        // origin, so a spoofed Host cannot smuggle an open redirect past the
        // old `redirect.origin !== incoming.origin` passthrough.
        if (redirect.origin === target.origin) {
          responseHeaders.set("location", redirect.pathname + redirect.search + redirect.hash);
        } else {
          // Absolute redirects to ANY other origin are dropped — the CMS never
          // legitimately bounces users to third parties, and forwarded Host
          // headers must not be able to forge such a redirect (open redirect).
          console.warn("[cms-proxy] dropped cross-origin redirect Location:", location);
          responseHeaders.set("location", "/");
        }
      } catch { /* Preserve an already relative Location. */ }
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
