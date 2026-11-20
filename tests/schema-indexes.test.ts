// ============================================================================
// Schema/migration consistency tests (full-remediation audit §6).
//
// The admin_query_indexes migration must exist, must contain exactly the
// missing FK-lookup/cleanup indexes, and the Prisma schema must declare the
// same indexes so `prisma migrate diff` stays clean for fresh databases.
// ============================================================================

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(import.meta.dir, "../prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(import.meta.dir, "../prisma/migrations/20261120120000_admin_query_indexes/migration.sql"),
  "utf8",
);

const expectedIndexes: Array<[model: string, column: string, indexName: string]> = [
  ["Session", "userId", "Session_userId_idx"],
  ["Session", "expiresAt", "Session_expiresAt_idx"],
  ["OtpGrant", "expiresAt", "OtpGrant_expiresAt_idx"],
  ["LoginAttempt", "createdAt", "LoginAttempt_createdAt_idx"],
  ["Invoice", "orderId", "Invoice_orderId_idx"],
  ["Subscription", "orderId", "Subscription_orderId_idx"],
  ["Service", "subscriptionId", "Service_subscriptionId_idx"],
  ["AuditLog", "actorId", "AuditLog_actorId_idx"],
];

for (const [model, column, indexName] of expectedIndexes) {
  test(`schema declares @@index([${column}]) on ${model}`, () => {
    const modelBlock = schema.split(`model ${model} {`)[1]?.split("\n}")[0] ?? "";
    expect(modelBlock).toContain(`@@index([${column}])`);
  });

  test(`migration creates ${indexName}`, () => {
    expect(migration).toContain(`CREATE INDEX "${indexName}"`);
    expect(migration).toContain(`ON "${model}"("${column}")`);
  });
}

test("migration is additive only (no DROP/ALTER of existing structures)", () => {
  expect(migration).not.toMatch(/\bDROP\b/i);
  expect(migration).not.toMatch(/\bALTER\s+TABLE\b/i);
});

test("migration lock still targets postgresql", () => {
  const lock = readFileSync(join(import.meta.dir, "../prisma/migrations/migration_lock.toml"), "utf8");
  expect(lock).toContain("provider = \"postgresql\"");
});
