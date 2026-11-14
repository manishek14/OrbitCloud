// DELETE /api/cart/[id] — remove one cart item.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { cartService } from "@/lib/commerce/cart";
import { handleRouteError } from "@/lib/api/http";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return NextResponse.json(await cartService.removeItem(user, id));
  } catch (error) {
    return handleRouteError(error, "cart/remove");
  }
}
