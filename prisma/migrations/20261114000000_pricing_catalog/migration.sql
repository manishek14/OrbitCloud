CREATE TABLE "PricingPlan" (
    "code" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingPlan_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "PricingContract" (
    "months" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PricingContract_pkey" PRIMARY KEY ("months")
);

ALTER TABLE "Subscription" ADD COLUMN "entitlementJson" TEXT;
