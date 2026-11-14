# AbrIT Platform — Architecture & Deployment

> This document is the authoritative description of the corrected production
> architecture: the **real Orchard Core administration at `/admin`**, the
> Next.js public site + customer portal, **PostgreSQL** as the single
> production database, real sandbox payment gateways (ZarinPal + Zibal), and
> SMS.ir OTP delivery.

---

## 1. System Architecture

```
                        ┌────────────────────────────────────────────┐
                        │            Reverse proxy (TLS)             │
                        │  abrit.cloud  →  single origin             │
                        └───────────────┬────────────────────────────┘
                                        │
              ┌─────────────────────────┴──────────────────────────┐
              │  Next.js 16 (port 3000)                            │
              │  • Public site  /  /services /plans /about …       │
              │  • Auth         /auth/login (OTP) …                │
              │  • Customer portal /portal/** (right sidebar)      │
              │  • Commerce APIs /api/** (canonical owner)         │
              │  • Reverse-proxies every non-Next path → Orchard   │
              └──────┬──────────────────────────────┬──────────────┘
                     │ service token (server-to-    │ fallback proxy
                     │ server, X-Abrit-Service-Token)│ /admin, /Login, /TheAdmin,
                     ▼                              ▼ /OrchardCore.*, /media …
        ┌────────────────────────┐      ┌────────────────────────────┐
        │ PostgreSQL (durable)   │      │ Orchard Core 3.0.1 (.NET)  │
        │ • abrit_portal (Prisma)│◄─────│ • REAL CMS admin at /admin │
        │   canonical business   │ read │ • AbrITAdminTheme (dark)   │
        │   records              │ via  │ • Content/Media/Users/     │
        │ • abrit_orchard (YesSql│ API  │   Roles/Workflows/Queries/ │
        │   CMS content+users)   │      │   Recipes/Localization    │
        └──────────┬─────────────┘      │ • AbrIT business admin     │
                   │                    │   (customers/orders/…)     │
                   │                    └────────────────────────────┘
        ┌──────────┴──────────┐    ┌──────────────┐   ┌──────────────┐
        │ Nextcloud (AbrIT    │    │ SMS.ir Verify│   │ ZarinPal +   │
        │ Drive) OCS API      │    │ API (OTP)    │   │ Zibal        │
        │ drive.abrit.cloud   │    │ api.sms.ir   │   │ SANDBOX      │
        └─────────────────────┘    └──────────────┘   └──────────────┘
```

### Canonical data ownership

| Data | Owner | Storage | Accessed by Orchard via |
|---|---|---|---|
| Customers (panel users, sessions, OTP grants) | Next.js | PostgreSQL `abrit_portal` (Prisma) | `/api/admin/customers` |
| Orders (immutable price snapshots) | Next.js | PostgreSQL | `/api/admin/orders` |
| Payments / transactions (gateway refs) | Next.js | PostgreSQL | `/api/admin/payments` |
| Invoices | Next.js | PostgreSQL | `/api/admin/invoices` |
| Subscriptions & services | Next.js | PostgreSQL | `/api/admin/subscriptions` |
| Drive account mappings (Nextcloud IDs) | Next.js | PostgreSQL | `/api/admin/drive` |
| Support tickets | Next.js | PostgreSQL | `/api/admin/tickets` |
| Pricing catalog (single source of truth) | Next.js code (`src/lib/commerce/catalog.ts`) | code-defined | `/api/commerce/catalog` (read-only in Orchard) |
| SMS outbox (OTP delivery audit) | Next.js | PostgreSQL (`SmsOutbox`) | — |
| CMS content, Orchard users/roles, workflows, media metadata | Orchard Core | PostgreSQL `abrit_orchard` (YesSql) | n/a (Orchard-native) |

**There is no second database of customers, orders, payments, subscriptions or
Drive accounts inside Orchard.** Orchard's business pages read the canonical
records through the documented server-to-server API with the shared
`ABRIT_SERVICE_TOKEN` (constant-time compared on the Next.js side).

---

## 2. Routing map (real paths — no hash routes)

