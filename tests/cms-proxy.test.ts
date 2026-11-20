// ============================================================================
// CMS reverse proxy security tests (full-remediation audit §2.1).
//
// The proxy (src/app/[...path]/route.ts) forwards unmatched paths to the
// Orchard CMS. These tests pin the security contract:
//   • the upstream ORIGIN can never deviate from ORCHARD_PROXY_TARGET —
//     "//evil.com", "\evil.com" and "%2F%2Fevil.com" path tricks, and
//     dot-segments, all stay literal (encoded) path segments of the target;
//   • only standard web methods are forwarded (405 otherwise);
//   • portal-internal credentials (x-abrit-service-token, authorization,
//     abrit_session cookie) are never forwarded to the CMS;
//   • hop-by-hop headers are stripped in both directions;
//   • cross-origin redirect Locations are dropped (open-redirect hardening);
//   • oversized bodies are rejected with 413; upstream failures produce a
//     controlled 502/504 (branded HTML for browser navigations).
//
// globalThis.fetch is mocked — no network access happens.
// ============================================================================

import { describe, test, expect, beforeAll, afterAll } from "bun:test";

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
    // Actually consume a streamed request body so the proxy's byte-cap
    // transform runs (the 413 path depends on the stream being read).
    if (init?.body != null) {
      await new Response(init.body as ReadableStream<Uint8Array>).arrayBuffer();
    }
    return upstreamResponse();
  }) as typeof fetch;
}

// Small bodies only: the proxy body cap is lowered via env before import.
process.env.ORCHARD_PROXY_TARGET = "http://cms.internal:5000";
process.env.ABRIT_PROXY_MAX_BODY_BYTES = "2048";

const { GET } = await import("../src/app/[...path]/route");

function call(
  method: string,
  path: string,
  init: RequestInit & { routeSegments?: string[] } = {},
): Promise<Response> {
  const { routeSegments, ...requestInit } = init;
  const request = new Request(`http://portal.test${path}`, { method, ...requestInit });
  const context = { params: Promise.resolve({ path: routeSegments ?? path.split("/").slice(1) }) };
  // Every export is the same handler; it validates request.method itself.
  return (GET as (req: Request, ctx: unknown) => Promise<Response>)(request, context);
}

beforeAll(() => {
  installFetchMock();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  delete process.env.ORCHARD_PROXY_TARGET;
  delete process.env.ABRIT_PROXY_MAX_BODY_BYTES;
});

describe("CMS proxy — origin pinning (SSRF)", () => {
  test("normal path proxies to the configured target", async () => {
    captures = [];
    const response = await call("GET", "/admin/login", { routeSegments: ["admin", "login"] });
    expect(response.status).toBe(200);
    expect(captures[0].url).toBe("http://cms.internal:5000/admin/login");
  });

  test("protocol-relative '//evil.com' segments stay inside the target origin", async () => {
    captures = [];
    // Decoded catch-all segments as Next would deliver them for //evil.com/x
    await call("GET", "//evil.com/x", { routeSegments: ["", "", "evil.com", "x"] });
    expect(captures[0].url).toBe("http://cms.internal:5000/evil.com/x");
    expect(new URL(captures[0].url).host).toBe("cms.internal:5000");
  });

  test("backslash segments are percent-encoded, never parsed as authority", async () => {
    captures = [];
    await call("GET", "/\\evil.com/x", { routeSegments: ["\\evil.com", "x"] });
    const upstream = new URL(captures[0].url);
    expect(upstream.host).toBe("cms.internal:5000");
    expect(upstream.pathname).toBe("/%5Cevil.com/x");
  });

  test("decoded '%2F%2Fevil.com' becomes an encoded path segment", async () => {
    captures = [];
    // A request to /admin/%2F%2Fevil.com decodes to a segment "//evil.com"
    await call("GET", "/admin/%2F%2Fevil.com", { routeSegments: ["admin", "//evil.com"] });
    const upstream = new URL(captures[0].url);
    expect(upstream.host).toBe("cms.internal:5000");
    expect(upstream.pathname).toBe("/admin/%2F%2Fevil.com");
  });

  test("dot-segments cannot escape the target path", async () => {
    captures = [];
    await call("GET", "/../../etc/passwd", { routeSegments: ["..", "..", "etc", "passwd"] });
    const upstream = new URL(captures[0].url);
    expect(upstream.host).toBe("cms.internal:5000");
    expect(upstream.pathname).not.toContain("..");
  });

  test("external host in the incoming URL never changes the upstream", async () => {
    captures = [];
    // Even if the Host header were poisoned, the upstream origin is pinned.
    const request = new Request("http://evil.attacker.test/admin", {
      method: "GET",
      headers: { host: "evil.attacker.test" },
    });
    await (GET as unknown as (req: Request, ctx: unknown) => Promise<Response>)(request, {
      params: Promise.resolve({ path: ["admin"] }),
    });
    expect(new URL(captures[0].url).host).toBe("cms.internal:5000");
  });

  test("unusual query strings pass through without touching the origin", async () => {
    captures = [];
    await call("GET", "/admin/users?next=//evil.com&x=%2F%2F", { routeSegments: ["admin", "users"] });
    const upstream = new URL(captures[0].url);
    expect(upstream.host).toBe("cms.internal:5000");
    expect(upstream.search).toContain("next=");
  });
});

