-- Payment gateway references: ZarinPal authority / Zibal trackId stored
-- against the transaction (unique → duplicate provider callbacks can never
-- match two transactions). verifyTokenHash becomes nullable (real gateways
-- verify server-side instead). Mellat is never a valid gateway value.

ALTER TABLE "Transaction" ADD COLUMN "gatewayRef" TEXT;
ALTER TABLE "Transaction" ALTER COLUMN "verifyTokenHash" DROP NOT NULL;
ALTER TABLE "Transaction" ALTER COLUMN "gateway" SET DEFAULT 'zarinpal';
CREATE UNIQUE INDEX "Transaction_gatewayRef_key" ON "Transaction"("gatewayRef");
CREATE INDEX "Transaction_gateway_status_idx" ON "Transaction"("gateway", "status");
