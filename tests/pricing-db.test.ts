import { expect, test } from "bun:test";
import { db } from "../src/lib/db";
import { readCommercialCatalog, type CommercialPackage } from "../src/lib/commerce/catalog";
import { computeQuote } from "../src/lib/commerce/quote";
import { getPlan } from "../src/lib/drive/plans";

const isolated = process.env.PRICING_ISOLATED_TEST === "abrit-pricing-check-20261114" &&
  process.env.DATABASE_URL?.includes("@localhost:5432/postgres");

(isolated ? test : test.skip)("PostgreSQL catalog is the quote source", async () => {
  const catalog = await readCommercialCatalog();
  expect(catalog.packages).toHaveLength(6);
  expect(catalog.contracts).toHaveLength(3);
  expect((await getPlan("trial"))?.quotaBytes).toBe(catalog.packages.find((p) => p.code === "free")!.driveQuotaBytes);
  const row = await db.pricingPlan.findUniqueOrThrow({ where: { code: "standard" } });
  const original = row.payload as unknown as CommercialPackage;
  const input = { packageCode: "standard", months: 3, users: 10, endpoints: 12 };
  const before = await computeQuote(input);
  try {
    await db.pricingPlan.update({ where: { code: row.code }, data: {
      payload: { ...original, monthlyPriceToman: original.monthlyPriceToman + 1_000_000 },
    } });
    const after = await computeQuote(input);
    expect(after.breakdown!.totalToman).toBeGreaterThan(before.breakdown!.totalToman);
    expect(before.purchasedTerms!.monthlyPriceToman).toBe(original.monthlyPriceToman);
    await db.pricingPlan.update({ where: { code: row.code }, data: { active: false } });
    expect((await computeQuote(input)).valid).toBe(false);
  } finally {
    await db.pricingPlan.update({ where: { code: row.code }, data: { payload: row.payload, active: row.active } });
  }
});
