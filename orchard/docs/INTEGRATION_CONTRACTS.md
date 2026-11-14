# INTEGRATION_CONTRACTS (Phase 5 Infrastructure Track, P1)

**Date:** 2026-11-10  
**Repository/branch:** `C:\Users\m.shekofteh\source\repos\ClassLibrary1` (`feature/phase5-commercial-core`)  
**Method:** repository inspection + official doc fetch attempts (`webfetch`) for ZarinPal, Zibal, SMS.ir, Orchard Core Background Tasks; `websearch` unavailable (HTTP 403). Provider API contracts below are marked **Verified from accessible doc**, **Partially verified (page limited/SPA)**, or **Unverified in-session (known public contract; live adapter disabled pending verification/credentials)**. No invented live defaults or credentials.

## 1. Repository state (inspected)

| Area | Finding |
|---|---|
| Host | Orchard Core 3.0.1, .NET 10 (`AbrITPortal/AbrITPortal.csproj`), `AddOrchardCms()` in `Program.cs`. |
| Identity/OTP | `Mobile/MobileIdentityService.cs` (IMemoryCache OTP challenges/reset grants, 2-min expiry, 5 attempts, 15-min rate buckets, keyed hash, single-use consume), `Mobile/MobileIdentityController.cs` (registration, mobile verify, recovery), `Mobile/SmsProviders.cs` (`ISmsProvider`, `MockSmsProvider`, `KavenegarSmsProvider` active non-dev). |
| Orders/authz | `Orders/OwnedOrdersQuerySource.cs`, `Security/OrderAuthorizationHandler.cs`; M3 order lifecycle incomplete (no public checkout enabled). |
| Commercial/pricing | M2 complete (`AbrITPortal/Commercial/*`, 178 assertions). Amounts Toman (IRT), snapshot immutable. |
| Persistence | PostgreSQL dev clone `abrit_portal_dev_20261109_110512`; YesSql/OC patterns; no existing payment/SMS outbox tables. |

## 2. Orchard Core Background Tasks (v3 / docs fetched)

- **Source:** https://docs.orchardcore.net/en/main/reference/modules/BackgroundTasks/ (fetched 2026-11-10).
- **Verified:** `IBackgroundTask` registered tasks managed via Tools → Background Tasks (enable/disable, cron schedule, routing pipeline option). Execution state is **in-memory per server** (not DB), reset on restart; in web farm each server runs independently, **session affinity** required for admin pages, **Run now** affects handling server only. Atomic overlap prevention requires `[BackgroundTask]` lock timeout/expiration + distributed lock feature (e.g. Redis Lock); without distributed lock settings ignored. `ShellWarmup` defaults false. Config: `OrchardCore:BackgroundService` (`PollingTime`, `MinimumIdleTime`, `MaxRecentRuns`, `ShellWarmup`). `IBackgroundTaskMonitor` available at host level when background service enabled.
- **Implication:** Cron/native scheduling usable for recurring dispatch/reconciliation/cleanup triggers, but **does not guarantee exactly-once or continuous low-latency OTP**. DB-backed queue with atomic claiming/leases + short batch processing required (implemented in P5); multi-instance/distributed-lock limitations documented in `docs/BACKGROUND_JOBS.md`.

## 3. SMS.ir

- **Docs URL:** https://sms.ir/ , API host `https://api.sms.ir` (referenced by brief). `https://docs.sms.ir/` fetch: transport error (unreachable in-session). `websearch` unavailable.
- **Status:** **Unverified in-session** (official version-specific contract not re-read here). Commonly documented REST patterns (e.g. `x-api-key` header, verify/send endpoints, template parameters) are **assumptions** until verified against approved account/API version.
- **Implementation stance:** `ISmsProvider` abstraction + `SmsIrProvider` adapter implemented behind configuration and mock transport tests; **live mode disabled by default**, no credentials/defaults. Provider-specific endpoint/payload mapping isolated and adjustable once official contract/template IDs confirmed. No OTP values logged/returned; secure OTP generation/hash/expiry/attempts/cooldown/single-use preserved.

## 4. Behpardakht Mellat

- **Docs URL:** https://bpm.shaparak.ir/ (starting point). No full WSDL contract fetched/verified in-session.
- **Status:** **Unverified in-session**. Known operations (to confirm): `bpPayRequest`, `bpVerifyRequest`, `bpSettleRequest`, `bpInquiryRequest`, `bpReversalRequest`; SOAP/WSDL, composite response parsing, distinct verify/settle states, amount/currency and date/time format per actual contract.
- **Implementation stance:** `IPaymentProvider` adapter with typed request/parse/results and explicit capability flags; SOAP transport abstraction + mocked responses for success/decline/timeout/duplicate callback/ambiguous settlement. **Live disabled, no credentials/default terminal/password**, configurable HTTPS callback. Not claimed connected.

## 5. ZarinPal (v4 / Sandbox)

- **Docs URL:** https://docs.zarinpal.com/paymentGateway/guide/ (fetched: minimal/landing content only; detailed v4 request/verify fields not extractable).
- **Status:** **Partially verified (entry point only)**. Common v4 concepts (merchant_id, amount, callback_url, authority, StartPay redirect, server-side verify, sandbox/production separation, currency/amount semantics) treated as **to-be-verified** against current official v4 docs.
- **Implementation stance:** Separate REST adapter, typed `HttpClient` (controlled timeouts), sandbox/production config isolated, mock HTTP transport tests + optional controlled sandbox tests only if credentials provided (not now). **Live disabled by default**. Callback untrusted; server-side verify required.

## 6. Zibal

- **Docs URL:** https://help.zibal.ir/IPG/API/ (fetched: SPA shell, API details not extractable).
- **Status:** **Unverified in-session**. Common contract elements (request, redirect, callback, verify, trackId/reference, test merchant mechanism, amount/currency) treated as **to-be-verified**.
- **Implementation stance:** Separate REST adapter, mock HTTP transport tests, configurable merchant (no hardcoded test merchant in production config), **live disabled**.

## 7. Currency & amounts

- M2 pricing: Toman (IRT), snapshot authoritative. Payments must use immutable server-verified order snapshot amount; central **Toman → provider-required currency** boundary required; original and provider-submitted amounts recorded; no implicit conversions or double ×10. (No public checkout/order-payment creation enabled in this track per M3 dependency.)

## 8. Blockers recorded

| Blocker | Impact | Classification |
|---|---|---|
| Official SMS.ir version-specific API/template contract not accessible in-session | Live SMS.ir mapping/credentials | Implemented mock-first; live blocked |
| Mellat WSDL/merchant credentials not available | Live Mellat | Implemented mock-first; live blocked |
| ZarinPal v4 detailed fields/sandbox contract not fully extractable | Live/sandbox verification | Implemented mock-first; live blocked |
| Zibal API details not extractable (SPA) | Live verification | Implemented mock-first; live blocked |
| M3 secure order lifecycle incomplete | Public checkout/payment attempts | Payment attempts restricted to tests/dev fixtures only |

*This document is updated if additional official contracts are verified during implementation.*
