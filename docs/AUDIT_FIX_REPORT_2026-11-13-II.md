# AbrIT — Orchard Admin UI, Authentication, Redirect & Drive Audit — Fix Report

> Round: 2026-11-13 (II). Every claim below was re-verified against the current
> source **before** patching, and browser-verified after. Evidence screenshots:
> `docs/evidence-audit/`. Statuses are used honestly per the specification.

---

## 1. Orchard Core Admin — UI/UX correction (§1 of the audit)

### Root causes found (verified against source, not guessed)

| # | Symptom | Root cause |
|---|---|---|
| 1 | All 12 `/Admin/AbrIT/*` pages unstyled/rough | The `.abrit-ops__*` design system (~17 BEM classes), `.abrit-admin-table-wrap`, and the `.abrit-status-badge.is-active/is-pending/is-muted` modifiers were **referenced by every business page but defined nowhere** — only stray light-mode overrides existed in `abrit-admin.css` |
| 2 | Conflicting dashboard sizing | `abrit-admin.css` contained two competing dashboard generations (1440px vs 1480px widths, duplicate KPI grid rules, a doubled `.btn-secondary` selector, a dead pagination wrapper) |
| 3 | Mixed-direction admin (LTR shell around RTL pages) | The setup recipe's `DefaultLanguage` key is **not a supported settings step in OrchardCore 3.0.1** (verified against `OrchardCore.Settings.dll`), so the site default culture was never `fa-IR`; TheAdmin renders `<html dir>` and its Bootstrap LTR/RTL bundle from that culture. Custom pages compensated with hardcoded `dir="rtl"` |
| 4 | `/admin` showed an empty widget placeholder (not the KPI dashboard) | The KPI dashboard lived in `Views/AdminDashboard.cshtml` — a **shape template nothing ever displayed**. `/admin` renders the AdminDashboard module's **controller view** `Dashboard/Index.cshtml`, which was never overridden |
| 5 | AbrIT's dark default was overridden by light | TheAdmin/OrchardCore.Themes own the theme store (`{tenant}-theme` in localStorage) and re-apply the preferred theme after page scripts; the old branding script fought it with a private key |
| 6 | Dates unreadable (ISO + milliseconds) in RTL tables | Views rendered raw ISO-8601 strings |
| 7 | Admin favicon was Orchard's stock icon; brand "A" was styled text | No real brand asset existed |

### Fixes

- **`abrit-admin.css` (v3.1.0)**: authored the complete `.abrit-ops` design system (hero, eyebrow, quick-access chips, KPI stat cards with accent bars, cards/labels/links, page headings, back links, filters, status-lists, unavailable states, table wrapper, status-badge modifiers) — RTL-first with logical properties (`inset-inline-start`, `border-block-end`, `margin-inline-end`…), consistent tokens, hover/focus/disabled states, responsive breakpoints (767.98px/480px/380px) + light-mode palette. De-duplicated the CSS conflicts and removed dead rules.
- **Culture**: set the site default culture to **fa-IR through Orchard's own Localization settings UI** (persisted in the DB — `html` now renders `dir="rtl" lang="fa"`, TheAdmin swaps in the RTL Bootstrap bundle, Persian PO translations activate across the admin). Removed the bogus recipe key and hardcoded `dir="rtl"` from all 13 custom views; `DevelopmentIdentitySetup` now applies `LocalizationSettings.DefaultCulture = "fa-IR"` for fresh dev setups.
- **Dashboard**: replaced the dead shape template with a proper theme **view override** `Views/OrchardCore.AdminDashboard/Dashboard/Index.cshtml` — the KPI dashboard (9 cards, recent orders/customers, service-health cards) now renders at `/admin` while keeping the native widgets zone + Manage Dashboard action.
- **Dark default**: the branding script now seeds/applies OrchardCore's own theme store (`{tenant}-theme`, dark by default, explicit light persists) instead of a private key.
- **Dates**: new `Commercial/ViewFormats.CompactDate()` renders compact UTC stamps (`yyyy-MM-dd HH:mm`) in Orders/Payments/Subscriptions/Drive/Tickets; inline styles migrated to CSS.
- **Brand**: new geometric AbrIT mark (navy tile, white peak, electric-blue bar — see §5) as the admin favicon + navbar brand + login mark; FontAwesome verified loading (TheAdmin registers it globally).

### Verification (screenshots in `docs/evidence-audit/`)

| Evidence | File |
|---|---|
| Ops home, light & dark, desktop RTL | `01-ops-home-rtl-1440.png`, `05-ops-home-dark-1440.png` |
| Orders table (badges, tabular amounts, compact dates) | `02-orders-rtl-1440.png`, `04-orders-dark-rtl.png` |
| Pricing table (9 columns, RTL, dark) | `03-plans-rtl-1440.png`, `07-plans-dark.png` |
| `/admin` KPI dashboard (view override) | `08-dashboard-dark-1440.png` |
| Mobile 390px (scrollable tables, icon sidebar) | `09-ops-home-mobile-390.png`, `10-orders-mobile-390.png` |
| Customers page (live commerce data) | `16-customers-dark.png` |

