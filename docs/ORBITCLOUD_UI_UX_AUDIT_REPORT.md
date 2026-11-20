# OrbitCloud — Comprehensive UI/UX Audit & Remediation Report

**Date:** 2026-11-20
**Branch:** `ui/comprehensive-ux-improvements` (from `audit/orbitcloud-comprehensive-fixes` @ `a8bc749`)
**Method:** full-repository UI inventory → live visual inspection with a real browser
(Chrome 157, headless) across a 6-viewport matrix → VLM-assisted screenshot review with
**every claim re-verified against DOM measurements and source** → prioritized fixes →
after-captures → full validation suite.

Statuses: **FIXED & VERIFIED** · **IMPLEMENTED BUT NOT VERIFIED** ·
**EXISTING AND ACCEPTABLE** · **BLOCKED** · **REQUIRES PRODUCT DECISION**.

---

## 0. Baseline, branch safety & CI (Phase 0)

- Repository state at start: `audit/orbitcloud-comprehensive-fixes` @ `a8bc749`,
  clean tree, `master` untouched at `6428268`. New branch
  `ui/comprehensive-ux-improvements` created from it.
- **CI status at `a8bc749`: FAILED (both jobs)** — diagnosed and fixed as the
  first act of this round (details in §1); these fixes ship in this branch's
  first commit.
- **.NET build status:** the solution had **never compiled** — the SecurityTests
  harness referenced the retired `PortalController`. FIXED & VERIFIED:
  `dotnet build AbrITPortal.slnx -c Release` → 0 errors; SecurityTests →
  **199 assertions, 0 failures**; PricingTests → **PASS**.
- **Docker build status:** BLOCKED (no Docker daemon in the audit sandbox);
  image-build validation remains a CI job.
- **Skipped tests & reasons:** the 8 `pricing-db` tests skip without a live
  PostgreSQL catalog (documented behavior; everything else runs).
- **Engineering-review items — both implemented:**
  1. `OTP_HMAC_SECRET` is now **mandatory in production** (no
     `ABRIT_SERVICE_TOKEN` fallback): `grant-hash.ts`, `throttle.ts`, compose
     (required variable), dev override (isolated dev value), `.env.example`,
     deployment checklist, and updated grant-hash tests. FIXED & VERIFIED.
  2. Caddy preview gateway now uses an **explicit per-service port map**
     (`3000` portal, `3031` Nextcloud emulator) instead of the 3000–3999
     range; everything else routes to the discard sink. FIXED & VERIFIED
     (configuration review; no Caddy binary in the sandbox).

## 0.1 CI failures at baseline — root causes & fixes

**Portal job — `bun test` failure** (`login-throttle > raw identifiers…`):
bun's `mock.module()` is **process-global and leaks across test files that
share a parallel worker**. `payment-callback-service.test.ts` installs a no-op
`@/lib/audit` mock; when CI's 4-worker grouping ran it before
`login-throttle.test.ts`, the login route received the cached no-op audit and
the test's audit assertions found nothing. Reproduced locally with
`bun test --randomize --seed=3251704646` (deterministic), fixed by:
- CI runs `bun test --isolate` (fresh module registry per file);
- `login-throttle.test.ts` now mocks `@/lib/audit` directly (immune to
  predecessor mocks) and asserts response statuses + array lengths for honest
  diagnostics.
FIXED & VERIFIED (bun 1.3.14 and 1.4.5, multiple seeds, 184 tests: 176 pass /
0 fail / 8 documented skips).

**Orchard job — `CS0234: namespace 'AbrITPortal.Portal' not found`:** the
SecurityTests harness still asserted the retired MVC `PortalController`
(dashboard moved to the Next.js portal). Stale checks removed with an honest
comment pointing at the bun coverage that replaced them. FIXED & VERIFIED.

## 1. Page inventory (Phase 1)

**A. Public website** (`src/views/public` + `public-layout`): home, services,
plans, about, contact, FAQ, not-found; auth: login (mobile-OTP + password
tabs), register (2-step with OTP), verify-OTP, forgot-password (mobile/email
channels), reset-password. — 11 routes inspected.

**B. Customer portal** (`src/views/portal` + `portal-layout`): dashboard,
services (+detail), plans (+detail), cart, checkout, payment result, orders,
billing (invoices+transactions), drive, tickets (+detail), notifications,
profile, security, settings. — 17 routes inspected (all states noted).

**C. Orchard administration** (real Orchard Core 3.x at `:5100/admin` with the
AbrITAdminTheme): admin dashboard, content items, users, search + the custom
AbrIT business area (`/Admin/AbrIT/*`): home, customers (+detail), orders,
payments, subscriptions, drive, tickets, reports, plans/pricing, settings. —
15 screens inspected. **Orchard was run as the REAL CMS** (production mode,
first-run setup completed through the actual UI) — no imitation.

## 2. Visual inspection & viewport matrix (Phase 2)