| Path | Served by | Notes |
|---|---|---|
| `/` | Next.js | Public home |
| `/services` `/plans` `/about` `/contact` `/faq` | Next.js | Public site |
| `/auth/login` `/auth/register` `/auth/verify-otp` `/auth/forgot-password` `/auth/reset-password` | Next.js | Customer authentication (OTP via SMS.ir in production) |
| `/portal` (+ `/services/[id]`, `/plans/[id]`, `/cart`, `/checkout`, `/payment/result`, `/orders`, `/billing`, `/drive`, `/tickets/[id]`, `/notifications`, `/profile`, `/security`, `/settings`) | Next.js | Customer portal, right-side persistent navigation |
| `/api/**` | Next.js | All commerce/auth/portal APIs |
| `/admin/**` | **Orchard Core** | The REAL Orchard administration (non-negotiable) |
| `/Login` `/Logoff` `/users/*` | Orchard Core | Orchard identity (admin login) |
| `/TheAdmin/**` `/OrchardCore.*/**` `/AbrITAdminTheme/**` `/media/**` | Orchard Core | Module static assets + media library |
| anything else | Orchard Core | Fallback proxy rule |

**Routing rule** (`next.config.ts`): a single *fallback* rewrite proxies every
request that does not match a Next.js filesystem route to
`ORCHARD_PROXY_TARGET` (default `http://127.0.0.1:5000`). Legacy `/#/...` hash
URLs from the old build are migrated to real paths on first load.

The old React admin imitation (`src/views/admin/*`, hash route `/#/admin`)
was **deleted**. `/admin` now always reaches the real Orchard application.

---

## 3. Authentication boundaries

| Principal | System | Credentials |
|---|---|---|
| Customer | Next.js portal | Email+password or mobile OTP (SMS.ir) — session cookie `abrit_session` |
| CMS administrator | Orchard Core | Orchard user store (own login at `/Login`) |
| Service (Orchard → commerce API) | Next.js `/api/admin/*` | `X-Abrit-Service-Token: <ABRIT_SERVICE_TOKEN>` (min 16 chars, constant-time compare) |

- Customer roles **never** grant Orchard admin access; the two identity
  systems are fully separate (separate cookies, separate stores).
- All `/api/admin/*` routes accept EITHER a panel session with the proper
  permission OR the service token.
- OTP security: CSPRNG 6-digit codes, SHA-256-only storage, 5-minute TTL,
  single-use, max 5 attempts, 3/mobile and 10/IP per 15 minutes, Persian/Arabic
  digit normalization. In production (`NODE_ENV=production`) the OTP code is
  **never** returned by the API and `display` mode is rejected outright.
- Password recovery: email channel (RECOVERY_DELIVERY_MODE=email in
  production) or mobile channel via SMS.ir OTP (purpose `recover`).

---

## 4. Payment flow (ZarinPal Sandbox + Zibal Sandbox; Mellat disabled)

Verified against the providers' live sandbox APIs (2026-11-13):

1. Customer configures a plan (users/endpoints/contract period) → server-side
   quote with immutable checksummed snapshot (`/api/commerce/quote`).
2. Cart → checkout → `Order(pending_payment)` (server recomputes every price).
3. `POST /api/payments/init {orderId, gateway}` — server selects the provider
   (**Mellat is always rejected**), stores the provider reference
   (`gatewayRef`, unique) on the transaction and returns the REAL provider
   payment-page URL.
4. Browser is redirected to the provider sandbox page
   (`sandbox.zarinpal.com/pg/StartPay/{authority}` /
   `gateway.zibal.ir/start/{trackId}`).
5. Provider redirects the browser to `/api/payments/callback/{gateway}`.
6. The callback **verifies the payment server-to-server** (ZarinPal
   `pg/v4/payment/verify.json`, Zibal `v1/verify`) including the paid amount
   (Toman→Rial conversion happens exactly once, inside each provider adapter).
   A browser success flag alone is never trusted.
7. Verified success → single `finalizeSuccess()` path: Transaction
   `succeeded`, Order `paid`, Invoice issued, Subscription + Service records
   created, Drive quota applied per plan, notifications sent, audit logged.
8. Ambiguous verification → transaction stays **pending**; the result page
   re-verifies (idempotent) and the state is honestly reported.
9. Browser lands on `/portal/payment/result?ref=…` (real path) showing only
   server-verified state.

Amount unit contract: catalog is in **Toman (IRT)**; both providers operate
in Rial; conversion ×10 exists exactly once per adapter and the verified
provider amount must equal the stored server-side Toman amount.

The internal mock gateway (`MOCK-` refs) is dev-only
(`ABRIT_PAYMENTS_MOCK_ENABLED=true`, default **false**).

---

## 5. Commercial rules (single source of truth)

`src/lib/commerce/catalog.ts` — every value in one place:

