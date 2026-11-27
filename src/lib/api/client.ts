"use client";

// Typed fetch wrapper for the Orbit API. All server communication in the
// client goes through this module (relative URLs only — the gateway routes
// any non-3000 service ports via the XTransformPort query parameter).

export interface ApiError {
  code: string;
  message: string;
  status: number;
  /** Field-level validation messages (field name → Persian message). */
  fields?: Record<string, string>;
  correlationId?: string;
}

export class ApiRequestError extends Error implements ApiError {
  code: string;
  status: number;
  fields?: Record<string, string>;
  correlationId?: string;
  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
    this.status = error.status;
    this.fields = error.fields;
    this.correlationId = error.correlationId;
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiRequestError({
      code: err?.code ?? "UNKNOWN",
      message: err?.message ?? "درخواست انجام نشد؛ لطفاً دوباره تلاش کنید.",
      status: response.status,
      fields: err?.fields,
      correlationId: response.headers.get("X-Correlation-Id") ?? undefined,
    });
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.correlationId ? `${error.message} (شناسه پیگیری: ${error.correlationId})` : error.message;
  if (error instanceof Error && error.message) return error.message;
  return "خطای غیرمنتظره‌ای رخ داد.";
}
