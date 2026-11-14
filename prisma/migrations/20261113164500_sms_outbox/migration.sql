-- Durable SMS outbox for SMS.ir deliveries. The OTP code/body is never
-- stored — only delivery metadata. Also extends OtpGrant purposes with
-- mobile password recovery ("recover").
CREATE TABLE "SmsOutbox" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'smsir',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "messageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "SmsOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SmsOutbox_idempotencyKey_key" ON "SmsOutbox"("idempotencyKey");
CREATE INDEX "SmsOutbox_mobile_createdAt_idx" ON "SmsOutbox"("mobile", "createdAt");
CREATE INDEX "SmsOutbox_status_createdAt_idx" ON "SmsOutbox"("status", "createdAt");
