// ============================================================================
// Pricing & commercial-catalog test suite (bun test).
//
// Covers the post-correction business rules:
//   • Contract periods are EXACTLY 1, 3, 6 months — the 12-month option was
//     REMOVED (COM-06).
//   • Rates: 1-month → discount 0 / onboarding 0; 3-month → 3% / 50%;
//     6-month → 5% / 25%.
//   • 1405 SLA amendment labels (۸/۵/۳/۱ ساعت کاری، لحظه‌ای) and no leftover
//     «۳۰ دقیقه» / «۴ ساعت» / «۲ ساعت» texts.
//   • Exact quote math for the standard package (incl. the documented
//     3-month 84,375,000 Toman case and its per-month equivalent).
//   • needsCustomAssessment above 40 users / 60 endpoints.
//   • Immutable snapshot checksum round-trip via verifySnapshotSnapshotChecksum.
//   • Grep-style source assertions (12-month leftovers) — cart.ts is not
//     imported directly because it pulls in @/lib/db (Prisma); its months
//     validation is asserted on the source text + via computeQuote instead.
// ============================================================================

import { describe, test, expect } from "bun:test";
import {
  COMMERCIAL_PACKAGES,
  CONTRACT_POLICIES,
  COMMERCE_POLICY_FA,
  ONE_MONTH_POLICY,
  QUOTE_LIMITS,
  SLA_IMMEDIATE_DEFINITION_FA,
} from "../src/lib/commerce/catalog";
const getContractPolicy = (months: number) => CONTRACT_POLICIES.find((c) => c.months === months);
import {
  calculateQuote,
  type QuoteInput,
  verifySnapshotSnapshotChecksum,
  type QuoteSnapshot,
} from "../src/lib/commerce/quote";

const seedCatalog = {
  packages: COMMERCIAL_PACKAGES.map((p) => ({ ...p, active: true, revision: 1 })),
  contracts: CONTRACT_POLICIES.map((c) => ({ ...c, active: true, revision: 1 })),
};
const computeQuote = (input: QuoteInput) => calculateQuote(input, seedCatalog);

// ---------------------------------------------------------------------------
// Contract periods & policy rates
// ---------------------------------------------------------------------------

