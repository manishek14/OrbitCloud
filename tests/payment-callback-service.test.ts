import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

let tx: { id: string; ref: string; orderId: string; gateway: string; gatewayRef: string; amountToman: number; status: string; order: { orderNumber: string } };
let verifyCount = 0;
let finalizeCount = 0;
let verifyOutcome: unknown;
let invoiceCount = 0;

const fakeDb = {
  transaction: {
    findUnique: async () => tx,
    updateMany: async ({ where, data }: { where: { status: string }; data: { status?: string } }) => {
      if (tx.status !== where.status) return { count: 0 };
      if (data.status) tx.status = data.status;
      return { count: 1 };
    },
  },
  order: { updateMany: async () => ({ count: 0 }) },
  invoice: { create: async () => { invoiceCount++; } },
  $transaction: async (fn: (client: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
};
mock.module("@/lib/db", () => ({ db: fakeDb }));
mock.module("@/lib/audit", () => ({ audit: async () => undefined }));
const providers = await import("../src/lib/payments/providers");
const zibal = providers.getProvider("zibal")!;
const originalVerify = zibal.verify;
zibal.verify = async () => { verifyCount++; return verifyOutcome as ReturnType<typeof originalVerify> extends Promise<infer T> ? T : never; };
const { orderService } = await import("../src/lib/commerce/orders");
const originalFinalize = orderService.finalizeSuccess;
orderService.finalizeSuccess = async () => { finalizeCount++; tx.status = "succeeded"; };
afterAll(() => { zibal.verify = originalVerify; orderService.finalizeSuccess = originalFinalize; });

beforeEach(() => {
  tx = { id: "tx-1", ref: "ZBL-12345678", orderId: "order-1", gateway: "zibal", gatewayRef: "12345",
    amountToman: 1000, status: "pending", order: { orderNumber: "AB-1" } };
  verifyCount = 0;
  finalizeCount = 0;
  invoiceCount = 0;
  verifyOutcome = { ok: false, reason: "ambiguous", detailFa: "pending", raw: {} };
});

describe("payment callback decisions", () => {
  test("browser success alone remains pending when verification is ambiguous", async () => {
    await orderService.handleGatewayCallback("zibal", new URLSearchParams("trackId=12345&success=1"));
    expect(tx.status).toBe("pending");
    expect(verifyCount).toBe(1);
    expect(finalizeCount).toBe(0);
  });

  test("server verification can confirm payment despite a false browser flag", async () => {
    verifyOutcome = { ok: true, alreadyVerified: false, amountToman: 1000, raw: {} };
    await orderService.handleGatewayCallback("zibal", new URLSearchParams("trackId=12345&success=0&status=2"));
    expect(tx.status).toBe("succeeded");
    expect(finalizeCount).toBe(1);
  });

  test("verified not-paid cancellation is recorded and replay is a no-op", async () => {
    verifyOutcome = { ok: false, reason: "not_paid", raw: {} };
    const params = new URLSearchParams("trackId=12345&success=0&status=2");
    await orderService.handleGatewayCallback("zibal", params);
    await orderService.handleGatewayCallback("zibal", params);
    expect(tx.status).toBe("cancelled");
    expect(verifyCount).toBe(1);
    expect(finalizeCount).toBe(0);
  });

  test("another gateway's callback cannot use this reference", async () => {
    await orderService.handleGatewayCallback("zarinpal", new URLSearchParams("Authority=12345&Status=OK"));
    expect(verifyCount).toBe(0);
    expect(tx.status).toBe("pending");
  });

  test("a second verified attempt for an already-paid order cannot issue another invoice", async () => {
    await originalFinalize.call(orderService, tx as Parameters<typeof originalFinalize>[0], { gateway: "zibal" });
    expect(tx.status).toBe("succeeded");
    expect(invoiceCount).toBe(0);
  });
});
