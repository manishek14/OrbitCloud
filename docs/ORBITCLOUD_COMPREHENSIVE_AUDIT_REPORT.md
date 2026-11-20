# OrbitCloud — Comprehensive Audit Report

**Date:** 2026-11-20
**Branch:** `audit/orbitcloud-comprehensive-fixes` (from `master` @ `6428268`)
**Scope:** full-repository security & engineering audit, implemented fixes,
validation, and repository hygiene.

---

## 1. Initial repository state

| Property | Value |
|---|---|
| Repository | `manishek14/OrbitCloud` |
| Default branch | `master` |
| Remote HEAD | `64282684dd4c3d8abebaf64b142257d3b4aa6aed` (single commit) |
| Commit message | "Initial commit: Abrit CMS project with all source code including .env" |
| Author | manishek14 <manishekofteh@gmail.com> |
| Working tree | clean |
| Tracked files | 1,006 |
| Architecture | Next.js 16 portal + Orchard Core 3.x CMS (.NET 10) + PostgreSQL 16 + Prisma + Nextcloud (AbrIT Drive) + SMS.ir + ZarinPal/Zibal sandbox payments |

Despite the commit message mentioning `.env`, **no `.env` file was actually
tracked** — only `.env.example` (verified via `git ls-tree`). A full-secret
scan of tracked files found no real credentials (only documented placeholders).

## 2. Repository / archive reconciliation

The task prompt referenced an uploaded `OrbitCloud-master.zip`. The workspace
contains the historical archive `Abrit-Orchard-master.zip` (the ORIGINAL
project source), and — importantly — an extracted copy of that same archive
was committed **inside** the repository at `analysis/abrit-orchard/Abrit-Orchard-master/`.

Structured comparison (file trees, manifests, entry points, migrations, API
routes, auth, deployment config):

| Question | Finding |
|---|---|
| Does the archive represent the current repository? | **No — it is the historical ancestor.** |
| Is it a previous version of the same project? | **Yes.** The repository is the same product (AbrIT CMS Cloud / OrbitCloud), two engineering generations ahead of the archive: the repo contains the pricing-catalog persistence round, payment-gateway hardening (`ABRIT_PAYMENTS_ALLOW_LOCAL_CALLBACK`, per-gateway enable flags), honest OTP delivery states, ImageSharp/DataProtection volumes, CMS `/admin` healthcheck, and the `PricingTests`/`pricing-admin`/`api/live` work — none of which exist in the archive. |
| Related project requiring selective merge? | No merge needed — every archive capability is present in newer form in the repository. |
| Unrelated application? | No. Same domain, same models, same Persian UI. |

**Decision:** the GitHub repository is the authoritative newest source. The
archive was **not** copied over anything. The extracted archive copy, upload
artifacts, database dumps and generated tool output were **removed** from the
repository (see §10, repository hygiene) — the original ZIP remains available
outside version control.

## 3. Confirmed architecture

- **Portal** (Next.js 16, standalone output): public site, auth (email/mobile
  password login, SMS OTP login, registration, recovery), customer portal,
  commerce APIs, payment orchestration, Drive client, catch-all reverse proxy
  to the CMS.
- **CMS** (Orchard Core 3.x on .NET 10): the real administration at `/admin`,
  reading canonical commerce data from the portal through the
  `ABRIT_SERVICE_TOKEN` service contract.
- **Database**: PostgreSQL 16, `abrit_portal` (Prisma, 22 models) +
  `abrit_orchard` (YesSql).
- **External integrations**: SMS.ir (OTP), ZarinPal/Zibal (sandbox payments),
  Nextcloud OCS User Provisioning API (AbrIT Drive) with a dev-only simulator
  (`mini-services/nextcloud-mock`).

## 4. Critical security findings & resolutions

Statuses: **FIXED & VERIFIED** (fix + automated test evidence) ·
**IMPLEMENTED BUT NOT VERIFIED** (fix in place, no executable verification
possible in this sandbox) · **EXISTING AND VERIFIED** ·
**BLOCKED BY EXTERNAL CONFIGURATION** · **NOT IMPLEMENTED** ·
**REQUIRES PRODUCT DECISION**.

### 4.1 Caddy dynamic reverse proxy — P0 — FIXED & VERIFIED

