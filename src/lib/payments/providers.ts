// ============================================================================
// Payment gateway provider layer — REAL sandbox integrations.
//
// Verified against the providers' live sandbox APIs on 2026-11-13:
//
// ZarinPal Payment Gateway v4 (https://www.zarinpal.com/docs/):
//   Request:  POST {base}/pg/v4/payment/request.json
//             { merchant_id, amount (Rial), callback_url, description }
//             → data.code == 100 + data.authority        (verified live)
//   Redirect: {base}/pg/StartPay/{authority}             (verified live)
//   Callback: GET callback_url?Authority=...&Status=OK|NOK
//   Verify:   POST {base}/pg/v4/payment/verify.json
//             { merchant_id, amount (Rial), authority }
//             → data.code 100 (success) | 101 (already verified) | negative
//             error codes (e.g. -51 for an unpaid/invalid session — verified)
//   Sandbox base: https://sandbox.zarinpal.com   Live base: https://api.zarinpal.com
//
// Zibal (https://help.zibal.ir/):
//   Request:  POST https://gateway.zibal.ir/v1/request
//             { merchant, amount (Rial), callbackUrl, description }
//             → result == 100 + trackId                   (verified live)
//   Redirect: https://gateway.zibal.ir/start/{trackId}    (verified live)
//   Callback: GET callbackUrl?success=1|0&status=&trackId=&orderId=
//   Verify:   POST https://gateway.zibal.ir/v1/verify
//             { merchant, trackId }
//             → result 100 (success) | 201 (already verified) | 202 (failed)
//             (202 for an unpaid trackId — verified live)
//   Test/sandbox merchant: the literal documented value "zibal".
//
// Currency: the commercial catalog is in TOMAN (IRT). Both providers operate
// in RIAL (IRR). The conversion happens EXACTLY ONCE, inside each provider
// adapter (× 10), and the verified provider amount is compared with the
// stored server-side Toman amount before any order is finalized.
//
// Bank Mellat is intentionally NOT implemented as a selectable provider: it
// is disabled by configuration, excluded from the selectable methods and
// rejected by server-side provider selection (see selectGateway).
//
// The bundled mock provider is an internal dev/test facility only — it is
// excluded from customer-selectable methods unless explicitly enabled via
// ABRIT_PAYMENTS_MOCK_ENABLED=true in an isolated development environment.
// ============================================================================

export type GatewayId = "zarinpal" | "zibal" | "mock";

export interface PaymentProviderConfig {
  id: GatewayId;
  labelFa: string;
  /** Sandbox (test) mode — always true for this deployment phase. */
  mode: "sandbox" | "test";
  enabled: boolean;
  /** Human-readable status for admin/settings displays. */
  noteFa: string;
}

export interface InitiateArgs {
  amountToman: number;
  orderNumber: string;
  description: string;
  callbackUrl: string;
}

export interface InitiateResult {
  /** Provider reference (ZarinPal authority / Zibal trackId). */
  gatewayRef: string;
  /** URL the customer's browser must be sent to (the provider payment page). */
  redirectUrl: string;
  raw: unknown;
}

export type VerifyOutcome =
  | { ok: true; alreadyVerified: boolean; amountToman: number; raw: unknown }
  | { ok: false; reason: "not_paid" | "amount_mismatch" | "invalid_response"; raw: unknown }
  | { ok: false; reason: "ambiguous"; detailFa: string; raw: unknown };

export interface PaymentProvider {
  id: GatewayId;
  initiate(args: InitiateArgs): Promise<InitiateResult>;
  /**
   * Server-to-server verification. MUST be called before any order is marked
   * paid. The verified amount is returned in Toman for comparison.
   */
  verify(args: { amountToman: number; gatewayRef: string }): Promise<VerifyOutcome>;
}

// ---------------------------------------------------------------------------
// Configuration (environment-based; sandbox defaults; no real credentials)
// ---------------------------------------------------------------------------

const TOMAN_TO_RIAL = 10;