Live stack for the audit: PostgreSQL 16.4 (userspace), portal = production
standalone build, CMS = real Orchard production instance, both behind a local
SMS.ir mock (production-fidelity `sms` mode for the OTP flows), Chrome 157
headless.

**Captured: 90+ before screenshots** at 1440×900, 1280×800, 1024×768,
768×1024, 390×844, 360×800 — public, auth, portal (authenticated) and CMS
(authenticated), plus light-theme variants. Evidence pairs are committed under
[`docs/evidence-uiux/`](evidence-uiux/).

**Interactive flows verified end-to-end in the browser:**
- Registration: form → terms → OTP request (real sms mode via the mock) →
  code entry → `/portal` session. PASS.
- OTP login: request → verify page (masked mobile, countdown, resend) →
  code → `/portal`. PASS.
- Password login (email and mobile identifiers), portal navigation, CMS
  login + setup wizard (Persian). PASS.

**RTL verification:** document direction, sidebar position, breadcrumb flow,
form alignment, chevron directions and table column order all verified
correct in every screenshot; mixed Persian/Latin runs are isolated with the
existing `.ltr-iso`/`dir="ltr"` helper in the audited hotspots.

### Measured responsive results (DOM, not screenshots)

- **Horizontal overflow: 0 px across 138 page/viewport combinations** (all
  public + portal pages × 6 viewports), re-verified after the fixes on the
  changed pages. No horizontal scrolling, no clipped containers anywhere.
- Touch-target scan found the real defects listed in §4 (carousel dots 8×8,
  copy buttons ~22px, footer links 17px tall) — all fixed (§4).

## 3. Design system audit (Phase 3)

`globals.css` defines a coherent token system — navy/electric-blue identity
(`#1d4ed8` primary, `#0b1220`/`#111c31` dark surfaces), full light/dark
palettes, semantic tokens, radius scale, self-hosted Vazirmatn, bidi helper.
Findings: **no conflicting styles, no duplicate selectors, no dead CSS, no
unscoped global selectors** found; the CMS side uses one namespaced
stylesheet (`admin-abrit.css`, BEM-ish `abrit-*` prefixes) layered on
Orchard's TheAdmin — consistent with the portal's visual language.
The existing visual direction already matches the requested enterprise-SaaS
profile, so **no redesign was performed** (per the evidence-first rule); only
the defect fixes below.

## 4. Confirmed defects & implemented corrections (Phases 4–7, 9)

| # | Sev | Defect (evidence) | Route | Fix | Status |
|---|-----|-------------------|-------|-----|---------|
| UI-1 | P1 | Carousel pagination tabs measured **8×8 px** (`h-2 w-2` buttons) — unusable touch targets, WCAG 2.5.8 failure | `/plans`, `/portal/plans` | 24×24 buttons with visible 8px dot inside + focus ring | **FIXED & VERIFIED** (DOM: `24x24` ×6) |
| UI-2 | P1 | Unknown paths with the CMS down returned a **bare `CMS is unavailable`** string — unbranded, LTR, no way back | any non-Next path | Branded RTL 502 card (navy theme, retry/home CTA, error code) for `Accept: text/html`; plain payload otherwise; `no-store` | **FIXED & VERIFIED** (before/after captures) |
| UI-3 | P1 | SecurityTests harness never compiled (`AbrITPortal.Portal` / `PortalController` retired) — .NET CI red | CI | Stale checks removed, pointer to the replacing bun coverage | **FIXED & VERIFIED** (199/199 assertions) |
| UI-4 | P1 | CI test-order flake from process-global `mock.module` leakage | CI | `bun test --isolate` + direct `@/lib/audit` mock in login-throttle test | **FIXED & VERIFIED** (multi-seed) |
| UI-5 | P2 | CMS tables mixed **Latin and Persian numerals** in adjacent columns (`52,900,000` next to «۸×۵»); KPI cards Latin | `/Admin/AbrIT/Plans`, Orders, Payments, Customers, Reports, dashboard | `ViewFormats.FaToman/FaNumber` (explicit U+06F0 digit translation — .NET never substitutes native digits) applied to every money/quantity column and dashboard KPIs | **FIXED & VERIFIED** (DOM: `۵۲٬۹۰۰٬۰۰۰`, KPIs `۲\|۰\|…`) |
| UI-6 | P2 | CMS dashboard rendered **8 identical error cards** when the commerce API was unreachable, and 3 permanently-unwired SMS/failed-payment placeholder cards at all times | `/admin` | Provider flags `Unavailable`/`SmsMetricsAvailable`; the view renders **one full-width notice** when unavailable and hides unwired cards when healthy; “active services” card now shows real data with an honest caption | **FIXED & VERIFIED** (code + rebuild; healthy-state capture) |
| UI-7 | P2 | Plans table row actions **stacked vertically** (3 blocks) inflating row height | `/Admin/AbrIT/Plans` | Flex row wrapper inside the cell (`display:flex` on a `<td>` itself is unreliable); edit panel wraps to its own line when opened | **FIXED & VERIFIED** (DOM: same-row geometry) |
| UI-8 | P2 | OTP/demo **copy buttons ~22px**, no focus styling | auth views | 28px targets + visible focus ring | **FIXED & VERIFIED** |
| UI-9 | P3 | Public **footer links 17px tall** hit areas | all public pages | `inline-block py-1` (≈26px targets) | **FIXED & VERIFIED** |

