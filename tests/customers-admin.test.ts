// ============================================================================
// Admin customers API tests (full-remediation audit §3.1–§3.2).
//
//   • GET /api/admin/customers returns the paginated envelope
//     { items, page, pageSize, total, totalPages } with server-side caps;
//   • aggregates are computed with BATCHED queries — one groupBy/findMany
//     per aggregate per page regardless of the number of customers (the
//     previous implementation ran 4 queries per user: an N+1 pattern);
//   • search is case-insensitive (mode:"insensitive", not .toLowerCase());
//   • GET /api/admin/customers/{id} exists (Orchard's customer-detail page
//     calls it; it previously 404'd because only PATCH was exported);
//   • unauthenticated callers get 401.
// ============================================================================

import { describe, test, expect, beforeEach } from "bun:test";
import { mock } from "bun:test";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date("2026-11-20T10:00:00Z");

function user(id: string, email: string, name: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    email,
    name,
    mobile: "09120000000",
    company: null,
    role: "customer",
    status: "active",
    createdAt: now,
    lastLoginAt: null,
    ...extra,
  };
}

const users = [
  user("u1", "Ali@Example.com", "علی رضایی"),
  user("u2", "sara@example.com", "سارا کریمی"),
  user("u3", "admin@abrit.ir", "مدیر سیستم", { role: "admin" }),
  user("u4", "staff@abrit.ir", "کارشناس", { role: "staff" }),
  user("u5", "mani@example.com", "مانی شکفته"),
];

const ordersByUser: Record<string, number> = { u1: 3, u2: 1, u5: 2 };
const paidByUser: Record<string, number> = { u1: 1_500_000, u5: 250_000 };
const driveUsers = new Set(["u1"]);
const subsByUser: Record<string, string> = { u1: "business" };

let findManyCalls: Array<Record<string, unknown>> = [];
let orderGroupByCalls: Array<Record<string, unknown>> = [];
let txGroupByCalls: Array<Record<string, unknown>> = [];
let driveFindManyCalls: Array<Record<string, unknown>> = [];
let subFindManyCalls: Array<Record<string, unknown>> = [];

const fakeDb = {
  panelUser: {
    count: async ({ where }: { where?: Record<string, unknown> }) => {
      // crude filter emulation good enough for the tests
      let rows = users;
      const or = (where?.OR ?? null) as Array<Record<string, { contains: string }>> | null;
      if (or) {
        const q = or[0].email.contains;
        rows = rows.filter(
          (u) => u.email.includes(q) || (u.name ?? "").includes(q) || (u.mobile ?? "").includes(q),
        );
      }
      if (where && "role" in where) rows = rows.filter((u) => u.role === where.role);
      return rows.length;
    },
    findMany: async (args: Record<string, unknown>) => {
      findManyCalls.push(args);
      const skip = (args.skip as number) ?? 0;
      const take = (args.take as number) ?? users.length;
      return users.slice(skip, skip + take);
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      users.find((u) => u.id === where.id) ?? null,
  },
  order: {
    groupBy: async (args: Record<string, unknown>) => {
      orderGroupByCalls.push(args);
      const ids = ((args.where as { userId: { in: string[] } }).userId.in) ?? [];
      return ids
        .filter((id) => ordersByUser[id] !== undefined)
        .map((id) => ({ userId: id, _count: { _all: ordersByUser[id] } }));
    },
  },
  transaction: {
    groupBy: async (args: Record<string, unknown>) => {
      txGroupByCalls.push(args);
      const ids = ((args.where as { userId: { in: string[] } }).userId.in) ?? [];
      return ids
        .filter((id) => paidByUser[id] !== undefined)
        .map((id) => ({ userId: id, _sum: { amountToman: paidByUser[id] } }));
    },
  },
  driveAccount: {
    findMany: async (args: Record<string, unknown>) => {
      driveFindManyCalls.push(args);
      const ids = ((args.where as { panelUserId: { in: string[] } }).panelUserId.in) ?? [];
      return ids.filter((id) => driveUsers.has(id)).map((id) => ({ panelUserId: id }));
    },
  },
  subscription: {
    findMany: async (args: Record<string, unknown>) => {
      subFindManyCalls.push(args);
      const ids = ((args.where as { userId: { in: string[] } }).userId.in) ?? [];
      return ids
        .filter((id) => subsByUser[id] !== undefined)
        .map((id) => ({ userId: id, packageCode: subsByUser[id] }));
    },
  },
};

mock.module("@/lib/db", () => ({ db: fakeDb }));
mock.module("@/lib/commerce/catalog", () => ({
  readCommercialCatalog: async () => ({ packages: [{ code: "business", nameFa: "بیزینس" }] }),
}));
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

process.env.ABRIT_SERVICE_TOKEN = "customers-admin-test-secret";

const { GET: listCustomers } = await import("../src/app/api/admin/customers/route");
const { GET: getCustomer } = await import("../src/app/api/admin/customers/[id]/route");

function serviceRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { "x-abrit-service-token": "customers-admin-test-secret" },
  });
}

