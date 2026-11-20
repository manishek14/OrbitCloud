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

  test("8b. trusted-proxy mode + allowlist: Host forwarded, XFP from the edge ACTUALLY asserted, XFF passes on", async () => {
    // FSR-6 (fix for "test title without assertion"): the x-forwarded-proto
    // value is now genuinely controlled. Trusted-proxy mode is also no longer
    // blind trust — the public Host is only honored because it is explicitly
    // allowlisted (without an allowlist the target host is used, see 8d).
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    process.env.ABRIT_TRUSTED_PUBLIC_HOSTS = "portal.example.com";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: {
        host: "portal.example.com",
        "x-forwarded-for": "203.0.113.9",
        "x-forwarded-proto": "https",
      },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("portal.example.com");
    expect(forwarded.get("x-forwarded-host")).toBe("portal.example.com");
    expect(forwarded.get("x-forwarded-proto")).toBe("https"); // asserted, not just titled
    // In trusted mode the edge owns these headers; the proxy passes them on.
    expect(forwarded.get("x-forwarded-for")).toBe("203.0.113.9");
  });

  test("8d. trusted-proxy mode WITHOUT an allowlist is NOT blind trust: the inbound Host is not forwarded (FSR-6)", async () => {
    // Enabling ABRIT_TRUST_PROXY_HEADERS=true alone must not let a client
    // that reaches the portal directly poison the CMS's public Host.
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    delete process.env.ABRIT_TRUSTED_PUBLIC_HOSTS;
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { host: "evil.direct-access.test" },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("cms.internal:5000");
    expect(forwarded.get("x-forwarded-host")).toBe("cms.internal:5000");
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

// ============================================================================
// FSR-6 — complete forwarded-header control (final-integration remediation).
//
// The P1-2 pass covered Host/XFH/XFP/XFF/x-real-ip/Forwarded in UNTRUSTED
// mode, but left gaps that are closed here and asserted below:
//   • x-forwarded-port was never touched (forwarded as-is in every mode);
//   • trusted mode passed x-forwarded-proto through blindly (any value);
//   • trusted mode accepted ANY inbound Host without an allowlist (8d above);
//   • trusted mode forwarded x-real-ip without validating it as an IP;
//   • the RFC 7239 Forwarded header was only stripped in untrusted mode.
// ============================================================================
describe("FSR-6 — complete forwarded-header control", () => {
  test("f1. x-forwarded-port is stripped in untrusted mode (previously forwarded untouched)", async () => {
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-forwarded-port": "8443" },
    });
    expect(captures[0].headers.get("x-forwarded-port")).toBeNull();
  });

  test("f2. trusted mode: a VALID x-real-ip passes; an invalid one is stripped", async () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-real-ip": "203.0.113.10" },
    });
    expect(captures[0].headers.get("x-real-ip")).toBe("203.0.113.10");

    await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-real-ip": "evil.attacker.test" },
    });
    expect(captures[1].headers.get("x-real-ip")).toBeNull();
  });

  test("f3. trusted mode: x-forwarded-port passes only as a bare numeric port", async () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-forwarded-port": "443" },
    });
    expect(captures[0].headers.get("x-forwarded-port")).toBe("443");

    for (const bad of ["99999", "0", "8443;evil", "https"]) {
      await call("/admin", {
        routeSegments: ["admin"],
        headers: { "x-forwarded-port": bad },
      });
      expect(captures[captures.length - 1].headers.get("x-forwarded-port")).toBeNull();
    }
  });

  test("f4. x-forwarded-proto is validated in trusted mode: anything but http/https is replaced by the target scheme", async () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-forwarded-proto": "gopher" },
    });
    expect(captures[0].headers.get("x-forwarded-proto")).toBe("http"); // target scheme, never the spoofed value
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-forwarded-proto": "HTTPS" },
    });
    expect(captures[1].headers.get("x-forwarded-proto")).toBe("https"); // case-insensitive VALID value honored
  });

  test("f5. the RFC 7239 Forwarded header is stripped in BOTH modes", async () => {
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { forwarded: "for=9.9.9.9;host=evil.attacker.test;proto=https" },
    });
    expect(captures[0].headers.get("forwarded")).toBeNull();

    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { forwarded: "for=9.9.9.9;host=evil.attacker.test;proto=https" },
    });
    expect(captures[1].headers.get("forwarded")).toBeNull();
  });

  test("f6. a spoofed x-forwarded-host is ALWAYS overwritten — in every mode (it is never a trust input)", async () => {
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-forwarded-host": "evil.attacker.test" },
    });
    expect(captures[0].headers.get("x-forwarded-host")).toBe("cms.internal:5000");

    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-forwarded-host": "evil.attacker.test", host: "also-evil.test" },
    });
    expect(captures[1].headers.get("x-forwarded-host")).toBe("cms.internal:5000");
  });
});

