# OrbitCloud — Final Security Remediation Report

**Date:** 2026-11-20
**Branch:** `audit/orbitcloud-full-remediation` (base: `fb31a28`, on top of `master` @ `d29708c` which includes PR #1)
**Scope:** the two P1 defects from the independent final audit (service-token customer mutation + CMS-proxy Host-header trust), the §3 rate-limiter proxy-trust review, full validation, and regression tests.
**Honesty rule applied throughout:** every claim below is either code-verified (file references), tool-verified (real lint/tsc/test/build output from this session), or explicitly marked as NOT verified locally (the .NET CI jobs — no dotnet SDK in this environment).

---

## 1. Executive summary

Two independent P1 findings were confirmed against the source and fixed with regression coverage:

- **P1-1 — service token could mutate customer records.** `PATCH /api/admin/customers/[id]` was gated by the READ permission `customers.view`, which the Orchard service principal legitimately holds, so a valid `ABRIT_SERVICE_TOKEN` could edit customer data (at minimum the display name). Fixed by separating view and edit permissions: PATCH now requires the new `customers.edit` permission (staff: yes, service principal: no, admin: yes), while GET stays on `customers.view` (the CMS only reads). Role/status changes keep requiring `settings.manage` (human admins only).
- **P1-2 — CMS proxy trusted the inbound Host header.** The proxy set the upstream `host` and `x-forwarded-host` from the inbound request's Host, and the redirect filter accepted any `Location` equal to `incoming.origin` — a value the attacker controls via the Host header. Fixed by deriving the upstream Host/XFH only from deployment configuration (`ORCHARD_PROXY_TARGET` host, or the operator's `ABRIT_TRUSTED_PUBLIC_HOSTS` allowlist, or — only with explicit `ABRIT_TRUST_PROXY_HEADERS=true` — the inbound Host), stripping the client-settable forwarded-header family in untrusted mode, and dropping every redirect `Location` that does not point at the trusted CMS origin (the incoming origin is no longer part of the decision at all).
- **§3 — rate limiter IP-spoofing review (topology-verified, not speculative).** `clientIpKey` consumed `x-real-ip` / `x-forwarded-for` straight from the inbound request. The repo's own edge gateway (Caddyfile) REPLACES both headers at the edge, and the documented production topology is an operator-controlled TLS proxy in front of `portal:3000` — but `docker-compose.yml` also publishes the port directly, so header sanitization cannot be assumed at the application layer. Fix: the same explicit `ABRIT_TRUST_PROXY_HEADERS` flag now gates header trust; without it all callers share one bucket (no spoofed-header rotation bypass) and spoofed-header attack simulations are pinned by tests.

**Acceptance criteria re-verified by tests:** no valid service token can modify customer data with read-only permissions (`tests/customers-acl-p1.test.ts`), and no uncontrolled inbound Host can influence the CMS target Host or a redirect destination (`tests/cms-proxy-host-trust-p1.test.ts`).

---

## 2. P1-1 — Service-token customer mutation (view/edit permission confusion)

### Root cause

`src/app/api/admin/customers/[id]/route.ts` guarded **both** GET and PATCH with the same read-only permission:

```ts
// BEFORE (line 32):
const actor = await requireAdminAccess("customers.view", request);
```

`SERVICE_PRINCIPAL_PERMISSIONS` (src/lib/auth/rbac.ts) deliberately includes `customers.view` — the Orchard CMS reads the customer directory through `CommerceApiClient`. Because a WRITE was gated by a READ permission the service principal holds, any valid service token could PATCH customer records (`name` at minimum; `role`/`status` were already separately blocked for the service principal by the §2.3 fix of the previous round, but `name` was not).

### Fix

1. **New permission `customers.edit`** ("ویرایش مشخصات مشتریان", group عملیات) added to the `PERMISSIONS` catalog and to `STAFF_PERMISSIONS`. It is **not** added to `SERVICE_PRINCIPAL_PERMISSIONS` — the enforced service allowlist is unchanged.
2. **PATCH guard switched** to `requireAdminAccess("customers.edit", request)`; GET unchanged (`customers.view`). The service principal now fails the PATCH guard immediately (403) before any database access.
3. **Role/status changes** keep the additional `requireAdminAccess("settings.manage", request)` — human administrators only (staff cannot escalate; the service principal cannot mutate at all).
4. **Compatibility verified:** Orchard's `CommerceApiClient` (orchard/AbrITPortal/Commercial/CommerceApiClient.cs) only performs `GET api/admin/customers` / `GET api/admin/customers/{id}` — no customer-mutation call exists — and the portal UI has no consumer of the `useAdminUpdateUser` PATCH hook, so tightening PATCH breaks no caller.