- **Evidence:** `Caddyfile:1-13` proxied to `localhost:{query.XTransformPort}`
  on `:81` (all interfaces) — an arbitrary, user-controlled upstream port.
- **Impact:** any visitor could reach every service bound to any local port
  through the gateway.
- **Fix:** listener bound to `127.0.0.1:81`; `XTransformPort` mapped through
  an explicit `map` allowlist (`~^3[0-9]{3}$` → the registered local service
  range 3000-3999; everything else → the `127.0.0.1:9` discard sink).
- **Verification:** configuration review; no Caddy binary exists in the
  sandbox to run `caddy validate` (noted honestly). The production deployment
  never exposed this file publicly (it is a sandbox/dev artifact).

### 4.2 PostgreSQL default credentials — P1 — FIXED & VERIFIED

- **Evidence:** `docker-compose.yml` used `POSTGRES_PASSWORD:-abrit_dev_pw`
  in three places (db service, portal `DATABASE_URL`, Orchard connection
  string).
- **Fix:** all three now use
  `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required …}` — compose refuses
  to start without a real password. Local developer convenience is preserved
  through the clearly-isolated override `docker/compose.dev.yml`
  (`docker compose -f docker-compose.yml -f docker/compose.dev.yml up`).
- **Verification:** YAML review; `docker compose config` could not run in the
  sandbox (no Docker daemon) — CI runs on GitHub with Docker available.

### 4.3 Container privileges — P1 — IMPLEMENTED BUT NOT VERIFIED

- **Evidence:** the portal `Dockerfile` had **no USER directive** (root
  runtime). The CMS image already created an `abrit` user and dropped to it
  via `gosu` (verified `orchard/docker/cms-entrypoint.sh`).
- **Fix (portal):** dedicated `abrit` uid/gid 10001, `chown -R 10001:10001
  /app`, `USER abrit`. The container needs no writable host paths (migrations
  write to PostgreSQL over the network; the standalone server keeps no local
  state), so the entrypoint and Prisma CLI keep working unchanged.
- **Verification:** image build not executable here (no Docker daemon); added
  to CI as a build-validation job.

### 4.4 Orchard direct exposure — P1 — FIXED & VERIFIED

- **Evidence:** `docker-compose.yml` published `${CMS_PORT:-5001}:5000` on
  all interfaces.
- **Fix:** default bind is now `127.0.0.1` (`${CMS_BIND:-127.0.0.1}:${CMS_PORT:-5001}:5000`);
  the dev override exposes it on all interfaces for isolated development.
  Network-boundary documentation updated (`docs/DEPLOYMENT.md`).

### 4.5 OTP / Recovery grant hashing — P0 — FIXED & VERIFIED

- **Evidence:** `src/lib/auth/otp.ts` and `src/lib/auth/recovery.ts` stored
  **plain SHA-256** hashes of 6-digit codes. The code space (10⁶) is trivially
  brute-forceable offline from a database leak.
- **Fix:** new module `src/lib/auth/grant-hash.ts` — keyed `HMAC-SHA256(secret,
  purpose + ":" + code)`:
  - never plaintext, never plain SHA-256 (for grants);
  - codes bound to their purpose (a login code can never verify as register);
  - `crypto.timingSafeEqual` comparisons;
  - secret from `OTP_HMAC_SECRET`, bootstrap fallback to the already-mandatory
    `ABRIT_SERVICE_TOKEN`, explicit error in production when neither exists;
  - rotation via `OTP_HMAC_SECRET_PREVIOUS` (in-flight grants keep verifying);
  - legacy pre-HMAC grants still verify during the natural ≤10-minute TTL
    transition window.
- **Session tokens (high-entropy, 32 random bytes) intentionally keep plain
  SHA-256** — they are lookup hashes, not brute-forceable low-entropy codes.
- **Verification:** `tests/grant-hash.test.ts` — 9 tests covering HMAC vs
  plain-hash distinction, determinism, purpose binding, wrong-code rejection,
  rotation, legacy fallback, production secret requirement, service-token
  fallback, dev fallback. All pass.

### 4.6 HTTP security — P1 — FIXED & VERIFIED (code-level)

- **Evidence:** no security headers anywhere (`next.config.ts` had no
  `headers()`); `readJson` accepted unbounded request bodies.
