// ============================================================================
// Mock payment callback — server-controlled redirect origin
// (final-integration remediation FSR-7 + final-audit-closure FSR-10).
//
// The defect: POST /api/payments/callback built its 303 Location from the
// REQUEST HEADERS (x-forwarded-proto / x-forwarded-host / host) via
// baseUrl(request) — all plain client-settable values, so the internal
// dev/test gateway could be made to redirect the browser to an
// attacker-chosen absolute origin.
//
// The fix: the route now emits a 303 with a RELATIVE, server-controlled
// Location (same pattern as the real-gateway callback), validated by
// src/lib/payments/redirect-target.ts. These tests run the REAL route with
// the REAL orderService.finalizePayment / finalizeSuccess (only @/lib/db and
// @/lib/audit are mocked) so the actual runtime path is exercised, not a
// stub of it.
//
// FSR-10 (final-audit closure): the previous version's "success outcome"
// test actually POSTed outcome=failure — a regression that made the success
// path untested. This version runs the REAL success flow end-to-end: the
// in-memory database supports the full finalizeSuccess chain ($transaction →
// transaction claim → order claim → invoice.create → fulfill → subscription
// + service rows), and every test asserts on the writes it observed, so a
// test can no longer claim "success" while exercising another path.
//
// Required matrix (closure task §3):
//   • SUCCESS + normal headers       → 303 + valid relative Location,
//     finalizeSuccess really executed (tx → succeeded, order → paid,
//     invoice + subscription + service rows created)
//   • FAILURE + normal headers       → 303 + valid relative Location,
//     failure path really executed (tx → failed)
//   • SUCCESS + forged Host / XFH / XFP → destination unchanged
//   • FAILURE + combined forged headers → destination unchanged
//   • redirect carrying "//" or a backslash → rejected (collapsed to "/")
//   • the mock gateway stays disabled in production (403 MOCK_DISABLED) for
//     every outcome, including success
// ============================================================================

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { createHash } from "node:crypto";

const VERIFY_TOKEN = "mock-gateway-token";
const REF = "MOCK-REF-1";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// In-memory database. Supports BOTH terminal paths of the REAL service:
//   • finalizeSuccess: $transaction → transaction.updateMany (claim) →
//     order.updateMany (claim) → order.findUniqueOrThrow → invoice.create →
//     fulfill() → subscription.create + service.create → (commit) →
//     order.findUnique → audit (mocked) → postCommitFulfillment (returns
//     early: panelUser.findUnique → null)
//   • failure/cancel: transaction.update (single row write) → audit
// Every write is RECORDED so tests can assert the real path was taken.
// ---------------------------------------------------------------------------
const ONE_ITEM_JSON = JSON.stringify([
  {
    input: { packageCode: "starter", months: 1, users: 1, endpoints: 1 },
    packageNameFa: "پکیج استارتر (تست)",
    totalToman: 4900000,
    lineItems: [],
    breakdown: {},
    snapshot: { packageCode: "starter", months: 1, users: 1, endpoints: 1 },
  },
]);

const fakeOrder = {
  id: "order-1",
  orderNumber: "AB-1",
  userId: "user-1",
  status: "pending_payment",
  totalToman: 4900000,
  invoiceTitle: "فاکتور تست",
  invoiceCompany: "شرکت تست",
  itemsJson: ONE_ITEM_JSON,
};

function makeFakeTx(over: Partial<{ ref: string; status: string }> = {}) {
  return {
    id: "tx-1",
    ref: REF,
    status: "pending",
    orderId: "order-1",
    amountToman: 4900000,
    verifyTokenHash: sha256(VERIFY_TOKEN),
    order: fakeOrder,
    ...over,
  };
}

const writes = {
  transactionUpdates: [] as Array<{ via: string; whereStatus?: string; dataStatus?: string }>,
  orderUpdates: [] as Array<{ via: string; whereStatus?: string; dataStatus?: string }>,
  invoices: [] as Array<{ number: string; orderId: string; userId: string; amountToman: number; status: string }>,
  subscriptions: [] as Array<{ packageCode: string; orderId: string; userId: string; status: string }>,
  services: [] as Array<{ type: string; subscriptionId: string }>,
};

// The tx row the fake database serves for its ref (tests may swap it).
let currentTx = makeFakeTx();