describe("CMS proxy — method allowlist", () => {
  test("OPTIONS is refused without contacting the CMS", async () => {
    captures = [];
    const response = await call("OPTIONS", "/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(405);
    expect(captures.length).toBe(0);
  });

  test("non-standard methods (MKCOL/WebDAV) are refused without contacting the CMS", async () => {
    captures = [];
    const response = await call("MKCOL", "/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(405);
    expect(captures.length).toBe(0);
  });

  test("POST is forwarded", async () => {
    captures = [];
    const response = await call("POST", "/Login", {
      routeSegments: ["Login"],
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "user=a",
    });
    expect(response.status).toBe(200);
    expect(captures[0].method).toBe("POST");
  });
});

describe("CMS proxy — credential & header hygiene", () => {
  test("service token, authorization and the portal session cookie are not forwarded", async () => {
    captures = [];
    await call("GET", "/admin", {
      routeSegments: ["admin"],
      headers: {
        "x-abrit-service-token": "super-secret-service-token-value",
        authorization: "Bearer super-secret-service-token-value",
        cookie: "abrit_session=PORTAL_SESSION_SECRET; orchard_auth=CMS_VALUE",
      },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("x-abrit-service-token")).toBeNull();
    expect(forwarded.get("authorization")).toBeNull();
    // Only the CMS cookie survives.
    expect(forwarded.get("cookie")).toBe("orchard_auth=CMS_VALUE");
  });

  test("hop-by-hop request headers are stripped", async () => {
    captures = [];
    await call("GET", "/admin", {
      routeSegments: ["admin"],
      headers: { connection: "keep-alive", "transfer-encoding": "chunked", upgrade: "websocket" },
    });
    const forwarded = captures[0].headers;
    expect(forwarded.get("connection")).toBeNull();
    expect(forwarded.get("transfer-encoding")).toBeNull();
    expect(forwarded.get("upgrade")).toBeNull();
  });
});

describe("CMS proxy — response handling", () => {
  test("same-origin absolute redirect Location is rewritten to a relative path", async () => {
    upstreamResponse = () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://cms.internal:5000/Admin/Login?ReturnUrl=%2Fadmin" },
      });
    const response = await call("GET", "/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/Admin/Login?ReturnUrl=%2Fadmin");
  });

  test("cross-origin redirect Location is dropped (open-redirect hardening)", async () => {
    upstreamResponse = () =>
      new Response(null, { status: 302, headers: { location: "http://evil.attacker.test/phish" } });
    const response = await call("GET", "/admin", { routeSegments: ["admin"] });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  test("hop-by-hop response headers are stripped and set-cookie survives", async () => {
    upstreamResponse = () => {
      const r = new Response("ok", {
        status: 200,
        headers: { connection: "keep-alive", "x-test": "1" },
      });
      r.headers.append("set-cookie", "a=1; Path=/");
      r.headers.append("set-cookie", "b=2; Path=/");
      return r;
    };
    const response = await call("GET", "/admin", { routeSegments: ["admin"] });
    expect(response.headers.get("connection")).toBeNull();
    expect(response.headers.get("x-test")).toBe("1");
    expect(response.headers.getSetCookie().length).toBe(2);
  });
});

describe("CMS proxy — failure modes", () => {
  test("body over the configured cap is rejected with 413", async () => {
    const response = await call("POST", "/admin/media", {
      routeSegments: ["admin", "media"],
      headers: { "content-type": "application/octet-stream" },
      body: "x".repeat(4096), // cap is 2048 bytes (env above)
    });
    expect(response.status).toBe(413);
  });

  test("CMS connection failure → branded 502 for browser navigations", async () => {
    upstreamResponse = () => {
      throw new Error("ECONNREFUSED");
    };
    const response = await call("GET", "/admin", {
      routeSegments: ["admin"],
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("CMS_UNAVAILABLE");
  });

  test("CMS connection failure → plain 502 for API/asset requests", async () => {
    upstreamResponse = () => {
      throw new Error("ECONNREFUSED");
    };
    const response = await call("GET", "/admin/api/contents", { routeSegments: ["admin", "api", "contents"] });
    expect(response.status).toBe(502);
    expect((response.headers.get("content-type") ?? "")).not.toContain("text/html");
    expect(await response.text()).toBe("CMS is unavailable");
  });

  test("upstream timeout → 504", async () => {
    upstreamResponse = () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    };
    const response = await call("GET", "/admin", {
      routeSegments: ["admin"],
      headers: { accept: "text/html" },
    });
    expect(response.status).toBe(504);
    expect(await response.text()).toContain("CMS_TIMEOUT");
  });

  test("upstream 404 passes through unchanged", async () => {
    upstreamResponse = () => new Response("Not Found", { status: 404 });
    const response = await call("GET", "/nope", { routeSegments: ["nope"] });
    expect(response.status).toBe(404);
  });
});
