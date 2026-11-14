# BACKGROUND_JOBS

## Orchard Core 3.0.1 (verified)
- Native `IBackgroundTask` scheduling/management (Tools -> Background Tasks). Execution state in-memory per server; not DB-persisted; web-farm runs per server, session affinity for admin state pages; distributed lock feature required for true atomic cross-server exclusion. See `docs/INTEGRATION_CONTRACTS.md`.

## Registered tasks (`BackgroundJobs/AbrITBackgroundTasks.cs`)
| Task | Cron | Purpose |
|---|---|---|
| `SmsOutboxBackgroundTask` | `*/1 * * * *` | Claim/process pending SMS outbox batches (DB-atomic when Postgres store active) |
| `SmsLeaseRecoveryBackgroundTask` | `*/5 * * * *` | Recover stalled SMS worker leases |
| `PaymentReconciliationBackgroundTask` | `*/10 * * * *` | Reconcile pending/ambiguous payment attempts (mock-safe) |
| `OtpCleanupBackgroundTask` | `0 * * * *` | OTP cleanup (best-effort) |

## Concurrency & recovery
- In-process overlap guards per task key (minimum interval). Durable safety relies on DB atomic claims/leases (SMS outbox) and idempotent/optimistic payment transitions.
- Restart recovery: leases expire and are recovered; pending/retry/ambiguous records remain in DB stores.

## Multi-instance notes
- Without distributed lock, multiple servers may schedule same task; SMS claims use DB row locks (`SKIP LOCKED`) to avoid double-processing when shared Postgres store is used. Payment reconciliation is idempotent/transition-guarded.
- `IBackgroundTaskMonitor`/admin execution details are per-server/in-memory (native OC behavior).

## Admin
- Minimal `/Admin/AbrIT/Jobs` lists registered tasks/schedules; native Tools -> Background Tasks provides runtime controls/state per server.
