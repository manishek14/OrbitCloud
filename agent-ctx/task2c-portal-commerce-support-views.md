# Task 2-c — Customer Portal: Commerce + Support Views (7 views)

Agent: Task 2-c (portal commerce + support views)
Scope: ONLY the 7 assigned view files. No shared files/layouts/hooks/APIs touched.

## Files written (all compile clean, ESLint clean, tsc clean for these files)

1. `src/views/portal/cart-view.tsx` — CartView
   - `useCart()`; loading → SkeletonRows; error → ErrorState(retry); empty → EmptyState + CTA to plans.
   - Per-item card: packageNameFa, config chips (مدت/کاربر/Endpoint), server line items with
     signed amounts (negative → `−N تومان` in `text-success`; 0 → «بدون هزینه» + noteFa),
     item total via PriceTag, snapshot quoteId tiny ltr mono, warning panel for invalid quotes.
   - Remove → ConfirmDialog (destructive, pending) → `useRemoveCartItem` → toast.
   - Sticky (lg) summary aside: count, جمع کل from `cart.totalToman` (server), the honest
     no-discount-code note (exact business copy), server-recompute note, ادامه خرید + تکمیل خرید.
2. `src/views/portal/checkout-view.tsx` — CheckoutView (3-step state machine)
   - Step indicator: numbered Persian circles (۱/۲/۳), completed → Check + primary, active →
     primary ring, upcoming muted; connector lines.
   - AnimatePresence slide transitions with direction awareness.
   - Step 1 مرور سفارش: fresh `useCart()` review cards (no remove); empty cart → redirect
     `routes.portalCart`; if an order was already created (failed payment retry) → info panel.
   - Step 2 اطلاعات فاکتور: FormField عنوان گیرنده (required, min 2, inline errors, blur
     validation), نام شرکت optional; values derived from `useMe` profile until user edits
     (override-state pattern — no setState-in-effect).
   - Step 3 تأیید و پرداخت: summary from LIVE cart before checkout, from `createdOrder`
     snapshot after checkout (cart is consumed server-side); payment radio cards — Sandbox
     gateway ACTIVE (badge «فعال», note: نتیجه پرداخت صرفاً از طریق کال‌بک سرور تأیید می‌شود),
     زرین‌پال/به‌پرداخت ملت/زیبال disabled (badge «نیازمند پیکربندی درگاه», muted).
   - Pay button → `useCheckout({invoiceTitle, invoiceCompany})` → keep order in state →
     `useInitPayment({orderId})` → `window.location.href = result.gatewayUrl` (full-page
     redirect to server-rendered sandbox gateway). Loader2 during whole sequence; errors toast;
     if init fails, retry skips re-checkout (order already created).
   - Sticky summary aside persists across steps (order snapshot after checkout, live cart before).
3. `src/views/portal/payment-result-view.tsx` — PaymentResultView
   - Reads `router.query.ref`; missing → redirect orders. `usePaymentResult(ref)` (auto-polls
     while pending). Render by SERVER status only: succeeded (CheckCircle2, info rows: مبلغ /
     شماره سفارش link / شماره فاکتور link / مرجع ltr tiny + «وضعیت این صفحه تنها از تأیید سمت
     سرور درگاه به دست آمده است»), failed (XCircle destructive + پرداخت مجدد via
     useInitPayment→gateway redirect), cancelled (muted + same retry), pending (spinner +
     auto-refresh note). First-fetch skeleton card.
4. `src/views/portal/orders-view.tsx` — OrdersView
   - Stat chips: total / pending_payment / paid. DataTable columns: orderNumber (ltr bold),
     status, itemCount, مبلغ PriceTag, تاریخ ثبت, تاریخ پرداخت (— if none). Row click →
     detail Dialog `useOrder(id)`: invoice title/company, full item snapshots (name + chips +
     line items + total + quoteId), order total, paidAt. pending_payment → «پرداخت»
     (useInitPayment → gateway redirect) + «لغو سفارش» (ConfirmDialog destructive →
     useCancelOrder → toast + invalidate order detail). Mobile cards + empty CTA.
5. `src/views/portal/billing-view.tsx` — BillingView
   - Tabs فاکتورها | تراکنش‌ها. Invoices DataTable → row click → printable invoice dialog
     (Logo + number + dates, گیرنده/شرکت, items table شرح=پکیج+مدت+کاربر+Endpoint + مبلغ,
     جمع کل, وضعیت) + «چاپ / ذخیره PDF» → window.print() with the browser-print note.
   - Invoice status mapping: paid → «پرداخت شده», issued → «صادر شده», void → «باطل شده»
     (issued/void are NOT in shared StatusBadge STATUS_MAP — mapped locally via label prop).
   - Transactions: note «تراکنش‌ها فقط از طریق کال‌بک درگاه نتیجه‌گیری می‌شوند», gateway
     mock → «درگاه آزمایشی», columns ref/order/gateway/amount/status/زمان/نتیجه‌گیری.
