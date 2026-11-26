# OrbitCloud Rebrand & Review — 2026-11-27

Independent engineering review of `manishek14/OrbitCloud` @ `9321f53` plus the
**AbrIT → Orbit** rebrand executed directly on `main` through a series of
reviewed commits. Read together with [`ORCHARD_HOSTING_GUIDE.md`](ORCHARD_HOSTING_GUIDE.md).

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
| `3d15c2ea` | public + auth layout brand strings |
| `6e18534` | portal layout shell, plan-card strings, README |
| `7c81b6cb` | Orchard admin theme chrome (login/forgot/reset/dashboard branding, admin menu labels), `orbit-icon.svg` |
| `d0666de` | CMS-unavailable fallback page, `/api/health` + `/api/liveness` service name, `public/brand/orbit-*` assets |
| `d3a527f8`…`e7c31ad` | replaced `abrit-*.svg` assets deleted |
| `9dadf15` | residual document-name token (`Orbit_Packages_1405_Final`) |

## 3. Deliberately KEPT identifiers (do **not** grep-hack these)

Renaming the tokens below breaks the live deployment, the CMS contract, or the
database. They are scheduled for a **coordinated follow-up** (rename + config
cutover in the same release):

| Identifier | Where | Why kept |
|---|---|---|
| `ABRIT_SERVICE_TOKEN`, `ABRIT_TRUSTED_PUBLIC_HOSTS`, `ABRIT_TRUST_PROXY_HEADERS`, `ABRIT_CSP`, `ABRIT_PAYMENTS_*`, `ABRIT_PROXY_MAX_BODY_BYTES` | env names across portal/compose/docs | live Vercel env contract — renaming requires a same-deploy Vercel env update |
| `abrit_session` cookie, `x-abrit-service-token` header | portal ⇄ CMS contract | service-to-service contract; rename both sides + rotate in one release |
| `AbrITPortal`, `AbrITAdminTheme`, `AbrITPortalTheme` | C# projects, themes, csproj/slnx | Orchard module identity; needs project/namespace/folder refactor |
| `abrit_portal`, `abrit_orchard` | DB names (init/compose) | renaming DBs needs a data migration |
| `drive.abrit.cloud` | Nextcloud config | live production host |
| `demo@abrit.ir`, `admin@abrit.ir` | seed + login hint | matches the seeded demo accounts |
| `ManageAbrITOperations`, `/Admin/AbrIT/*` URLs | C# permission + admin routes | matches the C# controller/provider contract |
| `abrit-*` CSS classes | matched 1:1 with the (unrenamed) stylesheets | stylesheet rename must land with the class rename |

Also still carrying the old brand (queued follow-up batch): the 15
`AbrITBusinessAdmin` views, `PortalShell.cs`, `AbrITPortalTheme` liquid views,
`mini-services/nextcloud-mock`, `prisma/seed.ts` demo emails, docker/compose
env plumbing, and the historical audit reports in `docs/` (left as historical
records).

## 4. Security findings (verified this round)

| Sev | Finding | Location |
|---|---|---|
| P1 | Demo credentials (incl. admin password) rendered on the public login page; `SEED_ON_START` can seed them in production | `src/views/auth/login-view.tsx:122-124`, `prisma/seed.ts:25-37`, `docker/portal-entrypoint.sh` |
| P2 | Post-login **open redirect**: `next=//evil.com` passes `next.startsWith("/")` | `src/views/auth/login-view.tsx:102`, `src/views/auth/verify-otp-view.tsx:89` — validate with `/^\/(?!\/|\\)/` |
| P2 | Unauthenticated payment callback flips transaction state using only `gatewayRef` (Zibal trackIds are numeric/enumerable) | `src/app/api/payments/callback/[gateway]/route.ts`, `src/lib/commerce/orders.ts:459+` — add a per-transaction capability token to `callbackUrl` |
| P2 | In-memory rate limiting is per-lambda on serverless; contact/quote/reverify limits degrade | `src/lib/rate-limit/memory.ts` — use Postgres counters or Upstash |
| P2 | CSP allows `script-src 'unsafe-inline'` on every route | `next.config.ts` — documented Orchard tradeoff; consider nonce policy for portal-only routes |
| P3 | Proxied response bodies uncapped (request body is capped, responses are not) | `src/app/[...path]/route.ts:409+` |
| P3 | ZarinPal live-mode flip has no production guard | `src/lib/payments/providers.ts:110` |
| P3 | `ABRIT_SECURITY_HEADERS=off` kill-switch has no production warning | `next.config.ts:28` |

**Note on the previously flagged proxy open-redirect**: verified **fixed** in
the current code — `sanitizeUpstreamLocation` (FSR-6) reduces every upstream
`Location` to a safe relative path and rejects network-path references.

## 5. Recommendations (ordered)

1. Remove the credential banner; generate the admin password at seed time.
2. Fix the `next` redirect validation (both views).
3. Add a capability token to payment callback URLs.
4. Move rate-limit counters to a shared store before scaling traffic.
5. Host the CMS per [`ORCHARD_HOSTING_GUIDE.md`](ORCHARD_HOSTING_GUIDE.md), then set
   `ORCHARD_PROXY_TARGET` + `ABRIT_TRUSTED_PUBLIC_HOSTS=orbitcloud.vercel.app`
   in Vercel.
6. Schedule the identifier-tier rename as one coordinated release (env vars +
   cookie/header + C# project names + CSS classes).
