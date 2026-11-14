# Phase 5 audit — current repository (2026-11-10)

Scope: source, projects, recipes, routes, theme, security harness and Phase 5/6 reports on `fix/pr2-conflicts` at `174eb3f`. No production tenant, real payment or real SMS was used. Earlier milestone claims were checked against current registrations and route code. `PHASE5_GAP_AUDIT.md` records the older baseline; this report records the current state.

| Component | Current implementation | Problem | Risk | Required change | Dependencies | Verification |
|---|---|---|---|---|---|---|
| Commercial defaults | Five plans were initialized with screenshot prices/users and marked published | Screenshot conflicts with document; no business approval is recorded | Critical | Replace defaults with inactive, zero-price shells; block quotes and snapshots until approval | Owner confirms reconciled values, limits, additional-user fees, onboarding | Pricing tests; inspect site settings and customer display |
| Pricing administration | Admin can edit draft prices/users/onboarding; SLA and discounts are now fixed | Earlier save could publish unapproved values; no plan capacity/service fields | High | Keep draft-only until explicit approval; add validated capacity/feature fields and audited approval workflow | Commercial source document | Authorized admin integration test, model validation |
| Catalog/slider | `/services` still uses `AllServices`; purchase disabled | Five dynamic plan cards, slider and server quote flow absent | High | Implement after commercial approval | Approved values and UI reference | 360–1920 px browser captures and boundary tests |
| Orders | Legacy `AbrITOrder` content plus owner-filtered `MyOrders` query | No durable commercial order snapshot/state machine | Critical | Persist immutable priced order and validated transitions | Approved pricing; schema migration | Ownership and transition integration tests |
| Payment | Provider boundaries, callback and in-memory store; PostgreSQL store exists in source | Store is not registered; order snapshot and paid transition are not wired; live Mellat mapping unavailable | Critical | Wire durable store only with isolated schema/migration, then complete verified merchant contract | Official Mellat documents, credentials, test merchant | Replay, amount mismatch, concurrent callback and isolated gateway tests |
| SMS identity | Legacy mobile OTP uses in-memory challenges | Restart/scale-out loses challenges; old Kavenegar was active outside development | Critical | Kavenegar removed from active code; implement durable protected challenge and SMS.ir mapping | Official SMS.ir API, template account, secret storage | OTP expiry/attempt and no-live-send tests |
| SMS outbox | PostgreSQL claim implementation and in-memory store | In-memory store registered; worker not registered; former bridge stored OTP as Base64 before persistence | Critical | Bridge removed; wire protected durable outbox, caps, leases, retries and operations UI | Isolated PostgreSQL migration; provider contract | Multi-worker concurrency/restart/retention tests |
| Background jobs | Orchard task classes with static process-local overlap guard | No distributed lock/history/configuration; only four of ten required jobs modeled | High | Persist schedule/leases/history and add remaining jobs | Orchard task lifecycle validation; DB | Two-instance overlap and restart test |
| Drive/provisioning | `/drive/provision` directly performs WebDAV MKCOL, status checked server-side | Folder creation is not paid-order provisioning; quota/account lifecycle absent | High | Add durable idempotent provisioning job; retain honest status | Nextcloud admin API and approved quota | Isolated WebDAV/Nextcloud test |
| Admin UI | Plans, payments, SMS and jobs pages exist | Dashboard/customers/orders/provisioning/reports absent; jobs list is static | Medium | Complete permissioned operational pages from real persisted data | Durable stores and job history | Admin role and manual-action CSRF tests |
| Customer UI | Dashboard shows authorized legacy orders and Drive status | No purchased-plan snapshot, payment history or activation details | Medium | Populate from authorized new order/payment records | Order model | Cross-customer isolation test |
| Security/dependencies | Existing order authorization harness and Orchard 3.0.1/.NET 10 | Transitive NU1902/NU1903 advisories; several inline HTML pages; partial browser acceptance | Medium | Review compatible dependency updates and rendered a11y/RTL | Orchard compatibility; browser tooling | Full build, security suite, browser acceptance |
| Build environment | Main project `Compile` target succeeds | Full build cannot copy DLL/exe while an existing process holds `AbrITPortal/bin/Debug/net10.0`; isolated artifacts build also needs restored assets | Medium | Stop/reconfigure the running development process or build into a fully restored isolated output | Local dev runtime | Full solution build and security test run |

## Commercial reconciliation

The conflict table and approval questions are in `COMMERCIAL_RULES.md`. The prior document incorrectly claimed screenshot values were approved. No value has been chosen. Current code defaults to zero-price unpublished plans and rejects quotes without `CommercialValuesApproved`; older stored settings are treated as drafts. No tenant database was edited by this source change.

## Reviewed surfaces

`AbrITPortal`, `AbrITPortalTheme`, `AbrITPortal.SecurityTests`, the placeholder `ClassLibrary1` project, `DevelopmentIdentity.recipe.json`, controller route inventory, commercial/payment/SMS/background/Drive source, Liquid/Razor theme files and existing reports/screenshots. The Phase 6 screenshot directory still contains only a placeholder; rendered acceptance was not demonstrated. The existing `docs/ui-review` images predate the current commercial flow.

## Verification in this pass

- `git diff --check`: no whitespace errors.
- `dotnet build AbrITPortal/AbrITPortal.csproj --no-restore -t:Compile`: passed (dependency advisory and existing source warnings).
- Full solution/project build: blocked by an existing process locking `AbrITPortal.dll`/`.exe`; isolated `--artifacts-path` lacked restored assets and its restore attempt returned failure without diagnostic errors. Security executable was therefore not rerun after these edits. No integration test success is claimed.
