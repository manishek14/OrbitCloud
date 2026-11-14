# PHASE5_GAP_AUDIT ï¿½ M1 (2026-11-10)

**Scope:** inspection of repository state at `C:\Users\m.shekofteh\source\repos\ClassLibrary1` (branch `feature/phase5-commercial-core`, created from `master` `fd03a6c`) against Phase 5 execution brief and owner decisions (2026-11-10). No production systems accessed. No real SMS/transactions performed.

## 1. Repository / delivery truth (evidence)

| Item | Evidence | Severity | Notes |
|---|---|---:|---|
| Repo/remote mismatch vs brief | `git remote -v` ? `origin https://github.com/manishek14/ClassLibrary1.git`; brief references `manishek14/Abrit-Orchard` | Medium | Work proceeds on actual source of truth; documented per owner decision #4. Migration/sync to Abrit-Orchard is a delivery blocker pending owner action. |
| Branch | `git branch --show-current` ? `feature/phase5-commercial-core` | Info | Created safely; no reset/overwrite of local changes. |
| Working tree (preserved) | `git status --short`: modified `AbrITPortal/Mobile/MobileIdentityController.cs`, `MobileIdentityService.cs`, `Portal/PortalController.cs`, `AbrITPortalTheme/AbrITPortalTheme.csproj`, `Views/Layout.liquid`, `Views/Page-UserDashboard.liquid`, `wwwroot/css/abrit-portal.css`, `docs/UI_REDESIGN.md`; untracked `AbrITPortalTheme/Views/LoginForm.Edit.cshtml`, `Views/OrchardCore.Users/Account/Login.cshtml`, `Views/_ViewImports.cshtml`, `wwwroot/fonts/*`, `docs/ui-review/*` | Medium | Must be integrated, not discarded (owner decision #6). |
| Local runtime artifacts present | `AbrITPortal/App_Data/**`, `bin/`, `obj/`, `artifacts/` exist on disk but gitignored (`.gitignore`: `**/App_Data/`, `**/bin/`, `**/obj/`, `artifacts/`) | Medium | Contains tenant config/keys/logs/lucene; must never be committed (verified ignore). |
| Secrets/config | `AbrITPortal/appsettings.json` contains only logging config (no credentials). Kavenegar reads env/config keys `ABRIT_KAVENEGAR_*` at runtime (`Mobile/SmsProviders.cs`). | Info | No hardcoded credentials found in source scan. |
| Missing supplied inputs in workspace | No `*.zip`, commercial PDF/doc, or approved pricing screenshot found (search excluded bin/obj/artifacts/build). Only `docs/ui-review/*.png` present. | High (input) | Owner provided authoritative pricing table and policies in prompt (2026-11-10) ï¿½ used as source of truth for M2+; feature details from commercial doc still unavailable for verbatim transcription. |

## 2. Hosting, tenant, database, migrations, recipes

| Item | Evidence | Severity | Recommended repair |
|---|---|---:|---|
| Orchard host | `AbrITPortal/AbrITPortal.csproj`: `net10.0`, `OrchardCore.Application.Cms.Targets` 3.0.1, `OrchardCore.Logging.NLog` 3.0.1. `Program.cs` uses `AddOrchardCms()`, NLog, dev maintenance/setup commands. | Info | Keep supported OC 3.0.1 extension points. |
| Tenant/dev isolation | `Development/DevelopmentEnvironment.cs` requires `ORCHARD_APP_DATA=../artifacts/development/App_Data`, pins shells path, refuses DB outside `abrit_portal_dev_` namespace and non-Default tenant. `DevelopmentMaintenance.cs`/`DevelopmentIdentitySetup.cs` enforce same DB prefix. `docs/BASELINE.md` documents clone `abrit_portal_dev_20261109_110512`, backup `C:\Users\m.shekofteh\AbrITPortalBackups\phase2-20261109-110512`. | Low | Re-verify clone/backup exist before M2 migrations; migrations/index rebuild only on dev clone after backup. |
| Migrations/recipes | No `Migrations` classes or `*ContentDefinition*`/`*recipe*.json` beyond `Recipes/DevelopmentIdentity.recipe.json` found in source (`AbrITPortal/Recipes`). Commercial entities (plans, orders/payments/provisioning/SMS outbox/jobs config) not modeled. | High | Add repeatable migrations/recipes for Phase 5 content/records with auditable, versioned schema; protect orders referencing changed/unpublished plans. |
| Config drift risk | `App_Data/Sites/Default/appsettings.json` and lucene/keys exist locally (gitignored) and dev artifacts path is external; tenant DB state may diverge from repo recipes. | Medium | Prefer code/migration/recipe-driven setup in dev clone; document drift in traceability. |

## 3. Theme, UI, and encoding defects (critical for M1)

| Item | Evidence | Severity | Recommended repair |
|---|---|---:|---|
| Mojibake in working files (stored, not terminal-only) | PowerShell/[IO.File] reads show corrupted sequences in: `Portal/PortalController.cs` (e.g. `"Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯"`), `Mobile/MobileIdentityController.cs`, `Mobile/MobileIdentityService.cs` (comment/strings area shows garbled ranges), `AbrITPortalTheme/Views/Layout.liquid`, `Page-UserDashboard.liquid`, `Content-ServiceCatalogPage.Detail.liquid`, `Content-AbrITService.{List,Detail}.liquid`, untracked `Views/LoginForm.Edit.cshtml`, `Views/OrchardCore.Users/Account/Login.cshtml`. `docs/UI_REDESIGN.md` also shows mojibake. | **Critical** | Re-encode/fix Persian text to correct UTF-8 across affected source/views/docs; verify by byte/char inspection and rendered strings; preserve unstaged intent. |
| Inline HTML controllers | `PortalController` and `MobileIdentityController` build full HTML pages in C# (large string builders, duplicated shell/layout/CSS refs) ï¿½ hard to maintain, RTL/a11y fixes error-prone. | High | Refactor to Razor/Liquid views or shared layout partials while preserving routes/antiforgery/authorization; fix as part of M1/M3 UI integration. |
| Pricing/catalog UI | Catalog shows `AbrITService` content items with disabled purchase (`Content-ServiceCatalogPage.Detail.liquid`, `Content-AbrITService.*`, `PortalController.Catalog/Service`). No 5-plan (P1ï¿½P5) comparison, no user slider, no contract selector, no price breakdown, Endpoint not excluded by model (model absent). | **Critical (Phase 5)** | Implement approved 5-card pricing UI + slider + 3/6 month + breakdown per owner rules (M2/M3). |
| Dashboard/account | Dashboard shows Drive ï¿½not connectedï¿½ static panel (`PortalController`/`Page-UserDashboard.liquid`); no payment history/service activation/provisioning status fields. | High | Extend for order/payment/service/provisioning status (M6/M7). |
| Mobile UX | Docs note 390px screenshots ok for services/login/register; tall card comparison risk called out in brief. | Medium | Design mobile-friendly comparison/selection pattern (M3). |

## 4. Authentication, mobile, SMS

| Item | Evidence | Severity | Recommended repair |
|---|---|---:|---|
| Identity flows | Username/password preserved; registration/mobile verify/recovery OTP flows in `Mobile/MobileIdentityService.cs` & controller; native Orchard login override in theme. `DevelopmentIdentitySetup` disables native registration feature and manages settings/role/mobile uniqueness index. | Info | Preserve flows; harden and migrate provider. |
| OTP storage/limits | Challenges/reset grants stored in `IMemoryCache` (`cache.Set("otp:"...)`, 2 min expiry; 5 attempts; 15-min rate buckets; single-use consume). Not durable across restarts/scale-out; no persisted audit/dispatch metadata. Recovery `BeginRecoveryAsync` returns accepted challenge even if unknown/limited (anti-enumeration intent) but implementation branches need careful review. | High | Move OTP challenges/dispatch to durable, auditable structures where required; keep 2-min expiry, attempt limits, resend cooldown, no reuse, priority dispatch (M5). Do not expose OTP values. |
| SMS provider | `ISmsProvider` + `MockSmsProvider` + `KavenegarSmsProvider` (`Mobile/SmsProviders.cs`). `Program.cs`: dev?Mock singleton, non-dev?`AddHttpClient<ISmsProvider, KavenegarSmsProvider>()`. Kavenegar-specific env keys/URL hardcoded to `api.kavenegar.com`. No SMS.ir, no outbox, no queue, no retries/DLQ/idempotency keys, no admin visibility. | **Critical** | Implement `SmsIrProvider`, config/health, templates, transactional+OTP via approved SMS.ir contract (verify docs/account); durable PostgreSQL outbox, atomic claiming/leases, backoff, DLQ, idempotency, rate/abuse controls, admin retry/search (M5). Keep mock default for tests/dev; no real sends. |
| Background jobs | No `IBackgroundTask`/scheduled workers found for SMS, reconciliation, cleanup, provisioning, stuck recovery. | **Critical** | Add recurring jobs with supported OC facilities + distributed locking/persistence as needed (M5/M7); safe retention, tests. |

## 5. Orders, pricing, payment, provisioning

| Item | Evidence | Severity | Recommended repair |
|---|---|---:|---|
| Pricing engine | None found (no `*Pricing*` types). Catalog uses `AbrITService.Price.Value/Text`; JS/server-centralized pricing absent. | **Critical** | Single central pricing service (decimal, explicit rounding), server-authoritative recalculation, immutable snapshot on order create (M2). |
| Commercial model entities | No P1ï¿½P5 plan definitions/config, no contract 3/6 policy records, no onboarding policy records, no user-count constraints in code. | **Critical** | Model approved plans/SLA/limits/additional fees/discounts/onboarding as admin-manageable, auditable config (M2/M4). |
| Order/payment/provisioning state | `AbrITOrder` referenced by string/content fields only (`ServiceId`, `Status`, `Price`) in controllers/query/authz; no explicit separated state machine for order/payment/provisioning/subscription. | **Critical** | Explicit separated states, durable transitions, audit history, idempotent activation (M3/M6/M7). |
| Payment | No Mellat/Behpardakht integration, no gateway abstraction, no callback/verify/settlement/reconciliation. | **Critical** | Mock-first `IPaymentGateway` adapter, attempt records, unique merchant refs, immutable amount, server-side verify only, replay/duplicate protection, Toman/Rial explicit, admin status; no live activation (M6). |
| Nextcloud | No Nextcloud/provisioning code found. Dashboard shows disconnected placeholder. | **Critical** | Complete/implement verified Nextcloud provisioning workflow (mock/test env only now), idempotent, quota mapping, duplicate prevention, retry/failure handling (M7). |

## 6. Authorization, security, operational concerns

| Item | Evidence | Severity | Recommended repair |
|---|---|---:|---|
| Order isolation | Strong handler/query pattern in `OrderAuthorizationHandler` and `OwnedOrdersQuerySource` (stable NameIdentifier, fail-closed, recheck). `PortalController.CanDisplayOrders` revalidates. | Low | Preserve; extend to new order/payment records and admin/customer boundaries. |
| Admin commercial management | No dedicated AbrIT admin area for plans/orders/payments/SMS/jobs/provisioning/audit. Native OC admin remains. | High | Dedicated authorized admin area with RBAC/CSRF/audit (M4/M5/M6/M7). |
| CSRF/antiforgery | Used in login/theme forms and controller-generated forms (`antiforgery.GetAndStoreTokens`), but inline HTML generation increases regression risk. | Medium | Keep/standardize antiforgery on all state-changing endpoints; prefer framework view helpers. |
| Logging/exposure | Need to ensure OTP values, secrets, provider keys never logged or shown; mock provider currently stores last OTP in-memory for tests (acceptable if test-only/dev-scoped) ï¿½ review usage. | Medium | Audit logging paths in M5; never persist/display OTP. |
| Dependency advisories | `docs/BASELINE.md`: NU1902/NU1903 transitive advisories (AngleSharp, MySqlConnector, SixLabors.ImageSharp, System.Security.Cryptography.Pkcs). No upgrades applied. | Medium | Track; upgrade only after OC 3.0.1 compatibility review (not blocking M1 without exploit path evidence). |

## 7. Tests, CI, deployment readiness

| Item | Evidence | Severity | Recommended repair |
|---|---|---:|---|
| Automated tests | `AbrITPortal.SecurityTests` (custom exe, 43 assertions per docs/code coverage areas: ownership/catalog/dashboard/authz/HTTP). No unit/integration tests for pricing, payment, SMS queue/jobs, provisioning, admin. | **Critical** | Add comprehensive tests per Phase 5 L; run existing + new; record evidence (M8). |
| CI/CD | No `.github/workflows` build/test pipeline; no Dockerfile. | High | Add CI/build/test readiness as feasible without production deploy (M8). |
| Deployment docs | Partial (`BASELINE.md`, `SECURITY.md`, `UI_REDESIGN.md`). Missing Phase 5 operational/commercial/payment/SMS/provisioning docs. | High | Produce required docs set (M8 / incremental). |

## 8. M1 fixes applied in this milestone (independently verified where noted)

| Fix | Files | Verification |
|---|---|---|
| Safe branch for Phase 5 | git branch | `feature/phase5-commercial-core` active; working tree preserved. |
| Gap audit documented | `docs/PHASE5_GAP_AUDIT.md` | This document. |

## 9. M1 fixes planned next (safe, in-progress)

1. **Repair mojibake (critical):** restore correct UTF-8 Persian strings in modified/untracked UI and mobile/portal controllers and affected docs while preserving functional changes. Verify with source inspection and build.
2. **Baseline build & existing tests:** run `dotnet build` and `AbrITPortal.SecurityTests` (artifacts path) to capture current baseline on this branch.
3. **Record milestone report:** update docs with changed files, results, and unresolved blockers.

## 10. Blockers / external dependencies (current)

- **Repo name mismatch:** `ClassLibrary1` vs `Abrit-Orchard` ï¿½ delivery/sync decision external.
- **Commercial feature text:** approved screenshot/table provided; full commercial document details for non-conflicting plan features not present in workspace ï¿½ will mark unverifiable feature bullets explicitly if needed.
- **SMS.ir/Mellat/Nextcloud/SMTP credentials & official contracts:** not available ï¿½ mock-first, integration-blocked.
- **Dev clone readiness:** `abrit_portal_dev_*` DB and isolated App_Data must be confirmed present/healthy before DB-affecting steps.

---
*Status: M1 audit recorded; remediation/build/test in progress.*
