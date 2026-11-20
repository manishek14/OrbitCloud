// ============================================================================
// P1-1 regression tests — customer view/edit permission separation
// (final security remediation, defect 1).
//
// The defect: PATCH /api/admin/customers/[id] was gated by the READ
// permission `customers.view`, which the service principal (Orchard CMS
// service token) legitimately holds — so a valid service token could MUTATE
// customer records (at minimum the display name).
//
// The fix: GET stays on customers.view (the CMS only reads), PATCH now
// requires the separate customers.edit permission (staff holds it, the
// service principal does NOT), and role/status changes additionally require
// settings.manage (human administrators only).
//
// Required matrix (all eight, plus DB-unchanged assertions after every 403):
//   service token: GET → 200 | PATCH name → 403 | PATCH role → 403 | PATCH status → 403
//   staff:         PATCH name → 200 | PATCH role → 403
//   admin:         PATCH name → 200 | PATCH role/status → 200
// ============================================================================

import { describe, test, expect, beforeEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Fixtures — three actors and one target customer. `signedInUser` drives the
// mocked session for the human cases; the service token cases use the header.
// ---------------------------------------------------------------------------

const now = new Date("2026-11-20T10:00:00Z");

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  mobile: string | null;
  company: string | null;
  passwordHash: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

const target: UserRow = {
  id: "u1",
  email: "ali@example.com",
  name: "علی رضایی",
  mobile: "09120000000",
  company: null,
  passwordHash: "x",
  role: "customer",
  status: "active",
  createdAt: now,
  updatedAt: now,
  lastLoginAt: null,
};
const staffActor: UserRow = {
  ...target,
  id: "u4",
  email: "staff@abrit.ir",
  name: "کارشناس",
  role: "staff",
};
const adminActor: UserRow = {
  ...target,
  id: "u3",
  email: "admin@abrit.ir",
  name: "مدیر سیستم",
  role: "admin",
};

let signedInUser: UserRow | null = null;

/** Every db.panelUser.update call is recorded here (the DB-unchanged oracle). */
const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

const fakeDb = {
  panelUser: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === target.id ? target : null,
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      updates.push(args);
      return { ...target, ...args.data };
    },
    count: async () => 1,
    findMany: async () => [target],
  },
  order: { groupBy: async () => [] },
  transaction: { groupBy: async () => [] },
  driveAccount: { findMany: async () => [] },
  subscription: { findMany: async () => [] },
};

