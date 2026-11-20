// ============================================================================
// Grant hashing tests (audit §3.5): OTP / recovery codes must be stored as
// KEYED HMACs — not plain SHA-256 — and verified timing-safely with support
// for secret rotation and legacy (pre-HMAC) grants.
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { hashGrantCode, verifyGrantCode, isGrantSecretConfigured } from "../src/lib/auth/grant-hash";

const WATCHED = ["NODE_ENV", "OTP_HMAC_SECRET", "OTP_HMAC_SECRET_PREVIOUS", "ABRIT_SERVICE_TOKEN"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of WATCHED) saved[key] = process.env[key];
  process.env.OTP_HMAC_SECRET = "test-secret-a";
  delete process.env.OTP_HMAC_SECRET_PREVIOUS;
  delete process.env.ABRIT_SERVICE_TOKEN;
});

afterEach(() => {
  for (const key of WATCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("grant hashing (audit §3.5)", () => {
  test("stored hash is a keyed HMAC, never the plain SHA-256 of the code", () => {
    const stored = hashGrantCode("123456", "login");
    const plain = createHash("sha256").update("123456", "utf8").digest("hex");
    expect(stored).not.toBe(plain);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  test("the same code + purpose hashes identically (deterministic storage)", () => {
    expect(hashGrantCode("123456", "login")).toBe(hashGrantCode("123456", "login"));
  });

  test("codes are bound to their purpose — a login code cannot verify as register", () => {
    const stored = hashGrantCode("123456", "login");
    expect(verifyGrantCode(stored, "123456", "login")).toBe(true);
    expect(verifyGrantCode(stored, "123456", "register")).toBe(false);
  });

  test("wrong code is rejected", () => {
    const stored = hashGrantCode("123456", "login");
    expect(verifyGrantCode(stored, "123455", "login")).toBe(false);
    expect(verifyGrantCode(stored, "123457", "login")).toBe(false);
  });

  test("secret rotation: a grant hashed under the previous secret still verifies", () => {
    const stored = hashGrantCode("123456", "recover");
    // Rotate: previous secret becomes OTP_HMAC_SECRET_PREVIOUS.
    process.env.OTP_HMAC_SECRET_PREVIOUS = process.env.OTP_HMAC_SECRET as string;
    process.env.OTP_HMAC_SECRET = "test-secret-b";
    expect(hashGrantCode("123456", "recover")).not.toBe(stored);
    expect(verifyGrantCode(stored, "123456", "recover")).toBe(true);
    // New grants verify under the new secret directly.
    expect(verifyGrantCode(hashGrantCode("654321", "recover"), "654321", "recover")).toBe(true);
  });

  test("legacy pre-HMAC grants (plain SHA-256) still verify during the transition window", () => {
    const legacy = createHash("sha256").update("123456", "utf8").digest("hex");
    expect(verifyGrantCode(legacy, "123456", "login")).toBe(true);
    expect(verifyGrantCode(legacy, "111111", "login")).toBe(false);
  });

  test("production without any secret fails explicitly instead of weakening", () => {
    process.env.NODE_ENV = "production";
    delete process.env.OTP_HMAC_SECRET;
    delete process.env.ABRIT_SERVICE_TOKEN;
    expect(isGrantSecretConfigured()).toBe(false);
    expect(() => hashGrantCode("123456", "login")).toThrow(/OTP_HMAC_SECRET/);
  });

  test("production falls back to the service token when no dedicated secret is set", () => {
    process.env.NODE_ENV = "production";
    delete process.env.OTP_HMAC_SECRET;
    process.env.ABRIT_SERVICE_TOKEN = "a-service-token-of-sufficient-length";
    expect(isGrantSecretConfigured()).toBe(true);
    const stored = hashGrantCode("123456", "login");
    expect(verifyGrantCode(stored, "123456", "login")).toBe(true);
  });

  test("development without a secret uses the warned fallback (display mode is dev-only anyway)", () => {
    process.env.NODE_ENV = "development";
    delete process.env.OTP_HMAC_SECRET;
    delete process.env.ABRIT_SERVICE_TOKEN;
    expect(isGrantSecretConfigured()).toBe(true);
    const stored = hashGrantCode("123456", "login");
    expect(verifyGrantCode(stored, "123456", "login")).toBe(true);
  });
});
