// Run after the additive migration. Existing rows are never overwritten.
import { PrismaClient } from "@prisma/client";
import { COMMERCIAL_PACKAGES, CONTRACT_POLICIES } from "../src/lib/commerce/catalog";

const db = new PrismaClient();
try {
  await db.$transaction(async (tx) => {
    for (const plan of COMMERCIAL_PACKAGES) {
      await tx.pricingPlan.createMany({
        data: [{ code: plan.code, payload: JSON.parse(JSON.stringify(plan)) }],
        skipDuplicates: true,
      });
    }
    for (const contract of CONTRACT_POLICIES) {
      await tx.pricingContract.createMany({
        data: [{ months: contract.months, payload: JSON.parse(JSON.stringify(contract)) }],
        skipDuplicates: true,
      });
    }
  });
} finally {
  await db.$disconnect();
}
