# AbrIT — Mandatory Audit Report (Architecture Correction)

> Required by §1 of the correction specification: report the serving
> application for each surface, the available Orchard project, theme
> reference, databases, the shared-data contract, and the routing that puts
> the **real Orchard Core administration** at `/admin`.
>
> Everything below was **re-verified in this session** (process inspection,
> HTTP probes, PostgreSQL queries, authenticated browser walkthrough).
> Evidence screenshots: `docs/evidence-final/`.

---

## 1. Which application currently serves the homepage?

**Next.js 16 (App Router)** — `src/app/page.tsx` (public marketing site) on
port **3000**. Verified: `GET / → 200`, rendered branded home in dark
(default) and light mode. Hash routing is **gone**: real filesystem routes
`/services`, `/plans`, `/about`, `/contact`, `/faq`, `/auth/*`, `/portal/*`
exist under `src/app/**`.

## 2. Which application currently serves the customer portal?

**Next.js** — real route tree `src/app/portal/**` (dashboard, services,
`services/[id]`, plans, `plans/[id]`, cart, checkout, `payment/result`,
orders, billing, drive, tickets, `tickets/[id]`, notifications, profile,
security, settings). Right-side persistent navigation verified in the
browser at 1440 px; collapses to an RTL slide-in drawer at 390 px.

## 3. Which application currently serves `/admin`?