**Status: FIXED & VERIFIED** (light/dark, RTL, desktop/mobile, tables, forms, sidebar collapse/expand preserved — TheAdmin native behavior untouched).

---

## 2. Password login — email OR mobile (§2)

- New shared parser `src/lib/auth/identifier.ts` (single source of truth; pure, client+server safe): emails lowercased, mobiles digit-normalized to the canonical `09XXXXXXXXX` — Persian/Arabic digits, spaces, dashes all collapse onto the stored form, so **inconsistent phone formats can never split one account**.
- `POST /api/auth/login` accepts `{identifier, password}`: parses to email OR mobile branch, single canonical lookup, generic 401 (no enumeration), scrypt verification unchanged, disabled-account check preserved.
- **Rate limiting added**: failed password attempts are counted from the durable audit log per identifier AND per IP-hash over 15 minutes → 429 with a Persian message.
- Login view: field relabeled **«شماره تماس یا ایمیل»**, `type="text"` + `inputMode="email"`, client-side validation mirroring the server parser.
- OTP verify route now normalizes the mobile **before** the user lookup; recover/reset reuses the shared normalizer (3 divergent implementations unified).

**Verified** (`12-mobile-password-login-portal.png`, `13-email-password-login-portal.png`):
mobile `09121111111` + password → `/portal`; mixed-case `Demo@Abrit.IR` + password → `/portal`; malformed identifiers → 400 with one generic message; 10 bad attempts → 401×10 then **429**.

**Status: FIXED & VERIFIED.**

---

## 3. OTP redirect root cause (§3)

**Root cause (confirmed by code trace + runtime):** after a successful OTP/password mutation the hooks only called `invalidateQueries()` — TanStack refetched `/api/me` in the background while the cache still held `{user:null}`. The portal layout guard (`!me.isLoading && !user`) fired on the stale cache and bounced the just-authenticated user back to `/auth/login?next=/portal`. Navigation code and cookies were never the problem (login and OTP-verify set identical `abrit_session` cookies via one shared helper).

**Fix:** `seedMeCache()` writes the authenticated user into the `["me"]` cache **before** navigation in all three auth mutations (login / OTP verify / register); `invalidateQueries()` still refreshes everything afterward. The SPA `router.replace` strategy is kept — the cause was cache state, not navigation.

**Verified E2E** (`14-otp-login-landed-portal.png`, `15-otp-portal-refresh-persist.png`):
request OTP (spaced + Persian-digit mobile normalize correctly) → type the 6-digit code → **land on `/portal`** (portal APIs 200) → **refresh keeps `/portal`** with `/api/me` returning the session (`09121111111`, role customer). Invalid/expired OTPs keep the existing rejection path (atomic attempt counting unchanged).

**SMS delivery config:** production guard re-verified — `display` mode **throws in production**; unconfigured SMS.ir fails safe with 503 `SMS_NOT_CONFIGURED`; credentials come only from env vars. **Real SMS delivery remains UNVERIFIED in this sandbox** (no designated test number / live SMS contract) — the sandbox runs `OTP_DELIVERY_MODE=display` by design and shows the code in the UI.

**Status: OTP redirect FIXED & VERIFIED · real SMS delivery BLOCKED BY EXTERNAL CONFIGURATION.**

---

## 4. AbrIT Drive — entitlement & recovery (§4)

**Confirmed vulnerabilities (fixed):**
- `/api/drive/activate` trusted the body's `planCode` verbatim — any signed-in user could self-assign the 250 GB enterprise quota (the same class of bug fixed earlier on `/api/drive/quota` but missed on activate).
- The existing-account recovery path repaired email/displayname/quota but **never set the remote password** — the chosen credentials silently did not work.

**Fixes:**
- New shared policy `src/lib/drive/entitlement-policy.ts` (`resolveActivatablePlan(requested, entitled)`) used by BOTH `activate` and `quota` routes: only the free `trial` plan or the plan backed by an **active server-side subscription** is acceptable; rejections are audited (`drive.activation.rejected`).
- Recovery path now **applies the chosen password to the existing Nextcloud account** (`editUser(id, "password", …)`); a password-sync failure fails the activation loudly (no silent success with unusable credentials) and the Drive event records the sync.
- `sync`/`enabled` routes hardened to `requireUser()` (disabled accounts blocked, consistent with `activate`).