beforeEach(() => {
  findManyCalls = [];
  orderGroupByCalls = [];
  txGroupByCalls = [];
  driveFindManyCalls = [];
  subFindManyCalls = [];
});

describe("GET /api/admin/customers", () => {
  test("unauthenticated → 401", async () => {
    const response = await listCustomers(new Request("http://localhost/api/admin/customers"));
    expect(response.status).toBe(401);
  });

  test("returns the pagination envelope with real aggregates", async () => {
    const response = await listCustomers(serviceRequest("/api/admin/customers"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(5);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBe(5);
    expect(body.totalPages).toBe(1);

    const ali = body.items.find((i: { id: string }) => i.id === "u1");
    expect(ali.orderCount).toBe(3);
    expect(ali.paidTotalToman).toBe(1_500_000);
    expect(ali.hasDrive).toBe(true);
    expect(ali.activeSubscription).toBe("بیزینس"); // Persian name resolved via catalog
    const sara = body.items.find((i: { id: string }) => i.id === "u2");
    expect(sara.hasDrive).toBe(false);
    expect(sara.activeSubscription).toBeNull();
  });

  test("N+1 eliminated: exactly ONE batched query per aggregate for 5 users", async () => {
    await listCustomers(serviceRequest("/api/admin/customers"));
    expect(orderGroupByCalls.length).toBe(1);
    expect(txGroupByCalls.length).toBe(1);
    expect(driveFindManyCalls.length).toBe(1);
    expect(subFindManyCalls.length).toBe(1);
    // The batched calls must cover ALL users in one shot.
    const orderIds = (orderGroupByCalls[0].where as { userId: { in: string[] } }).userId.in;
    expect(orderIds).toHaveLength(5);
  });

  test("page & pageSize are applied and capped server-side", async () => {
    const response = await listCustomers(serviceRequest("/api/admin/customers?page=2&pageSize=2"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(5);
    expect(body.totalPages).toBe(3);
    expect(findManyCalls[0].skip).toBe(2);
    expect(findManyCalls[0].take).toBe(2);

    const capped = await listCustomers(serviceRequest("/api/admin/customers?pageSize=99999"));
    expect((findManyCalls[1].take as number) <= 200).toBe(true);
  });

  test("sort is whitelisted (bogus value falls back to newest)", async () => {
    await listCustomers(serviceRequest("/api/admin/customers?sort=; DROP TABLE users"));
    expect(findManyCalls[0].orderBy).toEqual({ createdAt: "desc" });
    await listCustomers(serviceRequest("/api/admin/customers?sort=email"));
    expect(findManyCalls[1].orderBy).toEqual({ email: "asc" });
  });

  test("search uses case-insensitive contains without mangling the query", async () => {
    await listCustomers(serviceRequest("/api/admin/customers?query=Ali"));
    const where = findManyCalls[0].where as {
      OR: Array<{ email: { contains: string; mode: string } }>;
    };
    expect(where.OR[0].email.contains).toBe("Ali"); // NOT lowercased
    expect(where.OR[0].email.mode).toBe("insensitive");
  });

  test("role/status filters are whitelisted", async () => {
    await listCustomers(serviceRequest("/api/admin/customers?role=admin&status=active"));
    const where = findManyCalls[0].where as Record<string, unknown>;
    expect(where.role).toBe("admin");
    expect(where.status).toBe("active");
    await listCustomers(serviceRequest("/api/admin/customers?role=superadmin"));
    const where2 = findManyCalls[1].where as Record<string, unknown>;
    expect(where2.role).toBeUndefined();
  });
});

describe("GET /api/admin/customers/{id}", () => {
  test("unknown id → 404", async () => {
    const response = await getCustomer(serviceRequest("/api/admin/customers/nope"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("invalid id → 400", async () => {
    const response = await getCustomer(serviceRequest("/api/admin/customers/x".repeat(100)), {
      params: Promise.resolve({ id: "x".repeat(100) }),
    });
    expect(response.status).toBe(400);
  });

  test("existing id → full AdminCustomerDTO with real aggregates", async () => {
    const response = await getCustomer(serviceRequest("/api/admin/customers/u1"), {
      params: Promise.resolve({ id: "u1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("u1");
    expect(body.email).toBe("Ali@Example.com");
    expect(body.orderCount).toBe(3);
    expect(body.paidTotalToman).toBe(1_500_000);
    expect(body.hasDrive).toBe(true);
    expect(body.activeSubscription).toBe("بیزینس");
  });

  test("unauthenticated → 401", async () => {
    const response = await getCustomer(new Request("http://localhost/api/admin/customers/u1"), {
      params: Promise.resolve({ id: "u1" }),
    });
    expect(response.status).toBe(401);
  });
});
