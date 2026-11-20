# OrbitCloud — Compose Validation Isolation & Docker Version Documentation Closure (FSR-13 / FSR-14)

Branch: `fix/orbitcloud-compose-validation-isolation` (from `origin/master`)
Scope: closure of the two remaining final-audit findings **FSR-13** (compose
validation must not be influenced by a developer's `.env`) and **FSR-14**
(Docker Engine / Compose version documentation must be precise). No
architecture or business-logic change; no merge, no deployment; `master` is
untouched. This report records only evidence from real executions — every
command output cited below was actually run; nothing is claimed from reading
code alone.

> **Final note on scope:** this mission closes FSR-13 and FSR-14 only. It
> does NOT declare OrbitCloud production-ready and makes no claim about a
> live `docker compose up` of the stack (see §10).

---

## Executive Summary

| Finding | Subject | Status |
|---|---|---|
| **FSR-13** | `docker/validate-compose.sh` `unset` shell variables but Docker Compose still auto-loads the project `.env` for interpolation — on a machine with a real `.env` the "default value" checks validated the local machine, not the repository | **FIXED & VERIFIED** (every `docker compose config` invocation pinned to an EMPTY temporary env file via `--env-file`, mktemp + trap cleanup on all exit paths; sandboxed `--self-test` with an adversarial `.env` proves isolation, wired into CI) |
| **FSR-14** | `docs/DEPLOYMENT.md` claimed "Docker Engine 25+ bundles Compose ≥ 2.24 as a plugin" — an over-generalization of a release-specific packaging fact | **FIXED & VERIFIED** (claim replaced: the binding requirement is Compose v2.24.0+ checked with `docker compose version`; the Engine version alone proves nothing; the 25.0.0 release-note packaging fact is cited as release-specific evidence, not generalized) |

Verification summary (all real runs, on code commit `ff016ea`):

* `bash docker/validate-compose.sh` — **all 21 checks PASS** (Docker 27.5.1 / Compose v2.34.0, real CLI, client-side)
* `bash docker/validate-compose.sh --self-test` — **PASS, 31/31 checks** (9 control + 21 isolated-validation + 1 proof summary; adversarial `.env` proven harmless; control render proves it would otherwise leak)
* Pre-fix vulnerability demonstration — the OLD script (from `origin/master`) fails **8 checks** when an adversarial `.env` exists (§5)
* `bun run lint` — exit 0
* `bunx tsc --noEmit` — exit 0
* `bun test --isolate` — **336 pass / 0 fail / 8 pre-existing env-gated skips** (344 tests, 28 files, 1168 expect() calls)
* `bun run build:docker` — exit 0
* CI run **44807339449** on `ff016ea791962ae22486c1500a28c46f765da6dc` — **all three jobs (portal, orchard, docker) SUCCESS**, including the compose validation step, the new `--self-test` step, and BOTH image builds (§9).

## 1. Real Base SHA

`9f8da3b0a6642fb4e982e1fd815105eabf831b55` — the REAL `origin/master` HEAD,
re-fetched at mission start (not trusted from prior reports):

```
$ git fetch origin
   e89e059..9f8da3b  master     -> origin/master
$ git rev-parse origin/master
   9f8da3b0a6642fb4e982e1fd815105eabf831b55
$ git log --oneline origin/master -1
   9f8da3b Merge pull request #3 from manishek14/audit/orbitcloud-final-audit-closure
```

`master` had advanced past `e89e059` exactly as expected (PR #3 merged the
previous final-audit closure). The branch was cut directly from this SHA:

```
$ git checkout -b fix/orbitcloud-compose-validation-isolation origin/master
$ git rev-parse HEAD
   9f8da3b0a6642fb4e982e1fd815105eabf831b55
```

## 2. Branch and Final SHA

| Item | Value |
|---|---|
| Branch | `fix/orbitcloud-compose-validation-isolation` (pushed to origin) |
| Base | `9f8da3b0a6642fb4e982e1fd815105eabf831b55` (`origin/master`, PR #3 merge) |
| **Code commit (all fixes + CI wiring)** | `ff016ea791962ae22486c1500a28c46f765da6dc` — CI run **44807339449** ran on exactly this SHA, all three jobs SUCCESS (§9) |
| Report commit (this file) | docs-only commit on top of `ff016ea`; the branch tip. Its own CI run is observed after the push (same pattern as the previous audit rounds — the substantive verification evidence is the code commit's run). |

## 3. Changed Files

```
.github/workflows/ci.yml         |   9 +   (new CI step: --self-test in the docker job)
docker/validate-compose.sh       | 197 +/-  (FSR-13 fix + --self-test mode)
docs/DEPLOYMENT.md               |  63 +/-  (FSR-14 fix + FSR-13 documentation)
3 files changed, 229 insertions(+), 40 deletions(-)
```

Nothing else changed: no application code, no compose file changes, no
auth/rate-limiting, no CMS proxy/SSRF, no payment callback/finalization, no
Orchard CMS, no Prisma schema/migrations. FSR-1 … FSR-12 remediation content
is untouched (the `DEPLOYMENT.md` edits are limited to the version
documentation, the validation-status note, the §1.1 machine-check list and
the §8 checklist item). The working tree contained no untracked files at
commit time; no `.env` was ever created, read, modified or deleted in the
repository (`.env` is git-ignored; none exists in the checkout).

## 4. FSR-13 — Root Cause and Fix

### Root cause (verified empirically, not assumed)

Docker Compose resolves interpolation variables with this precedence:
shell-exported variables first, then the env file — and the DEFAULT env file
is the `.env` in the project directory (the directory of the first `-f`
file), regardless of the current working directory. The old script `unset`
the operator-contract variables from the shell, but that only removed the
highest-precedence source: with a real `.env` present, Compose silently read
the values from it, so the "default value" checks (ABRIT_TRUST_PROXY_HEADERS
= false, PORTAL_BIND = 127.0.0.1, …) validated the developer's machine
instead of the repository. Verified against Compose v2.34.0:

* without `--env-file`, a project `.env` value (`PORTAL_BIND=192.0.2.123`)
  DID reach the rendered port mapping even when the shell variable was unset;
* an explicit `--env-file <empty file>` REPLACES the default `.env`
  auto-load — the compose defaults apply again;
* shell-exported variables still WIN over env files, so placeholders and
  operator injection are unaffected by the empty file;
* `COMPOSE_ENV_FILES` (environment variable) is a THIRD influence path when
  `--env-file` is absent — it replaces the default `.env` lookup on its own.

### Fix (`docker/validate-compose.sh`)

1. An empty temporary env file is created at script start with `mktemp`
   (`${TMPDIR:-/tmp}/abrit-validate-compose.env.XXXXXX`).
2. A `cleanup` trap removes it on EVERY exit path: `trap cleanup EXIT` plus
   `INT`/`TERM`/`HUP` traps that route through `exit` so the EXIT trap runs.
   The cleanup also removes the `--self-test` sandbox when present and can
   never mask the script's real exit status.
3. EVERY `docker compose config` invocation — all three validation groups:
   base compose, base + dev override, and the operator environment injection
   render — is pinned to the empty file:
   `docker compose --env-file "$EMPTY_ENV_FILE" -f … config`.
4. The three REQUIRED compose variables (`POSTGRES_PASSWORD`,
   `OTP_HMAC_SECRET`, `ABRIT_SERVICE_TOKEN`) still come from shell-exported,
   obviously-fake, non-secret placeholders (shell wins over env files — so a
   real `.env` can neither supply nor shadow them; proven in the self-test
   control with adversarial values in the sandbox `.env`).
5. The operator-injection values (check [4]) still come from the process
   environment (inline shell assignments); the empty env file cannot block
   them, and with an adversarial `.env` present this check now ALSO proves
   the shell values win over `.env` content.
6. `COMPOSE_ENV_FILES` is `unset` alongside the operator-contract variables
   (defense in depth; it also makes the self-test's control render
   deterministic).
7. No content of any real `.env` is read, modified, deleted or printed: the
   empty file replaces the auto-load, and the assertions extract only
   specific non-secret keys from the rendered model via `jq`.
8. Strengthened default assertions: `CMS_BIND` + `CMS_PORT` defaults are now
   asserted from the rendered output (cms publishes exactly
   `127.0.0.1:5001→5000`), alongside the existing `PORTAL_BIND`/`PORTAL_PORT`
   portal mapping assertion — so all EIGHT variables named by the acceptance
   criteria are default-checked from the render.

### `--self-test` mode (new, sandboxed — never touches a real `.env`)

`bash docker/validate-compose.sh --self-test` copies the two compose files
into a throwaway `mktemp -d` sandbox, writes an ADVERSARIAL `.env` there
(values differing from both the compose defaults and the operator-injection
values for all 8 variables, plus adversarial values for the 3 REQUIRED
variables), then:

1. **Negative control** — renders the sandbox WITHOUT `--env-file` and
   asserts all 8 adversarial values DO leak into the render (and that the
   REQUIRED `POSTGRES_PASSWORD` still comes from the shell placeholder).
   This proves the sandbox `.env` is genuinely in the interpolation path, so
   the isolation proof is not vacuous.
2. **Positive proof** — re-runs the FULL validation script against the
   sandbox (`ABRIT_VALIDATE_COMPOSE_DIR` internal override) and asserts
   every check still passes — only possible if the empty-env-file isolation
   works.

The sandbox is removed by the same trap on every exit path (verified: zero
`/tmp/abrit-*` files remain after runs).

## 5. Isolated `.env` Test Evidence (three-point proof)

All three points ran in throwaway sandboxes under `/tmp`; the repository
working tree and any real `.env` were never touched (no `.env` exists in the
repository checkout — only the committed `.env.example`).

**Point 1 — the OLD script (from `origin/master`), sandbox WITHOUT any
`.env`: the baseline is green** (proving the sandbox setup is sound):

```
$ bash /tmp/fsr13-demo/docker/validate-compose-old.sh
…
RESULT: all compose validation checks PASSED
```

**Point 2 — the OLD script, same sandbox WITH an adversarial `.env`
(ABRIT_TRUST_PROXY_HEADERS=from-env-file, PORTAL_BIND=192.0.2.123,
PORTAL_PORT=4000, CMS_BIND=0.0.0.0, CMS_PORT=6000, …): the FSR-13
vulnerability reproduced — the `.env` changed what the default checks
observed:**

```
$ bash /tmp/fsr13-demo/docker/validate-compose-old.sh
  [FAIL] ABRIT_TRUST_PROXY_HEADERS: expected "false", rendered "from-env-file"
  [FAIL] ABRIT_TRUSTED_PUBLIC_HOSTS: expected "", rendered "adversarial-public-hosts.invalid"
  [FAIL] ORCHARD_PROXY_TIMEOUT_MS: expected "", rendered "999999"
  [FAIL] ABRIT_PROXY_MAX_BODY_BYTES: expected "", rendered "88888888"
  [FAIL] production default host_ip: expected 127.0.0.1, rendered "192.0.2.123"
  [FAIL] development override host_ip: expected 0.0.0.0, rendered "192.0.2.123"
  [FAIL] unexpected portal port mapping(s): [{"host_ip":"192.0.2.123","target":3000,"published":"4000"}]
  [FAIL] cms debug host_ip: expected 127.0.0.1, rendered "0.0.0.0"
RESULT: 8 compose validation check(s) FAILED
```

**Point 3 — the FIXED script's `--self-test` (its own sandbox, the same
adversarial values): control proves the leak is real, then the isolated run
passes everything** (full verbatim log in §6b):

```
-- [self-test control] WITHOUT --env-file the adversarial .env MUST leak (proves the setup is a valid test)
  [PASS] control: ABRIT_TRUST_PROXY_HEADERS leaked its adversarial value — the sandbox .env IS in the interpolation path
  [PASS] control: ABRIT_TRUSTED_PUBLIC_HOSTS leaked its adversarial value — the sandbox .env IS in the interpolation path
  [PASS] control: ORCHARD_PROXY_TIMEOUT_MS leaked its adversarial value — the sandbox .env IS in the interpolation path
  [PASS] control: ABRIT_PROXY_MAX_BODY_BYTES leaked its adversarial value — the sandbox .env IS in the interpolation path
  [PASS] control: PORTAL_BIND leaked its adversarial value — the sandbox .env IS in the interpolation path
  [PASS] control: PORTAL_PORT leaked its adversarial value — the sandbox .env IS in the interpolation path
  [PASS] control: CMS_BIND leaked its adversarial value — the sandbox .env IS in the interpolation path
  [PASS] control: CMS_PORT leaked its adversarial value — the sandbox .env IS in the interpolation path
  [PASS] control: REQUIRED POSTGRES_PASSWORD still comes from the shell placeholder (shell wins over .env)
-- [self-test proof] the SAME sandbox validated with the empty --env-file isolation (every check must pass)
…
RESULT: all compose validation checks PASSED          <- inner, isolated run
  [PASS] full validation passed against the sandbox WITH an adversarial .env present — defaults come from the compose files, not .env

RESULT: FSR-13 self-test PASSED (an adversarial .env is proven harmless to the validation)
```

Interpretation: with the fix, the presence of a `.env` containing DIFFERENT
values for `ABRIT_TRUST_PROXY_HEADERS`, `ABRIT_TRUSTED_PUBLIC_HOSTS`,
`ORCHARD_PROXY_TIMEOUT_MS`, `ABRIT_PROXY_MAX_BODY_BYTES`, `PORTAL_BIND`,
`PORTAL_PORT`, `CMS_BIND` and `CMS_PORT` cannot change any default-value
check — the defaults rendered are exactly the ones defined in the compose
files; and the operator override still transfers the SHELL-set values
(`true` / `portal.example.test` / `45000` / `104857600` / `0.0.0.0`) into
the rendered model, not the `.env` values.

## 6. Real Compose Validation Output

### 6a. `bash docker/validate-compose.sh` (repository files; exit 0)

```
== docker/validate-compose.sh (real Docker CLI, no daemon needed) ==
Docker version 27.5.1, build 9f9e405
Docker Compose version v2.34.0
  [PASS] docker compose v2.34 meets the v2.24.0 floor required by docker/compose.dev.yml (!override tag)
-- [1] base compose: docker compose --env-file <empty> -f docker-compose.yml config
  [PASS] base compose renders without error (isolated from any project .env by the empty env file)
-- [2] base + dev override: docker compose --env-file <empty> -f docker-compose.yml -f docker/compose.dev.yml config
  [PASS] base + dev override renders without error (Compose supports the !override tag; isolated from any project .env by the empty env file)
-- [3] portal environment: proxy-trust contract variables (FSR-8 wiring)
  [PASS] ABRIT_TRUST_PROXY_HEADERS present with documented default ("false")
  [PASS] ABRIT_TRUSTED_PUBLIC_HOSTS present with documented default ("")
  [PASS] ORCHARD_PROXY_TIMEOUT_MS present with documented default ("")
  [PASS] ABRIT_PROXY_MAX_BODY_BYTES present with documented default ("")
-- [4] operator values injected into the rendered portal environment
  [PASS] ABRIT_TRUST_PROXY_HEADERS → "true" reached the container environment
  [PASS] ABRIT_TRUSTED_PUBLIC_HOSTS → "portal.example.test" reached the container environment
  [PASS] ORCHARD_PROXY_TIMEOUT_MS → "45000" reached the container environment
  [PASS] ABRIT_PROXY_MAX_BODY_BYTES → "104857600" reached the container environment
  [PASS] explicit PORTAL_BIND=0.0.0.0 overrides the loopback default
-- [5] PORTAL_BIND defaults (production loopback vs development override)
  [PASS] production default: portal publishes on 127.0.0.1 (loopback only)
  [PASS] development override: portal publishes on 0.0.0.0 (all interfaces)
  [PASS] development override REPLACED the base port binding (exactly 1 mapping — no !override mis-merge)
-- [6] production render publishes only the documented loopback ports
  [PASS] database publishes no host ports
  [PASS] portal publishes exactly 127.0.0.1:3000→3000 (PORTAL_BIND + PORTAL_PORT defaults)
  [PASS] cms publishes exactly 127.0.0.1:5001→5000 (CMS_BIND + CMS_PORT defaults)
-- [7] internal CMS → portal service wiring
  [PASS] cms reaches the portal internally at http://portal:3000 (base and dev)
-- [8] private network and named volumes
  [PASS] base render: network "abrit" + volumes pgdata/cms_appdata/cms_imagesharp_cache/cms_data_protection_keys present
  [PASS] dev-override render: network "abrit" + volumes pgdata/cms_appdata/cms_imagesharp_cache/cms_data_protection_keys present

RESULT: all compose validation checks PASSED
```

(21 PASS lines, 0 FAIL: 1 version floor + 2 renders + 4 contract defaults + 4 operator injections + 1 explicit-bind override + 3 PORTAL_BIND/!override checks + 3 production port mappings + 1 CMS wiring + 2 topology checks.)

### 6b. `bash docker/validate-compose.sh --self-test` (exit 0)

Verbatim: control (9 PASS — all 8 adversarial values leak without
`--env-file`, REQUIRED variable still from the shell placeholder), then the
inner isolated run over the sandbox (21 PASS, all checks, quoted in full in
§5 Point 3 / §6a structure), then:

```
  [PASS] full validation passed against the sandbox WITH an adversarial .env present — defaults come from the compose files, not .env

RESULT: FSR-13 self-test PASSED (an adversarial .env is proven harmless to the validation)
```

## 7. FSR-14 — Precise Fix

**Removed** (from `docs/DEPLOYMENT.md` §1):

> "Docker Engine 25+ bundles Compose ≥ 2.24 as a plugin; on Engine 24
> install the standalone `docker-compose` v2.24+ binary or a newer plugin."

**Replaced with** (summary; see the file for the full text):

1. The BINDING requirement is stated as **Docker Compose v2.24.0 or newer**,
   full stop.
2. The user must check the version of the ACTUALLY installed plugin with
   `docker compose version` — the operational check.
3. It is now explicit that the Engine version ALONE proves nothing about the
   installed Compose version: which Compose a host carries depends on the
   package, the distribution channel and when it was last updated — an
   Engine 25+ host can still carry an older Compose plugin. (The Engine
   prerequisites bullet cross-references this.)
4. The packaging fact is kept but scoped precisely to its evidence: the
   official Docker Engine 25.0.0 release notes record that that specific
   release's docker-ce packaging shipped Compose v2.24.1
   (docker/docker-ce-packaging#980), with 25.0.x patch releases later
   shipping 2.24.2/2.24.5/2.24.7 — explicitly labeled "a statement about
   those releases' official packaging, NOT a guarantee for every Engine 25+
   install method or operating system", with the source URL
   https://docs.docker.com/engine/release-notes/25.0/.
5. Actionable guidance: if `docker compose version` reports anything older
   than v2.24.0, UPDATE the Compose plugin (e.g.
   `apt-get install --only-upgrade docker-compose-plugin`,
   `dnf update docker-compose-plugin`, or reinstall the plugin per
   docs.docker.com) or install the standalone Compose v2 binary.
6. No version claim exists without evidence: the floor itself (v2.24.0,
   `!override` tag) was already empirically derived in the previous closure
   (FSR-11, verified against v2.20.3/v2.23.3/v2.34.0); the 25.0.0 packaging
   fact is cited from the official release notes. The §8 production
   checklist item was tightened to match ("the ACTUALLY installed plugin
   … the Engine version alone does not prove this").

Fittingly, the evidence in this very closure demonstrates the point: the
authoring environment ran Compose v2.34.0 while the GitHub Actions runner
ran Compose v5.1.3 (both ≥ 2.24.0, both green) — the plugin version is a
property of the installation, not of the Engine version.

## 8. All Test Results (real runs, code commit `ff016ea`)

| # | Command | Result |
|---|---|---|
| 1 | `bash docker/validate-compose.sh` | exit 0 — all 21 checks PASS (Docker 27.5.1 / Compose v2.34.0) |
| 2 | Base Compose validation with the empty env file | PASS — check [1]: renders without error, isolated from any project `.env` |
| 3 | Base + Dev Override validation with the empty env file | PASS — check [2]: renders without error (`!override` supported) |
| 4 | Isolated adversarial `.env` test (`--self-test`) | PASS — 31/31 (control proves the leak is possible; isolated run keeps all defaults) |
| 5 | Operator environment injection test | PASS — check [4]: all 4 contract variables + `PORTAL_BIND=0.0.0.0` reach the render from the shell |
| 6 | `PORTAL_BIND` production vs development | PASS — check [5]: production `127.0.0.1`, dev override `0.0.0.0`, exactly 1 port mapping after `!override` |
| 7 | `bun run lint` (ESLint) | exit 0 |
| 8 | `bunx tsc --noEmit` (the typecheck CI runs) | exit 0 |
| 9 | `bun test --isolate` | **336 pass / 0 fail / 8 skip** (344 tests, 28 files, 1168 expect() calls) |
| 10 | `bun run build:docker` (production build CI runs) | exit 0 |

Additional evidence: pre-fix vulnerability reproduction (old script +
adversarial `.env` → 8 FAILs, §5 Point 2); temp-file hygiene verified (zero
`/tmp/abrit-*` leftovers after every run).

The 8 skips are the pre-existing environment-gated tests (live
PostgreSQL/Nextcloud-dependent), unchanged from the previous closure runs —
not new skips introduced by this change.

## 9. CI Run ID and Job Status

CI run **44807339449** on code commit
`ff016ea791962ae22486c1500a28c46f765da6dc`
(branch `fix/orbitcloud-compose-validation-isolation`, workflow `ci`):

| Job | Status | Notes |
|---|---|---|
| Portal (Next.js — lint, types, tests, build) | **SUCCESS** | bun install → prisma generate → lint → `bunx tsc --noEmit` → `bun test --isolate` → `bun run build:docker` |
| Orchard CMS (.NET 10 — build + test harnesses) | **SUCCESS** | solution build + SecurityTests + PricingTests |
| Docker image build validation | **SUCCESS** | step-by-step (job 136535249740): ① Validate docker compose configuration (real `docker compose config`) — **success**; ② Compose validation `.env` isolation self-test (FSR-13) — **success** (runner: Docker 29.4.2 / Compose v5.1.3; log lines: `RESULT: all compose validation checks PASSED` and `RESULT: FSR-13 self-test PASSED`); ③ Build portal image — **success**; ④ Build CMS image — **success** |

Both container images were really BUILT in CI (real daemon on the GitHub
Actions runner). The compose validation and the new self-test really RAN in
CI on this exact SHA.

## 10. Execution Environment Limitations (stated honestly)

* **No Docker daemon in the authoring environment.** The sandbox had no
  `docker` CLI at all; for this mission the official standalone Docker CLI
  27.5.1 + the Compose v2.34.0 plugin were installed client-side (static
  binaries, no daemon) so that `docker compose config` — which is a
  client-side render/validate — could run FOR REAL locally. This is
  explicitly distinguished from `docker compose up`: a live bring-up of the
  stack (containers, healthchecks, first-boot flows) was NOT exercised here
  and is NOT claimed. The real image builds happen in CI (§9), not locally.
* The local CLI versions (27.5.1 / v2.34.0) differ from the GitHub runner's
  (29.4.2 / v5.1.3); the validation passed on both, which is consistent
  with — but not a proof of — cross-version robustness. The enforced floor
  remains v2.24.0 (`!override` tag).
* The `--self-test` adversarial `.env` proves isolation for the variables
  named in the acceptance criteria plus the three REQUIRED variables; it is
  not an exhaustive proof over every variable Compose could interpolate.
* The 8 skipped tests remain environment-gated (live PostgreSQL/Nextcloud),
  unchanged from previous rounds.

## 11. Merge and Deployment Status

* The branch `fix/orbitcloud-compose-validation-isolation` is pushed and
  **awaiting review** — no pull request was merged, nothing was deployed,
  and `master` was not modified (it still points at `9f8da3b`).
* No secrets, real credentials or real `.env` content appear in any file,
  commit or log cited here; the only values used are obviously-fake
  placeholders (`validate-compose-placeholder`) and adversarial test markers
  (`from-env-file`, `192.0.2.123`, `adversarial-public-hosts.invalid`, …).
* **This closure covers FSR-13 and FSR-14 only.** OrbitCloud is NOT declared
  production-ready by this report, and no claim is made about a live tested
  stack; production readiness remains subject to independent verification of
  all acceptance criteria.