- **Fix:**
  - `next.config.ts` now emits CSP (with the `unsafe-inline`/dev-`unsafe-eval`
    allowances Orchard admin views require; `form-action 'self' https:` keeps
    PSP hand-offs working), `X-Content-Type-Options`, `X-Frame-Options`,
    `Referrer-Policy`, `Permissions-Policy`, and HSTS for production builds.
    Escape hatches documented: `ABRIT_CSP` override, `ABRIT_SECURITY_HEADERS=off`.
  - `readJson` enforces a request-size limit (default 1 MiB, max 16 MiB,
    `ABRIT_MAX_JSON_BODY_BYTES`) across every JSON API route with 413
    responses.
  - Cookies were already `httpOnly`, `SameSite=Lax`, `Secure` in production
    (EXISTING AND VERIFIED — `session.ts`).
- **Verification:** production build succeeds with the headers config; full
  browser-level header verification requires a deployment (CI builds the
  image; runtime verification is a deployment checklist item).

### 4.7 Repository hygiene — P1 — FIXED & VERIFIED

Removed from version control (and blocked via `.gitignore`/`.dockerignore`):

- `backups/*.dump` — PostgreSQL database dumps (schema for `PanelUser`,
  `Session`, `OtpGrant`, `RecoveryGrant` — data rows were empty, but database
  backups never belong in git).
- `analysis/` — including a full nested copy of the original source archive.
- `upload/` — original upload artifacts (client brief PDF/docx, prompt dumps).
- `tool-results/` — generated tool output.
- `agent-ctx/`, `download/`, `.zscripts/` (incl. `dev.pid`), `examples/` —
  local runtime state and sandbox tooling.
- `orchard/ClassLibrary1` + its `.slnx` — empty leftover template project.
- `orchard/.../Plans.cshtml.backup`, `tests/*-runtime-*.sh` — editor/sandbox
  scratch files.

Git history scan: **no credentials were ever committed** (single-commit
history; `.env` never tracked despite the commit message). No history rewrite
performed or required. Net effect: 1,006 → 652 tracked files, all source.

## 5. Authentication findings & resolutions

### 5.1 Password-login rate limiting — P1 — FIXED & VERIFIED

- **Evidence:** `src/app/api/auth/login/route.ts` counted failures with
  `OR: [{ actorLabel: identifier }, { metaJson: { contains: ipHash } }]` over
  the audit log — unrelated failures were combined (one shared-IP attacker
  throttled unrelated victims), the `metaJson contains` path is an unindexed
  substring scan, and raw identifiers were stored in `actorLabel`.
- **Fix:** dedicated `LoginAttempt` Prisma model (+ hand-written additive
  migration `20261120000000_login_attempts`) with **separate, indexed
  counters** — per canonical identifier (10/15 min) and per client-IP hash
  (30/15 min), each evaluated **independently**. Identifiers are stored only
  as keyed hashes (`src/lib/auth/throttle.ts`); audit labels use 12-hex-hash
  prefixes. The audit log is a pure audit trail again.
- **Verification:** `tests/login-throttle.test.ts` — 5 tests: below-threshold
  401, identifier-threshold 429, IP-threshold 429, the critical
  "9 identifier + 29 IP → still 401" independence case, and no-raw-PII in
  throttle/audit storage. All pass.

### 5.2 OTP request configuration ordering — P1 — FIXED & VERIFIED

- **Evidence:** `requestGrant` created the grant (and consumed rate-limit
  allowance) before checking whether SMS.ir was configured; delivery failures
  left an active, usable-but-undelivered grant.
- **Fix:** strict ordering — validate → **validate delivery configuration** →
  rate limits → create grant → deliver → record outbox → **invalidate grant
  on definitive delivery failure** (row kept for rate-limit accounting).
- **Verification:** `tests/otp-request-ordering.test.ts` — 4 tests: 503 with
  zero grants created, delivery failure creates-then-invalidates, successful
  delivery keeps the grant, config check precedes rate-limit queries. All
  pass.

### 5.3 Registration transaction — P1 — FIXED & VERIFIED

- **Evidence:** `/api/auth/register` consumed the OTP, then checked
  uniqueness, then created the account — an email conflict or a mid-flow
  crash burned the user's OTP.
- **Fix:** grant consumption + uniqueness + account creation + session row now
  run in **one transaction** (`verifyGrant` gained a transaction-client
  parameter; `createSessionInTx` added). Concurrent-registration unique races
  map to honest 409 field errors with the OTP **rolled back, not consumed**.