## 5. Verified NON-defects (claims investigated and dismissed)

Evidence discipline: every VLM claim was re-checked against DOM measurement
or source before acting. The following were **hallucinated or artifacts**:

- “Login right panel clipped/overflowing” — DOM: `docOverflow = 0`; the only
  out-of-viewport element is an intentional, clipped decorative glow.
- “Severe horizontal overflow on mobile portal orders” — 0 px overflow across
  the full 138-combination matrix.
- “No mobile navigation” — both layouts have Sheet drawers (`lg:hidden`
  trigger, RTL side="right", labeled).
- “Empty FAQ section on home” — live DOM contains 18 accordion items; the
  capture artifact came from scroll-reveal animations hidden in full-page
  screenshots.
- “`دراپ‌درون` placeholder / “AbiIT” typo” — not present anywhere in source.

## 6. Accessibility findings (Phase 8)

- Keyboard/ARIA: auth forms use labeled inputs; the carousel exposes a proper
  `tablist`; drawers have `SheetTitle` (sr-only); icon buttons carry
  `aria-label`. EXISTING AND ACCEPTABLE.
- Touch targets: fixed per UI-1/UI-8/UI-9. FIXED & VERIFIED.
- Inline nav/footer text links remain text-height where conventional
  (WCAG inline exception) — EXISTING AND ACCEPTABLE.
- The Orchard Core admin's own widgets (e.g., the Users dashboard card note)
  are Orchard module UI; restyling them deeply would fight the platform —
  REQUIRES PRODUCT DECISION.

## 7. Performance findings (Phase 8)

- The portal ships a self-hosted variable font (`font-display: swap`), code-split
  routes, and no animation library beyond the already-present framer-motion.
  No heavy dependencies were added by this round (zero new packages).
- Lighthouse runs were not possible in the sandbox (no public URL for the
  headless audit stack) — NOT RUN, noted honestly; CI + deployment remain the
  place for lab-grade numbers.
- The CMS dashboard previously fetched/ rendered 8 KPI cards even when the
  data source was down; it now short-circuits to a single notice.

## 8. Test results (exact, this round)

| Check | Result |
|---|---|
| `bun run lint` | clean |
| `bunx tsc --noEmit` | clean |
| `bun test --isolate` | **184 tests: 176 pass / 0 fail / 8 skip** (documented DB-gated pricing tests) |
| `bun run build:docker` (production standalone) | success |
| `dotnet build AbrITPortal.slnx -c Release` | **0 errors** (35 pre-existing warnings) |
| `dotnet run --project …SecurityTests` | **199 assertions, 0 failures** |
| `dotnet run --project …PricingTests` (from repo root) | **PASS** |
| Overflow regression (changed pages × 4 viewports) | **0 px overflow** |
| Carousel tabs DOM size | **24×24** (was 8×8) |
| Registration / OTP-login / password-login flows in-browser | **PASS** |
| Docker image builds | BLOCKED (no Docker daemon in sandbox; CI job covers it) |

## 9. Remaining issues / product decisions

1. **Orchard admin sidebar labels** — the icon-only rail with dead space below
   is Orchard's own collapse behavior; adding persistent labels would fight
   the platform. REQUIRES PRODUCT DECISION.
2. **CMS login “remember me” checkbox ~16px** — Orchard core widget; a theme
   override is possible but touches platform markup. REQUIRES PRODUCT DECISION.
3. **Lighthouse/perf lab numbers** — NOT RUN (no public URL in the sandbox).
4. **Live-browser CMS-unavailable capture required stopping the local CMS**
   (by design); in the deployed stack the fallback triggers only when the CMS
   container is actually unreachable.
5. **8 pricing-DB tests** remain skip-gated without a live PostgreSQL catalog
   (pre-existing, documented).

## 10. Commit / branch

- Branch: `ui/comprehensive-ux-improvements`
  https://github.com/manishek14/OrbitCloud/tree/ui/comprehensive-ux-improvements
- Commits: CI-repair + hardening (`d2e165e`), UI remediation + this report
  (`aac94ad`), PricingTests CI build fix (`550b528`); author
  `manishek14 <manishekofteh@gmail.com>`.
- **CI on `550b528`: ALL THREE JOBS GREEN** — Portal (lint, types, tests,
  production build) ✓, Orchard (.NET build + SecurityTests 199/199 +
  PricingTests) ✓, **Docker image build validation ✓** (first-ever green
  pipeline for this repository, validating both container images end-to-end).
- `master` untouched; no force-push; PR creation blocked by the token's
  missing `pull_requests: write` scope (same as the previous round) — create
  it at:
  https://github.com/manishek14/OrbitCloud/pull/new/ui/comprehensive-ux-improvements
