-- Full-remediation audit §6: missing lookup/cleanup indexes.
--
-- These are plain (non-concurrent) CREATE INDEX statements: Prisma migrate
-- deploy applies migrations inside a transaction, and the tables are small
-- enough at this stage that a brief lock is acceptable. Safe to run on a
-- database with existing data (indexes are additive).

-- Session: revocation by user + expired-session cleanup scans.
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- OtpGrant: expired-grant cleanup scans.
CREATE INDEX "OtpGrant_expiresAt_idx" ON "OtpGrant"("expiresAt");

-- LoginAttempt: retention cleanup scans.
CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");

-- Invoice: order → invoices lookup.
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");

-- Subscription: order → subscriptions lookup after payment fulfillment.
CREATE INDEX "Subscription_orderId_idx" ON "Subscription"("orderId");

-- Service: subscription → services lookup.
CREATE INDEX "Service_subscriptionId_idx" ON "Service"("subscriptionId");

-- AuditLog: per-actor activity trails.
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
