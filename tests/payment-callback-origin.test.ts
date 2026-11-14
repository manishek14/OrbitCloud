import { describe, expect, test } from "bun:test";
import { publicPaymentOrigin } from "../src/lib/payments/callback-origin";

describe("public payment callback origin", () => {
  test("accepts a configurable public HTTPS tunnel origin", () => {
    expect(publicPaymentOrigin("https://abc123.trycloudflare.com/")).toBe("https://abc123.trycloudflare.com");
    expect(publicPaymentOrigin("https://shop.example.ir")).toBe("https://shop.example.ir");
  });

  test("missing configuration fails before payment initiation", () => {
    expect(() => publicPaymentOrigin("")).toThrow();
    try { publicPaymentOrigin(""); } catch (error) {
      expect(error).toMatchObject({ code: "PUBLIC_BASE_URL_MISSING", status: 503 });
    }
  });

  test("rejects insecure, local, provider, and non-origin URLs", () => {
    for (const value of [
      "http://portal.example.ir", "http://localhost:3000", "https://127.0.0.1",
      "https://sandbox.zarinpal.com/", "https://gateway.zibal.ir",
      "https://portal.example.ir/path", "https://portal.example.ir?next=1",
      "https://user:pass@portal.example.ir", "not-a-url",
    ]) {
      expect(() => publicPaymentOrigin(value)).toThrow();
    }
  });
});
