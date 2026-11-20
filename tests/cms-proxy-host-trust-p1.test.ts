// ============================================================================
// P1-2 regression tests — CMS proxy Host-header trust & redirect whitelist
// (final security remediation, defect 2).
//
// The defect: the proxy set `host` / `x-forwarded-host` on the upstream
// request from the INBOUND request's Host, and the redirect filter treated a
// Location as safe when it equaled `incoming.origin` — an origin the attacker
// controls via the Host header. Result: Host-header poisoning could make the
// CMS generate attacker-scoped absolute URLs and smuggle open redirects.
//
// The fix: the upstream Host/XFH come only from the deployment configuration
// (ORCHARD_PROXY_TARGET host, or the operator's ABRIT_TRUSTED_PUBLIC_HOSTS
// allowlist, or — only with explicit ABRIT_TRUST_PROXY_HEADERS=true — the
// inbound Host). Redirects are honored ONLY against the trusted CMS origin;
// the incoming origin is never part of the decision.
//
// Required matrix (all eight), each proving a spoofed Host cannot influence
// the CMS Host or the redirect destination:
//   1. normal Host          — configured/allowlisted host forwarded upstream
//   2. forged Host          — spoofed Host never reaches the CMS
//   3. forged XFH/XFF/XRI   — client-set forwarding headers stripped
//   4. external redirect    — dropped to "/"
//   5. forged-inbound-Host redirect — dropped (the actual P1-2 bypass)
//   6. real CMS origin redirect — rewritten to a relative path
//   7. relative redirect    — preserved untouched
//   8. forwarded header checks (allowlist + trusted-proxy modes)
//
// globalThis.fetch is mocked — no network access happens.
// ============================================================================

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

const originalFetch = globalThis.fetch;

interface UpstreamCapture {
  url: string;
  method: string;
  headers: Headers;
}

let captures: UpstreamCapture[] = [];
let upstreamResponse: () => Response = () => new Response("ok", { status: 200 });

function installFetchMock(): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String((input as Request)?.url ?? input);
    captures.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers as HeadersInit | undefined),
    });
    if (init?.body != null) {
      await new Response(init.body as ReadableStream<Uint8Array>).arrayBuffer();
    }
    return upstreamResponse();
  }) as typeof fetch;
}

const TARGET = "http://cms.internal:5000";

process.env.ORCHARD_PROXY_TARGET = TARGET;
delete process.env.ABRIT_TRUSTED_PUBLIC_HOSTS;
delete process.env.ABRIT_TRUST_PROXY_HEADERS;

const { GET } = await import("../src/app/[...path]/route");

function call(
  path: string,
  init: RequestInit & { routeSegments?: string[] } = {},
): Promise<Response> {
  const { routeSegments, ...requestInit } = init;
  const request = new Request(`http://portal.test${path}`, { method: "GET", ...requestInit });
  const context = { params: Promise.resolve({ path: routeSegments ?? path.split("/").slice(1) }) };
  return (GET as (req: Request, ctx: unknown) => Promise<Response>)(request, context);
}

beforeAll(() => {
  installFetchMock();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  delete process.env.ORCHARD_PROXY_TARGET;
  delete process.env.ABRIT_TRUSTED_PUBLIC_HOSTS;
  delete process.env.ABRIT_TRUST_PROXY_HEADERS;
});

// Restore the default (untrusted) trust state after every test — several
// cases flip the env to exercise the operator modes.
beforeEach(() => {
  captures = [];
  upstreamResponse = () => new Response("ok", { status: 200 });
  delete process.env.ABRIT_TRUSTED_PUBLIC_HOSTS;
  delete process.env.ABRIT_TRUST_PROXY_HEADERS;
});
afterEach(() => {
  delete process.env.ABRIT_TRUSTED_PUBLIC_HOSTS;
  delete process.env.ABRIT_TRUST_PROXY_HEADERS;
});

