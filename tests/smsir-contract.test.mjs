import test from "node:test";
import assert from "node:assert/strict";
import { sendVerifyOtp } from "../src/lib/sms/smsir.ts";

process.env.SMSIR_API_KEY = "test-key-never-sent";
process.env.SMSIR_TEMPLATE_ID = "123456";
process.env.SMSIR_OTP_PARAMETER_NAME = "Code";

async function withResponse(status, body, check) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.sms.ir/v1/send/verify");
    assert.equal(init.headers["x-api-key"], "test-key-never-sent");
    assert.deepEqual(JSON.parse(init.body), {
      mobile: "09120000000",
      templateId: 123456,
      parameters: [{ name: "Code", value: "123456" }],
    });
    return new Response(JSON.stringify(body), { status });
  };
  try { await check(); } finally { globalThis.fetch = originalFetch; }
}

test("rejects a success-looking body on HTTP failure", async () => {
  await withResponse(500, { status: 1, data: { messageId: 42 } }, async () => {
    assert.equal((await sendVerifyOtp("09120000000", "123456")).ok, false);
  });
});

test("rejects a success status without a provider message id", async () => {
  await withResponse(200, { status: 1, data: {} }, async () => {
    assert.equal((await sendVerifyOtp("09120000000", "123456")).ok, false);
  });
});

test("accepts only a valid provider acknowledgement", async () => {
  await withResponse(200, { status: 1, data: { messageId: 42, cost: 1 } }, async () => {
    assert.deepEqual(await sendVerifyOtp("09120000000", "123456"), {
      ok: true, messageId: 42, cost: 1,
    });
  });
});
