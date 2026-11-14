# AbrIT — Critical Fix Round Report (2026-11-13)

> Scope: §1–§16 of the correction specification. Every finding below was
> re-verified against the CURRENT source before patching (per §1), and every
> claim in §16 is labeled honestly. Evidence screenshots:
> `docs/evidence-fix/`.

---

## 1. Root causes found (verified against current source)

| # | Reported issue | Verdict | Root cause |
|---|---|---|---|
| 1 | `/auth/login#/auth/register` hash navigation | **Confirmed** | 5 raw `<a href={`#${routes.x}`}>` anchors in all four auth views; the SPA router already had a correct `<Link>` component that was simply not used there |
| 2 | «ایمیل معتبر نیست.» shown only at the OTP stage | **Confirmed** | Client regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) was looser than the server's zod `z.email()`; the server rejected the payload at the FINAL register call (after the OTP had been sent) — reproduced in dev.log (`POST /api/auth/register 400`) |
| 3 | Pricing shows only 3 plans | **Outdated** — the page renders the full catalog; the real gap was: **no free plan existed** and no carousel | Catalog had 5 orderable packages; the required free plan was missing |
| 4 | Seats / contract durations | **Already working** | Steppers + server quotes + 1/3/6-month policies were consistent (verified: UI/API/engine all accept 1 month; SLA table matches the 1405 amendment) |
| 5 | Payment «This page isn't working» / unreliable completion | **Confirmed** | a) `finalizeSuccess` performed 6 sequential writes with NO database transaction; b) the callback redirect built an ABSOLUTE URL from Host/forwarded headers; c) `/api/payments/result` had NO ownership check and re-verified with the provider on EVERY 4-second poll |
| 6 | ZarinPal / Zibal sandbox | **Already implemented** per official docs; hardening added (ZarinPal amount cross-check) | — |
| 7 | OTP succeeds but no portal redirect | **Not reproduced** — full flow verified E2E (registration + login OTP → /portal). The one real OTP bug was environmental: the sandbox process inherited a stale `DATABASE_URL=file:…` from the wrapper shell, breaking all DB-backed auth after a dev-server restart | Restart now pins `DATABASE_URL` explicitly |
| 8 | Orchard login uses default appearance | **Confirmed** | Active `AbrITAdminTheme` had NO `Login.cshtml` override; `/Login` rendered TheAdmin's default English LTR form |
| 9 | Demo administrator credentials do not work | **Confirmed** | The `abrit-admin` user existed but no bootstrap mechanism could (re)set its password; credentials were undocumented and untestable |
| 10 | `NEXTCLOUD_MODE=simulation` default | **Confirmed for production requirements** | Config existed with live/simulation modes but production silently allowed simulation |
| 11 | PostgreSQL | **Already satisfied** — Next.js (`abrit_portal`, Prisma/PostgreSQL, migrations present) and Orchard (`abrit_orchard`, YesSql/PostgreSQL) | Durable models for orders/transactions/SMS outbox/OTP grants/subscriptions/Drive mappings all have unique constraints |

## 2. Files changed

**Authentication routing (§2)**
- `src/views/auth/login-view.tsx` — hash anchors → `<Link>` (register, forgot-password); `expires` query param passed to verify-otp
- `src/views/auth/register-view.tsx` — hash anchor → `<Link>`; shared validation; blur validation; server field-error mapping
- `src/views/auth/forgot-password-view.tsx`, `src/views/auth/reset-password-view.tsx` — hash anchors → `<Link>`

**Registration validation (§3)**
- `src/lib/validation.ts` — NEW: shared zod schemas (email/mobile/password/profile) + `validateRegisterProfile()`; byte-identical rules on both sides
- `src/app/api/auth/register/route.ts` — shared schema; FIELD-LEVEL error payload (`fields: {email: "…"}`); duplicate email/mobile mapped to fields
- `src/lib/api/http.ts` — `apiError(..., fields?)` support
- `src/lib/api/client.ts` — `ApiRequestError.fields` carried to the UI

**Pricing / free plan / carousel (§4–§5)**
- `src/lib/commerce/catalog.ts` — added plan 6 «رایگان» (code `free`, 0 Toman, 100 MB Drive, `orderable: false`, honest «—» for non-included commercial values); `orderable` flag on all packages
- `src/lib/commerce/quote.ts` — non-orderable packages are never quotable («پلن رایگان نیازی به خرید ندارد…»)
- `src/lib/drive/plans.ts` — free excluded from Drive mapping (its 100 MB == the `trial` plan)
- `src/lib/api/types.ts` — `CommercialPackageDTO.orderable`
- `src/components/abrit/plan-carousel.tsx` — NEW: RTL snap carousel, 5s autoplay, prev/next, indicators, hover/focus/touch pause + 12s cooldown after interaction, `prefers-reduced-motion` (autoplay off, instant scroll)
- `src/components/abrit/price.tsx` — free-plan card presentation («رایگان», no fake price/contract, success-colored CTA «فعال‌سازی رایگان»)
- `src/views/public/plans-view.tsx` — carousel (all 6) + COMPLETE grid below (nothing hidden) + free-CTA routing (login gate → /portal/drive)
- `src/views/portal/plan-detail-view.tsx` — free-plan guard page (activation, not purchase)
- `src/app/globals.css` — `.hide-scrollbar` utility