describe("P1-2 — upstream Host derivation (host-header poisoning)", () => {
  test("1. normal request (default mode): Host/XFH come from the configured target", async () => {
    const response = await call("/admin/login", { routeSegments: ["admin", "login"] });
    expect(response.status).toBe(200);
    expect(captures[0].headers.get("host")).toBe("cms.internal:5000");
    expect(captures[0].headers.get("x-forwarded-host")).toBe("cms.internal:5000");
    expect(captures[0].headers.get("x-forwarded-proto")).toBe("http");
  });

  test("2. forged inbound Host never reaches the CMS (default: replaced by the target host)", async () => {
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { host: "evil.attacker.test" },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("cms.internal:5000"); // NOT evil.attacker.test
    expect(forwarded.get("x-forwarded-host")).toBe("cms.internal:5000");
  });

  test("2b. forged inbound Host is also rejected in allowlist mode (non-allowlisted → primary host)", async () => {
    process.env.ABRIT_TRUSTED_PUBLIC_HOSTS = "portal.example.com, www.portal.example.com";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { host: "evil.attacker.test" },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("portal.example.com"); // primary allowlisted host
    expect(forwarded.get("x-forwarded-host")).toBe("portal.example.com");
  });

  test("3. client-supplied x-forwarded-host / x-forwarded-for / x-real-ip / forwarded are stripped (default mode)", async () => {
    await call("/admin", {
      routeSegments: ["admin"],
      headers: {
        "x-forwarded-host": "evil.attacker.test",
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
        forwarded: "for=9.9.9.9",
        "x-forwarded-proto": "https",
      },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("x-forwarded-host")).toBe("cms.internal:5000"); // overridden
    expect(forwarded.get("x-forwarded-for")).toBeNull(); // stripped
    expect(forwarded.get("x-real-ip")).toBeNull(); // stripped
    expect(forwarded.get("forwarded")).toBeNull(); // stripped
    expect(forwarded.get("x-forwarded-proto")).toBe("http"); // derived from the target scheme
  });
});

describe("P1-2 — redirect destination whitelist (open redirect via poisoned Host)", () => {
  test("4. external redirect Location is dropped → \"/\"", async () => {
    upstreamResponse = () =>
      new Response(null, { status: 302, headers: { location: "http://evil.attacker.test/phish" } });
    const response = await call("/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  test("5. redirect pointing at the FORGED inbound Host is dropped (the P1-2 bypass)", async () => {
    // The attacker sends Host: evil.attacker.test and the CMS (believing that
    // Host) emits Location: http://evil.attacker.test/admin. The OLD code
    // compared against incoming.origin and let it through; the fix only ever
    // compares against the trusted CMS origin.
    upstreamResponse = () =>
      new Response(null, { status: 302, headers: { location: "http://evil.attacker.test/admin" } });
    const response = await call("/admin", {
      routeSegments: ["admin"],
      headers: { host: "evil.attacker.test" },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/"); // dropped — NOT the forged host
  });

  test("6. redirect to the REAL CMS origin is rewritten to a relative path", async () => {
    upstreamResponse = () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://cms.internal:5000/Admin/Login?ReturnUrl=%2Fadmin" },
      });
    const response = await call("/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/Admin/Login?ReturnUrl=%2Fadmin");
  });

  test("7. relative redirect Location is preserved untouched", async () => {
    upstreamResponse = () =>
      new Response(null, { status: 302, headers: { location: "/Admin/Login?x=1" } });
    const response = await call("/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/Admin/Login?x=1");
  });
});

describe("P1-2 — forwarded header checks in operator trust modes", () => {
  test("8a. allowlist mode: an allowlisted inbound Host is forwarded; the upstream URL stays pinned", async () => {
    process.env.ABRIT_TRUSTED_PUBLIC_HOSTS = "portal.example.com, www.portal.example.com";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { host: "www.portal.example.com" },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("www.portal.example.com");
    expect(forwarded.get("x-forwarded-host")).toBe("www.portal.example.com");
    // The upstream ORIGIN is still the configured CMS, never the public host.
    expect(new URL(captures[0].url).host).toBe("cms.internal:5000");
  });

  test("8b. trusted-proxy mode (ABRIT_TRUST_PROXY_HEADERS=true): inbound Host and proto pass through, spoofed XFF is preserved only from the trusted edge", async () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { host: "portal.example.com", "x-forwarded-for": "203.0.113.9" },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("portal.example.com");
    expect(forwarded.get("x-forwarded-host")).toBe("portal.example.com");
    // In trusted mode the edge owns these headers; the proxy passes them on.
    expect(forwarded.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  test("8c. forged Host with userinfo/scheme tricks in the allowlist is ignored (host syntax validation)", async () => {
    process.env.ABRIT_TRUSTED_PUBLIC_HOSTS = "https://evil.attacker.test, portal.example.com:8443";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { host: "portal.example.com:8443" },
    });
    // "https://evil.attacker.test" is rejected by the bare-host syntax check;
    // "portal.example.com:8443" is valid and forwarded.
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("portal.example.com:8443");
    expect(forwarded.get("x-forwarded-host")).toBe("portal.example.com:8443");
  });
});