**Verified** (simulation Drive, since production Nextcloud credentials are not available in this sandbox):
- Attack simulation: authenticated user POSTs `planCode:"enterprise"` → **403 `NOT_ENTITLED`** with the Persian message, before any Nextcloud call; unauthenticated → **401**.
- Legitimate activation: trial → **201**, state `ready`, quota exactly **104,857,600 bytes (100 MB)**, mode honestly labeled `simulation`.
- Recovery: the DriveAccount row was deleted (orphaning the remote account) and re-activated with a NEW password → event `resumed … رمز عبور انتخابی روی حساب موجود همگام شد`, and the simulation server's stored scrypt hash **matches the new password** while the old one is rejected.
- Unit tests: `tests/drive-entitlement.test.ts` (9 cases: trial always allowed, entitled allowed, higher plan rejected, unknown codes rejected, identifier parsing).

**Real Nextcloud provisioning (`drive.abrit.cloud`) remains UNVERIFIED — BLOCKED BY EXTERNAL CONFIGURATION**: no production credentials/network access from this sandbox. The integration is marked simulation-only honestly (production guard throws on `NEXTCLOUD_MODE=simulation` when `NODE_ENV=production`).

**Status: entitlement + recovery FIXED & VERIFIED (simulation) · production provisioning BLOCKED BY EXTERNAL CONFIGURATION.**

---

## 5. Logo (§5)

New identity built from scratch as precise SVG (no AI raster artifacts):
- **Symbol**: deep-navy rounded tile (#0B2447) + geometric "A" — white peak stroke with a floating electric-blue (#3E9BFF) crossbar; flat, minimal, readable at 16px.
- Deliverables: `public/brand/abrit-icon.svg` (standalone icon), `public/brand/abrit-logo-horizontal-light.svg` / `-dark.svg` (wordmark variants), `src/app/icon.svg` + generated `src/app/icon.png` (192) and `src/app/apple-icon.png` (180) — the app previously had **no favicon at all** (404).
- Integrated via the reusable component (`src/components/abrit/ui.tsx` `LogoMark`/`Logo`, wordmark as theme-aware text) into the public header/footer, portal shell, auth pages, Orchard admin navbar, Orchard login/forgot/reset, and the Orchard customer portal (liquid + `PortalShell.cs`); the old three inconsistent marks (gradient-A, letter-A, hexagon) and the orphaned scaffold `public/logo.svg` are gone.

**Status: IMPLEMENTED & VERIFIED** (evidence `11-portal-login-new-brand.png`, `17/18-home-new-logo*.png`, admin screenshots).

---

## 6. Source-derived issues & hygiene (§6)

- **Tracked secret REMOVED**: `orchard/AbrITPortal/appsettings.json` no longer contains the service token (empty default; overridden by env `AbrIT__CommerceApi__ServiceToken` — wired in `orchard-watchdog.sh` from `.env` and documented for docker-compose). The token **also exists in the previously pushed commit** — history is rewritten in this push (single clean commit) so GitHub holds no copy. **ROTATION REQUIRED**: the exposed sandbox service token and the SMS.ir API key (never committed, but circulated in plaintext) must be rotated by the operator before production.
- Verified OK: `.env` is git-ignored and present in **no reachable commit** (single-commit history, `git log --diff-filter=A -- .env` empty); `.env.example` files contain placeholders only; no other secret-like tracked files.
- Production guards re-verified in code: OTP display-mode rejection, Nextcloud simulation rejection, payments public-URL requirement.
- One environmental trap documented & mitigated: the sandbox shell exports a stale `DATABASE_URL=file:…` which overrides `.env` (OS env wins) — the dev server must be started with the pinned PostgreSQL URL (health endpoint `db:"up"` proves it).

---

## 7. Tests executed (§7)

| Check | Result |
|---|---|
| `bun test` | **103 pass / 0 fail** (incl. 9 new entitlement/identifier cases) |
| `bun run lint` | clean |
| `bunx tsc --noEmit` | exit 0 |
| `dotnet build` (Orchard) | Build succeeded, 0 errors |
| Browser E2E (agent-browser) | email+password login → /portal; mobile+password login → /portal; OTP login → /portal; /portal refresh persistence (`/api/me` authenticated); modified-planCode attack → 403; trial activation → 201/100MB; recovery → password re-synced (hash-verified); admin RTL/light/dark/mobile screenshot review |

---

## 8. Remaining blockers / honest production assessment

1. **Real SMS delivery** — BLOCKED BY EXTERNAL CONFIGURATION (needs SMS.ir live contract + designated test number). Code path, guards and outbox are implemented; NOT production-verified.
2. **Real Nextcloud provisioning** — BLOCKED BY EXTERNAL CONFIGURATION (needs `drive.abrit.cloud` credentials + network). Verified against the bundled simulation server only.
3. **Secret rotation** — required for the previously exposed sandbox service token and the SMS.ir key.
4. **Session cookie `secure` flag** is `NODE_ENV`-derived; production must run behind HTTPS (documented) so cookies persist.

**AbrIT is NOT claimed production-ready** until items 1–2 pass against the real services and item 3 is done.
