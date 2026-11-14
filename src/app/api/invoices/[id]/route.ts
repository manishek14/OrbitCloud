// GET /api/invoices/[id] — one invoice (ownership enforced).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/rbac";
import { orderService } from "@/lib/commerce/orders";
import { handleRouteError } from "@/lib/api/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    return NextResponse.json(await orderService.getInvoice(user.id, id));
  } catch (error) {
    return handleRouteError(error, "invoices/[id]");
  }
}