const fakeDb = {
  transaction: {
    findUnique: async ({ where }: { where: { ref?: string } }) =>
      where.ref === currentTx.ref ? currentTx : null,
    // failure/cancel path — the single write of the non-success terminal.
    update: async (args: { where: { id: string }; data: { status: string } }) => {
      writes.transactionUpdates.push({ via: "transaction.update", dataStatus: args.data.status });
      return args;
    },
    // success path — the atomic claim inside $transaction.
    updateMany: async (args: { where: { id: string; status?: string }; data: { status: string } }) => {
      writes.transactionUpdates.push({
        via: "transaction.updateMany",
        whereStatus: args.where.status,
        dataStatus: args.data.status,
      });
      const matches =
        args.where.id === currentTx.id &&
        (args.where.status === undefined || args.where.status === currentTx.status);
      return { count: matches ? 1 : 0 };
    },
  },
  order: {
    updateMany: async (args: { where: { id: string; status?: string }; data: { status: string } }) => {
      writes.orderUpdates.push({
        via: "order.updateMany",
        whereStatus: args.where.status,
        dataStatus: args.data.status,
      });
      const matches =
        args.where.id === fakeOrder.id &&
        (args.where.status === undefined || args.where.status === fakeOrder.status);
      return { count: matches ? 1 : 0 };
    },
    findUniqueOrThrow: async () => fakeOrder,
    findUnique: async () => fakeOrder,
  },
  invoice: {
    create: async ({ data }: { data: typeof writes.invoices[number] }) => {
      writes.invoices.push(data);
      return data;
    },
  },
  subscription: {
    create: async ({ data }: { data: typeof writes.subscriptions[number] }) => {
      writes.subscriptions.push(data);
      return { id: `sub-${writes.subscriptions.length}`, ...data };
    },
  },
  service: {
    create: async ({ data }: { data: { subscriptionId: string; type: string } }) => {
      writes.services.push({ type: data.type, subscriptionId: data.subscriptionId });
      return data;
    },
  },
  panelUser: {
    // postCommitFulfillment stops here (no user row) — notifications and
    // Drive quota are outside this test's scope by design.
    findUnique: async () => null,
  },
  // The real $transaction executes the callback against a transaction
  // client; the in-memory fake simply runs it against the same object.
  $transaction: async (fn: (client: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
};

mock.module("@/lib/db", () => ({ db: fakeDb }));
mock.module("@/lib/audit", () => ({ audit: async () => undefined }));

const { POST } = await import("../src/app/api/payments/callback/route");
const { safeRelativeRedirectLocation } = await import("../src/lib/payments/redirect-target");

function callbackRequest(headers: Record<string, string> = {}, outcome = "cancel", ref = REF): Request {
  return new Request("http://localhost/api/payments/callback", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ ref, t: VERIFY_TOKEN, outcome }).toString(),
  });
}

const EXPECTED_LOCATION = `/portal/payment/result?ref=${REF}`;

/** The Location must be a server-controlled RELATIVE reference — exactly one
 *  leading "/", never a network-path "//", never a backslash, never an
 *  absolute URL, and never any forged-host content. */
