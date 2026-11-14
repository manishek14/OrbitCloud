# PAYMENT_ARCHITECTURE

## Scope (Infrastructure Track)
Backend foundation for AbrIT payments on Orchard Core 3.0.1/.NET 10/PostgreSQL. **No public checkout enabled** (M3 secure order lifecycle required). Payment attempts may be created only in isolated automated tests or restricted dev fixtures.

## Components
- **Contracts/abstraction:** `Payments/PaymentContracts.cs` — `IPaymentProvider` (`InitiateAsync`, `VerifyAsync`, `ReconcileAsync`), capabilities, typed request/result models, statuses, error categories, refund domain records.
- **Amount boundary:** `IPaymentAmountConverter` — central Toman→provider currency conversion (currently identity in IRT, whole amounts). Original and provider-submitted amounts recorded; no implicit conversion/double×10.
- **State machine:** `PaymentStateMachine` — explicit transitions; final/success helpers. Application services control transitions; adapters return typed results only.
- **Persistence:** `PaymentAttemptRecord`, `PaymentTransactionRecord`, `RefundAttemptRecord`. Stores: `InMemoryPaymentStore` (tests/dev) and `PostgresPaymentStore` (Npgsql, optimistic version checks) with schema `abrit_payment_attempt/transaction/refund_attempt`, indexes and unique constraints for gateway authority/request identifiers (tenant+provider scoped).
- **Orchestration:** `PaymentOrchestrator` — requires server-verified snapshot payable amount, blocks public checkout, creates attempt, calls provider, records result idempotently via transitions.
- **Verification:** `PaymentVerificationService` — callback correlation, provider-enabled check, idempotent duplicate handling, concurrent update protection, server-side provider verify, amount/order context from stored attempt, auditable transaction record on success.
- **Reconciliation:** `PaymentReconciliationService` — processes pending/ambiguous/initiated attempts, provider inquiry hooks, retry scheduling metadata.
- **Providers:** `MockPaymentProvider` (enabled), `MellatPaymentProvider`, `ZarinPalPaymentProvider`, `ZibalPaymentProvider` (adapters scaffolded, config-gated, **live disabled**, mock transport tests).

## Security
- Callbacks untrusted; never mark paid from redirect/callback params alone.
- No card/PIN/bank credentials or sensitive callback data stored; sanitized metadata truncated.
- Idempotency/concurrency: versioned transitions, duplicate success short-circuit, unique gateway identifiers in DB schema.
- Secrets via env/User Secrets/secret manager; no defaults.

## Status
Implemented and tested locally (mock/in-memory). External provider verification blocked by credentials/official contracts. Postgres schema/migrations verified via idempotent `EnsureSchemaAsync` code path (not executed against production; dev-clone execution requires explicit run).