### Files changed

| File | Change |
|---|---|
| `src/lib/auth/rbac.ts` | `customers.edit` added to `PERMISSIONS` catalog + `STAFF_PERMISSIONS`; module comment documents the separation |
| `src/app/api/admin/customers/[id]/route.ts` | PATCH guard `customers.view` → `customers.edit`; permission-model comment |

### Tests (`tests/customers-acl-p1.test.ts` — 12 tests, all passing)

The required 8-case matrix plus extras; every 403 case asserts the database is untouched (`db.panelUser.update` never called):

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | Service token GET `[id]` | 200 (read-only grant intact) | ✅ pass |
| 2 | Service token PATCH `name` | 403 + DB untouched | ✅ pass |
| 3 | Service token PATCH `role` | 403 + DB untouched | ✅ pass |
| 4 | Service token PATCH `status` | 403 + DB untouched | ✅ pass |
| 5 | Staff PATCH `name` | 200 (holds `customers.edit`), only `name` written | ✅ pass |
| 6 | Staff PATCH `role` | 403 (needs `settings.manage`) + DB untouched | ✅ pass |
| 7 | Admin PATCH `name` | 200, only `name` written | ✅ pass |
| 8 | Admin PATCH `role`+`status` (non-self target) | 200 per policy, both fields written | ✅ pass |

Extra hardening cases: service-token combined `name+role+status` PATCH → 403 (nothing written); staff PATCH `status` → 403; RBAC catalog consistency (`customers.edit` in catalog + staff set, NOT in `SERVICE_PRINCIPAL_PERMISSIONS`); unauthenticated PATCH → 401.

---

## 3. P1-2 — CMS proxy Host-header trust (host poisoning + redirect allowlist)

### Root cause

`src/app/[...path]/route.ts` copied the inbound Host into the upstream request and used the inbound origin as a redirect-allowlist base:

```ts
// BEFORE:
headers.set("host", incoming.host);
headers.set("x-forwarded-host", incoming.host);
...
} else if (redirect.origin !== incoming.origin) { /* drop */ }
```

An attacker sending `Host: evil.attacker.test` to the portal (possible whenever a request path reaches the Next.js container without an edge proxy that pins Host — e.g. the directly published compose port, or a misconfigured edge) could (a) make the CMS generate absolute URLs (redirects, reset links, canonical URLs) pointing at the attacker's host, and (b) get a CMS redirect to `http://evil.attacker.test/...` passed through, because `redirect.origin === incoming.origin` fell into the "same-origin" case — **the comparison base itself was attacker-controlled** (classic host-header poisoning → open redirect).

### Fix

1. **Upstream Host/XFH are derived only from trusted configuration** (`chooseUpstreamHost`):
   - `ABRIT_TRUSTED_PUBLIC_HOSTS` allowlist (comma/space separated, bare-host or host:port syntax only): allowlisted inbound hosts are forwarded; anything else is replaced by the primary configured host.
   - Otherwise, only with explicit `ABRIT_TRUST_PROXY_HEADERS=true` (operator declares an edge proxy that pins Host) does the inbound Host pass through.
   - Default (untrusted): the configured `ORCHARD_PROXY_TARGET` host is reported — nothing client-controlled ever reaches the CMS.
2. **Forwarded-header hygiene:** in untrusted mode the client-settable family `x-forwarded-host`, `x-forwarded-proto`, `x-forwarded-for`, `x-real-ip` and `forwarded` is stripped from the upstream request; `x-forwarded-proto` is derived from the target scheme.
3. **Redirect allowlist:** a `Location` is honored ONLY when it points at the trusted CMS origin (rewritten to a relative, host-independent path). Every other absolute Location is dropped and replaced with `/`. **The `incoming.origin` comparison is removed entirely** — the incoming request origin no longer participates in any security decision.
4. **Deployment compatibility:** with `ORCHARD_PROXY_TARGET=http://cms:5000` (compose default) the CMS sees `host: cms:5000`, which is what the container-internal deployment presents today (no behavior change for existing Docker setups); operators fronting the portal with a TLS proxy set `ABRIT_TRUSTED_PUBLIC_HOSTS` (recommended) and/or `ABRIT_TRUST_PROXY_HEADERS=true` to get correct public URLs. Both variables are documented in `.env.example` and `docs/DEPLOYMENT.md`.

### Files changed