describe("contract policies (1/3/6 months — 12-month removed)", () => {
  test("CONTRACT_POLICIES has exactly 3 entries", () => {
    expect(CONTRACT_POLICIES).toHaveLength(3);
  });

  test("allowed months are exactly 1, 3 and 6 — never 12", () => {
    const months = CONTRACT_POLICIES.map((p) => p.months).sort((a, b) => a - b);
    expect(months).toEqual([1, 3, 6]);
    expect(months).not.toContain(12);
    expect(getContractPolicy(12)).toBeUndefined();
    expect(getContractPolicy(2)).toBeUndefined();
    for (const m of [1, 3, 6] as const) {
      expect(getContractPolicy(m)).toBeDefined();
    }
  });

  test("1-month policy: no discount, no onboarding fee", () => {
    const one = getContractPolicy(1);
    expect(one?.discountRate).toBe(0);
    expect(one?.onboardingRate).toBe(0);
    expect(ONE_MONTH_POLICY.discountRate).toBe(0);
    expect(ONE_MONTH_POLICY.onboardingRate).toBe(0);
  });

  test("3-month policy: 3% discount, 50% onboarding", () => {
    const three = getContractPolicy(3);
    expect(three?.discountRate).toBe(0.03);
    expect(three?.onboardingRate).toBe(0.5);
  });

  test("6-month policy: 5% discount, 25% onboarding", () => {
    const six = getContractPolicy(6);
    expect(six?.discountRate).toBe(0.05);
    expect(six?.onboardingRate).toBe(0.25);
  });

  test("COMMERCE_POLICY_FA.allowedMonths is [1, 3, 6]", () => {
    expect([...COMMERCE_POLICY_FA.allowedMonths]).toEqual([1, 3, 6]);
    expect(COMMERCE_POLICY_FA.minimumMonths).toBe(1);
  });

  test("quote limits are 40 users / 60 endpoints", () => {
    expect(QUOTE_LIMITS.maxQuotableUsers).toBe(40);
    expect(QUOTE_LIMITS.maxQuotableEndpoints).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// months validation through the public quote engine (cart.ts shares the rule)
// ---------------------------------------------------------------------------

describe("computeQuote months validation", () => {
  test("months 1, 3 and 6 are valid", () => {
    for (const months of [1, 3, 6]) {
      const q = computeQuote({ packageCode: "standard", months, users: 10, endpoints: 12 });
      expect(q.valid).toBe(true);
      expect(q.errors).toHaveLength(0);
      expect(q.checkoutEnabled).toBe(true);
    }
  });

  test("months 12 is rejected by the current catalog", () => {
    const q = computeQuote({ packageCode: "standard", months: 12, users: 10, endpoints: 12 });
    expect(q.valid).toBe(false);
    expect(q.errors).toContain("مدت قرارداد انتخابی فعال یا معتبر نیست.");
    expect(q.breakdown).toBeNull();
    expect(q.snapshot).toBeNull();
    expect(q.checkoutEnabled).toBe(false);
  });

  test("other invalid month values are rejected too", () => {
    for (const months of [0, 2, 4, 5, -3, 9, 24]) {
      const q = computeQuote({ packageCode: "standard", months, users: 10, endpoints: 12 });
      expect(q.valid).toBe(false);
      expect(q.errors).toContain("مدت قرارداد انتخابی فعال یا معتبر نیست.");
    }
  });

  test("unknown package codes are rejected", () => {
    const q = computeQuote({ packageCode: "golden", months: 3, users: 10, endpoints: 12 });
    expect(q.valid).toBe(false);
    expect(q.errors).toContain("پکیج انتخابی معتبر نیست.");
  });
});

// ---------------------------------------------------------------------------
// Exact quote math — standard package
// ---------------------------------------------------------------------------

describe("computeQuote exact math (standard: 19,500,000/mo, 10 users incl, 12 endpoints incl, extra user 1,990,000/mo, extra endpoint 990,000/mo)", () => {
  test("3 months, 12 users, 14 endpoints → total 84,375,000 Toman", () => {
    const q = computeQuote({ packageCode: "standard", months: 3, users: 12, endpoints: 14 });
    expect(q.valid).toBe(true);
    const b = q.breakdown;
    if (!b) throw new Error("expected a breakdown");

    expect(b.packageCode).toBe("standard");
    expect(b.months).toBe(3);
    expect(b.users).toBe(12);
    expect(b.endpoints).toBe(14);
    expect(b.monthlyBaseToman).toBe(19_500_000);
    expect(b.baseSubtotalToman).toBe(58_500_000); // 19,500,000 × 3
    expect(b.discountRate).toBe(0.03);
    expect(b.discountToman).toBe(1_755_000); // 3% of 58,500,000
    expect(b.baseAfterDiscountToman).toBe(56_745_000);
    expect(b.extraUsers).toBe(2); // 12 − 10 included
    expect(b.extraUserFeePerMonthToman).toBe(1_990_000);
    expect(b.extraUsersTotalToman).toBe(11_940_000); // 2 × 1,990,000 × 3
    expect(b.extraEndpoints).toBe(2); // 14 − 12 included
    expect(b.extraEndpointFeePerMonthToman).toBe(990_000);
    expect(b.extraEndpointsTotalToman).toBe(5_940_000); // 2 × 990,000 × 3
    expect(b.onboardingRate).toBe(0.5);
    expect(b.onboardingToman).toBe(9_750_000); // 50% of ONE month base
    expect(b.totalToman).toBe(84_375_000); // 56,745,000 + 11,940,000 + 5,940,000 + 9,750,000
    expect(b.perMonthEquivalentToman).toBe(28_125_000); // 84,375,000 / 3
  });

  test("line items sum exactly to the total", () => {
    const q = computeQuote({ packageCode: "standard", months: 3, users: 12, endpoints: 14 });
    expect(q.valid).toBe(true);
    const sum = q.lineItems.reduce((acc, item) => acc + item.amountToman, 0);
    expect(sum).toBe(84_375_000);
    expect(q.lineItems.map((i) => i.key)).toEqual([
      "base",
      "discount",
      "extra_users",
      "extra_endpoints",
      "onboarding",
    ]);
  });

  test("1-month standard within included capacity → 19,500,000, no discount, no onboarding", () => {
    const q = computeQuote({ packageCode: "standard", months: 1, users: 10, endpoints: 12 });
    expect(q.valid).toBe(true);
    const b = q.breakdown;
    if (!b) throw new Error("expected a breakdown");
    expect(b.baseSubtotalToman).toBe(19_500_000);
    expect(b.discountRate).toBe(0);
    expect(b.discountToman).toBe(0);
    expect(b.onboardingRate).toBe(0);
    expect(b.onboardingToman).toBe(0);
    expect(b.extraUsersTotalToman).toBe(0);
    expect(b.extraEndpointsTotalToman).toBe(0);
    expect(b.totalToman).toBe(19_500_000);
    expect(b.perMonthEquivalentToman).toBe(19_500_000);
  });

  test("1-month standard with extra capacity → base + extras only", () => {
    const q = computeQuote({ packageCode: "standard", months: 1, users: 12, endpoints: 14 });
    expect(q.valid).toBe(true);
    const b = q.breakdown;
    if (!b) throw new Error("expected a breakdown");
    // 19,500,000 + 2×1,990,000 + 2×990,000 = 25,460,000
    expect(b.totalToman).toBe(25_460_000);
    expect(b.onboardingToman).toBe(0);
    expect(b.discountToman).toBe(0);
  });

  test("6-month standard with the same config (5% / 25%)", () => {
    const q = computeQuote({ packageCode: "standard", months: 6, users: 12, endpoints: 14 });
    expect(q.valid).toBe(true);
    const b = q.breakdown;
    if (!b) throw new Error("expected a breakdown");
    expect(b.baseSubtotalToman).toBe(117_000_000); // 19,500,000 × 6
    expect(b.discountToman).toBe(5_850_000); // 5%
    expect(b.baseAfterDiscountToman).toBe(111_150_000);
    expect(b.extraUsersTotalToman).toBe(23_880_000); // 2 × 1,990,000 × 6
    expect(b.extraEndpointsTotalToman).toBe(11_880_000); // 2 × 990,000 × 6
    expect(b.onboardingToman).toBe(4_875_000); // 25% of one month base
    expect(b.totalToman).toBe(151_785_000);
    expect(b.perMonthEquivalentToman).toBe(25_297_500);
  });

  test("discount applies to the base price only (extras at full price)", () => {
    // Standard, 3 months, 1 extra user: the 3% is applied to 58,500,000 —
    // NOT to (58,500,000 + 5,970,000).
    const q = computeQuote({ packageCode: "standard", months: 3, users: 11, endpoints: 12 });
    expect(q.valid).toBe(true);
    const b = q.breakdown;
    if (!b) throw new Error("expected a breakdown");
    expect(b.discountToman).toBe(1_755_000);
    expect(b.totalToman).toBe(56_745_000 + 5_970_000 + 9_750_000);
  });
});

// ---------------------------------------------------------------------------
// Custom assessment boundary (Enterprise Custom above 40 users / 60 endpoints)
// ---------------------------------------------------------------------------

describe("custom assessment boundary", () => {
  test("41 users → needsCustomAssessment true, no invented price", () => {
    const q = computeQuote({ packageCode: "enterprise", months: 3, users: 41, endpoints: 60 });
    expect(q.needsCustomAssessment).toBe(true);
    expect(q.valid).toBe(false);
    expect(q.breakdown).toBeNull();
    expect(q.snapshot).toBeNull();
    expect(q.checkoutEnabled).toBe(false);
    expect(q.errors.length).toBeGreaterThan(0);
  });

  test("61 endpoints → needsCustomAssessment true", () => {
    const q = computeQuote({ packageCode: "enterprise", months: 1, users: 40, endpoints: 61 });
    expect(q.needsCustomAssessment).toBe(true);
    expect(q.valid).toBe(false);
  });

  test("both over the limits → needsCustomAssessment true", () => {
    const q = computeQuote({ packageCode: "essential", months: 6, users: 100, endpoints: 200 });
    expect(q.needsCustomAssessment).toBe(true);
    expect(q.valid).toBe(false);
  });

  test("exactly 40 users / 60 endpoints is still quotable (boundary inclusive)", () => {
    const q = computeQuote({ packageCode: "enterprise", months: 1, users: 40, endpoints: 60 });
    expect(q.needsCustomAssessment).toBe(false);
    expect(q.valid).toBe(true);
    const b = q.breakdown;
    if (!b) throw new Error("expected a breakdown");
    // Enterprise includes 40 users / 60 endpoints → pure base price, 1 month.
    expect(b.totalToman).toBe(79_900_000);
  });
});

// ---------------------------------------------------------------------------
// SLA texts (1405 amendment)
// ---------------------------------------------------------------------------

describe("SLA labels (1405 amendment)", () => {
  const expectedSlaByCode: Record<string, string> = {
    essential: "حداکثر ۸ ساعت کاری",
    standard: "حداکثر ۵ ساعت کاری",
    professional: "حداکثر ۳ ساعت کاری",
    business: "حداکثر ۱ ساعت کاری",
    enterprise: "لحظه‌ای",
  };

  test("every package slaLabelFa matches the required mapping", () => {
    // 6 plans total: 5 managed-IT packages + the free plan (no SLA — «—»).
    expect(COMMERCIAL_PACKAGES).toHaveLength(6);
    const orderable = COMMERCIAL_PACKAGES.filter((p) => p.orderable);
    expect(orderable).toHaveLength(5);
    for (const pkg of orderable) {
      expect(pkg.slaLabelFa).toBe(expectedSlaByCode[pkg.code]);
    }
    // The free plan honestly claims NO managed-IT SLA.
    const free = COMMERCIAL_PACKAGES.find((p) => !p.orderable);
    expect(free?.code).toBe("free");
    expect(free?.slaLabelFa).toBe("—");
    expect(free?.monthlyPriceToman).toBe(0);
    expect(free?.driveQuotaBytes).toBe(100 * 1024 * 1024);
  });

  test("no package carries leftover «۳۰ دقیقه» / «۴ ساعت» / «۲ ساعت» SLA texts", () => {
    for (const pkg of COMMERCIAL_PACKAGES) {
      const combined = `${pkg.slaLabelFa} ${pkg.slaDetailFa}`;
      expect(combined).not.toContain("۳۰ دقیقه");
      expect(combined).not.toContain("۴ ساعت");
      expect(combined).not.toContain("۲ ساعت");
    }
  });

  test("«لحظه‌ای» has a configurable definition and the catalog exposes it", () => {
    expect(SLA_IMMEDIATE_DEFINITION_FA).toContain("لحظه‌ای");
    expect(SLA_IMMEDIATE_DEFINITION_FA).toContain("P1");
    expect(SLA_IMMEDIATE_DEFINITION_FA).toContain("۲۴×۷");
  });
});

// ---------------------------------------------------------------------------
// Snapshot checksum round-trip
// ---------------------------------------------------------------------------

describe("quote snapshot checksum", () => {
  test("checksum verifies for a freshly computed quote", () => {
    const q = computeQuote({ packageCode: "standard", months: 3, users: 12, endpoints: 14 });
    expect(q.valid).toBe(true);
    const snapshot = q.snapshot;
    if (!snapshot) throw new Error("expected a snapshot");
    expect(snapshot.totalToman).toBe(84_375_000);
    expect(snapshot.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySnapshotSnapshotChecksum(snapshot)).toBe(true);
  });

  test("checksum verifies for every ORDERABLE package and period", () => {
    for (const pkg of COMMERCIAL_PACKAGES) {
      if (!pkg.orderable) continue; // the free plan is an activation, not a quote
      for (const months of [1, 3, 6]) {
        const q = computeQuote({
          packageCode: pkg.code,
          months,
          users: Math.min(pkg.includedUsers, 3),
          endpoints: Math.min(pkg.includedEndpoints, 3),
        });
        expect(q.valid).toBe(true);
        expect(verifySnapshotSnapshotChecksum(q.snapshot as QuoteSnapshot)).toBe(true);
      }
    }
  });

  test("the free plan is never quotable (activation, not a purchase)", () => {
    const q = computeQuote({ packageCode: "free", months: 3, users: 1, endpoints: 1 });
    expect(q.valid).toBe(false);
    expect(q.checkoutEnabled).toBe(false);
    expect(q.errors[0]).toContain("پلن رایگان");
  });

  test("tampered snapshots fail verification", () => {
    const q = computeQuote({ packageCode: "standard", months: 3, users: 12, endpoints: 14 });
    const snapshot = q.snapshot;
    if (!snapshot) throw new Error("expected a snapshot");

    const tamperedTotal: QuoteSnapshot = { ...snapshot, totalToman: snapshot.totalToman + 1 };
    expect(verifySnapshotSnapshotChecksum(tamperedTotal)).toBe(false);

    const tamperedMonths: QuoteSnapshot = { ...snapshot, months: 6 };
    expect(verifySnapshotSnapshotChecksum(tamperedMonths)).toBe(false);

    const tamperedUsers: QuoteSnapshot = { ...snapshot, users: 10 };
    expect(verifySnapshotSnapshotChecksum(tamperedUsers)).toBe(false);

    const tamperedChecksum: QuoteSnapshot = { ...snapshot, checksum: "0".repeat(64) };
    expect(verifySnapshotSnapshotChecksum(tamperedChecksum)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12-month leftovers — grep-style source assertions
// ---------------------------------------------------------------------------

describe("12-month leftovers in source files", () => {
  const catalogPath = `${import.meta.dir}/../src/lib/commerce/catalog.ts`;
  const cartPath = `${import.meta.dir}/../src/lib/commerce/cart.ts`;

  test("catalog.ts no longer defines a 12-month policy", async () => {
    const source = await Bun.file(catalogPath).text();
    expect(source).not.toContain("months: 12");
    // The runtime data agrees with the source: exactly 3 policies.
    expect(CONTRACT_POLICIES).toHaveLength(3);
    expect(CONTRACT_POLICIES.some((p) => p.months === 12)).toBe(false);
  });

  test("cart.ts validates month bounds without a fixed duration whitelist", async () => {
    const source = await Bun.file(cartPath).text();
    expect(source).not.toContain("6, 12");
    expect(source).not.toContain("12].includes");
    expect(source).toContain("Number.isSafeInteger(months)");
  });
});
