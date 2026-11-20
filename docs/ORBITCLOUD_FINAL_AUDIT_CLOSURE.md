# OrbitCloud — Final Audit Closure Report (FSR-9 … FSR-12)

Branch: `audit/orbitcloud-final-audit-closure` (from `master`)
Scope: closure of the four remaining independent-audit findings FSR-9 …
FSR-12. No merge, no deployment; `master` is untouched. This report records
only evidence from real executions — every command output cited below was
actually run; nothing is claimed from reading code alone.

---

## 1. Executive Summary

| Finding | Subject | Status |
|---|---|---|
| **FSR-9** | `x-real-ip` presence was detected via its VALUE: a present-but-empty/whitespace header was treated as absent and the resolver fell through to `x-forwarded-for`, violating the fail-closed trust contract | **FIXED & VERIFIED** (resolver fix + 9 new tests; all FSR-5 tests preserved) |
| **FSR-10** | The mock-payment test titled "success outcome …" actually POSTed `outcome=failure` — the success service path was untested | **FIXED & VERIFIED** (REAL success path end-to-end with write-log assertions + independent failure path + forged-header tests on both routes) |
| **FSR-11** | Compose had never been validated with the real Docker Compose CLI; minimum version was untested | **FIXED & VERIFIED** (real `docker compose config` locally with Engine 27.5.1 / Compose v2.34.0 + automated script wired into CI, step green on the final SHA; version floor empirically derived) |
| **FSR-12** | `docs/DEPLOYMENT.md` diverged from the real compose/code behavior (untested version claims, missing env-passthrough / Caddyfile status) | **FIXED & VERIFIED** (docs unified with tested facts; every claim traced to code/compose or a real execution) |

Verification summary (all real runs):

* `bun install --frozen-lockfile` — OK (no changes, 831 installs checked)
* `bun run lint` (ESLint) — exit 0
* `bunx tsc --noEmit` (typecheck; the script CI runs) — exit 0
* `bun test --isolate` — **336 pass / 0 fail / 8 pre-existing env-gated skips**, 1168 expect() calls, 28 files
* `bun run build:docker` (production build — the script CI runs) — exit 0
* `docker/validate-compose.sh` (REAL `docker compose config`) — **all 22 checks PASS** (Engine 27.5.1 / Compose v2.34.0)
* CI run **44802532815** on the final code SHA — **all three jobs (portal, orchard, docker) SUCCESS**, including the new "Validate docker compose configuration" step and both image builds.

## 2. Base Commit

`e89e0593cb8277e4145f7362954f98a504576e59` — the REAL `origin/master` HEAD at
mission start, re-fetched (not trusted from prior reports). It is the merge
commit of PR #2 (`audit/orbitcloud-final-integration-fixes`), i.e. the state
that already contains the verified FSR-1 … FSR-8 remediations. Local `master`
was fast-forwarded to exactly this SHA (no local commits added on top), then
the branch was cut from it:

```
$ git fetch origin --prune
   f26f244..e89e059  master -> origin/master
$ git checkout master && git merge --ff-only origin/master
   Updating f26f244..e89e059   (fast-forward)
$ git checkout -b audit/orbitcloud-final-audit-closure
$ git rev-parse HEAD
   e89e0593cb8277e4145f7362954f98a504576e59
```

## 3. Final Commit