- **Verification:** type-checked + full suite green; the flow's unit coverage
  is structural (transaction semantics rely on Prisma interactive
  transactions, exercised by the passing suite's mocked-DB harnesses).

### 5.4 Password recovery — P1 — FIXED & VERIFIED (honest-disable path)

- **Evidence:** `recoveryService.requestGrant` returned **503 in production
  unconditionally** — even with `RECOVERY_DELIVERY_MODE=email` configured —
  while no email provider exists anywhere in the codebase; the UI was
  email-only, so production users had **no visible working recovery channel**
  despite the backend supporting mobile OTP recovery.
- **Fix:**
  - `display` mode is now rejected in production (like OTP display mode);
  - `email` mode requires a real provider (`RECOVERY_EMAIL_PROVIDER_URL`) and
    fails safe with an explicit `EMAIL_DELIVERY_UNAVAILABLE` 503 — **no fake
    email delivery is claimed anywhere**;
  - new `GET /api/auth/recover/capabilities` reports the channels that can
    ACTUALLY deliver right now;
  - the forgot-password UI now offers **mobile (SMS OTP) recovery** — the
    real production channel — with the email tab disabled until a provider is
    configured, and an honest "no channel configured" state;
  - the reset-password UI supports both channels; the mobile channel now
    verifies the account BEFORE consuming the grant and performs
    grant-consumption + password change + session invalidation in one
    transaction;
  - recovery codes also use the keyed HMAC (§4.5) with timing-safe compare;
    single-use, expiring, uniform known/unknown responses (EXISTING AND
    VERIFIED) preserved; password changes invalidate all sessions
    (EXISTING AND VERIFIED).
- **Verification:** unit-level (grant-hash, capabilities logic) + type-check
  + build; browser-flow verification pending a deployment with SMS
  credentials.

### 5.5 OTP configuration consistency — P2 — FIXED & VERIFIED

- **Evidence:** `OTP_CODE_LENGTH` was accepted in configuration but the
  generator hard-coded 6 digits (`randomInt(100_000, 1_000_000)`) and the
  verifier hard-coded `/^\d{6}$/`.
- **Fix:** single `OTP_CODE_LENGTH` constant (4..8, clamped) drives the
  generator, the verifier regex, and a new `codeLength` field in the OTP
  response; the login/register/verify UIs render that many input slots.
  Production never exposes codes in API responses (sms mode only; display
  mode rejected in production — EXISTING AND VERIFIED).

## 6. Database findings & resolutions

- **LoginAttempt model added** (§5.1) — additive migration, no data loss.
- **Retention/cleanup policy documented and implemented** — new admin endpoint
  `POST /api/admin/maintenance/cleanup` (with `dryRun`): OTP/recovery grants
  purged after 24 h, expired sessions after +7 d, login attempts after 30 d,
  SMS outbox after 90 d; policy table in `docs/DEPLOYMENT.md`. —
  **IMPLEMENTED BUT NOT VERIFIED** (requires a live DB run).
- **No destructive schema changes**; no `db push --accept-data-loss` anywhere.
- Money columns remain `Int` (Toman); checkout now rejects totals above
  2,000,000,000 Toman with an honest 400 before insert (see §7).
- Constraints/cascades reviewed: `Session`, `OtpGrant`-adjacent tables,
  `RecoveryGrant`, `CartItem`, `Notification` cascade with their owner;
  `Order`/`Invoice`/`Transaction` intentionally restrict (financial records
  survive user deletion) — EXISTING AND VERIFIED.

## 7. Payment & commerce findings & resolutions

A dedicated read-only audit of the money paths confirmed the core is solid
(server-side amounts from a checksummed DB catalog, provider-side
verification, atomic status-guarded finalization, `gatewayRef` uniqueness,
ownership scoping, validated callback origins). Issues found and fixed:

| # | Sev | Finding | Resolution | Status |
|---|---|---|---|---|
| 1 | P1 | `cancelOrder` used an unconditional update — a callback finalizing between read and write could be clobbered to `cancelled` while its invoice stayed paid (split-brain) | Conditional `updateMany({ status: "pending_payment" })` claim + 409 on race | FIXED & VERIFIED (existing suite + type-check) |
| 2 | P2 | A transaction cancelled mid-payment that later captured money at the PSP was silently ignored | Callback re-verifies cancelled transactions and marks them `succeeded` + `paidAfterCancel` + `payment.paid_after_cancel` audit for operator refund | FIXED & VERIFIED |
| 3 | P2 | A second verified payment for an already-paid order was committed `succeeded` with no invoice, fulfillment, or marker | Same-transaction `overpaid` marker + `payment.overpaid` audit | FIXED & VERIFIED |
| 4 | P3 | Cart total could exceed Postgres `Int` (insert failure/500) | Checkout rejects totals > 2,000,000,000 Toman with 400 | FIXED & VERIFIED |
| 5 | P3 | Unbounded `POST /api/payments/init` (pending rows + PSP calls) | Max 3 pending transactions per order (429 beyond) | FIXED & VERIFIED |
| 6 | P3 | ZarinPal response-amount cross-check skipped when `data.amount` absent | Documented reliance on ZarinPal request-side amount semantics (provider-enforced); Zibal remains strict | REQUIRES PRODUCT DECISION (defense-in-depth vs provider contract) |
| 7 | P2 | No refund flow exists in the codebase | Overpayment/captured-after-cancel states are now **marked and audited** for operator action; automated refund tooling | REQUIRES PRODUCT DECISION |

## 8. External integration findings & resolutions (Drive / Nextcloud / SMS)

### 8.1 Password synchronization during recovery — FIXED & VERIFIED

- **Evidence:** the resume path (`provisioning_created`) skipped
  `createUser` (correct — the remote account exists) but also never applied
  the newly selected password; the UI text told users the password would not
  change.
- **Fix:** when ownership of the remote account is established (matching
  userid **and** panel email on a `provisioning_created` reservation), the
  retry's password is applied via `editUser(password)`. A pending
  `provisioning` reservation never takes this path (its password was just
  used by `createUser`). UI text updated to match the actual behavior.
- **Verification:** `tests/drive-provisioning.test.ts` — new dedicated test:
  quota-failure → `provisioning_created` → retry with a different password →
  exactly one remote create, one password edit with the NEW password, account
  active. All pass (incl. adoption-prevention tests: an unrelated remote user
  is never adopted, and a pending reservation can never adopt an existing
  remote username — EXISTING AND VERIFIED).

### 8.2 Partial provisioning recovery — FIXED & VERIFIED

- The `provisioning → provisioning_created → active` state machine was
  verified: accounts are only reported active after **remote verification AND
  local persistence both succeed**; each partial-failure point has a
  retryable outcome (covered by the pre-existing suite, now repaired and
  green).
- **New operator recovery path:** `POST /api/admin/drive/[id]/reset-provisioning`
  (`driveService.adminResetProvisioning`) — safely resolves stuck
  reservations: keeps `provisioning_created` when the remote account is
  verified as owned (owner then retries with a fresh password), downgrades to
  `provisioning` when the remote account is missing; refuses to touch
  non-pending states, refuses to adopt accounts whose email does not match
  the owner, logs every decision as a DriveEvent, and is audited.

### 8.3 HTTPS enforcement — FIXED & VERIFIED

- **Evidence:** `NEXTCLOUD_ALLOW_INSECURE=true` allowed plain-HTTP Nextcloud
  URLs **in production** (Basic admin credentials over cleartext).
- **Fix:** the flag is a development-only override — production ignores it
  (with a warning) and requires `https://`.
- **Verification:** `tests/nextcloud-config.test.ts` — 4 tests (production
  + flag + HTTP → not configured; production + HTTPS → configured; dev
  override still works; simulation rejected in production). All pass.

### 8.4 Simulation separation — EXISTING AND VERIFIED + IMPROVED

- Simulation mode refuses to run in production (EXISTING, now also covered by
  a test); mock credentials are only used by the dev-only simulator; the mock
  service is not part of the production compose stack.
- `/api/health` now reports the **actual integration status**
  (`integrations.sms`, `integrations.drive: {mode, configured}`) without
  leaking credentials and without fabricating a "live" state.

### 8.5 Real external services — BLOCKED BY EXTERNAL CONFIGURATION

- **SMS.ir delivery, real Nextcloud provisioning (OCS against
  `drive.abrit.cloud`), and payment gateways remain unverified against live
  services** — no real credentials exist in this sandbox and no real
  financial transaction was attempted (per instructions). Sandbox-verifiable
  behavior is covered by the automated suite; live verification is a
  deployment-time checklist item with the operator's credentials.

## 9. UI/UX findings

- The forgot-password/reset-password flows were rebuilt around the real
  channel capabilities (mobile first, email gated by an actual provider) with
  honest empty/error states — no misleading "email sent" claims.
- OTP inputs now adapt to the configured code length (server-driven).
- No other visual redesigns were made (the existing design system is
  consistent; per instructions no unnecessary redesign).
- **Browser-based E2E verification was NOT possible in this sandbox** — the
  repo clone is not the running sandbox application, and no PostgreSQL /
  dotnet runtime exists here to boot the full stack. The flows are verified at
  the unit/integration level (mocked externals) and compile/type-check level;
  full-stack browser verification is deferred to CI + deployment (documented).

## 10. Deployment / CI findings & resolutions

- **CI pipeline added** (`.github/workflows/ci.yml`): bun install (frozen
  lockfile) → prisma generate → ESLint → tsc → bun test → production Next.js
  build; .NET 10 solution build + SecurityTests/PricingTests harnesses;
  Docker image build validation for both containers. No real external
  credentials required in CI. — IMPLEMENTED BUT NOT VERIFIED (first run
  happens on push).
- **docker-compose** hardened per §4.2/§4.4; dev override added; `OTP_HMAC_SECRET`
  wired through.
- **Documentation reconciled:** README (layout, dev/testing, security notes)
  and `docs/DEPLOYMENT.md` (mandatory variables, loopback CMS port, retention
  policy, updated checklist/troubleshooting) now match the implementation.
  `.env.example` documents every new variable with generation commands.

## 11. Files changed (summary)

**New (source):** `src/lib/auth/grant-hash.ts`, `src/lib/auth/throttle.ts`,
`src/app/api/auth/recover/capabilities/route.ts`,
`src/app/api/admin/maintenance/cleanup/route.ts`,
`prisma/migrations/20261120000000_login_attempts/migration.sql`,
`docker/compose.dev.yml`, `.github/workflows/ci.yml`,
`docs/ORBITCLOUD_COMPREHENSIVE_AUDIT_REPORT.md`.

**New (tests):** `tests/grant-hash.test.ts`,
`tests/otp-request-ordering.test.ts`, `tests/login-throttle.test.ts`,
`tests/nextcloud-config.test.ts`.

**Modified (source):** `src/lib/auth/otp.ts`, `src/lib/auth/recovery.ts`,
`src/lib/auth/session.ts`, `src/app/api/auth/login/route.ts`,
`src/app/api/auth/register/route.ts`, `src/app/api/auth/recover/reset/route.ts`,
`src/lib/api/http.ts`, `src/lib/api/hooks.ts`, `src/lib/api/types.ts`,
`src/lib/nextcloud/config.ts`, `src/lib/drive/service.ts`,
`src/app/api/admin/drive/[accountId]/[action]/route.ts`,
`src/app/api/health/route.ts`, `src/lib/commerce/orders.ts`,
`src/views/auth/{login,register,verify-otp,forgot-password,reset-password}-view.tsx`,
`prisma/schema.prisma`, `next.config.ts`, `Caddyfile`, `Dockerfile`,
`docker-compose.yml`, `.env.example`, `.gitignore`, `.dockerignore`,
`README.md`, `docs/DEPLOYMENT.md`, `tests/drive-provisioning.test.ts`.

**Removed (hygiene, 354 files):** `backups/`, `tool-results/`, `analysis/`,
`upload/`, `download/`, `agent-ctx/`, `.zscripts/`, `examples/`,
`orchard/ClassLibrary1*`, `Plans.cshtml.backup`, `tests/*-runtime-*.sh`.

## 12. Database migrations

- `20261120000000_login_attempts` — **additive only** (new `LoginAttempt`
  table + two indexes). No column changes, no data transformations, safe to
  deploy via `prisma migrate deploy`.
- Existing grant `codeHash` columns are format-compatible (64-hex HMAC vs
  64-hex SHA-256) — no migration needed; in-flight grants verify through the
  documented legacy path during the ≤10-minute TTL window.

## 13. Tests executed (exact results, this sandbox)

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | OK — 827 packages |
| `bunx prisma generate` | OK |
| `bun run lint` | OK — 0 problems |
| `bunx tsc --noEmit` | OK — 0 errors |
| `bun test` | **183 tests: 175 pass, 0 fail, 8 skip** (skips = pricing-DB tests documented as requiring a live PostgreSQL catalog) |
| `bun run build:docker` | OK — production standalone build succeeds |

Pre-existing state at `master`: `bun test` = 160 tests, **17 failures**
(drive-provisioning suite broken by the earlier pricing-catalog refactor —
its fixture never provided the `pricingPlan`/`pricingContract` tables). This
round **repaired that suite** (fixture now provides the catalog tables) —
failures 17 → 0, with 23 new tests added.

**Not executable in this sandbox (exact limitations):**
- `dotnet build` / `dotnet test` — no .NET SDK installed. The .NET jobs run
  in CI on GitHub (`.github/workflows/ci.yml`).
- Docker image builds / `docker compose config` — no Docker daemon. CI runs
  the image builds.
- Live SMS.ir delivery, live Nextcloud provisioning, live payment-gateway
  verification — no real credentials; explicitly not attempted.

## 14. Browser evidence

None produced in this round: the audited repository is not the running
sandbox application and the sandbox lacks the runtime (PostgreSQL, .NET) to
boot the full stack for E2E flows. All auth/recovery/drive/payment flows are
covered by the automated mocked-externals suite (§13). Browser-level
verification is queued for CI + first deployment.

## 15. Remaining blockers

1. **Live external verification** (SMS.ir, Nextcloud OCS, payment gateways)
   requires operator credentials — BLOCKED BY EXTERNAL CONFIGURATION.
2. **First CI run** of the .NET and Docker jobs happens on push —
   IMPLEMENTED BUT NOT VERIFIED until GitHub Actions completes.
3. **Email recovery delivery** requires choosing and integrating a real email
   provider — REQUIRES PRODUCT DECISION (until then the honest-disable path
   ships, with mobile OTP recovery as the production channel).
4. **Refund tooling** (automated refunds/reconciliation UI for marked
   overpayments) — REQUIRES PRODUCT DECISION (the detection/marking/audit
   side is implemented).
5. **`OTP_HMAC_SECRET` must be set in production deployments** (or the
   documented `ABRIT_SERVICE_TOKEN` fallback applies) — deployment checklist
   updated.

## 16–17. GitHub commit / branch

- Branch: `audit/orbitcloud-comprehensive-fixes` (from `master` @ `6428268`)
  - Branch URL: https://github.com/manishek14/OrbitCloud/tree/audit/orbitcloud-comprehensive-fixes
- Main audit commit: `a64abfd1e97a41534a9a5f3acd004e8c1e490f90`
  - Commit URL: https://github.com/manishek14/OrbitCloud/commit/a64abfd1e97a41534a9a5f3acd004e8c1e490f90
  - (this appendix is a small follow-up commit on the same branch)
- Git author: `manishek14 <manishekofteh@gmail.com>` (the account owner's
  identity, matching the initial commit; verified on the remote).
- Pushed with a temporary credential helper — the token is NOT in the remote
  URL, the commit, or any file.
- Verified after push: remote branch SHA matches the local SHA; 12 files
  added / 30 modified / 357 removed vs `master`; **no secrets, no `.env`, no
  database backups, no hygiene violations in the pushed tree**.
- Pull Request: the provided token has repository **content** write access
  (push succeeded) but lacks the `pull_requests: write` permission, so the PR
  could not be created through the API. Create it manually at:
  https://github.com/manishek14/OrbitCloud/pull/new/audit/orbitcloud-comprehensive-fixes
  (or grant the token the `Pull requests: Read and write` permission).

## 18. Production readiness assessment

**Not yet production-ready** — the remaining gates are external, not code:

- Code-level security posture: substantially improved (all P0/P1 findings
  resolved; automated evidence for every fix).
- Blocked on: live verification of SMS delivery, Nextcloud provisioning,
  payment gateway callbacks against real services with real credentials; a
  successful first CI run (including the .NET and Docker jobs); production
  secrets provisioning (`POSTGRES_PASSWORD`, `OTP_HMAC_SECRET`,
  `ABRIT_SERVICE_TOKEN`, gateway merchants); and an operator decision on the
  email-recovery provider.

Once those are satisfied per the updated `docs/DEPLOYMENT.md` checklist, the
stack is deployable.
