import { expect, mock, test } from "bun:test";

mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

test("pricing mutations reject missing service authentication", async () => {
  process.env.ABRIT_SERVICE_TOKEN = "local-pricing-test-secret";
  const { POST } = await import("../src/app/api/admin/pricing/[kind]/route");
  const response = await POST(new Request("http://localhost/api/admin/pricing/plans", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: {} }),
  }), { params: Promise.resolve({ kind: "plans" }) });
  expect(response.status).toBe(401);
});

test("valid service token reaches server-side validation", async () => {
  process.env.ABRIT_SERVICE_TOKEN = "local-pricing-test-secret";
  const { POST } = await import("../src/app/api/admin/pricing/[kind]/route");
  const response = await POST(new Request("http://localhost/api/admin/pricing/plans", {
    method: "POST", headers: { "content-type": "application/json", "x-abrit-service-token": "local-pricing-test-secret" },
    body: JSON.stringify({ payload: {} }),
  }), { params: Promise.resolve({ kind: "plans" }) });
  expect(response.status).toBe(400);
});

test("admin catalog read rejects unauthenticated access", async () => {
  process.env.ABRIT_SERVICE_TOKEN = "local-pricing-test-secret";
  const { GET } = await import("../src/app/api/admin/pricing/[kind]/route");
  const response = await GET(new Request("http://localhost/api/admin/pricing/contracts"), { params: Promise.resolve({ kind: "contracts" }) });
  expect(response.status).toBe(401);
});
