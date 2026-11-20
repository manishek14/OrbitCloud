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

/** Maximum accepted JSON request body in BYTES (default 1 MiB, env-tunable).
 *  Guards every route that reads JSON — unauthenticated endpoints included. */
export const MAX_JSON_BYTES = (() => {
  const raw = Number(process.env.ABRIT_MAX_JSON_BODY_BYTES);
  const value = Number.isFinite(raw) && raw > 0 ? raw : 1024 * 1024;
  return Math.min(value, 16 * 1024 * 1024);
})();

/** Content types that can never be a JSON body — rejected before reading. */
const NON_JSON_CONTENT_TYPES = new Set(["multipart/form-data", "application/x-www-form-urlencoded"]);

/**
 * Reads a request body with a REAL byte cap (full-remediation audit §2.2):
 *   1. Content-Length is checked first — oversized declared bodies are
 *      rejected with 413 before a single byte is read.
 *   2. Otherwise the stream is read chunk-by-chunk and aborted the moment
 *      the accumulated BYTE count exceeds the cap — the body is never fully
 *      buffered, and multi-byte UTF-8 (e.g. Persian text) counts by real
 *      bytes, not by JavaScript character units.
 */
async function readBodyWithByteLimit(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "حجم درخواست بیش از حد مجاز است.");
  }

  if (request.body == null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Always read at most one byte beyond the cap so the loop can stop early
  // without buffering the rest of an oversized (possibly hostile) stream.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", "حجم درخواست بیش از حد مجاز است.");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

export async function readJson<T>(request: Request): Promise<T | null> {
  const contentType = (request.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (NON_JSON_CONTENT_TYPES.has(contentType)) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "این درخواست باید با محتوای JSON ارسال شود.");
  }

  const raw = await readBodyWithByteLimit(request, MAX_JSON_BYTES);
  if (raw.length === 0 || raw.trim().length === 0) return null;

  try {
    // Strip a UTF-8 BOM so BOM-prefixed JSON from common clients still parses.
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "بدنه درخواست JSON معتبر نیست.");
  }
}