Code commit (all four FSR fixes + tests + script + CI wiring):
`a34a8c65d2bddd478ed38430ab40f55cac2edddc` — pushed to
`origin/audit/orbitcloud-final-audit-closure`; CI run **44802532815** ran on
exactly this SHA (all three jobs green — §13). This report is committed on
top as a docs-only commit; its own CI run is observed after the push (same
pattern as the previous audit rounds — the substantive verification evidence
is the code commit's run).

## 4. Branch

`audit/orbitcloud-final-audit-closure` — created from the base commit, pushed
to origin, **open for review; NOT merged**.

## 5. Master Status

* `origin/master` = `e89e059` (PR #2 merge) — **not modified by this mission**.
* Local `master` — fast-forwarded to `origin/master` only; **zero commits made
  directly on master** (`git log master..audit/orbitcloud-final-audit-closure`
  contains only this mission's commits).
* **No merge, no deployment performed.**

## 6. Findings FSR-9 … FSR-12 — Root Cause & Fix

### FSR-9 — Value-independent fail-closed for `x-real-ip` (FIXED & VERIFIED)

**Root cause.** `resolveClientIp()` decided whether `x-real-ip` "exists" by
checking the trimmed value's length:

```ts
const realIp = (request.headers.get("x-real-ip") ?? "").trim();
if (realIp.length > 0) { … }        // ← presence == "value non-empty"
```

A header PRESENT with an empty or whitespace-only value therefore looked
ABSENT, and the resolver fell through to `x-forwarded-for` — a
client-influenceable header — exactly the degradation the fail-closed
contract forbids (a broken authoritative header must not downgrade into
trusting other headers).

**Fix.** Presence is now a property of the HEADER itself:

```ts
if (request.headers.has("x-real-ip")) {
  const realIp = (request.headers.get("x-real-ip") ?? "").trim();
  return isValidIpLiteral(realIp) ? realIp : UNKNOWN_CLIENT_IP;
}
```

Present → trim → bare IPv4/IPv6 literal only; empty/whitespace/invalid →
`UNKNOWN_CLIENT_IP` with **no XFF fallthrough**. XFF (rightmost valid member,
unchanged policy) is consulted **only** when `x-real-ip` is genuinely absent.
Trusted/untrusted flag semantics, IPv4+IPv6 validation, no raw-IP logging and
rate-limiter behavior on `UNKNOWN_CLIENT_IP` (shared bucket, limits stay
active) are all unchanged. Bun `Headers.has()` semantics verified by
execution: `has()` is `true` for `""` and `"   "` values, `false` only when
the header is missing.

**Tests** (in `tests/client-ip-resolver.test.ts`, new describe block
"FSR-9 — x-real-ip presence is value-independent"):

| # | Input | Expected | Result |
|---|---|---|---|
| FSR-9.1 | `x-real-ip` absent + valid XFF | XFF per trusted policy (rightmost valid member) | PASS |
| FSR-9.2 | `x-real-ip` EMPTY + valid XFF | `unknown` — no XFF fallthrough | PASS |
| FSR-9.3 | `x-real-ip` whitespace-only + valid XFF | `unknown` — no XFF fallthrough | PASS |
| FSR-9.4 | `x-real-ip` invalid literal / `[2001:db8::1]` + valid XFF | `unknown` — no XFF fallthrough | PASS |
| FSR-9.5 | valid `x-real-ip` IPv4 (incl. padded) | the IP itself | PASS |
| FSR-9.6 | valid `x-real-ip` IPv6 (`2001:db8::1`, `::1`) | the IP itself | PASS |
| FSR-9.7 | `x-real-ip` with port (`1.2.3.4:443`, `[::1]:443`) + valid XFF | `unknown` — no XFF fallthrough | PASS |
| FSR-9.8 | hash derivation for the empty case | `clientIpHash` = hash of `unknown`, never the XFF-derived hash | PASS |
| FSR-9.9 | untrusted mode, all variants | shared `unknown` bucket (unchanged) | PASS |

All 17 pre-existing FSR-5 tests (resolver, hash, session, login, OTP,
recovery, contact, quote, per-identifier/mobile limits) still pass unchanged.

### FSR-10 — Real success/failure tests for the mock payment callback (FIXED & VERIFIED)

**Root cause.** `tests/payment-mock-callback-origin.test.ts` contained:

```ts
test("success outcome also redirects to the same relative result page", async () => {
  const response = await POST(callbackRequest({}, "failure"));  // ← failure!
```

The test named "success" exercised the FAILURE path, so `finalizeSuccess()`
had zero coverage through the mock callback route.

**Fix.** The in-memory database now supports the REAL success chain —
`$transaction` → `transaction.updateMany` (pending→succeeded claim) →
`order.updateMany` (pending_payment→paid claim) → `order.findUniqueOrThrow` →
`invoice.create` → `fulfill()` → `subscription.create` + `service.create`
(one real order item) → post-commit (`panelUser.findUnique → null` stops
post-commit side effects) — and every test asserts on the OBSERVED WRITES, so
a test can no longer claim one path while exercising another.

**Mandatory matrix (all real route + real service, Location asserted on the
actual 303 response header):**

| Scenario | Expectation | Result |
|---|---|---|
| Success + normal headers | 303, Location `/portal/payment/result?ref=…`, tx→succeeded + order→paid + invoice + subscription + service rows created | PASS |
| Failure + normal headers | 303, same relative Location, tx→failed write, NO success writes | PASS |
| Success + forged Host | destination unchanged, success flow still executed | PASS |
| Success + forged XFH | destination unchanged | PASS |
| Success + forged XFP | destination unchanged | PASS |
| Failure + combined forged headers (Host+XFH+XFP+XRI+XFF) | destination unchanged, failure write still executed | PASS |
| Location with `//` (network-path) | rejected → `/` (guard; route builder structurally emits a `/portal/…` prefix so a leading `//` cannot occur) | PASS |
| Location with backslash | rejected → `/` — proven THROUGH the real route with a poisoned stored ref | PASS |
| Production mock callback | 403 `MOCK_DISABLED`, no redirect, zero terminal writes — for **cancel, failure AND success** | PASS |

All pre-existing FSR-7 tests (cancel path, forged headers, guard unit tests)
are preserved and still pass.

### FSR-11 — Real Docker Compose validation (FIXED & VERIFIED)

**Root cause.** The previous round validated the compose files only by
simulated YAML/interpolation parsing; the real `docker compose config` had
never run, and the documented minimum Compose version was an untested guess.

**What was executed (REAL Docker CLI — client-side `config` needs no daemon):**

```
$ docker --version            → Docker version 27.5.1, build 9f9e405
$ docker compose version      → Docker Compose version v2.34.0
$ POSTGRES_PASSWORD=…-placeholder OTP_HMAC_SECRET=…-placeholder \
  ABRIT_SERVICE_TOKEN=…-placeholder \
  docker compose -f docker-compose.yml config --quiet            → exit 0
$ … docker compose -f docker-compose.yml -f docker/compose.dev.yml config --quiet → exit 0
```

**Automated checks.** New `docker/validate-compose.sh` (runs the REAL
`docker compose config` twice + an operator-override render, asserts on the
RENDERED model via `docker compose config --format json | jq`) — **all 22
checks PASS** locally, and the same script now runs as the first step of the
CI `docker` job (step "Validate docker compose configuration (real docker
compose config)" — **success** in run 44802532815 on the final SHA). It
checks: both renderings valid; the four FSR-8 env vars present with
documented defaults AND operator overrides reaching the rendered environment;
`PORTAL_BIND` production default `127.0.0.1` vs dev override `0.0.0.0` with
exactly ONE port mapping; DB publishes no ports; portal `127.0.0.1:3000→3000`
and CMS `127.0.0.1:5001→5000` only; CMS→portal internal
`http://portal:3000`; `abrit` network + the four named volumes in both
renderings; Compose ≥ 2.24.0 floor.

**Minimum Compose version — empirically derived, not guessed:**

* `docker/compose.dev.yml` uses the `!override` YAML tag (introduced in
  Compose **v2.24.0**). Negative-tested with REAL older binaries:
  * Compose **v2.23.3** and **v2.20.3**: `config` exits 0 but **silently
    MERGES** the ports — rendered portal ports become BOTH `0.0.0.0:3000` and
    `127.0.0.1:3000` (would fail at `up` with "port is already allocated").
    The validation script detects exactly this mis-merge (verified via a
    v2.23.3 shim run: script FAILS with 2 findings).
  * Compose **v2.34.0**: correct — exactly one `0.0.0.0:3000` mapping.
* Base `docker-compose.yml` alone renders **identically** (modulo cosmetic
  `external:false` fields) on v2.20.3 / v2.23.3 / v2.34.0 — the base file
  works on any modern Compose v2, but v2.24+ is the documented floor because
  the supported development flow includes the override.

**Docs aligned** (see FSR-12): Engine 24+; Compose v2.24.0+ REQUIRED
(explicitly called out for the dev override, with the empirical evidence);
identical statements in `docs/DEPLOYMENT.md`, `docker/compose.dev.yml` and
the validation script. No untested version is claimed as validated — the
report names exactly which versions were exercised (27.5.1 / v2.34.0 locally
+ the CI runner's preinstalled Docker in run 44802532815).

### FSR-12 — Deployment docs unification (FIXED & VERIFIED)

**Root cause.** `docs/DEPLOYMENT.md` stated an untested "Docker 24+ /
Compose v2" floor, lacked the env-passthrough mechanism, the PORTAL_BIND
prod/dev rationale table, the fail-closed (incl. FSR-9) resolver semantics
and any statement about the repository Caddyfile's role.

**Now documented (every item traced to code/compose or a real run):**

1. Minimum Docker Engine: 24+ (validation used Engine 27.5.1 + the CI
   runner's engine).
2. Minimum Docker Compose: **v2.24.0+** with the empirical `!override`
   mis-merge evidence (§ FSR-11).
3. Production run: §3 First run (`docker compose up -d --build`, healthchecks,
   first-run Orchard setup, guarded admin bootstrap).
4. Development run: §2 Local development (base + dev override command).
5. `PORTAL_BIND` production (127.0.0.1) vs development (0.0.0.0) — dedicated
   subsection with a mode table and the rendered-publish column.
6. Env passthrough mechanism: dedicated subsection — explicit
   `environment:` interpolation is the ONLY path from `.env` into a
   container; the three REQUIRED variables; how to inspect the rendered
   model; the four trust-contract vars are CI-asserted.
7. Trusted-proxy contract: §5.2 — the full edge checklist (pin Host,
   OVERWRITE x-real-ip, REPLACE x-forwarded-for, set x-forwarded-proto,
   delete other x-forwarded-*), and when `ABRIT_TRUST_PROXY_HEADERS=true` is
   allowed.
8. Fail-closed default behavior: default `false` = no forwarding header
   trusted, shared `unknown` bucket, limits stay ACTIVE; plus the FSR-9
   presence-based semantics (present-but-empty/invalid → `unknown`, NO XFF
   fallthrough).
9. Edge must overwrite/delete inbound headers: §1 + §5.2 (explicit DELETE
   recommendation for headers the edge cannot overwrite).
10. Public host from the allowlist: `ABRIT_TRUSTED_PUBLIC_HOSTS` is the ONLY
    path in every trust mode (§2 table + §5.2).
11. Direct portal access restrictions: §5.3 (loopback portal publish,
    loopback CMS debug port, DB without ports, container-to-container private).
12. Caddyfile status: §5.1 — the repository `Caddyfile` is the
    **PREVIEW/SANDBOX gateway** (127.0.0.1:81, XTransformPort allowlist), NOT
    a production configuration; it implements the edge contract and serves as
    a reference, but production TLS/exposure belongs to the operator's edge.

`.env.example` and the `docker-compose.yml` comment block were aligned with
the same FSR-9 semantics so code, compose and docs cannot drift apart.

## 7. Changed Files

| File | Change |
|---|---|
| `src/lib/net/client-ip.ts` | FSR-9: presence-based `x-real-ip` handling (Headers.has), updated trust-contract docs |
| `tests/client-ip-resolver.test.ts` | FSR-9: +9 tests (FSR-9.1 … FSR-9.9); FSR-5 tests untouched |
| `tests/payment-mock-callback-origin.test.ts` | FSR-10: real success/failure coverage with write-log assertions; forged-header tests on both routes; route-level backslash rejection; production 403 for all outcomes; all FSR-7 cases preserved |
| `docker/validate-compose.sh` | NEW — real `docker compose config` validation script (22 checks, version floor, mis-merge detection) |
| `.github/workflows/ci.yml` | docker job: new "Validate docker compose configuration" step before the image builds |
| `docs/DEPLOYMENT.md` | FSR-12: version floors, validation status note, PORTAL_BIND table, env-passthrough section, §5 edge/Caddyfile/trust section, checklist item |
| `.env.example` | FSR-9 semantics in the `ABRIT_TRUST_PROXY_HEADERS` documentation |
| `docker-compose.yml` | FSR-9 semantics note in the FSR-8 comment block (no behavioral change) |

No Orchard source files changed (the Orchard CI job validates the unchanged
solution on every run regardless).

## 8. New Tests

* `tests/client-ip-resolver.test.ts` — 9 new tests (FSR-9.1–9.9), file total
  now 26 (17 FSR-5 preserved + 9 new).
* `tests/payment-mock-callback-origin.test.ts` — rewritten around the real
  success/failure paths; file total now 16 tests (5 success-path incl. 3
  forged-header, 2 failure-path, 5 cancel-path preserved, 2 route-level
  dangerous-value rejections, 2 guard unit tests preserved — the production
  403 test now covers all three outcomes).
* `docker/validate-compose.sh` — 22 machine checks (executable script, CI
  step; not a bun test by design — it needs the real Docker CLI, which the
  bun-test runner environment does not guarantee).

## 9. Real Test Suite Output (final run, CI-identical invocation)

```
$ bun test --isolate
 336 pass
 8 skip
 0 fail
 1168 expect() calls
Ran 344 tests across 28 files. [613.00ms]
```

The 8 skips are the pre-existing env-gated pricing tests
(`PRICING_ISOLATED_TEST` + a local PostgreSQL — `tests/pricing-admin.test.ts`
line 9, `tests/pricing-db.test.ts` line 10); they skip identically on master
and were not touched. No test was deleted, weakened or skipped by this
mission. Local pre-checks: `bun install --frozen-lockfile` OK, `bun run lint`
exit 0, `bunx tsc --noEmit` exit 0, `bun run build:docker` (the build script
CI runs — package.json has no `typecheck` script; CI's typecheck is
`bunx tsc --noEmit`) exit 0.

## 10. Real Compose Config Output (excerpt)

Full script output (`bash docker/validate-compose.sh`, Engine 27.5.1 /
Compose v2.34.0) — 22/22 PASS:

```
  [PASS] docker compose v2.34 meets the v2.24.0 floor required by docker/compose.dev.yml (!override tag)
-- [1] base compose
  [PASS] base compose renders without error
-- [2] base + dev override
  [PASS] base + dev override renders without error (Compose supports the !override tag)
-- [3] portal environment: proxy-trust contract variables (FSR-8 wiring)
  [PASS] ABRIT_TRUST_PROXY_HEADERS present with documented default ("false")
  [PASS] ABRIT_TRUSTED_PUBLIC_HOSTS present with documented default ("")
  [PASS] ORCHARD_PROXY_TIMEOUT_MS present with documented default ("")
  [PASS] ABRIT_PROXY_MAX_BODY_BYTES present with documented default ("")
-- [5] PORTAL_BIND defaults
  [PASS] production default: portal publishes on 127.0.0.1 (loopback only)
  [PASS] development override: portal publishes on 0.0.0.0 (all interfaces)
  [PASS] development override REPLACED the base port binding (exactly 1 mapping — no !override mis-merge)
-- [6] production render publishes only the documented loopback ports
  [PASS] database publishes no host ports
  [PASS] portal publishes exactly 127.0.0.1:3000→3000
  [PASS] cms debug port stays loopback-bound (127.0.0.1:5001→5000)
-- [7]/[8] cms→portal wiring, network "abrit", 4 named volumes — PASS (both renders)
RESULT: all compose validation checks PASSED
```

Rendered extracts (via `docker compose config --format json | jq`):

```json
// base render — portal ports / cms ports
[{"host_ip":"127.0.0.1","target":3000,"published":"3000"}]
[{"host_ip":"127.0.0.1","target":5000,"published":"5001"}]
// base+dev render — portal ports (!override replaced the binding)
[{"host_ip":"0.0.0.0","target":3000,"published":"3000"}]
```

## 11. Environment Injection Validation

Proven with the REAL CLI by rendering compose with operator values set in the
environment and asserting they reach the portal container environment
(placeholders only — no real secrets anywhere in this validation, and the
script never prints secret values):

```json
// rendered with ABRIT_TRUST_PROXY_HEADERS=true ABRIT_TRUSTED_PUBLIC_HOSTS=portal.example.test
//   ORCHARD_PROXY_TIMEOUT_MS=45000 ABRIT_PROXY_MAX_BODY_BYTES=104857600 PORTAL_BIND=0.0.0.0
{ "trust": "true", "hosts": "portal.example.test",
  "timeout": "45000", "body": "104857600", "host_ip": "0.0.0.0" }
```

The same assertions run on every CI push (script section [4] — green in run
44802532815). Defaults were validated separately (section [3]): the four
variables are present in the portal environment with `false` / `""` / `""` /
`""` defaults; the app clamps empty `ORCHARD_PROXY_TIMEOUT_MS` /
`ABRIT_PROXY_MAX_BODY_BYTES` to 60000 ms / 64 MiB (`src/app/[...path]/route.ts`).

## 12. Docker Build Status

* **CI (real):** run 44802532815, docker job — step "Build portal image"
  (`docker build -t abrit-portal:ci .`) **success**, step "Build CMS image"
  (`docker build -t abrit-cms:ci ./orchard`) **success**.
* **Local:** `docker compose build` could NOT run in the authoring sandbox
  (no Docker daemon available — only the client-side CLI was installable).
  This is an honestly-declared limitation, not a hidden gap: image building
  is really verified by the CI job above on the exact final SHA.

## 13. CI Run IDs & SHAs

| Run | SHA | Jobs | Result |
|---|---|---|---|
| **44802532815** | `a34a8c65d2bddd478ed38430ab40f55cac2edddc` (final code commit) | Portal (Next.js — lint, types, tests, build) | **success** |
| | | Orchard CMS (.NET 10 — build + test harnesses) | **success** |
| | | Docker image build validation (compose validation + both image builds) | **success** |

Step-level evidence (GitHub API, run 44802532815, docker job): "Validate
docker compose configuration (real docker compose config)" — success; "Build
portal image" — success; "Build CMS image" — success. The docs-only report
commit on top triggers its own CI run of the same three jobs on the new SHA
(observed after push; the substantive evidence for the code changes is the
run above, per the repo's established reporting pattern).

## 14. Regression Review

All areas re-verified through the full local suite (336/336 active tests
pass) and the green CI run on the final SHA:

* **IP resolver consumers** — login throttle (per-identifier + per-IP),
  OTP request/verification grants, password recovery, contact form, commerce
  quote, session ipHash, per-email/per-mobile independent limits,
  trusted/untrusted policy split: `tests/client-ip-resolver.test.ts` (26
  pass), `tests/login-throttle.test.ts`, `tests/rate-limit-trust.test.ts`,
  `tests/otp-request-ordering.test.ts`, `tests/grant-hash.test.ts` — all
  pass. FSR-9 changed ONLY the present-but-empty/whitespace case; every
  previously-passing input matrix is preserved.
* **CMS proxy** — SSRF protection (fixed upstream origin), Host allowlist,
  XFP validation, forwarded-header stripping, redirect sanitization, method
  allowlist, body-size limit, timeout, internal-credential removal:
  `tests/cms-proxy.test.ts`, `tests/cms-proxy-host-trust-p1.test.ts` — pass
  (untouched by this mission).
* **Payments** — mock gateway 403 in production (all outcomes), real
  success/failure finalization, gateway verification, amount verification,
  replay protection (idempotent claims), server-controlled relative
  redirects: `tests/payment-mock-callback-origin.test.ts` (16),
  `tests/payment-callback-service.test.ts`, `tests/payment-callback-origin.test.ts`,
  `tests/payments.test.ts` — pass.
* **Docker/compose** — CMS→portal internal access, PostgreSQL, Redis N/A
  (stack uses no Redis), healthchecks, networks/volumes, production bind,
  dev override: asserted on the rendered compose output by
  `docker/validate-compose.sh` (22/22) locally and in CI.
* **Orchard** — no source changes; CI orchard job (build + SecurityTests +
  PricingTests harnesses) green on the final SHA.

## 15. Known Limitations

1. **No live `docker compose up`** was performed anywhere in this mission
   (no Docker daemon in the authoring sandbox). The compose CONTRACT is
   machine-validated on the rendered model; first real boot remains with the
   maintainer's environment.
2. **Image builds verified in CI only** (real, on the final SHA) — not
   locally, for the same daemon reason.
3. The 8 pre-existing pricing skips require an isolated local PostgreSQL;
   they are unchanged and out of scope.
4. The report commit's own CI run cannot contain its own run ID (no
   self-referential commits); the code-commit run 44802532815 is the recorded
   verification evidence.

## 16. External Blockers

None. Push succeeded on the first attempt; no patch delivery was needed. CI
executed on the exact pushed SHA without manual dispatch.

## 17. Remaining Risks

* **Operational, not code:** a misconfigured edge (appending
  `x-forwarded-for`, or forwarding an empty `x-real-ip`) silently collapses
  affected clients into the shared `unknown` bucket under trust mode —
  rate limits stay ACTIVE (never disabled), but per-client granularity is
  lost until the edge is fixed. Documented in DEPLOYMENT.md §5.2.
* **Compose floor footgun (now guarded):** operators on Compose < 2.24.0 get
  a silent port mis-merge in the dev override; the validation script and CI
  now fail loudly on this, and the docs state the floor explicitly.
* **Payment sandbox scope:** gateway integrations remain sandbox-phase by
  design (per §7 production checklist); live enablement is an operator
  decision outside this codebase's current phase.

## 18. Production Readiness Assessment

**Not production-ready yet — by design.** All four closure findings are
**FIXED & VERIFIED** (code + tests + real compose validation + green CI on
the final SHA, all three jobs), and the previously verified FSR-1 … FSR-8
remediations are preserved and re-tested. What still separates the project
from a production-ready declaration is independent maintainer review of this
branch and the operational steps that only a real deployment environment can
provide (first live `docker compose up`, real TLS edge, real SMS/payment
credentials, live Orchard first-run). Until the maintainer independently
confirms the acceptance criteria — including a real stack boot — OrbitCloud
must not be declared production-ready. This branch is ready for review; no
merge and no deployment were performed.
