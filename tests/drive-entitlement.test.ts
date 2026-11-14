// Unit tests: Drive plan-activation policy + login identifier parsing.
// Covers the audit fixes:
//   • a client-supplied planCode can never exceed the server-side entitlement
//   • login identifiers parse/normalize identically on both sides

import { describe, expect, test } from "bun:test";
import { resolveActivatablePlan } from "../src/lib/drive/entitlement-policy";
import { isValidMobile, parseIdentifier, normalizeIdentifierDigits } from "../src/lib/auth/identifier";

describe("resolveActivatablePlan (Drive entitlement policy)", () => {
  test("trial is always allowed — even with no subscription", () => {
    expect(resolveActivatablePlan("trial", null)).toEqual({ ok: true, planCode: "trial" });
    expect(resolveActivatablePlan("trial", "standard")).toEqual({ ok: true, planCode: "trial" });
  });

  test("the entitled plan is allowed", () => {
    expect(resolveActivatablePlan("professional", "professional")).toEqual({
      ok: true,
      planCode: "professional",
    });
  });

  test("a higher paid plan without entitlement is rejected (modified planCode attack)", () => {
    expect(resolveActivatablePlan("enterprise", null).ok).toBe(false);
    expect(resolveActivatablePlan("enterprise", "essential").ok).toBe(false);
    expect(resolveActivatablePlan("business", "standard").ok).toBe(false);
    expect(resolveActivatablePlan("standard", "standard")).toEqual({ ok: true, planCode: "standard" });
  });

  test("unknown plan codes are rejected", () => {
    expect(resolveActivatablePlan("__pending__", "essential").ok).toBe(false);
    expect(resolveActivatablePlan("free", "essential").ok).toBe(false);
    expect(resolveActivatablePlan("", "essential").ok).toBe(false);
  });
});

describe("login identifier parsing (email OR mobile)", () => {
  test("canonical mobile passes and normalizes", () => {
    expect(parseIdentifier("09121111111")).toEqual({ kind: "mobile", value: "09121111111" });
    expect(parseIdentifier("۰۹۱۲۱۱۱۱۱۱۱")).toEqual({ kind: "mobile", value: "09121111111" });
    expect(parseIdentifier("0912-111-1111")).toEqual({ kind: "mobile", value: "09121111111" });
    expect(parseIdentifier(" 0912 111 1111 ")).toEqual({ kind: "mobile", value: "09121111111" });
    expect(parseIdentifier("٠٩١٢١١١١١١١")).toEqual({ kind: "mobile", value: "09121111111" });
  });

  test("emails lowercase and pass", () => {
    expect(parseIdentifier("Demo@Abrit.IR")).toEqual({ kind: "email", value: "demo@abrit.ir" });
    expect(parseIdentifier(" demo@abrit.ir ")).toEqual({ kind: "email", value: "demo@abrit.ir" });
  });

  test("malformed identifiers are rejected with null (generic server error)", () => {
    expect(parseIdentifier("0912111111")).toBeNull(); // 10 digits
    expect(parseIdentifier("091211111112")).toBeNull(); // 12 digits
    expect(parseIdentifier("9121111111")).toBeNull(); // missing 0
    expect(parseIdentifier("not-an-email@@x")).toBeNull();
    expect(parseIdentifier("plain-text")).toBeNull();
    expect(parseIdentifier("")).toBeNull();
  });

  test("normalizeIdentifierDigits never throws and strips zero-width chars", () => {
    expect(normalizeIdentifierDigits("۰۹۱۲-۱۱۱ ۱۱۱۱")).toBe("09121111111");
    expect(normalizeIdentifierDigits("")).toBe("");
  });

  test("isValidMobile matches the canonical 09XXXXXXXXX form", () => {
    expect(isValidMobile("09121111111")).toBe(true);
    expect(isValidMobile("+989121111111")).toBe(false); // canonical form required
  });
});