function validAmountToman(amount: number): boolean {
  // Zarinpal's documented minimum is 10,000 Rial; use the same floor for
  // both selectable gateways so checkout rejects an invalid order early.
  return Number.isSafeInteger(amount) && amount >= 1000 && Number.isSafeInteger(amount * TOMAN_TO_RIAL);
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

// Sandbox merchant identifiers are PUBLIC documented test values — never real
// credentials. ZarinPal's sandbox accepts any 36-char UUID merchant; Zibal's
// documented test merchant is the literal string "zibal".
const ZARINPAL_SANDBOX_MERCHANT_DEFAULT = "6cded4c4-0f92-4e37-bbb5-1b9a2f3e6a12";

const zarinpalConfig = {
  merchantId: env("ABRIT_PAYMENTS_ZARINPAL_MERCHANT_ID") ?? ZARINPAL_SANDBOX_MERCHANT_DEFAULT,
  sandbox: (env("ABRIT_PAYMENTS_ZARINPAL_SANDBOX") ?? "true") !== "false",
  get baseUrl() {
    // Sandbox mode is mandatory for this phase; live mode requires an explicit
    // opt-out and real (env-provided) credentials.
    return this.sandbox ? "https://sandbox.zarinpal.com" : "https://api.zarinpal.com";
  },
  enabled: (env("ABRIT_PAYMENTS_ZARINPAL_ENABLED") ?? "true") !== "false",
};

const zibalConfig = {
  merchant: env("ABRIT_PAYMENTS_ZIBAL_MERCHANT") ?? "zibal", // documented test merchant
  baseUrl: env("ABRIT_PAYMENTS_ZIBAL_BASE_URL") ?? "https://gateway.zibal.ir",
  enabled: (env("ABRIT_PAYMENTS_ZIBAL_ENABLED") ?? "true") !== "false",
};

const mockEnabled = process.env.NODE_ENV !== "production" && env("ABRIT_PAYMENTS_MOCK_ENABLED") === "true";

/** Mellat is disabled by configuration — see selectGateway for enforcement. */
export const MELLAT_STATUS_FA =
  "بانک ملت طبق تصمیم پیکربندی غیرفعال است (Mellat disabled) و در هیچ مسیر پرداختی انتخاب نمی‌شود.";

// ---------------------------------------------------------------------------
// HTTP helper with timeout
// ---------------------------------------------------------------------------

async function postJson(url: string, body: unknown, timeoutMs = 20000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`GATEWAY_INVALID_JSON:${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// ZarinPal (v4, sandbox)
// ---------------------------------------------------------------------------

const zarinPalProvider: PaymentProvider = {
  id: "zarinpal",
  async initiate({ amountToman, description, callbackUrl }) {
    if (!validAmountToman(amountToman)) throw new Error("INVALID_PAYMENT_AMOUNT");
    const payload = {
      merchant_id: zarinpalConfig.merchantId,
      amount: amountToman * TOMAN_TO_RIAL, // Toman → Rial (the ONLY conversion site)
      callback_url: callbackUrl,
      description,
    };
    const raw = await postJson(`${zarinpalConfig.baseUrl}/pg/v4/payment/request.json`, payload);
    const data = asRecord(asRecord(raw).data);
    const authority = typeof data.authority === "string" ? data.authority : "";
    const code = Number(data.code);
    if (code !== 100 || !authority) {
      const errors = asRecord(asRecord(raw).errors);
      throw new Error(
        `ZARINPAL_REQUEST_FAILED:code=${Number.isFinite(code) ? code : "none"}:msg=${String(errors.message ?? data.message ?? "unknown")}`,
      );
    }
    return {
      gatewayRef: authority,
      redirectUrl: `${zarinpalConfig.baseUrl}/pg/StartPay/${authority}`,
      raw,
    };
  },
  async verify({ amountToman, gatewayRef }) {
    if (!validAmountToman(amountToman)) return { ok: false, reason: "invalid_response", raw: null };
    let raw: unknown;
    try {
      raw = await postJson(`${zarinpalConfig.baseUrl}/pg/v4/payment/verify.json`, {
        merchant_id: zarinpalConfig.merchantId,
        amount: amountToman * TOMAN_TO_RIAL, // Rial
        authority: gatewayRef,
      });
    } catch (error) {
      return {
        ok: false as const,
        reason: "ambiguous" as const,
        detailFa: "استعلام تأیید پرداخت زرین‌پال با خطای شبکه روبه‌رو شد؛ تراکنش در حال بررسی باقی می‌ماند.",
        raw: { error: error instanceof Error ? error.message : "network" },
      };
    }
    const body = asRecord(raw);
    const data = asRecord(body.data);
    const errors = asRecord(body.errors);
    // ZarinPal places success codes in data.code and error codes in
    // errors.code (verified live: unpaid session → {"data":{},"errors":{"code":-51}}).
    const code = Number(data.code ?? errors.code);
    // 100 = verified now, 101 = already verified (idempotent duplicate).
    if (code === 100 || code === 101) {
      // Cross-check the provider-confirmed amount (Rial) against the stored
      // server-side order amount — a mismatch is never finalized. The amount
      // is MANDATORY on a success response: a "success" without a verifiable
      // integer amount is treated as a mismatch, not silently accepted
      // (full-remediation audit §3.4 — previously a missing data.amount
      // skipped the check entirely).
      const paidRial = Number(data.amount);
      if (!Number.isSafeInteger(paidRial) || paidRial <= 0 || paidRial !== amountToman * TOMAN_TO_RIAL) {
        return { ok: false as const, reason: "amount_mismatch" as const, raw };
      }
      return { ok: true as const, alreadyVerified: code === 101, amountToman, raw };
    }
    if (code === -51 || code === -52 || code === -53 || code === -54) {
      // Session not valid / not paid — definitive not-paid.
      return { ok: false as const, reason: "not_paid" as const, raw };
    }
    // Any other code is ambiguous: keep pending for reconciliation.
    return {
      ok: false as const,
      reason: "ambiguous" as const,
      detailFa: `پاسخ استعلام زرین‌پال قطعی نبود (کد ${Number.isFinite(code) ? code : "نامشخص"}); تراکنش در حال بررسی باقی می‌ماند.`,
      raw,
    };
  },
};

// ---------------------------------------------------------------------------
// Zibal
// ---------------------------------------------------------------------------

const zibalProvider: PaymentProvider = {
  id: "zibal",
  async initiate({ amountToman, orderNumber, description, callbackUrl }) {
    if (!validAmountToman(amountToman)) throw new Error("INVALID_PAYMENT_AMOUNT");
    const raw = await postJson(`${zibalConfig.baseUrl}/v1/request`, {
      merchant: zibalConfig.merchant,
      amount: amountToman * TOMAN_TO_RIAL, // Toman → Rial (the ONLY conversion site)
      callbackUrl,
      description,
      orderId: orderNumber,
    });
    const body = asRecord(raw);
    const result = Number(body.result);
    const trackId = typeof body.trackId === "number" || typeof body.trackId === "string" ? String(body.trackId) : "";
    if (result !== 100 || !trackId) {
      throw new Error(`ZIBAL_REQUEST_FAILED:result=${Number.isFinite(result) ? result : "none"}:msg=${String(body.message ?? "unknown")}`);
    }
    return {
      gatewayRef: trackId,
      redirectUrl: `https://gateway.zibal.ir/start/${trackId}`,
      raw,
    };
  },
  async verify({ amountToman, gatewayRef }) {
    if (!validAmountToman(amountToman) || !/^[1-9]\d*$/.test(gatewayRef) || !Number.isSafeInteger(Number(gatewayRef))) {
      return { ok: false, reason: "invalid_response", raw: null };
    }
    let raw: unknown;
    try {
      raw = await postJson(`${zibalConfig.baseUrl}/v1/verify`, {
        merchant: zibalConfig.merchant,
        trackId: Number(gatewayRef),
      });
    } catch (error) {
      return {
        ok: false as const,
        reason: "ambiguous" as const,
        detailFa: "استعلام تأیید پرداخت زیبال با خطای شبکه روبه‌رو شد؛ تراکنش در حال بررسی باقی می‌ماند.",
        raw: { error: error instanceof Error ? error.message : "network" },
      };
    }
    const body = asRecord(raw);
    const result = Number(body.result);
    if (result === 100 || result === 201) {
      // Verify the paid amount matches the server-side order amount.
      const paidRial = Number(body.amount);
      if (!Number.isSafeInteger(paidRial) || paidRial !== amountToman * TOMAN_TO_RIAL) {
        return { ok: false as const, reason: "amount_mismatch" as const, raw };
      }
      return { ok: true as const, alreadyVerified: result === 201, amountToman, raw };
    }
    if (result === 202 || result === 203) {
      // Transaction not found / failed / not paid — definitive.
      return { ok: false as const, reason: "not_paid" as const, raw };
    }
    return {
      ok: false as const,
      reason: "ambiguous" as const,
      detailFa: `پاسخ استعلام زیبال قطعی نبود (کد ${Number.isFinite(result) ? result : "نامشخص"}); تراکنش در حال بررسی باقی می‌ماند.`,
      raw,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry + selection (server-side enforcement)
// ---------------------------------------------------------------------------

const providers: Record<GatewayId, PaymentProvider> = {
  zarinpal: zarinPalProvider,
  zibal: zibalProvider,
  mock: {
    id: "mock",
    // The internal mock provider is intentionally NOT wired to real initiate
    // flows here; the legacy dev-only test gateway keeps its own route. It is
    // listed in the registry only for the settings display.
    async initiate() {
      throw new Error("MOCK_PROVIDER_DISABLED");
    },
    async verify() {
      return { ok: false as const, reason: "invalid_response" as const, raw: { note: "mock disabled" } };
    },
  },
};

export function getProvider(id: string): PaymentProvider | null {
  return providers[id as GatewayId] ?? null;
}

/** Customer-selectable gateways (ZarinPal Sandbox + Zibal Sandbox; Mellat excluded). */
export function selectableGateways(): (PaymentProviderConfig & { gateway: GatewayId })[] {
  const list: (PaymentProviderConfig & { gateway: GatewayId })[] = [];
  if (zarinpalConfig.enabled) {
    list.push({
      gateway: "zarinpal",
      id: "zarinpal",
      labelFa: "زرین‌پال (Sandbox)",
      mode: "sandbox",
      enabled: true,
      noteFa: "درگاه آزمایشی زرین‌پال — پرداخت واقعی انجام نمی‌شود.",
    });
  }
  if (zibalConfig.enabled) {
    list.push({
      gateway: "zibal",
      id: "zibal",
      labelFa: "زیبال (Sandbox)",
      mode: "test",
      enabled: true,
      noteFa: "درگاه آزمایشی زیبال — پرداخت واقعی انجام نمی‌شود.",
    });
  }
  if (mockEnabled) {
    list.push({
      gateway: "mock",
      id: "mock",
      labelFa: "درگاه داخلی تست",
      mode: "test",
      enabled: true,
      noteFa: "فقط محیط توسعه/تست — در پیکربندی تولید غیرفعال است.",
    });
  }
  return list;
}

/**
 * Server-side provider selection. Mellat is rejected here unconditionally —
 * it can never be selected, regardless of client input or configuration.
 */
export function selectGateway(id: string | undefined | null): { provider: PaymentProvider } | { error: string } {
  const raw = String(id ?? "").trim().toLowerCase();
  if (raw === "mellat" || raw === "bank-mellat") {
    return { error: MELLAT_STATUS_FA };
  }
  if (raw === "mock") {
    if (!mockEnabled) {
      return { error: "درگاه داخلی تست فقط در محیط توسعه فعال است." };
    }
    return { provider: providers.mock };
  }
  if (raw === "zarinpal" && zarinpalConfig.enabled) return { provider: zarinPalProvider };
  if (raw === "zibal" && zibalConfig.enabled) return { provider: zibalProvider };
  return { error: "درگاه پرداخت انتخابی معتبر یا فعال نیست." };
}

/** Status summary for the admin settings page (single source of truth). */
export function gatewayStatusSummary() {
  return {
    zarinpal: {
      enabled: zarinpalConfig.enabled,
      mode: "sandbox",
      label: "ZarinPal Sandbox",
      note: "درگاه آزمایشی زرین‌پال (pg/v4) فعال است.",
    },
    zibal: {
      enabled: zibalConfig.enabled,
      mode: "sandbox",
      label: "Zibal Sandbox",
      note: 'درگاه آزمایشی زیبال فعال است (merchant تست "zibal").',
    },
    mellat: {
      enabled: false,
      mode: "disabled",
      label: "Bank Mellat",
      note: MELLAT_STATUS_FA,
    },
    mock: {
      enabled: mockEnabled,
      mode: "dev-only",
      label: "Internal Test Gateway",
      note: "درگاه داخلی فقط برای توسعه/تست؛ در تولید غیرفعال.",
    },
  } as const;
}
