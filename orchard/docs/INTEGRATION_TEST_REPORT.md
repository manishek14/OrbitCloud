# INTEGRATION_TEST_REPORT (Infrastructure Track)

**Date:** 2026-11-10  
**Branch:** `feature/phase5-commercial-core`  
**Environment:** local dev workspace (Windows), .NET 10.0.403, isolated dev DB backup verified (`phase5-m2-20261110-110556`, not modified). No real SMS, no real payments, no production access.

## Commands executed (evidence)
| Command | Result |
|---|---|
| `dotnet build AbrITPortal.slnx --artifacts-path artifacts/build` | **PASS** — 0 errors, 56-57 warnings (pre-existing transitive NU1902/NU1903 advisories, duplicated per-project/pass; no dependency upgrades) |
| `dotnet run --project AbrITPortal.SecurityTests/AbrITPortal.SecurityTests.csproj --artifacts-path artifacts/build` | **PASS** — `Assertions: 178; failures: 0` (all prior 43 security + M2 pricing assertions intact) |

## Component classification
| Component | Status | Notes |
|---|---|---|
| M2 commercial/pricing engine & rules | Implemented and tested locally | 178 assertions passing; unchanged by infra track |
| Payment abstraction/contracts/state machine/amount boundary | Implemented and tested locally | Mock/in-memory flows, transitions, idempotency/concurrency guards |
| Payment persistence models + Postgres store (schema/methods) | Implemented but not externally verified (DB runtime) | `EnsureSchemaAsync`/queries implemented; not applied to live DB; dev-clone execution not run in this pass beyond build |
| Mock payment provider | Implemented and tested locally | Initiate/verify/reconcile, decline/timeout scenarios |
| Mellat adapter | Implemented but not externally verified | Config-gated, live disabled, SOAP transport abstraction; blocked by WSDL/credentials |
| ZarinPal v4/sandbox adapter | Implemented but not externally verified | Config-gated, live disabled, REST transport abstraction; blocked by verified contract/credentials |
| Zibal adapter | Implemented but not externally verified | Config-gated, live disabled; blocked by verified contract/credentials |
| Payment callback/verification/reconciliation services | Implemented and tested locally (mock) | Untrusted callback handling, server-side verify, idempotency |
| SMS.ir provider v2 | Implemented but not externally verified | Live disabled; blocked by verified API/template contract & credentials |
| Legacy SMS bridge (replaces Kavenegar active path) | Implemented and tested locally (mock) | No real sends; OTP-safe handling hooks |
| Durable SMS outbox (in-memory + Postgres store) | Implemented and tested locally (in-memory) | Atomic claim/lease logic in Postgres store; runtime DB verification pending dev-clone run |
| SMS outbox processor & retry/DLQ/expiry/ambiguity | Implemented and tested locally (logic) | Backoff+jitter, no blind resend on ambiguous submit |
| Orchard background tasks & schedules | Implemented and tested locally (registration/build) | Runtime execution observed via OC semantics; per-server/in-memory state per OC 3.0.1 |
| Minimal Orchard Admin ops pages (Payments/SMS/Jobs) | Implemented but not externally verified (UI runtime) | Controllers/views/menu built; no browser E2E run captured |
| Config templates | Implemented and tested locally (static) | `.env.example` with placeholders only |

## Blockers
- Official SMS.ir version-specific contract & credentials/templates.
- Mellat WSDL/merchant credentials.
- ZarinPal verified v4/sandbox contract & credentials.
- Zibal verified API contract & credentials.
- M3 secure order lifecycle (public checkout must remain disabled).
- Dev-clone DB migration execution for new `abrit_payment_*`/`abrit_sms_outbox` tables not run in this session (backup available).

## Not implemented
- Full production-grade SMS.ir/Mellat/ZarinPal/Zibal live mappings beyond scaffold/parsing helpers (pending verified contracts).
- Public checkout, order-payment binding to real M3 flow, Nextcloud provisioning wiring, real delivery/settlement integrations.