mock.module("@/lib/db", () => ({ db: fakeDb }));
mock.module("@/lib/auth/session", () => ({
  getCurrentUser: async () => signedInUser,
  SESSION_COOKIE: "abrit_session",
}));
mock.module("@/lib/audit", () => ({ audit: async () => undefined }));
// Keep the real catalog exports (other modules in the import graph use them)
// and only stub the DB-backed reader.
const actualCatalog = await import("../src/lib/commerce/catalog");
mock.module("@/lib/commerce/catalog", () => ({
  ...actualCatalog,
  readCommercialCatalog: async () => ({ packages: [{ code: "business", nameFa: "بیزینس" }] }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

process.env.ABRIT_SERVICE_TOKEN = "p1-customers-acl-test-secret";

const SERVICE_HEADERS = {
  "content-type": "application/json",
  "x-abrit-service-token": "p1-customers-acl-test-secret",
};

const { GET, PATCH } = await import("../src/app/api/admin/customers/[id]/route");

function ctx(id = target.id) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/admin/customers/${target.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updates.length = 0;
  signedInUser = null;
  process.env.ABRIT_SERVICE_TOKEN = "p1-customers-acl-test-secret";
});

// ---------------------------------------------------------------------------

describe("P1-1 — service token (Orchard CMS): read-only on customer records", () => {
  test("GET /api/admin/customers/[id] → 200 (customers.view is intentionally granted)", async () => {
    const response = await GET(
      new Request(`http://localhost/api/admin/customers/${target.id}`, {
        headers: { "x-abrit-service-token": "p1-customers-acl-test-secret" },
      }),
      ctx(),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(target.id);
    expect(body.email).toBe(target.email);
  });

  test("PATCH name → 403 and the database is untouched (fix: edit permission required)", async () => {
    const response = await PATCH(patchRequest({ name: "Hacked By Service" }, SERVICE_HEADERS), ctx());
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(updates).toHaveLength(0); // DB unchanged
  });

  test("PATCH role → 403 and the database is untouched", async () => {
    const response = await PATCH(patchRequest({ role: "admin" }, SERVICE_HEADERS), ctx());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(updates).toHaveLength(0); // DB unchanged
  });

  test("PATCH status → 403 and the database is untouched", async () => {
    const response = await PATCH(patchRequest({ status: "disabled" }, SERVICE_HEADERS), ctx());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(updates).toHaveLength(0); // DB unchanged
  });

  test("PATCH combining name+role+status → 403, still nothing written", async () => {
    const response = await PATCH(
      patchRequest({ name: "x", role: "admin", status: "disabled" }, SERVICE_HEADERS),
      ctx(),
    );
    expect(response.status).toBe(403);
    expect(updates).toHaveLength(0);
  });
});

describe("P1-1 — staff (human operator with customers.edit)", () => {
  test("PATCH name → 200 (staff holds customers.edit; name-only edit allowed)", async () => {
    signedInUser = staffActor;
    const response = await PATCH(patchRequest({ name: "علی رضایی (ویرایش‌شده)" }), ctx());
    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.name).toBe("علی رضایی (ویرایش‌شده)");
    expect(updates[0].data.role).toBeUndefined();
    expect(updates[0].data.status).toBeUndefined();
  });

  test("PATCH role → 403 (settings.manage is admin-only) and the database is untouched", async () => {
    signedInUser = staffActor;
    const response = await PATCH(patchRequest({ role: "admin" }), ctx());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(updates).toHaveLength(0); // DB unchanged
  });

  test("PATCH status → 403 (settings.manage is admin-only) and the database is untouched", async () => {
    signedInUser = staffActor;
    const response = await PATCH(patchRequest({ status: "disabled" }), ctx());
    expect(response.status).toBe(403);
    expect(updates).toHaveLength(0); // DB unchanged
  });
});

describe("P1-1 — admin (full permissions)", () => {
  test("PATCH name → 200 with only the name written", async () => {
    signedInUser = adminActor;
    const response = await PATCH(patchRequest({ name: "علی رضایی مدیر ویرایش کرد" }), ctx());
    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].data).toEqual({ name: "علی رضایی مدیر ویرایش کرد" });
  });

  test("PATCH role/status → 200 per policy (settings.manage held; non-self target)", async () => {
    signedInUser = adminActor;
    const response = await PATCH(patchRequest({ role: "staff", status: "disabled" }), ctx());
    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.role).toBe("staff");
    expect(updates[0].data.status).toBe("disabled");
  });
});

describe("P1-1 — RBAC catalog consistency", () => {
  test("customers.edit exists in the catalog and staff set, but NOT in the service allowlist", async () => {
    const rbac = await import("../src/lib/auth/rbac");
    expect(rbac.PERMISSIONS.some((p) => p.key === "customers.edit")).toBe(true);
    expect(rbac.hasPermission("staff", "customers.edit")).toBe(true);
    expect(rbac.hasPermission("admin", "customers.edit")).toBe(true);
    expect(rbac.hasPermission("customer", "customers.edit")).toBe(false);
    // The exploit window: view without edit must be impossible for the service.
    expect(rbac.SERVICE_PRINCIPAL_PERMISSIONS.has("customers.view")).toBe(true);
    expect(rbac.SERVICE_PRINCIPAL_PERMISSIONS.has("customers.edit")).toBe(false);
  });

  test("unauthenticated PATCH → 401 (no session, no token)", async () => {
    const response = await PATCH(patchRequest({ name: "anon" }), ctx());
    expect(response.status).toBe(401);
    expect(updates).toHaveLength(0);
  });
});