- **Contract periods: exactly 1, 3, 6 months** (the 12-month option was
  removed everywhere: catalog, quote engine, cart validation, checkout, UI).
  - 1 month: no discount, no onboarding fee — ⚠ **pending final business
    approval** (`ONE_MONTH_POLICY`, explicitly configurable).
  - 3 months: 3% discount, onboarding 50% of one month's base.
  - 6 months: 5% discount, onboarding 25% of one month's base.
- **SLA (start of incident handling, not guaranteed resolution):**
  پایه ۸ ساعت · استاندارد ۵ ساعت · حرفه‌ای ۳ ساعت · سازمانی ۱ ساعت ·
  سازمانی پلاس لحظه‌ای («لحظه‌ای» = P1 handling starts immediately, 24×7 —
  configurable definition in `SLA_IMMEDIATE_DEFINITION_FA`).
- Free AbrIT Drive trial: **100 MB** for every eligible customer; paid plan
  quotas 10/25/50/100/250 GB — shown on every plan card, plan detail, pricing
  page and Drive UI.
- ⚠ **Documented business conflict (needs confirmation):** the 1405 tariff
  document lists the Essential package's Nextcloud/file-sharing row as «–»
  while its cloud-storage row says 10 GB. The implementation uses **10 GB**
  (single mapping point: `catalog.ts`).

---

## 6. Production deployment

### 6.1 Databases (PostgreSQL — mandatory)

```bash
# 1. Create databases (separate schemas of one PostgreSQL instance):
createdb abrit_portal && createdb abrit_orchard

# 2. Next.js schema (migrations — the deployment path):
DATABASE_URL="postgresql://...abrit_portal..." bunx prisma migrate deploy
bun run db:seed   # optional: initial content/contacts

# 3. Orchard tenant: run the app once, complete /Setup with
#    DatabaseProvider=Postgres and the abrit_orchard connection string
#    (recipe "AbrIT"). Never use SQLite in production.
```

### 6.2 Applications

```bash
# Next.js (public site + portal + commerce APIs)
bun run build && NODE_ENV=production ABRIT_SERVICE_TOKEN=... \
  DATABASE_URL=... OTP_DELIVERY_MODE=sms SMSIR_API_KEY=... \
  bun .next/standalone/server.js     # port 3000

# Orchard Core (real CMS administration)
cd orchard/AbrITPortal && dotnet publish -c Release
ASPNETCORE_URLS=http://127.0.0.1:5000 ASPNETCORE_ENVIRONMENT=Production \
  dotnet bin/Release/net10.0/publish/AbrITPortal.dll
```

`orchard/AbrITPortal/appsettings.json`:

```json
{
  "AbrIT": {
    "CommerceApi": {
      "BaseUrl": "http://127.0.0.1:3000",
      "ServiceToken": "<same ABRIT_SERVICE_TOKEN>",
      "TimeoutSeconds": 15
    }
  }
}
```

### 6.3 Reverse proxy (single origin + TLS termination)

```
abrit.cloud {
  # Next.js owns everything; it reverse-proxies non-Next paths to Orchard
  reverse_proxy 127.0.0.1:3000
}
```

The Next.js fallback rewrite sends `/admin`, `/Login`, `/TheAdmin/**`,
`/OrchardCore.*/**`, `/media/**`, … to `ORCHARD_PROXY_TARGET`. Both apps run
plain HTTP on loopback behind the proxy; secure cookies are enforced by the
proxy scheme and `X-Forwarded-Proto` handling in both apps.

### 6.4 Health checks & logging

- Next.js: `GET /api/health` (app), `GET /api/drive/health` (Nextcloud).
- Orchard: standard Kestrel + NLog structured logs
  (`App_Data/logs/orchard-log-*.log`).
- Prisma query logging is disabled by default (enable only with
  `PRISMA_LOG_QUERY=1` in isolated debugging).

### 6.5 Backups

- `pg_dump abrit_portal` (canonical business data) — daily + before
  migrations.
- `pg_dump abrit_orchard` (CMS content) — with the same schedule.
- Orchard `App_Data` (shell state, DataProtection keys) must be backed up
  together with the Orchard database.
- Rollback strategy: Prisma migrations are forward-only in production; roll
  back by redeploying the previous release (snapshots of both databases are
  the safety net — never `prisma db push --accept-data-loss` in production).

### 6.6 Required environment variables (production)

