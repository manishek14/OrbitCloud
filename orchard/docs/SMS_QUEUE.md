# SMS_QUEUE

## Durable outbox
- Model: `Notifications/SmsOutboxMessage` (`abrit_sms_outbox`).
- Statuses: Pending, Processing, Submitted, SentAccepted, Delivered (when confirmed), RetryScheduled, Failed, DeadLetter, Cancelled.
- Fields: tenant, provider, recipient, purpose/template, sanitized params/preview, protected payload (short-lived, non-OTP-plaintext metadata), priority, idempotency key, attempts/max, timestamps, lease/worker, expiry, provider ids/status, failure category, metadata.

## Stores
- `InMemorySmsOutboxStore` (tests/dev) and `PostgresSmsOutboxStore` (Npgsql) with `EnsureSchemaAsync` creating table + unique `(tenant_id,idempotency_key)` + claim/lease indexes.
- **Atomic claiming:** Postgres uses `FOR UPDATE SKIP LOCKED` CTE claim batch, increments attempt, sets lease/worker.
- **Leases:** `processing_lease_until_utc` with recovery (`RecoverExpiredLeasesAsync` / background task).

## Processing
- `BackgroundJobs/SmsOutboxProcessor`: recovers expired leases, claims priority-ordered batch, checks expiry, dispatches via enabled provider, handles accepted/ambiguous/submitted outcomes.
- **Ambiguity:** provider timeout after submission treated as ambiguous — marked submitted/retry-check path without blind resend.
- **Retry:** exponential backoff with jitter, max attempts, expiry-aware, DLQ on exhaustion.
- **OTP:** the former bridge was removed because Base64 was not encryption and its direct send happened before persistence. OTP dispatch is blocked outside development pending a protected, durable integration.

## Background jobs
- `SmsOutboxBackgroundTask` (`*/1 * * * *`), `SmsLeaseRecoveryBackgroundTask` (`*/5 * * * *`) registered as Orchard `IBackgroundTask`s with in-process overlap guards. Orchard scheduling/state semantics per `INTEGRATION_CONTRACTS.md`.

## Production storage decision (full-remediation audit §4.5)
- The docker-compose stack wires `AbrIT__SmsDatabase` to the Orchard
  PostgreSQL database, so the deployed CMS uses the durable
  `PostgresSmsOutboxStore`. The store creates its table/indexes lazily on
  first use (`EnsureSchemaOnceAsync`); a Production deployment that somehow
  falls back to `InMemorySmsOutboxStore` logs a loud startup warning.
- PRODUCTION OTP DELIVERY runs in the Next.js portal (SMS.ir + durable
  `SmsOutbox` table in `abrit_portal`), not in the CMS. CMS-local SMS flows
  are dev-facing; the legacy bridge refuses OTP delivery in Production and
  SMS.ir live sends require explicit provider authorization.

## Limitations
- In-memory stores (only when `AbrIT:SmsDatabase` is unset) are per-process;
  restart loses queued messages — hence the Production startup warning.
- Exactly-once third-party delivery not claimed; idempotency keys and ambiguity handling used.
- Daily cap, provider rate limiting, manual retry permission, delivery confirmation, and durable OTP challenge integration remain incomplete.
