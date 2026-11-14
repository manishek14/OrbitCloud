import { expect, test } from "bun:test";
import { resolveSubscriptionQuota } from "../src/lib/commerce/entitlement";
import { calculateQuote } from "../src/lib/commerce/quote";
import { COMMERCIAL_PACKAGES, CONTRACT_POLICIES } from "../src/lib/commerce/catalog";

test("purchased storage survives a catalog edit", () => {
  const catalog = {
    packages: COMMERCIAL_PACKAGES.map((p) => ({ ...p, active: true, revision: 1 })),
    contracts: CONTRACT_POLICIES.map((c) => ({ ...c, active: true, revision: 1 })),
  };
  const input = { packageCode: "standard", months: 3, users: 10, endpoints: 12 };
  const original = calculateQuote(input, catalog);
  const terms = original.purchasedTerms!;
  const sub = { packageCode: input.packageCode, entitlementJson: JSON.stringify(terms) };
  catalog.packages.find((p) => p.code === input.packageCode)!.driveQuotaBytes = 100 * 1024 ** 3;
  catalog.packages.find((p) => p.code === input.packageCode)!.monthlyPriceToman += 1_000_000;
  const updated = calculateQuote(input, catalog);
  expect(updated.breakdown!.totalToman).not.toBe(original.breakdown!.totalToman);
  expect(resolveSubscriptionQuota(sub, null)).toBe(terms.driveQuotaBytes);
  expect(updated.purchasedTerms!.driveQuotaBytes).toBe(100 * 1024 ** 3);
});

test("archived plans cannot be quoted, while a prior snapshot remains usable", () => {
  const catalog = {
    packages: COMMERCIAL_PACKAGES.map((p) => ({ ...p, active: p.code !== "standard", revision: 2 })),
    contracts: CONTRACT_POLICIES.map((c) => ({ ...c, active: true, revision: 1 })),
  };
  expect(calculateQuote({ packageCode: "standard", months: 3, users: 10, endpoints: 12 }, catalog).valid).toBe(false);
  expect(resolveSubscriptionQuota({ packageCode: "standard", entitlementJson: JSON.stringify({ planCode: "standard", driveQuotaBytes: 25 * 1024 ** 3 }) }, null)).toBe(25 * 1024 ** 3);
});

test("legacy quota uses only the matching persisted Drive allocation", () => {
  const sub = { packageCode: "standard", entitlementJson: null };
  expect(resolveSubscriptionQuota(sub, { planCode: "standard", quotaBytes: 20n * 1024n ** 3n })).toBe(20 * 1024 ** 3);
  expect(resolveSubscriptionQuota(sub, { planCode: "business", quotaBytes: 20n * 1024n ** 3n })).toBeNull();
  expect(resolveSubscriptionQuota(sub, null)).toBeNull();
  expect(resolveSubscriptionQuota({ ...sub, entitlementJson: "broken" }, { planCode: "standard", quotaBytes: 20n * 1024n ** 3n })).toBeNull();
});

test("discount applies once to the base price", () => {
  const quote = calculateQuote(
    { packageCode: "standard", months: 3, users: 12, endpoints: 14 },
    { packages: COMMERCIAL_PACKAGES.map((p) => ({ ...p, active: true, revision: 1 })), contracts: CONTRACT_POLICIES.map((c) => ({ ...c, active: true, revision: 1 })) },
  );
  const b = quote.breakdown!;
  expect(b.discountToman).toBe(Math.round(b.baseSubtotalToman * b.discountRate));
  expect(b.totalToman).toBe(b.baseSubtotalToman - b.discountToman + b.extraUsersTotalToman + b.extraEndpointsTotalToman + b.onboardingToman);
});
