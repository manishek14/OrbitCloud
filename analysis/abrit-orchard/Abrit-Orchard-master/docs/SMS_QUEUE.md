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

## Limitations
- In-memory stores are per-process; Postgres store provides durability/multi-instance safety when wired to tenant DB.
- Exactly-once third-party delivery not claimed; idempotency keys and ambiguity handling used.
- The PostgreSQL store and processor exist but are not registered as the active production path. Daily cap, provider rate limiting, manual retry permission, delivery confirmation, and durable OTP challenge integration remain incomplete.