function assertServerControlledLocation(location: string) {
  expect(location.startsWith("/")).toBe(true);
  expect(location.startsWith("//")).toBe(false);
  expect(location.includes("\\")).toBe(false);
  expect(/^[a-z][a-z0-9+.-]*:\/\//i.test(location)).toBe(false);
  expect(location.includes("evil.attacker.test")).toBe(false);
}

beforeEach(() => {
  // Normalize the environment: the mock gateway is a dev/test feature.
  delete process.env.NODE_ENV;
  // Fresh row + fresh write log per test — assertions are always per-test.
  currentTx = makeFakeTx();
  writes.transactionUpdates = [];
  writes.orderUpdates = [];
  writes.invoices = [];
  writes.subscriptions = [];
  writes.services = [];
});

// ---------------------------------------------------------------------------
// SUCCESS path (FSR-10) — the REAL finalizeSuccess flow, not a relabeled
// failure request. The write log proves the actual success service path ran.
// ---------------------------------------------------------------------------
describe("FSR-10 — mock payment callback: REAL success path", () => {
  test("success + normal headers → 303 to the relative result page, finalizeSuccess fully executed", async () => {
    const response = await POST(callbackRequest({}, "success"));
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toBe(EXPECTED_LOCATION);
    assertServerControlledLocation(location);

    // The REAL success service path ran — every stage of finalizeSuccess:
    // 1. the transaction was claimed pending → succeeded inside $transaction,
    expect(writes.transactionUpdates).toContainEqual({
      via: "transaction.updateMany",
      whereStatus: "pending",
      dataStatus: "succeeded",
    });
    // 2. the order was claimed pending_payment → paid,
    expect(writes.orderUpdates).toContainEqual({
      via: "order.updateMany",
      whereStatus: "pending_payment",
      dataStatus: "paid",
    });
    // 3. an invoice row was created for the paid order,
    expect(writes.invoices).toHaveLength(1);
    expect(writes.invoices[0]!.status).toBe("paid");
    expect(writes.invoices[0]!.orderId).toBe("order-1");
    // 4. fulfillment created the subscription + service rows.
    expect(writes.subscriptions).toHaveLength(1);
    expect(writes.subscriptions[0]!.packageCode).toBe("starter");
    expect(writes.subscriptions[0]!.status).toBe("active");
    expect(writes.services).toHaveLength(1);
    // 5. and the failure write never happened.
    expect(writes.transactionUpdates).not.toContainEqual({ via: "transaction.update", dataStatus: "failed" });
  });

  test("success + forged Host header → destination unchanged, success flow still executed", async () => {
    const response = await POST(callbackRequest({ host: "evil.attacker.test" }, "success"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION); // NOT evil.attacker.test
    assertServerControlledLocation(response.headers.get("location")!);
    expect(writes.transactionUpdates).toContainEqual({ via: "transaction.updateMany", whereStatus: "pending", dataStatus: "succeeded" });
  });

  test("success + forged x-forwarded-host → destination unchanged", async () => {
    const response = await POST(callbackRequest({ "x-forwarded-host": "evil.attacker.test" }, "success"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION);
    assertServerControlledLocation(response.headers.get("location")!);
  });

  test("success + forged x-forwarded-proto → destination unchanged", async () => {
    const response = await POST(callbackRequest({ "x-forwarded-proto": "gopher" }, "success"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION);
    assertServerControlledLocation(response.headers.get("location")!);
  });
});

// ---------------------------------------------------------------------------
// FAILURE path (FSR-10) — independent, with its own real-write assertion.
// ---------------------------------------------------------------------------
describe("FSR-10 — mock payment callback: REAL failure path", () => {
  test("failure + normal headers → 303 to the relative result page, failure write executed", async () => {
    const response = await POST(callbackRequest({}, "failure"));
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toBe(EXPECTED_LOCATION);
    assertServerControlledLocation(location);

    // The REAL failure path ran — a single terminal write, no success writes.
    expect(writes.transactionUpdates).toContainEqual({ via: "transaction.update", dataStatus: "failed" });
    expect(writes.transactionUpdates).not.toContainEqual({ via: "transaction.updateMany", dataStatus: "succeeded" });
    expect(writes.invoices).toHaveLength(0);
    expect(writes.subscriptions).toHaveLength(0);
    expect(writes.services).toHaveLength(0);
  });

  test("failure + combined forged headers → destination unchanged", async () => {
    const response = await POST(
      callbackRequest(
        {
          host: "evil.attacker.test",
          "x-forwarded-host": "evil.attacker.test",
          "x-forwarded-proto": "https",
          "x-real-ip": "1.2.3.4",
          "x-forwarded-for": "spoofed, 5.6.7.8",
        },
        "failure",
      ),
    );
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toBe(EXPECTED_LOCATION);
    assertServerControlledLocation(location);
    // The failure write still happened — the forged headers changed nothing.
    expect(writes.transactionUpdates).toContainEqual({ via: "transaction.update", dataStatus: "failed" });
  });
});

// ---------------------------------------------------------------------------
// CANCEL path (FSR-7, preserved) — the original default-outcome behavior.
// ---------------------------------------------------------------------------
describe("FSR-7 — mock payment callback redirect is server-controlled (cancel path)", () => {
  test("normal callback behavior is preserved: 303 to the relative result page", async () => {
    const response = await POST(callbackRequest());
    expect(response.status).toBe(303);
    const location = response.headers.get("location");
    expect(location).toBe(EXPECTED_LOCATION);
    // Relative by construction: exactly one leading "/", no scheme, no host.
    assertServerControlledLocation(location!);
    // The cancel path really ran (terminal write → cancelled).
    expect(writes.transactionUpdates).toContainEqual({ via: "transaction.update", dataStatus: "cancelled" });
  });

  test("a forged Host header cannot influence the redirect destination", async () => {
    const response = await POST(callbackRequest({ host: "evil.attacker.test" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION); // NOT evil.attacker.test
  });

  test("a forged x-forwarded-host header cannot influence the destination", async () => {
    const response = await POST(callbackRequest({ "x-forwarded-host": "evil.attacker.test" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION);
  });

  test("a forged x-forwarded-proto header cannot influence the destination", async () => {
    const response = await POST(callbackRequest({ "x-forwarded-proto": "gopher" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(EXPECTED_LOCATION);
  });

  test("combined forged headers still produce the same server-controlled Location", async () => {
    const response = await POST(
      callbackRequest({
        host: "evil.attacker.test",
        "x-forwarded-host": "evil.attacker.test",
        "x-forwarded-proto": "https",
        "x-real-ip": "1.2.3.4",
        "x-forwarded-for": "spoofed, 5.6.7.8",
      }),
    );
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toBe(EXPECTED_LOCATION);
    // No external origin, no network-path reference, no backslash — the
    // browser can only end up on the origin it already used.
    assertServerControlledLocation(location);
  });
});

// ---------------------------------------------------------------------------
// Route-level rejection of dangerous Location values (FSR-10 matrix): even a
// poisoned transaction ref reaching the redirect URL cannot produce an
// off-origin Location — the guard collapses it at the route boundary.
// ---------------------------------------------------------------------------
describe("FSR-10 — route-level rejection of dangerous redirect values", () => {
  test("a stored ref containing a backslash collapses the Location to \"/\" (guard enforced through the REAL route)", async () => {
    // A ref whose interpolation into the redirect URL would carry a
    // backslash — safeRelativeRedirectLocation must reject the whole target.
    currentTx = makeFakeTx({ ref: "MOCK-REF\\EVIL" });
    const response = await POST(callbackRequest({}, "success", "MOCK-REF\\EVIL"));
    expect(response.status).toBe(303);
    // The guard collapsed the unsafe target — never a backslash redirect.
    expect(response.headers.get("location")).toBe("/");
    assertServerControlledLocation(response.headers.get("location")!);
  });

  test("the redirect URL builder is structurally relative — it can never emit a network-path \"//\" target", async () => {
    // The server builds `/portal/payment/result?ref=${ref}` — the literal
    // prefix makes a leading "//" impossible; the guard (next describe)
    // independently rejects any "//"-prefixed value. Asserted here on the
    // real guard with the exact route-shaped input.
    expect(safeRelativeRedirectLocation(`//evil.example/x?ref=${REF}`)).toBe("/");
    expect(safeRelativeRedirectLocation(`/portal/payment/result?ref=${REF}`)).toBe(`/portal/payment/result?ref=${REF}`);
  });
});

describe("FSR-7 — the relative-Location guard itself (redirect-target)", () => {
  test("network-path, backslash and absolute values all collapse to \"/\"", () => {
    expect(safeRelativeRedirectLocation("//evil.example/x")).toBe("/");
    expect(safeRelativeRedirectLocation("\\\\evil.example\\x")).toBe("/");
    expect(safeRelativeRedirectLocation("/\\evil.example/x")).toBe("/");
    expect(safeRelativeRedirectLocation("/foo\\bar")).toBe("/");
    expect(safeRelativeRedirectLocation("http://evil.example/x")).toBe("/");
    expect(safeRelativeRedirectLocation("https://portal.example.com/x")).toBe("/");
    expect(safeRelativeRedirectLocation("relative-no-slash")).toBe("/");
    expect(safeRelativeRedirectLocation("")).toBe("/");
  });

  test("legitimate relative targets pass through unchanged", () => {
    expect(safeRelativeRedirectLocation("/portal/payment/result?ref=MOCK-REF-1")).toBe("/portal/payment/result?ref=MOCK-REF-1");
    expect(safeRelativeRedirectLocation("/")).toBe("/");
    expect(safeRelativeRedirectLocation("/portal/orders?page=2#top")).toBe("/portal/orders?page=2#top");
  });
});

describe("FSR-7 — the mock gateway stays disabled in production", () => {
  test("NODE_ENV=production → 403 MOCK_DISABLED for every outcome (cancel, failure, success)", async () => {
    process.env.NODE_ENV = "production";
    try {
      for (const outcome of ["cancel", "failure", "success"] as const) {
        writes.transactionUpdates = [];
        const response = await POST(callbackRequest({}, outcome));
        expect(response.status).toBe(403);
        expect(response.headers.get("location")).toBeNull(); // no redirect in production
        const body = (await response.json()) as { error?: { code?: string } };
        expect(body.error?.code).toBe("MOCK_DISABLED");
        // No terminal write happened — the service refused before any state change.
        expect(writes.transactionUpdates).toHaveLength(0);
      }
    } finally {
      delete process.env.NODE_ENV;
    }
  });
});
