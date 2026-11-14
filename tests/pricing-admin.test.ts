import { expect, test } from "bun:test";
import { db } from "../src/lib/db";
import { COMMERCIAL_PACKAGES, CONTRACT_POLICIES } from "../src/lib/commerce/catalog";
import { computeQuote } from "../src/lib/commerce/quote";
import { createPricing, deletePricing, updatePricing, validatePlan, validateContract } from "../src/lib/commerce/pricing-admin";

const isolated = process.env.PRICING_ISOLATED_TEST === "abrit-pricing-admin-check" &&
  process.env.DATABASE_URL?.includes("@localhost:5432/postgres");
const run = isolated ? test : test.skip;

run("plan create, duplicate, revision, archive, quote and delete", async () => {
  const code = "test_admin_plan";
  const base = COMMERCIAL_PACKAGES.find((p) => p.code === "standard")!;
  await db.pricingPlan.deleteMany({ where: { code } });
  try {
    const created = await createPricing("plans", { ...base, code });
    expect(created.revision).toBe(1);
    await expect(createPricing("plans", { ...base, code })).rejects.toMatchObject({ status: 409 });
    const changed = await updatePricing("plans", code, 1, { ...base, code, monthlyPriceToman: base.monthlyPriceToman + 1_000_000 });
    expect(changed.revision).toBe(2);
    expect((await computeQuote({ packageCode: code, months: 3, users: 10, endpoints: 12 })).purchasedTerms?.monthlyPriceToman).toBe(base.monthlyPriceToman + 1_000_000);
    await expect(updatePricing("plans", code, 1, undefined, false)).rejects.toMatchObject({ status: 409 });
    const archived = await updatePricing("plans", code, 2, undefined, false);
    expect((await computeQuote({ packageCode: code, months: 3, users: 10, endpoints: 12 })).valid).toBe(false);
    const activated = await updatePricing("plans", code, archived.revision, undefined, true);
    expect(activated.active).toBe(true);
    await expect(deletePricing("plans", code, 1)).rejects.toMatchObject({ status: 409 });
    expect((await deletePricing("plans", code, activated.revision)).ok).toBe(true);
  } finally { await db.pricingPlan.deleteMany({ where: { code } }); }
});

run("contract create, duplicate, revision, archive and delete", async () => {
  const months = 9;
  const source = CONTRACT_POLICIES.find((c) => c.months === 3)!;
  await db.pricingContract.deleteMany({ where: { months } });
  try {
    await createPricing("contracts", { ...source, months });
    await expect(createPricing("contracts", { ...source, months })).rejects.toMatchObject({ status: 409 });
    const changed = await updatePricing("contracts", String(months), 1, { ...source, months, discountRate: 0.1 });
    expect(changed.revision).toBe(2);
    const archived = await updatePricing("contracts", String(months), 2, undefined, false);
    expect((await computeQuote({ packageCode: "standard", months, users: 10, endpoints: 12 })).valid).toBe(false);
    await expect(deletePricing("contracts", String(months), 2)).rejects.toMatchObject({ status: 409 });
    expect((await deletePricing("contracts", String(months), archived.revision)).ok).toBe(true);
  } finally { await db.pricingContract.deleteMany({ where: { months } }); }
});

run("invalid money, limits and discounts are rejected", () => {
  const base = COMMERCIAL_PACKAGES.find((p) => p.code === "standard")!;
  expect(() => validatePlan({ ...base, monthlyPriceToman: -1 })).toThrow();
  expect(() => validatePlan({ ...base, includedUsers: -1 })).toThrow();
  expect(() => validatePlan({ ...base, driveQuotaBytes: -1 })).toThrow();
  expect(() => validateContract({ ...CONTRACT_POLICIES[1], discountRate: 1.2 })).toThrow();
  expect(() => validatePlan({ ...COMMERCIAL_PACKAGES[0], orderable: true })).toThrow();
});

run("the Drive trial source plan cannot be deleted", async () => {
  await expect(deletePricing("plans", "free", 1)).rejects.toMatchObject({ code: "PROTECTED" });
});