`DATABASE_URL`, `ABRIT_SERVICE_TOKEN`, `ORCHARD_PROXY_TARGET`,
`OTP_DELIVERY_MODE=sms`, `SMSIR_API_KEY`, `SMSIR_OTP_TEMPLATE_ID`,
`SMSIR_CODE_PARAMETER_NAME`, `RECOVERY_DELIVERY_MODE=email`,
`NEXTCLOUD_MODE=live`, `NEXTCLOUD_ADMIN_USER`, `NEXTCLOUD_ADMIN_APP_PASSWORD`,
`DRIVE_LOGIN_URL=https://drive.abrit.cloud`
(see `.env.example` for the complete annotated list).

---

## 7. Security review summary

- **Payment spoofing/replay**: browser flags never trusted; server-side
  verification with amount equality; `gatewayRef` unique; `finalizeSuccess`
  idempotent; ambiguous results stay pending.
- **Entitlement enforcement**: `/api/drive/quota` now allows only the free
  trial (100 MB) or the plan backed by an active subscription.
- **OTP abuse**: hashing, TTL, single-use, attempt limits, per-mobile and
  per-IP rate limits, production display-mode rejection, fail-safe
  configuration errors (no silent fallback).
- **Service token**: constant-time comparison, min 16 chars, server-side
  only, never logged.
- **Secrets**: no real credentials committed; `.env` values are never copied
  into code, logs, screenshots or docs. Sandbox merchant values are public
  documented test values.
- **XSS/CSRF/SQL injection**: React escaping everywhere, Orchard antiforgery
  on admin forms, Prisma parameterized queries only.
- **Known limitation (documented, by design)**: Orchard-local mobile identity
  pages (`/customer/*`) remain a development facility for CMS-local accounts;
  the production customer OTP flow is exclusively the Next.js + SMS.ir path.
  Orchard-local SMS outbox uses in-memory storage unless
  `AbrIT:SmsDatabase` is configured (PostgreSQL store is wired and ready).

---

## 8. Verification evidence (executed)

- `tsc --noEmit` — clean (TypeScript errors are no longer ignored in builds:
  `ignoreBuildErrors` was removed).
- `eslint .` — clean.
- `bun test` — **93 tests, 0 failures** (pricing/SLA/quote math, payment
  providers with mocked gateways incl. Mellat rejection and single-site
  Toman→Rial conversion, OTP security matrix, service-token checks, schema
  invariants).
- Live sandbox probes: ZarinPal request/verify, Zibal request/verify (see
  `src/lib/payments/providers.ts` header for the verified response shapes).
- End-to-end API flow: login → cart → checkout → ZarinPal/Zibal initiation →
  real sandbox redirect → callback → server-side verify → honest failure for
  unpaid (spoofed success correctly rejected) → Mellat rejected.
- `/admin` through the single origin → real Orchard Core: setup with the
  `AbrIT` recipe on PostgreSQL, admin login, AbrITAdminTheme active (dark,
  branded), content/media/users/roles/workflows/queries/recipes functional,
  AbrIT business pages showing live canonical data (customers, orders,
  payments, plans with 1/3/6-month contracts and the new SLA labels).

### Re-verification screenshots (final acceptance pass)

`docs/evidence-final/` — captured during the final audit session:

| File | Shows |
|---|---|
| `01-admin-dashboard.png` | Real Orchard dashboard via `/admin` (AbrITAdminTheme, dark) |
| `02-admin-abrit-menu.png` | AbrIT business menu group inside the Orchard admin |
| `03-admin-customers.png` | `/Admin/AbrIT/Customers` — canonical PostgreSQL data via service API |
| `04-admin-orders.png` / `05-admin-payments.png` | Live orders + verified-only payment states |
| `06-orchard-content.png` / `07-orchard-media.png` | Real Content management + Media Library |
| `08-orchard-users.png` / `09-orchard-roles.png` | Real Users & Roles administration |
| `10-portal-dashboard.png` | Customer portal (right sidebar, dark, real data) |
| `11`–`12-portal-drive*.png` | Drive onboarding: 100 MB trial + plan quota, simulator disclosure |
| `13-plans-comparison.png` / `14-plans-contracts.png` | Full feature/SLA/quota matrix + 1/3/6-month contract rules |
| `15`–`16-plan-config*.png` | User/endpoint steppers with live server quote |
| `17-portal-mobile-390.png` / `18-mobile-drawer.png` | Mobile 390 px layout + RTL drawer |
| `19-auth-login.png` | Auth: mobile OTP first-class + password tab |
| `20-home-light-1440.png` | Light mode home (persisted) |
| `21-payment-result.png` | Payment result — server-verified status only |
| `22-portal-1024.png` / `23-portal-768.png` / `24-plans-1920.png` | Tablet/wide responsive checks |