| File | Change |
|---|---|
| `src/app/[...path]/route.ts` | `chooseUpstreamHost` / `configuredPublicHosts` / `isOperatorTrustedProxy` helpers; header construction + forwarded-family stripping; redirect filter rewritten (target-origin only); security header comment |
| `.env.example` | `ABRIT_TRUSTED_PUBLIC_HOSTS`, `ABRIT_TRUST_PROXY_HEADERS` documented |
| `docs/DEPLOYMENT.md` | edge-proxy prerequisite note + both variables in the configuration table |

### Tests (`tests/cms-proxy-host-trust-p1.test.ts` — 11 tests, all passing)

The required 8-case matrix plus extras (fetch is mocked; upstream request is captured):

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | Normal request (default mode) | Upstream `host`/`xfh` = configured target host | ✅ pass |
| 2 | Forged inbound Host (`evil.attacker.test`) | Upstream host = `cms.internal:5000`, never the forged value (default mode **and** allowlist mode) | ✅ pass (2 tests) |
| 3 | Forged `x-forwarded-host` / `x-forwarded-for` / `x-real-ip` / `forwarded` / `x-forwarded-proto` | All stripped/overridden; proto derived from target | ✅ pass |
| 4 | External redirect `Location` | Dropped → `/` | ✅ pass |
| 5 | Redirect pointing at the FORGED inbound Host (the P1-2 bypass) | Dropped → `/` (old code passed it) | ✅ pass |
| 6 | Redirect to the real CMS origin | Rewritten to relative path | ✅ pass |
| 7 | Relative redirect `Location` | Preserved untouched | ✅ pass |
| 8 | Forwarded-header checks in operator modes | Allowlisted host forwarded with upstream URL still pinned; trusted-proxy mode passes inbound Host/XFF; allowlist rejects scheme/userinfo tricks | ✅ pass (3 tests) |

The pre-existing `tests/cms-proxy.test.ts` suite (origin pinning, methods, credential hygiene, 413/502/504) still passes unchanged — the hardening is strictly additive.

---

## 4. §3 — Rate limiter & proxy-headers review (topology-verified)

### What was verified before changing anything (per the task's requirement)

- **Code:** `clientIpKey` (src/lib/rate-limit/memory.ts) trusted `x-real-ip` then `x-forwarded-for` from the inbound request — plain client-settable headers. Used by the unauthenticated `POST /api/contact` (5/10min) and `POST /api/commerce/quote` (30/min) limits.
- **Repo edge gateway:** the root `Caddyfile` (sandbox/preview gateway) uses `header_up X-Real-IP {remote_host}` and `header_up X-Forwarded-For {remote_host}` — Caddy **replaces** (not appends) these headers, so gateway-routed traffic cannot spoof them.
- **Production topology:** `docs/DEPLOYMENT.md` specifies an operator-managed TLS proxy in front of `portal:3000`, but `docker-compose.yml` publishes `"${PORTAL_PORT:-3000}:3000"` **directly on the host** — the portal must therefore not assume any particular upstream proxy behavior; header sanitization is operator-dependent and NOT enforceable in-process.
- **Auth throttles are independent:** login/OTP/recovery throttling (src/lib/auth/throttle.ts and friends) keys on hashed identity identifiers (email/mobile), not on these headers — unaffected either way.

### Fix

`clientIpKey` now trusts the forwarded headers **only** when the operator explicitly declares the topology with `ABRIT_TRUST_PROXY_HEADERS=true` (the same flag the CMS proxy uses — one consistent trust switch). Without it, every caller shares a single `untrusted` bucket: a spoofed or rotated `x-real-ip`/`x-forwarded-for` can no longer reset an attacker's allowance. Operators fronting the portal with a sanitizing edge (the documented deployment) set the flag and get real per-client keys.

**Residual risk (documented, inherent to app-layer header trust):** if an operator sets `ABRIT_TRUST_PROXY_HEADERS=true` while the portal port remains directly reachable (bypassing the edge), direct connections could still spoof the headers — the app cannot see the true peer IP in a Next.js route handler. The DEPLOYMENT.md prerequisite note now states the edge MUST overwrite (not append) these headers and that the port must not be exposed outside the proxy path. In the untrusted default the trade-off is a shared bucket (possible cross-tenant lockout of the public contact form — a nuisance, not a security bypass), which is the correct fail-safe direction.

### Tests (`tests/rate-limit-trust.test.ts` — 8 tests, all passing)

Spoofed-header attack simulations at the exact layer the routes call:

- Untrusted default: `x-real-ip` and `x-forwarded-for` spoofing ignored (single `untrusted` key); **rotating fake IPs does not reset the contact allowance** (blocked exactly after the limit); mixed header variants share one bucket.
- Trusted mode: per-client keys work (`x-real-ip`, XFF fallback), independent allowances per client, one abusive client capped.
- Flag parsing: only (whitespace-padded, any-case) `"true"` enables trust; `yes`/`1` do not.

