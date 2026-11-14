// ============================================================================
// Security test suite (bun test): OTP delivery-mode policy, mobile
// normalization, and service-to-service (Orchard) token authentication.
//
// Only the PURE parts of src/lib/auth/otp.ts are exercised — requestGrant /
// verifyGrant require a live database and are out of scope here. otp.ts
// imports @/lib/db (PrismaClient) and @/lib/sms/smsir at module level, but the
// PrismaClient constructor does not connect eagerly, so importing the module
// under `bun test` is safe (verified).
//
// Environment matrix tests manipulate process.env directly; the original
// values are saved in beforeEach and restored in afterEach.
// ============================================================================

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { otpDeliveryMode, normalizeMobile } from "../src/lib/auth/otp";
import { isServiceRequest } from "../src/lib/auth/rbac";
import { HttpError } from "../src/lib/api/http";

// ---------------------------------------------------------------------------
// env save/restore helpers
// ---------------------------------------------------------------------------

const WATCHED_ENV_KEYS = [
  "NODE_ENV",
  "OTP_DELIVERY_MODE",
  // OTP_PROVIDER is the documented alias of OTP_DELIVERY_MODE (spec §8) and
  // .env may carry the operational OTP_* values — the matrix isolates all of
  // them so tests exercise the CODE defaults, not the local .env.
  "OTP_PROVIDER",
  "ABRIT_SERVICE_TOKEN",
] as const;
let savedEnv: Record<string, string | undefined> = {};

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  savedEnv = {};
  for (const key of WATCHED_ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of WATCHED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** Runs fn and returns the thrown HttpError (fails the test otherwise). */
function captureHttpError(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw new Error(`Expected an HttpError but got: ${String(error)}`);
  }
  throw new Error("Expected the call to throw an HttpError, but it returned normally");
}

// ---------------------------------------------------------------------------
// otpDeliveryMode — environment matrix
// ---------------------------------------------------------------------------

