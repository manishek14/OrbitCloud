// GET/POST /api/cart — server-persisted shopping cart.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { cartService } from "@/lib/commerce/cart";
import { handleRouteError, readJson } from "@/lib/api/http";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await cartService.getCart(user));
  } catch (error) {
    return handleRouteError(error, "cart/get");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson<{ packageCode?: string; months?: number; users?: number; endpoints?: number }>(request);
    const cart = await cartService.addItem(user, {
      packageCode: String(body?.packageCode ?? ""),
      months: Number(body?.months),
      users: Number(body?.users),
      endpoints: Number(body?.endpoints),
    });
    return NextResponse.json(cart, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "cart/add");
  }
}