---

## 5. Complete change list

| File | Type | Change |
|---|---|---|
| `src/lib/auth/rbac.ts` | modified | `customers.edit` permission (catalog + staff set); comment |
| `src/app/api/admin/customers/[id]/route.ts` | modified | PATCH guard → `customers.edit`; permission-model comment |
| `src/app/[...path]/route.ts` | modified | Host-trust helpers, forwarded-header hygiene, target-only redirect allowlist |
| `src/lib/rate-limit/memory.ts` | modified | `clientIpKey` gated on `ABRIT_TRUST_PROXY_HEADERS` |
| `.env.example` | modified | `ABRIT_TRUSTED_PUBLIC_HOSTS`, `ABRIT_TRUST_PROXY_HEADERS` |
| `docs/DEPLOYMENT.md` | modified | edge-proxy prerequisite + config-table rows |
| `tests/customers-acl-p1.test.ts` | **new** | 12 tests (P1-1 matrix + DB-untouched asserts) |
| `tests/cms-proxy-host-trust-p1.test.ts` | **new** | 11 tests (P1-2 matrix) |
| `tests/rate-limit-trust.test.ts` | **new** | 8 tests (§3 spoof simulations) |
| `docs/ORBITCLOUD_FINAL_SECURITY_REMEDIATION.md` | **new** | this report |

No existing test was modified or deleted. 31 new tests in total.

## 6. Validation — real results from this session

| Check | Command | Result |
|---|---|---|
| Lint | `bun run lint` | ✅ clean (no output, exit 0) |
| Types | `bunx tsc --noEmit` | ✅ clean (exit 0) |
| Tests | `bun test --isolate` | ✅ **276 pass / 0 fail / 8 skip** (the 8 skips are the pre-existing DB-gated pricing tests, untouched) — 26 files, including the 31 new tests |
| Portal production build | `bun run build:docker` (after `bunx prisma generate`) | ✅ exit 0, "Compiled successfully" |
| Orchard (.NET) jobs | — | ⛔ not runnable locally (no dotnet SDK in this environment) — delegated to GitHub Actions CI, which builds the solution and runs SecurityTests + PricingTests. This round touches **no C#/Razor code**, so the risk surface for those jobs is limited to CI-environment parity. |

## 7. CI status of this commit

**GitHub Actions run 44785602275** for the remediation commit `15e420c` (branch `audit/orbitcloud-full-remediation`) is **FULLY GREEN across all three jobs**:

| Job | Status |
|---|---|
| Portal (Next.js — lint, types, tests, build) | ✅ success |
| Orchard CMS (.NET 10 — build + test harnesses) | ✅ success |
| Docker image build validation | ✅ success |

Run URL: https://github.com/manishek14/OrbitCloud/actions/runs/44785602275

## 8. Items still requiring runtime (deployment) verification

1. **Host behavior behind a real edge proxy** — with `ABRIT_TRUSTED_PUBLIC_HOSTS` set, confirm the CMS renders correct absolute URLs through the real Caddy/Nginx TLS edge (unit tests cover the proxy logic; the edge's own header handling is operator infrastructure).
2. **Orchard admin flows after the permission change** — the CMS customer pages only call GET; verified in code (CommerceApiClient has no customer-mutation call), but an in-browser smoke test of the Orchard "مشتریان" pages against a live portal is the final proof.
3. **Rate limiter under the shared-bucket default** — operators without a trusted edge should confirm the contact form's effective global limit (5/10 min shared) is acceptable for their traffic, or front the portal with a sanitizing proxy and set `ABRIT_TRUST_PROXY_HEADERS=true`.
4. **Direct-container exposure** — production must keep `PORTAL_PORT` bound behind the edge proxy (network-level concern, not enforceable in code).

## 9. Acceptance criteria mapping

| Criterion | Evidence |
|---|---|
| "No valid service token can modify data using read-only permissions" | `tests/customers-acl-p1.test.ts`: service PATCH `name`/`role`/`status`/combined → 403 with `db.panelUser.update` never invoked; GET → 200 unchanged |
| "No uncontrolled inbound Host can affect the CMS destination or Redirect" | `tests/cms-proxy-host-trust-p1.test.ts`: forged Host never reaches the upstream `host`/`x-forwarded-host`; redirect to the forged inbound origin is dropped (the exact old bypass); only the configured CMS origin is honored |

---

*This appendix is now redundant — the recorded run is in §7 above.*
