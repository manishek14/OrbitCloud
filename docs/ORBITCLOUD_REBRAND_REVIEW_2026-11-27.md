# OrbitCloud Rebrand & Review — 2026-11-27

Independent engineering review of `manishek14/OrbitCloud` @ `9321f53` plus the
**AbrIT → Orbit** rebrand executed directly on `main` through a series of
reviewed commits. The rebrand record and findings below are maintained through
HEAD `736d09ad` (which also lands the §5 recommendation #2 security fix). Read
together with [`ORCHARD_HOSTING_GUIDE.md`](ORCHARD_HOSTING_GUIDE.md).

## 1. Architecture (verified)

- **Next.js 16 portal** (`src/`): public site, customer portal, SMS.ir OTP auth,
  commerce (catalog → quote → checkout), ZarinPal/Zibal sandbox payments,
  support tickets, Orbit Drive (Nextcloud) client.
- **Orchard Core 3.x CMS** (`orchard/`, .NET 10): the real admin at `/admin` —
  host project `AbrITPortal` + themes `AbrITAdminTheme` / `AbrITPortalTheme`.
  Proxied behind the same origin by the hardened catch-all
  `src/app/[...path]/route.ts` (`ORCHARD_PROXY_TARGET`).
- **PostgreSQL**: `abrit_portal` (Prisma) + `abrit_orchard` (YesSql).
- **CI**: lint, tsc, bun tests, Next build, .NET build + 2 harnesses, compose
  validation, both Docker builds.
- **Live state**: portal healthy on Vercel (`/api/health` ok, DB up); `/admin`
  returns 502 because `ORCHARD_PROXY_TARGET` points at an unreachable CMS —
  the .NET app cannot run on Vercel. See the hosting guide.

## 2. Rebrand record (what changed, and where)

| Commit | Surface |
|---|---|
| `0571ab3` | catalog + drive plans display strings, root metadata, favicon |
| `a8b6437` | Logo wordmark component → **Orb+it** |
| `3d15c2e` | public + auth layout brand strings |
| `6e18534` | portal layout shell, plan-card strings, README |
| `7c81b6c` | Orchard admin theme chrome (login/forgot/reset/dashboard branding, admin menu labels), `orbit-icon.svg` |
| `d0666de` | CMS-unavailable fallback page, `/api/health` + `/api/liveness` service name, `public/brand/orbit-*` assets |
| `d3a527f`…`e7c31ad` | replaced `abrit-*.svg` assets deleted |
| `9dadf15` | residual document-name token (`Orbit_Packages_1405_Final`) |
| `b959104` | public homepage brand strings |
| `7690c4f` | about/faq/services page brand strings |
| `e8684e0` | plans + contact page brand strings |
| `c13d669` | portal dashboard/services/service-detail brand strings |
| `453b0fb` | AbrITBusinessAdminController messages + PortalShell chrome |
| `b9f3710` | AbrITBusinessAdmin views ×12 brand strings |
| `1974477` | AbrITPortalTheme layout chrome + `orbit-icon.svg`/`orbit-logo.svg` assets |
| `11ddff7` | Drive doc renamed → `docs/ORBIT_DRIVE_INTEGRATION.md` |
| `97b8dfa` | drive/contact/gateway API copy + portal plans/settings pages |
| `1dc650f` | portal drive page brand strings |
| `704bbac` | checkout invoice placeholder copy |
| `855fcec` | plan configurator + profile page brand strings |
| `eb330b0` | security + tickets page brand strings |
| `2d9de8c` | README points at the renamed Drive doc |
| `f357053` | old-name `docs/ABRIT_DRIVE_INTEGRATION.md` deleted |
| `51d0016`/`53a07d2` | replaced portal-theme `abrit-icon.svg`/`abrit-logo.svg` deleted |
| `4dc260ac` | simulation-mode Orbit Drive branding: `nextcloud-mock` page strings, sim session cookie `abrit_drive_sim` → `orbit_drive_sim`, mock admin defaults (`orbit-portal-admin` / `orbit-simulation-app-password`) + matching `config.ts` SIM defaults, mock fixtures |
| `c756ebc6` | simulation mock UI branding (`nextcloud-mock/index.ts` — companion file missed in the previous push) |
| `314b0ef7` | portal user-dashboard liquid Orbit Drive card + design-token comment; `Page-UserDashboard.liquid` normalized UTF-16LE → UTF-8 (`AbrITOrder` content-part refs deliberately kept) |
| `4de3ebe9` | register terms checkbox string → Orbit services; shared sessionStorage key `abrit:otp-display` → `orbit:otp-display` (renamed atomically across register/login/verify-otp) |
| `eb605bfa` | public nav label («درباره AbrIT» → «درباره Orbit»); `NextcloudError` Persian messages → Orbit Drive |
| `dbe3e0fe` | free-plan Drive quote message + comment → Orbit Drive |
| `227dfedf` | drive service user-visible messages (USERNAME_TAKEN, not-configured, login labels); status cache key namespace → `orbit-drive:*` |
| `6ad2fa21` | gateway payment description («پرداخت سفارش X — Orbit»); Drive quota-update/activation notifications; Drive service record title |
| `d9dbc4ee` | lib comments (types/client/media/content/entitlement); internal SPA navigation event name → `orbit:navigate`; dev-only fallback HMAC key literals → `orbit-*` |
| `5471eaf` | types free-plan comment, rbac platform/Admin-area comments, `orbit:navigate` CustomEvent references (`orchard@abrit.internal` service principal kept as contract) |
| `736d09ad` | **Security follow-up**: post-login `?next=` open redirect fixed in both auth views (§4/§5) — no brand surface |

**Completion state** (through HEAD `736d09ad`): every user-visible brand surface
(portal public/auth/portal pages, Orchard admin + business views + portal theme
chrome, API copy, docs, assets) reads **Orbit**, and the follow-up sweep also
renamed internal identifiers and comments (simulation surfaces, sessionStorage
and cache namespaces, SPA navigation event, dev-only fallback HMAC key
literals). The residual `abrit` tokens are exactly the contract/infrastructure
identifiers in §3.

## 3. Deliberately KEPT identifiers (do **not** grep-hack these)

Renaming the tokens below breaks the live deployment, the CMS contract, or the
database. They are scheduled for a **coordinated follow-up** (rename + config
cutover in the same release):

| Identifier | Where | Why kept |
|---|---|---|
| `ABRIT_SERVICE_TOKEN`, `ABRIT_TRUSTED_PUBLIC_HOSTS`, `ABRIT_TRUST_PROXY_HEADERS`, `ABRIT_CSP`, `ABRIT_PAYMENTS_*`, `ABRIT_PROXY_MAX_BODY_BYTES` | env names across portal/compose/docs | live Vercel env contract — renaming requires a same-deploy Vercel env update |
| `abrit_session` cookie, `x-abrit-service-token` header | portal ⇄ CMS contract | service-to-service contract; rename both sides + rotate in one release |
| `AbrITPortal`, `AbrITAdminTheme`, `AbrITPortalTheme` (+ `.csproj`/`.slnx`/tests projects) | C# projects, themes, csproj/slnx | Orchard module identity; needs project/namespace/folder refactor (~230 files) |
| `abrit_portal`, `abrit_orchard` | DB names (init/compose) | renaming DBs needs a data migration |
| `drive.abrit.cloud` | Nextcloud config | live production host |
| `demo@abrit.ir`, `admin@abrit.ir` | seed + login hint | matches the seeded demo accounts |
| `ManageAbrITOperations`, `/Admin/AbrIT/*` URLs, `AbrIT:CommerceApi` config key | C# permission + admin routes + appsettings | matches the C# controller/provider contract |
| `abrit-*` CSS classes AND `abrit-admin.css` / `admin-abrit.css` / `abrit-portal*.css` stylesheet filenames | Orchard stylesheets + `ResourceManagementOptionsConfiguration.cs` + `PortalShell.cs` + liquid `asset_url` refs | class rename and stylesheet rename must land in the same release |
| `src/components/abrit/` folder + `@/components/abrit/*` imports | shared UI library, ~40 importers | pure refactor (type-checked); queued follow-up — recreate 9 files under `orbit/` and update all importers atomically |
| `AbrITService` content type, `Content-AbrITService.*.liquid` templates, `AbrIT.setup.recipe.json` | Orchard recipe + theme templates | content-type/recipe identity; rename requires recipe + content-type migration |
| `docs/` historical audit reports (2026-11-13 era) | historical records | left as-is on purpose; they document the state at their commit dates |

## 4. Security findings (verified this round)

| Sev | Finding | Location |
|---|---|---|
| P1 | Demo credentials (incl. admin password) rendered on the public login page; `SEED_ON_START` can seed them in production | `src/views/auth/login-view.tsx:122-124`, `prisma/seed.ts:25-37`, `docker/portal-entrypoint.sh` |
| P2 | Post-login **open redirect**: `next=//evil.com` passes `next.startsWith("/")` — **FIXED in `736d09ad`**: both views now validate `/^\/(?!\/|\\)/`; `register-view` audited (no `next` handling) | `src/views/auth/login-view.tsx`, `src/views/auth/verify-otp-view.tsx` |
| P2 | Unauthenticated payment callback flips transaction state using only `gatewayRef` (Zibal trackIds are numeric/enumerable) | `src/app/api/payments/callback/[gateway]/route.ts`, `src/lib/commerce/orders.ts:459+` — add a per-transaction capability token to `callbackUrl` |
| P2 | In-memory rate limiting is per-lambda on serverless; contact/quote/reverify limits degrade | `src/lib/rate-limit/memory.ts` — use Postgres counters or Upstash |
| P2 | CSP allows `script-src 'unsafe-inline'` on every route | `next.config.ts` — documented Orchard tradeoff; consider nonce policy for portal-only routes |
| P3 | Proxied response bodies uncapped (request body is capped, responses are not) | `src/app/[...path]/route.ts:409+` |
| P3 | ZarinPal live-mode flip has no production guard | `src/lib/payments/providers.ts:110` |
| P3 | `ABRIT_SECURITY_HEADERS=off` kill-switch has no production warning | `next.config.ts:28` |

**Note on the previously flagged proxy open-redirect**: verified **fixed** in
the current code — `sanitizeUpstreamLocation` (FSR-6) reduces every upstream
`Location` to a safe relative path and rejects network-path references
(`trustedRedirectOrigins`, `src/app/[...path]/route.ts:265-311`).

## 5. Recommendations (ordered)

1. Remove the credential banner; generate the admin password at seed time.
2. ~~Fix the `next` redirect validation (both views).~~ **Done** — landed in
   `736d09ad` (safe-relative `/^\/(?!\/|\\)/` check in both post-auth views).
3. Add a capability token to payment callback URLs.
4. Move rate-limit counters to a shared store before scaling traffic.
5. Host the CMS per [`ORCHARD_HOSTING_GUIDE.md`](ORCHARD_HOSTING_GUIDE.md), then set
   `ORCHARD_PROXY_TARGET` + `ABRIT_TRUSTED_PUBLIC_HOSTS=orbitcloud.vercel.app`
   in Vercel.
6. Schedule the identifier-tier rename as one coordinated release (env vars +
   cookie/header + C# project names + CSS classes + `src/components/abrit/`).
