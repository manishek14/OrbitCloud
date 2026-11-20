// ============================================================================
// readJson body-limit tests (full-remediation audit §2.2).
//
// The limit is enforced on REAL BYTES:
//   • a Content-Length above the cap is rejected before reading;
//   • a streamed body is aborted the moment its BYTE count exceeds the cap —
//     multi-byte UTF-8 payloads (e.g. Persian text) are measured by byte
//     length, not JavaScript character units (the previous implementation
//     buffered the whole body and compared raw.length, so a 2 MB Persian
//     payload could pass a 1 MiB "byte" limit);
//   • invalid JSON → 400 INVALID_JSON (previously silently mapped to null);
//   • multipart/form bodies → 415 (readJson is a JSON reader);
//   • empty bodies still return null; a UTF-8 BOM is tolerated.
// ============================================================================

import { describe, test, expect } from "bun:test";
import { HttpError, MAX_JSON_BYTES, readJson } from "../src/lib/api/http";

function post(body: string | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    ...(body === null ? {} : { body }),
    headers,
  });
}

describe("readJson — byte-based limits", () => {
  test("exports a positive byte cap", () => {
    expect(MAX_JSON_BYTES).toBeGreaterThan(0);
  });

  test("a Persian payload whose BYTE size exceeds the cap is rejected (413)", async () => {
    // "ا" is 2 bytes in UTF-8 but 1 UTF-16 code unit: byteLength ≈ 2 × length.
    // The old character-count check let this through; bytes must not.
    const repeats = Math.floor(MAX_JSON_BYTES / 2) + 1024;
    const payload = JSON.stringify({ note: "ا".repeat(repeats) });
    expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(MAX_JSON_BYTES);
    expect(payload.length).toBeLessThan(MAX_JSON_BYTES); // proves the old check passed it

    let caught: unknown;
    try {
      await readJson(post(payload, { "content-type": "application/json" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(413);
    expect((caught as HttpError).code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("a declared Content-Length above the cap is rejected before the body is read", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      body: "irrelevant",
      headers: { "content-length": String(MAX_JSON_BYTES + 1) },
    });
    let caught: unknown;
    try {
      await readJson(request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(413);
  });

  test("a payload just under the cap parses fine", async () => {
    const payload = JSON.stringify({ ok: true, pad: "x".repeat(1024) });
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThan(MAX_JSON_BYTES);
    const parsed = await readJson<{ ok: boolean }>(post(payload, { "content-type": "application/json" }));
    expect(parsed?.ok).toBe(true);
  });
});

describe("readJson — JSON validity & content type", () => {
  test("empty body → null", async () => {
    expect(await readJson(post(null))).toBeNull();
    expect(await readJson(post(""))).toBeNull();
    expect(await readJson(post("   "))).toBeNull();
  });

  test("invalid JSON → 400 INVALID_JSON (no silent null)", async () => {
    let caught: unknown;
    try {
      await readJson(post("{not valid json", { "content-type": "application/json" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(400);
    expect((caught as HttpError).code).toBe("INVALID_JSON");
  });

  test("multipart form data → 415 (readJson only reads JSON)", async () => {
    let caught: unknown;
    try {
      await readJson(post("x=1", { "content-type": "multipart/form-data; boundary=--" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(415);
  });

  test("url-encoded forms → 415", async () => {
    let caught: unknown;
    try {
      await readJson(post("a=1", { "content-type": "application/x-www-form-urlencoded" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(415);
  });

  test("text/plain content type is tolerated (fetch() string bodies default to it)", async () => {
    const parsed = await readJson<{ v: number }>(post(JSON.stringify({ v: 7 }), { "content-type": "text/plain;charset=UTF-8" }));
    expect(parsed?.v).toBe(7);
  });

  test("a UTF-8 BOM before the JSON still parses", async () => {
    const payload = "\uFEFF" + JSON.stringify({ bom: true });
    const parsed = await readJson<{ bom: boolean }>(post(payload, { "content-type": "application/json" }));
    expect(parsed?.bom).toBe(true);
  });

  test("Persian content round-trips correctly", async () => {
    const payload = JSON.stringify({ name: "مانی شکفته", mobile: "۰۹۱۲۳۴۵۶۷۸۹" });
    const parsed = await readJson<{ name: string; mobile: string }>(post(payload, { "content-type": "application/json" }));
    expect(parsed?.name).toBe("مانی شکفته");
    expect(parsed?.mobile).toBe("۰۹۱۲۳۴۵۶۷۸۹");
  });
});
