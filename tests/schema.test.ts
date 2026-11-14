// ============================================================================
// Prisma schema test suite (bun test) — source-text assertions on
// prisma/schema.prisma.
//
// Covers the production-correction invariants:
//   • datasource provider is postgresql (never sqlite),
//   • Transaction.gatewayRef exists and is @unique (a repeated provider
//     callback can never create or match two transactions),
//   • the durable SmsOutbox model exists (with its idempotency key).
// ============================================================================

import { describe, test, expect, beforeAll } from "bun:test";

const schemaPath = `${import.meta.dir}/../prisma/schema.prisma`;

let schema: string;

beforeAll(async () => {
  schema = await Bun.file(schemaPath).text();
});

/** Extracts a `model Name { ... }` block (models contain no nested braces). */
function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`model ${name} not found in schema.prisma`);
  return match[0];
}

describe("prisma schema (source text)", () => {
  test("datasource provider is postgresql", () => {
    expect(schema).toMatch(/provider\s*=\s*"postgresql"/);
    const datasource = schema.match(/datasource db \{[\s\S]*?\}/)?.[0] ?? "";
    expect(datasource).toContain('"postgresql"');
    expect(datasource).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
  });

  test("no sqlite provider anywhere in the schema", () => {
    expect(schema).not.toContain('provider = "sqlite"');
    expect(schema).not.toMatch(/provider\s*=\s*"sqlite"/);
  });

  test("Transaction.gatewayRef is optional and @unique", () => {
    const transaction = modelBlock("Transaction");
    expect(transaction).toMatch(/gatewayRef\s+String\?\s*@unique/);
    // The unique constraint is on the column itself (inline @unique), and the
    // column is nullable (real gateways rely on provider-side verification).
    expect(transaction).toMatch(/gatewayRef\s+String\?/);
  });

  test("gatewayRef is defined only on the Transaction model", () => {
    const occurrences = schema.match(/gatewayRef/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(modelBlock("Transaction")).toContain("gatewayRef");
  });

  test("Transaction.gateway documents the never-selectable mellat gateway", () => {
    const transaction = modelBlock("Transaction");
    expect(transaction).toMatch(/gateway\s+String\s+@default\("zarinpal"\)/);
    expect(transaction).toContain("mellat never selectable");
  });

  test("the durable SmsOutbox model exists with a unique idempotency key", () => {
    const smsOutbox = modelBlock("SmsOutbox");
    expect(smsOutbox).toMatch(/idempotencyKey\s+String\s+@unique/);
    expect(smsOutbox).toMatch(/purpose\s+String/);
    expect(smsOutbox).toMatch(/mobile\s+String/);
    expect(smsOutbox).toMatch(/provider\s+String\s+@default\("smsir"\)/);
    expect(smsOutbox).toMatch(/status\s+String\s+@default\("pending"\)/);
    // Security: the OTP code itself is never a column of the outbox.
    expect(smsOutbox).not.toContain("code");
  });

  test("SmsOutbox has an OtpGrant sibling (durable OTP grants)", () => {
    expect(schema).toMatch(/model OtpGrant \{/);
    const otpGrant = modelBlock("OtpGrant");
    expect(otpGrant).toMatch(/codeHash\s+String/);
    expect(otpGrant).toMatch(/consumedAt\s+DateTime\?/);
  });
});
