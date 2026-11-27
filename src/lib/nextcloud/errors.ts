// Typed Nextcloud errors with fixed, non-leaking Persian messages.
// The raw detail is logged server-side only, never rendered to the customer
// (same policy as the Orchard portal's Drive integration).

export type NextcloudErrorCode =
  | "NC_NOT_CONFIGURED"
  | "NC_UNREACHABLE"
  | "NC_AUTH_FAILED"
  | "NC_USER_EXISTS"
  | "NC_INVALID_USERNAME"
  | "NC_INVALID_PASSWORD"
  | "NC_WEAK_PASSWORD"
  | "NC_NOT_FOUND"
  | "NC_ERROR";

const messages: Record<NextcloudErrorCode, string> = {
  NC_NOT_CONFIGURED: "اتصال Orbit Drive هنوز پیکربندی نشده است.",
  NC_UNREACHABLE: "سرور Drive در دسترس نیست.",
  NC_AUTH_FAILED: "اعتبارنامه Drive پذیرفته نشد.",
  NC_USER_EXISTS: "این نام کاربری در Orbit Drive قبلاً ثبت شده است.",
  NC_INVALID_USERNAME: "نام کاربری Drive معتبر نیست.",
  NC_INVALID_PASSWORD: "رمز عبور Drive معتبر نیست.",
  NC_WEAK_PASSWORD: "این رمز عبور رایج یا افشاشده است؛ رمز قوی و منحصربه‌فرد دیگری انتخاب کنید.",
  NC_NOT_FOUND: "حساب در سرور Drive یافت نشد.",
  NC_ERROR: "پاسخ نامعتبر از سرور Drive.",
};

export class NextcloudError extends Error {
  readonly code: NextcloudErrorCode;
  readonly publicMessage: string;
  /** Raw, sanitized-to-logs detail (never rendered to users). */
  readonly rawDetail: string;
  readonly httpStatus: number;
  /** Nextcloud OCS statuscode when available (101/102/103/998...). */
  readonly ocsStatuscode?: number;

  constructor(
    code: NextcloudErrorCode,
    options: { rawDetail?: string; httpStatus?: number; ocsStatuscode?: number; publicMessage?: string } = {},
  ) {
    super(messages[code]);
    this.name = "NextcloudError";
    this.code = code;
    this.publicMessage = options.publicMessage ?? messages[code];
    this.rawDetail = options.rawDetail ?? messages[code];
    this.httpStatus =
      options.httpStatus ??
      (code === "NC_UNREACHABLE"
        ? 502
        : code === "NC_AUTH_FAILED"
          ? 502
          : code === "NC_NOT_CONFIGURED"
            ? 503
            : code === "NC_USER_EXISTS"
              ? 409
              : 400);
    this.ocsStatuscode = options.ocsStatuscode;
  }
}

export function isNextcloudError(error: unknown): error is NextcloudError {
  return error instanceof NextcloudError;
}
