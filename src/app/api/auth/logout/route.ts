import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";
import { handleRouteError } from "@/lib/api/http";

export async function POST() {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    await destroySession(token);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { path: "/", expires: new Date(0) });
    return response;
  } catch (error) {
    return handleRouteError(error, "logout");
  }
}