6. `src/views/portal/tickets-view.tsx` — TicketsView
   - PageHeader action «ثبت تیکت جدید» → Dialog form: موضوع (min 3), دسته‌بندی Select
     (technical/billing/sales/drive/other), اولویت Select (low/normal/high/urgent), شرح مشکل
     TextAreaField (min 10) → `useCreateTicket` → toast «تیکت ثبت شد» + close + invalidate.
   - Filter chips همه/باز/پاسخ داده شده/بسته (باز = open + pending_customer) with counts +
     SearchInput on subject/number. DataTable → row click `routes.portalTicket(id)`.
     Empty state with CTA that opens the dialog.
7. `src/views/portal/ticket-detail-view.tsx` — TicketDetailView({ id })
   - `useTicket(id)` (15s live poll). PageHeader: subject, badges status/priority/category,
     breadcrumbs پنل کاربری → تیکت‌ها → {number}, actions بازگشت + «بستن تیکت»
     (ConfirmDialog → useCloseTicket → toast + invalidate ticket key — shared hook only
     invalidates the list).
   - Chat conversation: customer `justify-end bg-primary/10 rounded-2xl`, staff
     `justify-start border bg-card`, system centered muted; senderName + formatRelative +
     role icon (User/Headset); max-h-[60vh] overflow-y-auto scrollbar-slim; auto-scroll to
     bottom on message-count change (ref + effect).
   - Reply box: TextAreaField (min 2, inline error) + send (Loader2 pending); disabled with
     note «این تیکت بسته شده است؛ برای پیگیری جدید تیکت جدید ثبت کنید.» when closed.
   - Loading skeleton; error → ErrorState + back to tickets.

## Conventions honored

- "use client", exact default export names, only my 7 files touched.
- Semantic tokens only (bg-card, text-muted-foreground, text-success/info/destructive/warning,
  bg-primary/10, border) — no hex, no indigo/blue.
- Persian copy; numbers via toFaDigits/formatToman/formatDateTime/formatRelative; refs/numbers
  in `<span className="ltr-iso" dir="ltr">`.
- Loading skeletons / empty+CTA / error+retry / disabled states everywhere; Loader2 on pending.
- Toasts via sonner + errorMessage; sections wrapped in Reveal; AnimatePresence for checkout steps.
- Responsive (mobile cards via DataTable mobileCard, sticky asides only lg, no 360px overflow).

## Environment fix performed (NOT a source change) — important for other agents

- The dev server that started at 13:13 had a STALE Prisma client in memory (schema gained
  `lastLoginAt` etc. but server predated `prisma generate`) → every login returned 500
  (`Unknown argument lastLoginAt`). I ran `bun run db:push` (regenerated client; DB was already
  in sync) and bounced the dev server; a supervisor restarted it once automatically.
  LATER the dev server died completely (no process, port 3000 down, likely a parallel agent's
  restart raced mine). I restarted it detached with the project's own command
  (`nohup bun run dev` → same script that tees to dev.log). Port 3000 is healthy (200).
  If the server is down again for you, restart it the same way.
- Verified end-to-end with curl as demo@abrit.ir: login → cart add (essential/3mo/5u/6e) →
  checkout → payments/init (relative gatewayUrl `/api/payments/gateway/{ref}?t=...`) →
  callback success → result=succeeded + invoice. Demo data now present: order ABR-74990455
  (paid), invoice INV-12762840 (paid), tx MOCK-28055762 (succeeded), ticket TKT-540432
  (closed, 2 messages) — kept intentionally as part of the demo flow.

## ESLint fix applied during development

- Next 16 react-hooks rules rejected `setState` inside effects in checkout-view. Reworked:
  invoice fields now derive from `useMe` with override-state (no effect), and the post-checkout
  summary reads from `createdOrder` snapshot instead of capturing cart in state. Result is
  simpler and MORE correct (shows server-final numbers after checkout).

## Cross-file problems noticed but NOT fixed (out of my scope)

1. `StatusBadge` STATUS_MAP lacks invoice statuses `issued` / `void` (spec said they exist).
   I mapped them locally in billing-view via the `label` prop; consider adding them to
   `src/components/abrit/ui.tsx` (tone: issued → info/warning «صادر شده», void → muted/danger «باطل شده»).
2. `useCancelOrder` invalidates only `["orders"]` and `useCloseTicket` only `["tickets"]` —
   not the per-entity keys (`["order", id]`, `["ticket", id]`). I compensate by invalidating
   locally in my views; other views (admin) may show stale detail dialogs.
3. Dev server instability: it died once mid-session (see above). Parallel agents restarting
   it simultaneously can race; only one restart should happen at a time.
4. `prisma/seed.ts` exists (untracked) — if the DB is ever reset, re-seed demo users.
5. `POST /api/contact` returned 500 twice early in the session (before my work) — belongs to
   the public-site agent's area; later requests returned 400/201 so it may already be fixed.