// ============================================================================
// FSR-6 — redirect hardening: network-path references, backslashes and
// encoded tricks must NEVER survive as a Location, not even when the
// upstream's absolute URL points at the REAL CMS origin (the dangerous
// "http://cms:5000//evil.test/x" re-serialization trap).
// ============================================================================
describe("FSR-6 — redirect hardening (network-path / backslash / encoded)", () => {
  function redirectCase(name: string, location: string, expected: string) {
    test(name, async () => {
      upstreamResponse = () => new Response(null, { status: 302, headers: { location } });
      const response = await call("/admin", { routeSegments: ["admin"] });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(expected);
    });
  }

  redirectCase("r1. scheme-relative //evil.example/path → \"/\"", "//evil.example/phish", "/");
  redirectCase("r2. backslash \\\\evil.example\\path → \"/\"", "\\\\evil.example\\path", "/");
  redirectCase("r3. mixed /\\evil.example/path → \"/\"", "/\\evil.example/path", "/");
  redirectCase(
    "r4. a path containing a backslash is NORMALIZED (/foo\\bar → /foo/bar), never kept raw",
    "/foo\\bar",
    "/foo/bar",
  );
  redirectCase(
    "r5. absolute CMS-origin Location with a dangerous // path → \"/\" (re-serialization trap)",
    "http://cms.internal:5000//evil.example/x",
    "/",
  );
  redirectCase(
    "r6. encoded slashes stay a safe relative path (browsers keep %2F encoded)",
    "/%2F%2Fevil.example",
    "/%2F%2Fevil.example",
  );
  redirectCase(
    "r7. absolute CMS-origin Location with an encoded-backslash path → normalized safely",
    "http://cms.internal:5000/x%5C%5Cevil.example",
    "/x%5C%5Cevil.example",
  );

  test("r8. allowlisted public host redirects are trusted and relativized (normal operator mode)", async () => {
    process.env.ABRIT_TRUSTED_PUBLIC_HOSTS = "portal.example.com";
    upstreamResponse = () =>
      new Response(null, { status: 302, headers: { location: "https://portal.example.com/Admin/Next?x=1" } });
    const response = await call("/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/Admin/Next?x=1");
  });

  test("r9. a spoofed x-forwarded-proto never affects the redirect decision (or the forwarded header)", async () => {
    upstreamResponse = () =>
      new Response(null, { status: 302, headers: { location: "http://evil.attacker.test/phish" } });
    const response = await call("/admin", {
      routeSegments: ["admin"],
      headers: { "x-forwarded-proto": "gopher", host: "evil.attacker.test" },
    });
    expect(response.headers.get("location")).toBe("/"); // dropped — decision is target-based only
    expect(captures[0].headers.get("x-forwarded-proto")).toBe("http"); // spoofed proto replaced upstream too
  });

  test("r10. normal proxy behavior preserved (untrusted): plain 200 passthrough keeps Host/XFH/XFP contract", async () => {
    const response = await call("/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(200);
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("cms.internal:5000");
    expect(forwarded.get("x-forwarded-host")).toBe("cms.internal:5000");
    expect(forwarded.get("x-forwarded-proto")).toBe("http");
    expect(forwarded.get("x-forwarded-for")).toBeNull();
    expect(forwarded.get("x-real-ip")).toBeNull();
    expect(forwarded.get("forwarded")).toBeNull();
  });

  test("r11. normal proxy behavior preserved (trusted + allowlist): the documented edge contract is honored", async () => {
    process.env.ABRIT_TRUST_PROXY_HEADERS = "true";
    process.env.ABRIT_TRUSTED_PUBLIC_HOSTS = "portal.example.com";
    const response = await call("/admin", {
      routeSegments: ["admin"],
      headers: {
        host: "portal.example.com",
        "x-forwarded-proto": "https",
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "203.0.113.9",
        "x-forwarded-port": "443",
      },
    });
    expect(response.status).toBe(200);
    const forwarded = captures[0].headers;
    expect(forwarded.get("host")).toBe("portal.example.com");
    expect(forwarded.get("x-forwarded-host")).toBe("portal.example.com");
    expect(forwarded.get("x-forwarded-proto")).toBe("https");
    expect(forwarded.get("x-real-ip")).toBe("203.0.113.9");
    expect(forwarded.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(forwarded.get("x-forwarded-port")).toBe("443");
  });
});
