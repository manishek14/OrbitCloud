// ============================================================================
// Service-principal permission scope tests (full-remediation audit §2.3).
//
// The ABRIT_SERVICE_TOKEN authenticates the Orchard CMS server-to-server.
// Its documented contract — "read access plus the explicitly listed
// actions" — is now ENFORCED through SERVICE_PRINCIPAL_PERMISSIONS:
//   allowed:  dashboard, customers, orders/payments, subscriptions, drive,
//             tickets, reports, pricing catalog;
//   denied:   users, settings, maintenance/cleanup, audit, content, media.
// A valid service token must therefore get 403 on administrative endpoints
// (it used to be an implicit FULL administrator — privilege escalation
// beyond the documented contract).
// ============================================================================

import { describe, test, expect, beforeEach } from "bun:test";
import { mock } from "bun:test";

// ---------------------------------------------------------------------------
// Shared fakes — guards run BEFORE database access, so most endpoints only
// need the db import to resolve; the dashboard endpoint needs real answers.
// ---------------------------------------------------------------------------

const fakeDb = {
  panelUser: {
    count: async () => 10,
    findMany: async () => [],
  },
  subscription: { count: async () => 2, findMany: async () => [] },
  order: { count: async () => 4, findMany: async () => [] },
  transaction: {
    aggregate: async () => ({ _sum: { amountToman: 1000 } }),
    findMany: async () => [],
  },
  driveAccount: { count: async () => 1, findMany: async () => [{ status: "active" }] },
  ticket: { count: async () => 0 },
  auditLog: { findMany: async () => [] },
  loginAttempt: { deleteMany: async () => ({ count: 0 }) },
  otpGrant: { deleteMany: async () => ({ count: 0 }) },
  recoveryGrant: { deleteMany: async () => ({ count: 0 }) },
  session: { deleteMany: async () => ({ count: 0 }) },
  smsOutbox: { deleteMany: async () => ({ count: 0 }) },
  setting: { findMany: async () => [] },
  pricingPlan: { findMany: async () => [] },
  pricingContract: { findMany: async () => [] },
};

mock.module("@/lib/db", () => ({ db: fakeDb }));
// Keep every named export of the real catalog module (QUOTE_LIMITS etc. are
// imported by other modules in the route import graph) and only replace the
// DB-backed reader.
const actualCatalog = await import("../src/lib/commerce/catalog");
mock.module("@/lib/commerce/catalog", () => ({
  ...actualCatalog,
  readCommercialCatalog: async () => ({ packages: [{ code: "business", nameFa: "بیزینس" }] }),
}));
mock.module("@/lib/audit", () => ({ audit: async () => undefined }));
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

process.env.ABRIT_SERVICE_TOKEN = "service-scope-test-secret-1234";
process.env.ABRIT_PAYMENTS_MOCK_ENABLED = "false";

const serviceHeaders = { "x-abrit-service-token": "service-scope-test-secret-1234" };

const { GET: getCustomers } = await import("../src/app/api/admin/customers/route");
const { GET: getDashboard } = await import("../src/app/api/admin/dashboard/route");
const { GET: getUsers } = await import("../src/app/api/admin/users/route");
const { GET: getSettings } = await import("../src/app/api/admin/settings/route");
const { GET: getAudit } = await import("../src/app/api/admin/audit/route");
const { POST: cleanup } = await import("../src/app/api/admin/maintenance/cleanup/route");

function get(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: serviceHeaders });
}

beforeEach(() => {
  // reset env in case another suite in this worker mutated it
  process.env.ABRIT_SERVICE_TOKEN = "service-scope-test-secret-1234";
});

describe("service token — allowed surface (what the Orchard CMS actually calls)", () => {
  test("customers list → 200", async () => {
    const response = await getCustomers(get("/api/admin/customers"));
    expect(response.status).toBe(200);
  });

  test("dashboard aggregates → 200 with real totals shape", async () => {
    const response = await getDashboard(get("/api/admin/dashboard"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totals.customers).toBe(10);
    expect(Array.isArray(body.recentOrders)).toBe(true);
    expect(Array.isArray(body.recentTransactions)).toBe(true);
    expect(Array.isArray(body.recentActivity)).toBe(true);
  });
});

describe("service token — denied administrative surface (enforced, not just documented)", () => {
  test("users administration → 403", async () => {
    const response = await getUsers(get("/api/admin/users"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  test("settings administration → 403", async () => {
    const response = await getSettings(get("/api/admin/settings"));
    expect(response.status).toBe(403);
  });

  test("maintenance/cleanup (purges security tables) → 403", async () => {
    const response = await cleanup(
      new Request("http://localhost/api/admin/maintenance/cleanup", {
        method: "POST",
        headers: { ...serviceHeaders, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });

  test("audit trail → 403", async () => {
    const response = await getAudit(get("/api/admin/audit"));
    expect(response.status).toBe(403);
  });
});

describe("service token — unit-level permission matrix", () => {
  test("SERVICE_PRINCIPAL_PERMISSIONS matches the documented CMS surface", async () => {
    const { SERVICE_PRINCIPAL_PERMISSIONS } = await import("../src/lib/auth/rbac");
    expect([...SERVICE_PRINCIPAL_PERMISSIONS].sort()).toEqual(
      [
        "customers.view",
        "dashboard.view",
        "drive.manage",
        "orders.view",
        "pricing.manage",
        "reports.view",
        "subscriptions.view",
        "tickets.manage",
      ].sort(),
    );
    // Explicitly NOT part of the service surface:
    for (const denied of ["users.manage", "settings.manage", "content.manage", "media.manage", "audit.view"]) {
      expect(SERVICE_PRINCIPAL_PERMISSIONS.has(denied)).toBe(false);
    }
  });
});
