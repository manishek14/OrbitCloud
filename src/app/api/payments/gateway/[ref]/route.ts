// GET /api/payments/gateway/[ref] — SANDBOX payment gateway.
//
// A server-rendered page that mimics a real PSP page (like ZarinPal's
// gateway): it receives the authority token in the URL, verifies it against
// the transaction hash server-side, and renders a form whose outcome buttons
// POST to /api/payments/callback with the token embedded. Payment status can
// ONLY change through that callback — exactly like a real gateway flow.
//
// The page is clearly labeled as a TEST gateway everywhere.

import { NextResponse } from "next/server";
import { orderService } from "@/lib/commerce/orders";
import { formatToman } from "@/lib/format/fa";

export async function GET(request: Request, context: { params: Promise<{ ref: string }> }) {
  const { ref } = await context.params;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const data = await orderService.getTransactionForGateway(ref, token).catch(() => null);

  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  if (!data) {
    return new NextResponse(gatewayPage("نشست پرداخت نامعتبر است یا منقضی شده.", null, null, null, false), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { tx, order, valid } = data;
  const amount = formatToman(tx.amountToman);
  const html = gatewayPage(
    valid
      ? "برای تکمیل پرداخت، یکی از گزینه‌های شبیه‌سازی را انتخاب کنید."
      : "این تراکنش قبلاً نتیجه گرفته است؛ به پنل بازگردید.",
    escape(order.orderNumber),
    escape(amount),
    escape(ref),
    valid,
    escape(token),
  );
  return new NextResponse(html, {
    status: valid ? 200 : 409,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function gatewayPage(
  message: string,
  orderNumber: string | null,
  amount: string | null,
  ref: string | null,
  active: boolean,
  token = "",
): string {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>درگاه پرداخت آزمایشی AbrIT</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: Vazirmatn, Tahoma, sans-serif; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0b1220; color: #f8fafc; padding: 16px; }
  .card { width: 100%; max-width: 420px; background: #111c31; border: 1px solid #26354d; border-radius: 16px; padding: 28px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(245, 158, 11, 0.14); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 12px; font-weight: 700; border-radius: 999px; padding: 5px 12px; margin-bottom: 18px; }
  h1 { font-size: 18px; font-weight: 800; margin-bottom: 4px; }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
  .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed #26354d; font-size: 14px; }
  .row .k { color: #94a3b8; }
  .amount { font-size: 26px; font-weight: 800; color: #60a5fa; margin: 18px 0 6px; }
  .amount small { font-size: 13px; color: #94a3b8; font-weight: 400; }
  .msg { background: rgba(37, 99, 235, 0.1); border: 1px solid rgba(37, 99, 235, 0.3); color: #93c5fd; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin: 14px 0; }
  form { display: grid; gap: 10px; margin-top: 18px; }
  button { border: 0; border-radius: 10px; padding: 13px; font-size: 14px; font-weight: 700; cursor: pointer; transition: filter .15s; font-family: inherit; }
  button:hover { filter: brightness(1.12); }
  .pay { background: #1d4ed8; color: #fff; }
  .fail { background: transparent; color: #f87171; border: 1px solid rgba(248, 113, 113, 0.4); }
  .cancel { background: transparent; color: #94a3b8; border: 1px solid #26354d; }
  .back { display: block; text-align: center; margin-top: 14px; color: #94a3b8; font-size: 13px; text-decoration: none; }
  .back:hover { color: #e2e8f0; }
</style>
</head>
<body>
  <main class="card">
    <span class="badge">● درگاه پرداخت آزمایشی — Sandbox</span>
    <h1>پرداخت سفارش AbrIT</h1>
    <p class="sub">این صفحه شبیه‌ساز درگاه پرداخت است و هیچ مبلغ واقعی دریافت نمی‌کند.</p>
    ${orderNumber ? `<div class="row"><span class="k">شماره سفارش</span><span>${orderNumber}</span></div>` : ""}
    ${ref ? `<div class="row"><span class="k">مرجع تراکنش</span><span>${ref}</span></div>` : ""}
    ${amount ? `<div class="amount">${amount} <small>تومان</small></div>` : ""}
    <p class="msg">${message}</p>
    ${
      active
        ? `<form method="POST" action="/api/payments/callback">
      <input type="hidden" name="ref" value="${ref}" />
      <input type="hidden" name="t" value="${token}" />
      <button class="pay" type="submit" name="outcome" value="success">پرداخت موفق (شبیه‌سازی)</button>
      <button class="fail" type="submit" name="outcome" value="failure">شبیه‌سازی پرداخت ناموفق</button>
      <button class="cancel" type="submit" name="outcome" value="cancel">انصراف از پرداخت</button>
    </form>`
        : `<a class="back" href="/portal/payment/result?ref=${encodeURIComponent(ref ?? "")}">بازگشت به پنل کاربری</a>`
    }
    <a class="back" href="/portal/orders">بازگشت به سفارش‌ها</a>
  </main>
</body>
</html>`;
}