run("historically referenced plan and term cannot be deleted", async () => {
  const user = await db.panelUser.create({ data: { email: `pricing-admin-${crypto.randomUUID()}@test.invalid`, name: "test", passwordHash: "unused", role: "customer", status: "active" } });
  const planCode = "test_referenced_plan";
  const months = 9;
  try {
    await createPricing("plans", { ...COMMERCIAL_PACKAGES[2], code: planCode });
    await createPricing("contracts", { ...CONTRACT_POLICIES[1], months });
    await db.order.create({ data: { orderNumber: `T-${crypto.randomUUID()}`, userId: user.id, itemsJson: JSON.stringify([{ input: { packageCode: planCode, months } }]), totalToman: 1, invoiceTitle: "test" } });
    await expect(deletePricing("plans", planCode, 1)).rejects.toMatchObject({ code: "REFERENCED" });
    await expect(deletePricing("contracts", String(months), 1)).rejects.toMatchObject({ code: "REFERENCED" });
  } finally {
    await db.order.deleteMany({ where: { userId: user.id } });
    await db.pricingPlan.deleteMany({ where: { code: planCode } });
    await db.pricingContract.deleteMany({ where: { months } });
    await db.panelUser.delete({ where: { id: user.id } });
  }
});

run("concurrent edits allow one revision winner", async () => {
  const code = "test_concurrent_plan";
  const base = { ...COMMERCIAL_PACKAGES[2], code };
  await db.pricingPlan.deleteMany({ where: { code } });
  try {
    await createPricing("plans", base);
    const results = await Promise.allSettled([
      updatePricing("plans", code, 1, { ...base, monthlyPriceToman: base.monthlyPriceToman + 100 }),
      updatePricing("plans", code, 1, { ...base, monthlyPriceToman: base.monthlyPriceToman + 200 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await db.pricingPlan.findUniqueOrThrow({ where: { code } })).revision).toBe(2);
  } finally { await db.pricingPlan.deleteMany({ where: { code } }); }
});

run("catalog edit preserves stored order, subscription and Drive amounts", async () => {
  const code = "test_history_plan";
  const base = { ...COMMERCIAL_PACKAGES[2], code };
  const user = await db.panelUser.create({ data: { email: `pricing-history-${crypto.randomUUID()}@test.invalid`, name: "test", passwordHash: "unused", role: "customer", status: "active" } });
  try {
    await createPricing("plans", base);
    const order = await db.order.create({ data: { orderNumber: `T-${crypto.randomUUID()}`, userId: user.id, itemsJson: JSON.stringify([{ input: { packageCode: code, months: 3 }, totalToman: 1234 }]), totalToman: 1234, invoiceTitle: "test" } });
    const snapshot = JSON.stringify({ planCode: code, driveQuotaBytes: base.driveQuotaBytes, monthlyPriceToman: base.monthlyPriceToman });
    const sub = await db.subscription.create({ data: { userId: user.id, orderId: order.id, packageCode: code, months: 3, users: 10, endpoints: 12, expiresAt: new Date(Date.now() + 86400000), priceTotalToman: 1234, entitlementJson: snapshot } });
    const account = await db.driveAccount.create({ data: { panelUserId: user.id, ncUsername: `pricing-${crypto.randomUUID()}`, planCode: code, quotaBytes: BigInt(base.driveQuotaBytes) } });
    await updatePricing("plans", code, 1, { ...base, monthlyPriceToman: base.monthlyPriceToman + 1000, driveQuotaBytes: base.driveQuotaBytes * 2 });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).totalToman).toBe(1234);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: sub.id } })).entitlementJson).toBe(snapshot);
    expect((await db.driveAccount.findUniqueOrThrow({ where: { id: account.id } })).quotaBytes).toBe(BigInt(base.driveQuotaBytes));
    await expect(deletePricing("plans", code, 2)).rejects.toMatchObject({ code: "REFERENCED" });
  } finally {
    await db.driveAccount.deleteMany({ where: { panelUserId: user.id } });
    await db.subscription.deleteMany({ where: { userId: user.id } });
    await db.order.deleteMany({ where: { userId: user.id } });
    await db.pricingPlan.deleteMany({ where: { code } });
    await db.panelUser.delete({ where: { id: user.id } });
  }
});