describe("otpDeliveryMode env matrix", () => {
  describe("NODE_ENV=production", () => {
    test("display mode is FORBIDDEN (fails safe with HttpError)", () => {
      setEnv({ NODE_ENV: "production", OTP_DELIVERY_MODE: "display" });
      const error = captureHttpError(() => otpDeliveryMode());
      expect(error.status).toBe(500);
      expect(error.code).toBe("OTP_DISPLAY_FORBIDDEN_IN_PRODUCTION");
    });

    test("display mode is forbidden regardless of case/whitespace", () => {
      setEnv({ NODE_ENV: "production", OTP_DELIVERY_MODE: "  DISPLAY  " });
      expect(() => otpDeliveryMode()).toThrow(HttpError);
    });

    test("explicit sms mode is honored", () => {
      setEnv({ NODE_ENV: "production", OTP_DELIVERY_MODE: "sms" });
      expect(otpDeliveryMode()).toBe("sms");
    });

    test("default (unset) falls back to sms", () => {
      setEnv({ NODE_ENV: "production", OTP_DELIVERY_MODE: undefined });
      expect(otpDeliveryMode()).toBe("sms");
    });
  });

  describe("NODE_ENV=development", () => {
    test("display mode is allowed", () => {
      setEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "display" });
      expect(otpDeliveryMode()).toBe("display");
    });

    test("case-insensitive request values are normalized", () => {
      setEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "DISPLAY" });
      expect(otpDeliveryMode()).toBe("display");
      setEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "  Sms  " });
      expect(otpDeliveryMode()).toBe("sms");
    });

    test("explicit sms mode is honored", () => {
      setEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "sms" });
      expect(otpDeliveryMode()).toBe("sms");
    });

    test("default (unset) is display in development", () => {
      // Both the mode and its documented alias must be unset — .env may carry
      // OTP_PROVIDER=sms for operations, which is not a CODE default.
      setEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: undefined, OTP_PROVIDER: undefined });
      expect(otpDeliveryMode()).toBe("display");
    });

    test("unrecognized values fall back to the environment default", () => {
      setEnv({ NODE_ENV: "development", OTP_DELIVERY_MODE: "pigeon" });
      expect(otpDeliveryMode()).toBe("display");
    });
  });

  describe("non-production, non-development environments (e.g. bun's NODE_ENV=test)", () => {
    test("display is allowed anywhere that is not production", () => {
      setEnv({ NODE_ENV: "test", OTP_DELIVERY_MODE: "display" });
      expect(otpDeliveryMode()).toBe("display");
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeMobile — Persian/Arabic digits, strict 09xxxxxxxxx format
// ---------------------------------------------------------------------------

describe("normalizeMobile", () => {
  test("plain ASCII mobile passes through", () => {
    expect(normalizeMobile("09123456789")).toBe("09123456789");
  });

  test("Persian digits are normalized to ASCII", () => {
    expect(normalizeMobile("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
  });

  test("Arabic-Indic digits are normalized to ASCII", () => {
    expect(normalizeMobile("٠٩١٢٣٤٥٦٧٨٩")).toBe("09123456789");
  });

  test("mixed Persian digits with separators are normalized", () => {
    expect(normalizeMobile("۰۹۱۲-۳۴۵ ۶۷۸۹")).toBe("09123456789");
  });

  test("separators (spaces/dashes) are stripped", () => {
    expect(normalizeMobile("0912 345 6789")).toBe("09123456789");
    expect(normalizeMobile("0912-345-6789")).toBe("09123456789");
  });

  test("+98… international format is NOT supported → HttpError 400", () => {
    const error = captureHttpError(() => normalizeMobile("+989123456789"));
    expect(error.status).toBe(400);
    expect(error.code).toBe("INVALID_MOBILE");
  });

  test("0098… international format is NOT supported → HttpError 400", () => {
    expect(() => normalizeMobile("00989123456789")).toThrow(HttpError);
  });

  test("missing leading 0 is rejected", () => {
    expect(() => normalizeMobile("9123456789")).toThrow(HttpError);
  });

  test("wrong lengths are rejected", () => {
    expect(() => normalizeMobile("0912345678")).toThrow(HttpError); // 10 digits
    expect(() => normalizeMobile("091234567890")).toThrow(HttpError); // 12 digits
  });

  test("wrong prefixes are rejected", () => {
    expect(() => normalizeMobile("01123456789")).toThrow(HttpError); // must start with 09
    expect(() => normalizeMobile("98123456789")).toThrow(HttpError);
  });

  test("empty / non-numeric input is rejected with HttpError 400 INVALID_MOBILE", () => {
    for (const bad of ["", "   ", "abcdefghijk", "۰۹۱۲۳۴۵۶۷۸a", "09abcdefghi"]) {
      const error = captureHttpError(() => normalizeMobile(bad));
      expect(error.status).toBe(400);
      expect(error.code).toBe("INVALID_MOBILE");
    }
  });

  test("Persian-digit invalid formats are rejected too (not silently coerced)", () => {
    // 10 Persian digits — still invalid after normalization.
    expect(() => normalizeMobile("۰۹۱۲۳۴۵۶۷۸")).toThrow(HttpError);
    // Persian-digit +98 style.
    expect(() => normalizeMobile("+۹۸۹۱۲۳۴۵۶۷۸۹")).toThrow(HttpError);
  });
});

// ---------------------------------------------------------------------------
// isServiceRequest — service-to-service (Orchard) token authentication
// ---------------------------------------------------------------------------

describe("isServiceRequest", () => {
  const LONG_TOKEN = "abrit-orchard-service-token-6f3a1c9e2b7d4805"; // ≥ 16 chars
  const OTHER_LONG_TOKEN = "another-very-long-token-value-0000000000000000";

  function serviceRequest(headers: Record<string, string>): Request {
    return new Request("http://x/test", { headers });
  }

  test("configured long token + matching X-Abrit-Service-Token header → true", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: LONG_TOKEN });
    expect(isServiceRequest(serviceRequest({ "X-Abrit-Service-Token": LONG_TOKEN }))).toBe(true);
  });

  test("header name is case-insensitive", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: LONG_TOKEN });
    expect(isServiceRequest(serviceRequest({ "x-abrit-service-token": LONG_TOKEN }))).toBe(true);
  });

  test("wrong token → false", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: LONG_TOKEN });
    expect(isServiceRequest(serviceRequest({ "X-Abrit-Service-Token": OTHER_LONG_TOKEN }))).toBe(false);
  });

  test("no header → false", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: LONG_TOKEN });
    expect(isServiceRequest(serviceRequest({}))).toBe(false);
    expect(isServiceRequest(new Request("http://x/test"))).toBe(false);
  });

  test("empty header value → false", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: LONG_TOKEN });
    expect(isServiceRequest(serviceRequest({ "X-Abrit-Service-Token": "" }))).toBe(false);
  });

  test("short secret (< 16 chars) is refused even when the header matches", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: "short-secret" });
    expect(isServiceRequest(serviceRequest({ "X-Abrit-Service-Token": "short-secret" }))).toBe(false);
  });

  test("whitespace-only secret is refused", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: "        " });
    expect(isServiceRequest(serviceRequest({ "X-Abrit-Service-Token": "        " }))).toBe(false);
  });

  test("unset secret → always false", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: undefined });
    expect(isServiceRequest(serviceRequest({ "X-Abrit-Service-Token": LONG_TOKEN }))).toBe(false);
  });

  test("Bearer Authorization header is accepted as an alternative", () => {
    setEnv({ ABRIT_SERVICE_TOKEN: LONG_TOKEN });
    expect(isServiceRequest(serviceRequest({ Authorization: `Bearer ${LONG_TOKEN}` }))).toBe(true);
    expect(isServiceRequest(serviceRequest({ Authorization: `Bearer ${OTHER_LONG_TOKEN}` }))).toBe(false);
    // Non-Bearer authorization schemes do not count.
    expect(isServiceRequest(serviceRequest({ Authorization: `Basic ${LONG_TOKEN}` }))).toBe(false);
  });
});
