// ============================================================================
// SMS.ir Verify API client — REAL OTP delivery (https://sms.ir/web-service/).
//
// Documented endpoint (Verify send):
//   POST {base}/v1/send/verify
//   Headers: Content-Type: application/json · Accept: text/plain · x-api-key: <key>
//   Body: { mobile, templateId, parameters: [{ name, value }] }
//   Success: { status: 1, message: "موفق", data: { messageId, cost } }
//
// Configuration (server-side env only — never hardcoded, never logged):
//   SMSIR_API_KEY               — account API key (required in sms mode)
//   SMSIR_API_BASE_URL          — default https://api.sms.ir
//   SMSIR_OTP_TEMPLATE_ID       — approved template id (required in sms mode)
//   SMSIR_CODE_PARAMETER_NAME   — template parameter name (default "Code";
//                                 must match the template configured in the
//                                 SMS.ir account)
//   SMSIR_TIMEOUT_MS            — default 15000
//
// Security rules enforced here:
//   • The API key and the OTP code are NEVER logged.
//   • Provider errors are surfaced as accurate delivery states.
//   • If sms mode is requested but the provider is not configured, the caller
//     fails SAFE (a clear configuration error) — never a silent fallback to
//     displaying the OTP.
// ============================================================================

export type SmsSendStatus =
  | { ok: true; messageId: string | number | null; cost: number | null }
  | { ok: false; kind: "not_configured" | "auth_failed" | "invalid_template" | "rate_limited" | "network" | "provider_error"; message: string };

export interface SmsIrConfig {
  apiKey: string | null;
  baseUrl: string;
  templateId: string | null;
  codeParameterName: string;
  timeoutMs: number;
  configured: boolean;
}

export function getSmsIrConfig(): SmsIrConfig {
  // Documented names (spec §8) plus the original internal aliases — both work:
  //   SMSIR_API_KEY, SMSIR_TEMPLATE_ID | SMSIR_OTP_TEMPLATE_ID,
  //   SMSIR_OTP_PARAMETER_NAME | SMSIR_CODE_PARAMETER_NAME
  const apiKey = (process.env.SMSIR_API_KEY ?? "").trim() || null;
  const templateId =
    (process.env.SMSIR_TEMPLATE_ID ?? process.env.SMSIR_OTP_TEMPLATE_ID ?? "").trim() || null;
  const numericTemplateId = Number(templateId);
  const timeoutMs = Number(process.env.SMSIR_TIMEOUT_MS ?? 15000);
  return {
    apiKey,
    baseUrl: (process.env.SMSIR_API_BASE_URL ?? "https://api.sms.ir").trim().replace(/\/+$/, ""),
    templateId,
    codeParameterName:
      (process.env.SMSIR_OTP_PARAMETER_NAME ?? process.env.SMSIR_CODE_PARAMETER_NAME ?? "Code").trim() || "Code",
    timeoutMs: Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 3000), 30000) : 15000,
    configured: Boolean(apiKey && templateId && Number.isSafeInteger(numericTemplateId) && numericTemplateId > 0),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Sends an OTP code through the SMS.ir Verify API. Never logs the code. */
export async function sendVerifyOtp(mobile: string, code: string, correlationId?: string): Promise<SmsSendStatus> {
  const config = getSmsIrConfig();
  if (!config.configured) {
    return {
      ok: false,
      kind: "not_configured",
      message:
        "سرویس پیامک SMS.ir پیکربندی نشده است (SMSIR_API_KEY / SMSIR_OTP_TEMPLATE_ID). ارسال کد انجام نشد.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/v1/send/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "x-api-key": config.apiKey as string,
      },
      body: JSON.stringify({
        mobile,
        templateId: Number(config.templateId),
        parameters: [{ name: config.codeParameterName, value: code }],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = asRecord(JSON.parse(text));
    } catch {
      body = {};
    }
    const status = Number(body.status);
    const message = typeof body.message === "string" ? body.message : "";

    const data = asRecord(body.data);
    const messageId = data.messageId;
    const validMessageId =
      (typeof messageId === "number" && Number.isSafeInteger(messageId) && messageId > 0) ||
      (typeof messageId === "string" && /^[1-9]\d*$/.test(messageId));
    console.info("[smsir.verify]", { correlationId, httpStatus: response.status, apiStatus: Number.isFinite(status) ? status : null, messageIdPresent: validMessageId });
    if (response.ok && status === 1 && validMessageId) {
      return {
        ok: true,
        messageId: messageId as string | number,
        cost: typeof data.cost === "number" && Number.isFinite(data.cost) ? data.cost : null,
      };
    }

    // Common SMS.ir failure modes (documented error semantics).
    if (response.status === 401 || status === 401) {
      return { ok: false, kind: "auth_failed", message: "اعتبارنامه SMS.ir معتبر نیست (کلید API رد شد)." };
    }
    if (status === 11 || status === 12 || /template/i.test(message)) {
      return { ok: false, kind: "invalid_template", message: "قالب (Template) پیامک SMS.ir معتبر نیست." };
    }
    if (status === 13 || response.status === 429) {
      return { ok: false, kind: "rate_limited", message: "محدودیت نرخ ارسال SMS.ir؛ لطفاً کمی بعد تلاش کنید." };
    }
    return {
      ok: false,
      kind: "provider_error",
      message: `ارسال پیامک ناموفق بود${message ? `: ${message}` : ""} (وضعیت ${Number.isFinite(status) ? status : response.status}).`,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    console.warn("[smsir.verify]", { correlationId, stage: "network_failure", aborted });
    return {
      ok: false,
      kind: "network",
      message: aborted ? "مهلت ارتباط با SMS.ir به پایان رسید." : "ارتباط با سرویس پیامک برقرار نشد.",
    };
  } finally {
    clearTimeout(timer);
  }
}