**The real Orchard Core application** (AbrITPortal, .NET 10 / Orchard Core
3.0.1, process `dotnet bin/Debug/net10.0/AbrITPortal.dll` on
`127.0.0.1:5000`), reached through the Next.js fallback rewrite
(`next.config.ts` proxies every non-Next.js path to `ORCHARD_PROXY_TARGET`).
Verified: `GET /admin` → `302 → /Login?ReturnUrl=%2Fadmin` (Orchard identity)
when unauthenticated; after login the genuine Orchard admin renders
(TheAdmin layout: left icon sidebar, admin toolbar, Orchard "Manage
Dashboard"). The old React admin imitation was **deleted**
(`src/views/admin/` no longer exists; the hash route `/#/admin` is gone).

## 4. Which Orchard Core project is available?

`orchard/` at the repository root (the runnable, production-oriented copy —
the `analysis/abrit-orchard/Abrit-Orchard-master` tree is a historical
snapshot only):

| Project | Role |
|---|---|
| `orchard/AbrITPortal` | Orchard Core 3.0.1 web application (Program.cs, Recipes, Payments, Drive, Mobile identity, Notifications, Commercial admin controllers) |
| `orchard/AbrITAdminTheme` | Dedicated **admin theme** (based on TheAdmin, `admin` theme tag, AbrIT branding, dark default + light, `abrit-admin.css`, Vazirmatn) |
| `orchard/AbrITPortalTheme` | Public/portal Orchard theme (liquid views) — not the active site theme; the public site is Next.js |

`.NET SDK 10.0.404` is installed at `$HOME/dotnet` and the npm scripts now
prepend it to PATH (`orchard:build`, `orchard:start`, `orchard:verify`).

## 5. Is the AbrIT admin theme referenced by the running Orchard application?

**Yes — enabled AND active as the current admin theme.** Verified in the
Orchard PostgreSQL document store (`abrit_orchard`):

- Shell descriptor features include `TheAdmin` **and** `AbrITAdminTheme`.
- Site settings: `"CurrentAdminThemeName": "AbrITAdminTheme"`,
  `"DefaultLanguage": "fa-IR"`, `"Calendar": "Persian"`.
- `DevelopmentAdminThemeSetup.cs` (dev-only) also asserts the theme is
  discovered and forces it active.
- Browser evidence: branded header «مدیریت سامانه AbrIT», AbrIT-styled dark
  navy admin chrome, dedicated **AbrIT** menu group inside the Orchard admin
  (`docs/evidence-final/01…05-*.png`).

## 6. Which database does each application currently use?

**Both PostgreSQL 17** (instance on `127.0.0.1:5432`, user `abrit`):

| Application | Database | Access |
|---|---|---|
| Next.js (canonical business data) | `abrit_portal` | Prisma, `provider = "postgresql"` (migrations in `prisma/migrations/`) — **no SQLite fallback exists** |
| Orchard Core (CMS content, Orchard users/roles, workflows) | `abrit_orchard` | YesSql document store |

No in-memory stores back production-path orders, transactions, SMS outbox,
OTP grants, subscriptions or Drive mappings (durable Prisma models:
`Order`, `Transaction`, `SmsOutbox`, `OtpGrant`, `Subscription`,
`DriveAccount`). The Orchard-local in-memory SMS outbox is only reachable
through Orchard-local dev pages and is documented; production OTP is the
Next.js + SMS.ir path.

## 7. How do both applications share the same production data?

**Single canonical owner: Next.js/PostgreSQL (`abrit_portal`).** Orchard's
business pages (Customers, Orders, Payments, Invoices, Subscriptions,
Drive, Tickets, Reports, Audit) are **read-through views** over the
canonical records, fetched server-to-server from `/api/admin/*` with the
shared `ABRIT_SERVICE_TOKEN` (min 16 chars, constant-time compare on the
Next.js side; header `X-Abrit-Service-Token`). Verified:

- `GET /api/admin/customers` without token → **401**; wrong token → **401**.
- The Orchard page `/Admin/AbrIT/Customers` renders «۲ حساب — از منبع کانونی
  (PostgreSQL) خوانده شده است» and the live order/payment rows from the
  sandbox transactions created earlier in this environment.
- **No second database of customers/orders/payments/subscriptions/Drive
  accounts exists inside Orchard** (schema ownership table in
  `docs/ARCHITECTURE.md` §1).

## 8. How is the real Orchard administration made accessible at `/admin`?

`next.config.ts` registers a single **fallback rewrite**: every request that
does not match a Next.js filesystem route (pages or `/api/*`) is proxied to
`ORCHARD_PROXY_TARGET` (default `http://127.0.0.1:5000`). Therefore `/admin`,
`/Login`, `/Logoff`, `/TheAdmin/**`, `/OrchardCore.*/**`,
`/AbrITAdminTheme/**`, `/media/**` all reach the Orchard process on a single
origin — no hash-router aliasing, no path enumeration. Production: Caddy
(`reverse_proxy 127.0.0.1:3000`) → Next.js → (fallback) Orchard.

---

## Critical acceptance test — executed this session

| Step | Result |
|---|---|
| 1. Open `/admin` | Real Orchard responds (302 → Orchard `/Login` when anonymous) |
| 2. Log in with the Orchard administrator account | `abrit-admin` (Administrator) — authenticated |
| 3. Real Orchard Content Management | `/Admin/Contents/ContentItems` renders (Manage Content) |
| 4. Real Orchard Media Library | `/Admin/Media` renders (Assets) |
| 5. Users and Roles | `/Admin/Users/Index`, `/Admin/Roles/Index` render with the Administrator role |
| 6. AbrIT business administration pages | `/Admin/AbrIT/{Customers,Orders,Payments,…}` render **live canonical data** |
| 7. AbrITAdminTheme is the active admin theme | `CurrentAdminThemeName=AbrITAdminTheme` in the site settings document + branded chrome in screenshots |

Screenshots: `docs/evidence-final/01-admin-dashboard.png` …
`09-orchard-roles.png`.

---

## Cross-cutting re-verifications (this session)

- **Tests**: `bun test` → **93 pass / 0 fail** (pricing & SLA matrix,
  payment providers incl. Mellat rejection and single-site Toman→Rial
  conversion, OTP security, service token, schema invariants).
- **TypeScript**: `tsc --noEmit` clean; `ignoreBuildErrors` is **absent**
  from `next.config.ts`. ESLint clean.
- **Commercial rules**: catalog has exactly **1/3/6-month** contracts, the
  five required SLA labels (۸/۵/۳/۱ ساعت، لحظه‌ای), 1-month policy explicit
  and flagged «در انتظار تأیید نهایی شرایط تجاری», Enterprise Custom limits
  (40 users / 60 endpoints).
- **Server-side quotes**: `POST /api/commerce/quote` recomputes everything
  (verified arithmetic incl. 3 % discount, extra users at full price,
  50 % onboarding) and the plan UI shows the live-updated breakdown with a
  server quote id.
- **Payments**: selectable gateways are **ZarinPal (Sandbox)** and **Zibal
  (test)** only; Mellat is not implemented/selectable/rejectable-by-design;
  mock gateway is disabled by default. A real sandbox round-trip exists in
  this environment (`ZPL-38885120` → order `ABR-65687016`, 23,480,000 Toman,
  verified server-side, order «پرداخت‌شده», invoice issued).
- **OTP**: durable `OtpGrant` stores **hash-only** codes (verified in the
  DB), 5-minute TTL, single-use; dev display mode is labeled; production
  mode requires SMS.ir and never returns the code (`OTP_DISPLAY_FORBIDDEN_IN_PRODUCTION`).
- **Drive**: activation UI shows the **100 MB free trial** alongside the
  plan quota (25 GB for the demo subscription); the simulator banner
  honestly discloses the demo backend; plan quotas 10/25/50/100/250 GB are
  in the catalog and rendered on the pricing surfaces.
