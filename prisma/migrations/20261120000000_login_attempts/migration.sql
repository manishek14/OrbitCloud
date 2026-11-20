-- Dedicated login-attempt store (audit §4.1): separate, indexed counters for
-- per-identifier and per-IP password-login throttling. Replaces the previous
-- OR-combined audit-log substring counting, which mixed unrelated failures
-- and used an unindexed scan as the primary rate-limit mechanism.
-- Identifiers are stored ONLY as keyed hashes (never raw emails/phones).

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "identifierHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginAttempt_identifierHash_success_createdAt_idx" ON "LoginAttempt"("identifierHash", "success", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipHash_success_createdAt_idx" ON "LoginAttempt"("ipHash", "success", "createdAt");