**Payments (§6–§7)**
- `src/lib/commerce/orders.ts` — `finalizeSuccess` now ATOMIC (`db.$transaction`, conditional pending→succeeded claim = idempotent under concurrent callbacks); subscriptions/services written inside the transaction (`fulfill(order, client)`); post-commit side effects (audit, notifications, Nextcloud quota) moved OUT of the transaction (`postCommitFulfillment`, recoverable); `handleGatewayCallback` returns a RELATIVE redirect target; `getPaymentResult(ref, requester)` enforces ownership (other customers' refs → 404, no existence leak); `reverifyPendingTransaction` throttled (min 3s per ref, max ~40 verify calls)
- `src/app/api/payments/callback/[gateway]/route.ts` — 303 with RELATIVE `Location` (never trusts Host headers for redirects)
- `src/app/api/payments/init/route.ts` — production REQUIRES `ABRIT_PAYMENTS_PUBLIC_BASE_URL` (clear Persian config error; dev falls back to forwarded headers)
- `src/app/api/payments/result/route.ts` — `requireUser()` + ownership; throttled re-verify
- `src/lib/payments/providers.ts` — ZarinPal verify now cross-checks `data.amount` (Rial→Toman) against the stored order amount (mismatch → `amount_mismatch`)

**OTP / SMS.ir (§8)**
- `src/lib/auth/otp.ts` — env-tuned: `OTP_EXPIRY_SECONDS` (120), `OTP_MAX_ATTEMPTS` (3), `OTP_RESEND_COOLDOWN_SECONDS` (60); `OTP_PROVIDER` accepted as documented alias of `OTP_DELIVERY_MODE`; responses include `resendCooldownSeconds`
- `src/lib/sms/smsir.ts` — documented aliases accepted: `SMSIR_TEMPLATE_ID` (+ internal `SMSIR_OTP_TEMPLATE_ID`), `SMSIR_OTP_PARAMETER_NAME` (+ `SMSIR_CODE_PARAMETER_NAME`)
- `src/views/auth/verify-otp-view.tsx`, `register-view.tsx` — expiry copy now uses the server-provided `expiresInSeconds`
- `.env` / `.env.example` — SMS.ir credentials (`SMSIR_API_KEY`, `SMSIR_TEMPLATE_ID=314002`, `SMSIR_OTP_PARAMETER_NAME=Code`), `OTP_PROVIDER/OTP_CODE_LENGTH/OTP_EXPIRY_SECONDS/OTP_RESEND_COOLDOWN_SECONDS/OTP_MAX_ATTEMPTS`, payment public-URL var, Nextcloud production placeholders — exactly as specified in §8/§10

**Orchard admin (§9)**
- `orchard/AbrITAdminTheme/Views/OrchardCore.Users/Account/Login.cshtml` — NEW: full Persian RTL branded login (Vazirmatn, navy identity, dark default) preserving the EXACT Orchard form contract (`LoginForm.UserName/Password/RememberMe`, `__RequestVerificationToken`, ReturnUrl route value, `/admin` default landing)
- `…/Account/ForgotPassword.cshtml`, `…/Account/ResetPassword.cshtml` — NEW branded shells around the original forms (`DisplayAsync(Model)` — behavior untouched)
- `orchard/AbrITAdminTheme/Views/_ViewImports.cshtml` — added `OrchardCore.ResourceManagement` tag helpers (the `<style>` helper was rendering literally)
- `orchard/AbrITAdminTheme/wwwroot/css/abrit-admin.css` — `.abrit-auth` branded authentication chrome
- `orchard/AbrITPortal/Development/DevelopmentIdentitySetup.cs` — NEW `BootstrapAdminAsync` (operator CLI): creates/resets the Orchard Identity admin from `ABRIT_ORCHARD_ADMIN_*` env vars; database guards (`abrit_portal_dev_*` or explicit `ABRIT_ADMIN_BOOTSTRAP_ENABLED=true` opt-in for the sandbox CMS DB); min 12-char password
- `orchard/AbrITPortal/Program.cs` — `--abrit-admin-bootstrap` CLI flag wiring
- `orchard/.env.example` — bootstrap variables documented

**Drive / Nextcloud (§10)**
- `src/lib/nextcloud/config.ts` — production guard: `NEXTCLOUD_MODE=simulation` in production now throws a clear configuration failure (never silently fakes accounts)

**Infrastructure**
- `src/lib/db.ts` — exported `PrismaTransactionClient`
- `tests/pricing.test.ts` — updated for 6 plans (5 orderable + free assertions: 0 price, 100 MB, «—» SLA, non-quotable)
- `tests/security.test.ts` — OTP env matrix isolates `OTP_PROVIDER`
- `.env` — sandbox runtime config (display OTP mode with real credentials configured; simulation Drive with live placeholders)

## 3. Database changes and migrations

**None required.** All fixes operate on the existing PostgreSQL schema:
- `Transaction.gatewayRef` is `@unique` (duplicate provider callbacks can never match two transactions)
- `finalizeSuccess` idempotency is enforced by a conditional `UPDATE … WHERE status='pending'` inside the new transaction
- Migrations exist and are PostgreSQL-only (`prisma/migrations/…init_postgresql`); `prisma migrate deploy` is the production procedure; no destructive migrations were run

## 4. Authentication fixes — verified

| Check | Result |
|---|---|
| `/auth/login` direct | 200 ✓ |
| `/auth/register` direct + F5 | 200 ✓ |
| `/auth/forgot-password` direct + F5 (anonymous) | 200 ✓ |
| `/auth/reset-password` direct | 200 ✓ |
| `/auth/verify-otp` without mobile | redirects to `/auth/login` ✓ |
| Login → register click | `/auth/register` (NO `#/auth/…`) ✓ browser-back returns to login ✓ |
| `href={`#…`}` occurrences in source | **0** ✓ |
| Invalid email | rejected at step 1 BEFORE OTP (inline error + no OTP request) ✓ |
| Registration E2E | profile → validation → OTP (display mode) → account created → **redirect to /portal with dashboard rendered** ✓ |
| OTP login → /portal | ✓ (display mode) |
| Customer OTP ≠ Orchard admin | separate systems ✓ (Orchard login is username/password via Orchard Identity only) |

## 5. Payment callback fixes — verified

| Check | Result |
|---|---|
| ZarinPal Sandbox full round-trip | checkout → real `sandbox.zarinpal.com/pg/StartPay/…` → پرداخت → **callback → server verify → order paid + invoice + subscription + service** → result page «پرداخت با موفقیت تأیید شد» (`ZPL-99535171`, order `ABR-26644582`, 12,950,000 T) ✓ |
| Zibal Sandbox full round-trip | `gateway.zibal.ir/start/4910088240` → پرداخت تستی موفق → order `ABR-85139897` paid (66,495,000 T = 3-month standard: 58.5M − 3% + 50% onboarding — arithmetic exact) ✓ |
| Bank Mellat | NOT selectable in UI, rejected server-side (`selectGateway`), disabled in config ✓ |
| Cancelled/failed payment | ZarinPal انصراف → Status=NOK → transaction failed → result page «پرداخت ناموفق بود» + پرداخت مجدد ✓ (screenshots) |
| Duplicate callback | conditional claim inside the DB transaction → no double invoices/subscriptions (unit-tested; DB guarantee) |
| Result API ownership | unauthenticated → **401**; owner → JSON; another customer's ref → 404 (indistinguishable) ✓ |
| Poll storm | re-verify throttled (3 s per ref, bounded attempts) ✓ |

## 6. Orchard CMS and login theme — verified

- `/Login` renders the **AbrIT branded Persian RTL theme** (Vazirmatn, navy, «ورود به مدیریت سامانه») — screenshot `docs/evidence-fix/orchard-branded-login.png`
- The form is the REAL Orchard Identity login (exact field contract + antiforgery); wrong credentials → Persian error; correct credentials → session → `/admin` renders the genuine Orchard dashboard (verified programmatically: POST → 302 → GET /admin = 200 with AbrIT admin chrome)
- Administrator bootstrap: `dotnet …AbrITPortal.dll --abrit-admin-bootstrap` created/reset `abrit-admin` (Administrator role verified) with the password advertised by the demo banner — the documented demo credential now WORKS
- CMS capabilities remain native Orchard (Content, Media, Users/Roles, Workflows, Queries, Recipes, Settings — unchanged and proxied at `/admin`); the Next.js admin imitation stays deleted
- Forgot/Reset password pages wrapped in the same branded shell (original Orchard forms preserved)

## 7. SMS.ir integration status

**Implemented and configured — real delivery NOT integration-tested (needs a designated test number).**
- Client implements the official Verify API (`POST /v1/send/verify`, `x-api-key`, templateId, parameters) with timeout, error taxonomy (auth/template/rate/network), and durable `SmsOutbox` bookkeeping (metadata only, never the code)
- Credentials from §8 are configured (`SMSIR_API_KEY`, `SMSIR_TEMPLATE_ID=314002`, `SMSIR_OTP_PARAMETER_NAME=Code`)
- Sandbox runtime keeps `OTP_DELIVERY_MODE=display` (safe: no SMS to arbitrary numbers); production flips to `sms`
- NOT done: an actual SMS send to a user-designated test mobile — explicitly blocked by §15 («Do not send SMS messages to arbitrary numbers») until you designate a number

## 8. Nextcloud integration status

**Implemented (live mode supported end-to-end) — live integration NOT tested (credentials pending).**
- Production guard added: production + simulation = hard configuration failure
- `.env.example` carries the §10 placeholders (`NEXTCLOUD_MODE=live`, `https://drive.abrit.cloud`, admin/app-password, `NEXTCLOUD_DEFAULT_QUOTA=100MB`, `DRIVE_LOGIN_URL`)
- Sandbox continues in simulation mode against the bundled OCS-compatible emulator until you supply the real admin app-password; the portal honestly labels the mode
- The free plan's 100 MB quota is the existing `trial` Drive plan (verified in the portal: «سهمیه ۱۰۰ مگابایت»)

## 9. Pricing and carousel changes — verified

- **6 plans** render (carousel slides = 6; complete grid + comparison table show all six)
- Free plan: «رایگان» badge, 100 MB Drive, no fake price/contract, CTA «فعال‌سازی رایگان» → (login gate) → `/portal/drive`; portal configurator `/portal/plans/free` shows the activation notice instead of checkout; quote API refuses it
- Carousel: 5 s autoplay (observed advancing by itself), prev/next controls (scroll position verified moving), indicators, hover/focus/touch pause + interaction cooldown, native swipe via scroll-snap, `prefers-reduced-motion` disables autoplay + smooth scrolling, RTL direction verified
- Seats: steppers with min/max + live server quote; durations 1/3/6 all quote correctly (1-month verified live in the configurator; 3-month verified through the Zibal purchase arithmetic)
- SLA values unchanged and test-enforced: پایه ۸ / استاندارد ۵ / حرفه‌ای ۳ / سازمانی ۱ ساعت / سازمانی پلاس لحظه‌ای

## 10. Tests actually executed

| Suite | Result |
|---|---|
| `bun test` | **94 pass / 0 fail** (pricing & SLA matrix incl. free-plan assertions, payment providers incl. Mellat rejection + Toman→Rial, OTP security/env matrix, service token, schema invariants) |
| `bun run lint` | clean |
| `tsc --noEmit` | clean |
| Browser E2E (agent-browser, evidence in `docs/evidence-fix/`) | auth routing matrix, registration validation timing, register→OTP→portal, plans carousel + free plan, ZarinPal + Zibal sandbox round-trips, cancelled payment, ownership 401, mobile 390 px drawer, light mode `#F5F7FB` |
| Orchard login | branded render + real credential login → `/admin` 200 |

## 11. Configuration values still required from you

1. **Designated test mobile number** for one real SMS.ir OTP delivery test (§8 testing requirement; the key + template 314002 are already configured)
2. **Nextcloud production credentials** (`NEXTCLOUD_ADMIN_USER` + `NEXTCLOUD_ADMIN_APP_PASSWORD` for `https://drive.abrit.cloud`) to flip `NEXTCLOUD_MODE=live` and run the §10.3 acceptance list
3. **Public HTTPS base URL** of the production deployment (`ABRIT_PAYMENTS_PUBLIC_BASE_URL`) — required in production before any payment can start
4. Production gateways: replace sandbox merchants with the real ZarinPal merchant + Zibal merchant (and keep `ABRIT_PAYMENTS_*_SANDBOX`/test values out of production)

## 12. Remaining blockers / honest limitations

- **Real SMS delivery**: not exercised (no designated number) — status «Implemented but requires external credentials/test number»
- **Live Nextcloud**: not exercised (no credentials) — status «Implemented but requires external credentials»
- **ZarinPal/Zibal**: sandbox-tested only (both gateways); production verification will need real merchant credentials — status «Implemented and sandbox-tested»
- **Orchard forgot/reset password**: branded shells verified to render; the underlying email delivery uses the Orchard SMTP pickup directory in this sandbox (dev transport) — production SMTP must be configured in Orchard settings
- Sandbox runtime note: this 4 GB sandbox OOM-killed the dev server when heavy builds ran concurrently; servers were restarted with explicit `DATABASE_URL` and are healthy (both :3000 and :5000 verified after all work)
