// Shared helpers for API route handlers.

import { NextResponse } from "next/server";
import { DriveServiceError } from "@/lib/drive/service";
import { NextcloudError } from "@/lib/nextcloud/errors";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

/** Generic HTTP error any service can throw; mapped by handleRouteError. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function apiError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });
}

/** Maps known service errors to responses; logs unknown failures server-side. */
export function handleRouteError(error: unknown, scope: string): NextResponse<ApiErrorBody> {
  if (error instanceof HttpError) {
    return apiError(error.status, error.code, error.message);
  }
  if (error instanceof DriveServiceError) {
    if (error.causeDetail) console.error(`[drive:${scope}] ${error.code}: ${error.causeDetail}`);
    return apiError(error.httpStatus, error.code, error.publicMessage);
  }
  if (error instanceof NextcloudError) {
    console.error(`[nextcloud:${scope}] ${error.code}: ${error.rawDetail}`);
    return apiError(error.httpStatus, error.code, error.publicMessage);
  }
  console.error(`[api:${scope}] unexpected failure`, error);
  return apiError(500, "INTERNAL", "خطای غیرمنتظره‌ای رخ داد؛ لطفاً بعداً تلاش کنید.");
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
