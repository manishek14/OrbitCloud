// Cookie sessions backed by the PanelUser/Session tables.
// The cookie carries a random token; only its SHA-256 is stored.

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { PrismaTransactionClient } from "@/lib/db";
import type { PanelUser } from "@prisma/client";

export const SESSION_COOKIE = "abrit_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionInfo {
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: string, meta?: { userAgent?: string | null; request?: Request }): Promise<SessionInfo> {
  return createSessionInTx(db, userId, meta);
}

/**
 * Transaction-aware session creation — the session row is committed together
 * with the caller's transaction (e.g. atomic registration, audit §4.3).
 */
export async function createSessionInTx(
  tx: PrismaTransactionClient | typeof db,
  userId: string,
  meta?: { userAgent?: string | null; request?: Request },
): Promise<SessionInfo> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const request = meta?.request;
  const rawAgent = meta?.userAgent ?? request?.headers?.get("user-agent") ?? null;
  const userAgent = rawAgent ? rawAgent.slice(0, 250) : null;
  const ipHash = request ? createHash("sha256").update(`ip:${request.headers.get("x-real-ip") ?? "unknown"}`).digest("hex") : null;
  await tx.session.create({ data: { userId, tokenHash, expiresAt, userAgent, ipHash } });
  return { token, expiresAt };
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.session.deleteMany({ where: { tokenHash } });
}

/** Resolves the authenticated user from the request cookie (null when absent/expired). */
export async function getCurrentUser(): Promise<PanelUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}
