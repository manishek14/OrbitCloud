using System.Text.Json;
using Npgsql;
using AbrITPortal.Notifications;

namespace AbrITPortal.Notifications;

public sealed class PostgresSmsOutboxStore : ISmsOutboxStore
{
    private readonly string _connectionString;
    public PostgresSmsOutboxStore(string connectionString) => _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));

    public async Task EnsureSchemaAsync(CancellationToken ct)
    {
        const string sql = @"
CREATE TABLE IF NOT EXISTS abrit_sms_outbox (
    id uuid PRIMARY KEY,
    tenant_id text NOT NULL,
    provider_code text NOT NULL,
    recipient text NOT NULL,
    purpose int NOT NULL,
    template_key text NULL,
    parameters_json text NULL,
    message_preview text NULL,
    protected_payload text NULL,
    priority int NOT NULL,
    status int NOT NULL,
    idempotency_key text NOT NULL,
    attempt_count int NOT NULL DEFAULT 0,
    max_attempts int NOT NULL DEFAULT 8,
    created_utc timestamptz NOT NULL,
    next_attempt_utc timestamptz NULL,
    processing_lease_until_utc timestamptz NULL,
    processing_worker text NULL,
    expires_utc timestamptz NULL,
    submitted_utc timestamptz NULL,
    completed_utc timestamptz NULL,
    provider_message_id text NULL,
    provider_status text NULL,
    failure_category int NOT NULL DEFAULT 0,
    last_error text NULL,
    sanitized_metadata text NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_abrit_sms_outbox_idem ON abrit_sms_outbox(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS ix_abrit_sms_outbox_claim ON abrit_sms_outbox(tenant_id, status, next_attempt_utc, priority, created_utc);
CREATE INDEX IF NOT EXISTS ix_abrit_sms_outbox_lease ON abrit_sms_outbox(status, processing_lease_until_utc);";
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<SmsOutboxMessage?> EnqueueAsync(SmsOutboxMessage message, CancellationToken ct)
    {
        message.CreatedUtc = DateTimeOffset.UtcNow;
        message.NextAttemptUtc ??= message.CreatedUtc;
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        const string sql = @"INSERT INTO abrit_sms_outbox
(id,tenant_id,provider_code,recipient,purpose,template_key,parameters_json,message_preview,protected_payload,priority,status,idempotency_key,attempt_count,max_attempts,created_utc,next_attempt_utc,processing_lease_until_utc,processing_worker,expires_utc,submitted_utc,completed_utc,provider_message_id,provider_status,failure_category,last_error,sanitized_metadata)
VALUES (@id,@tenant,@provider,@recipient,@purpose,@template,@params,@preview,@prot,@priority,@status,@idem,@attempts,@max,@created,@next,@lease,@worker,@expires,@submitted,@completed,@pmid,@pstatus,@fcat,@lasterr,@meta)
ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id";
        await using var cmd = new NpgsqlCommand(sql, conn);
        Bind(cmd, message);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is Guid ? message : null;
    }

    public async Task<IReadOnlyList<SmsOutboxMessage>> ClaimBatchAsync(string tenantId, string workerId, int take, TimeSpan lease, DateTimeOffset now, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        // Atomic claim via CTE + SKIP LOCKED
        const string sql = @"
WITH cte AS (
  SELECT id FROM abrit_sms_outbox
  WHERE tenant_id=@tenant
    AND status IN (@pending,@retry)
    AND (next_attempt_utc IS NULL OR next_attempt_utc <= @now)
    AND (processing_lease_until_utc IS NULL OR processing_lease_until_utc <= @now)
    AND (expires_utc IS NULL OR expires_utc > @now)
  ORDER BY priority DESC, created_utc ASC
  LIMIT @take
  FOR UPDATE SKIP LOCKED
)
UPDATE abrit_sms_outbox o SET status=@processing, processing_worker=@worker, processing_lease_until_utc=@leaseUntil, attempt_count=o.attempt_count+1
FROM cte WHERE o.id=cte.id
RETURNING o.*;";
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        cmd.Parameters.AddWithValue("tenant", tenantId);
        cmd.Parameters.AddWithValue("pending", (int)SmsMessageStatus.Pending);
        cmd.Parameters.AddWithValue("retry", (int)SmsMessageStatus.RetryScheduled);
        cmd.Parameters.AddWithValue("processing", (int)SmsMessageStatus.Processing);
        cmd.Parameters.AddWithValue("now", now);
        cmd.Parameters.AddWithValue("take", take);
        cmd.Parameters.AddWithValue("worker", workerId);
        cmd.Parameters.AddWithValue("leaseUntil", now.Add(lease));
        var list = new List<SmsOutboxMessage>();
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct)) list.Add(Read(r));
        }
        await tx.CommitAsync(ct);
        return list;
    }

    public async Task MarkSubmittedAsync(Guid id, string? providerMessageId, string? status, string? metadata, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("UPDATE abrit_sms_outbox SET status=@s,provider_message_id=@pm,provider_status=@ps,sanitized_metadata=@m,submitted_utc=@u,processing_lease_until_utc=NULL,protected_payload=NULL WHERE id=@id", conn);
        cmd.Parameters.AddWithValue("s", (int)SmsMessageStatus.Submitted); cmd.Parameters.AddWithValue("pm", (object?)providerMessageId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("ps", (object?)status ?? DBNull.Value); cmd.Parameters.AddWithValue("m", (object?)metadata ?? DBNull.Value);
        cmd.Parameters.AddWithValue("u", DateTimeOffset.UtcNow); cmd.Parameters.AddWithValue("id", id);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task MarkRetryAsync(Guid id, SmsFailureCategory category, string? error, DateTimeOffset nextAttemptUtc, bool ambiguousSubmitted, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(ct);
        var st = ambiguousSubmitted ? SmsMessageStatus.Submitted : SmsMessageStatus.RetryScheduled;
        await using var cmd = new NpgsqlCommand("UPDATE abrit_sms_outbox SET status=@s,failure_category=@fc,last_error=@e,next_attempt_utc=@n,processing_lease_until_utc=NULL WHERE id=@id", conn);
        cmd.Parameters.AddWithValue("s", (int)st); cmd.Parameters.AddWithValue("fc", (int)category); cmd.Parameters.AddWithValue("e", (object?)error ?? DBNull.Value);
        cmd.Parameters.AddWithValue("n", nextAttemptUtc); cmd.Parameters.AddWithValue("id", id);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task MarkFailedAsync(Guid id, SmsFailureCategory category, string? error, bool deadLetter, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("UPDATE abrit_sms_outbox SET status=@s,failure_category=@fc,last_error=@e,completed_utc=@u,processing_lease_until_utc=NULL,protected_payload=NULL WHERE id=@id", conn);
        cmd.Parameters.AddWithValue("s", (int)(deadLetter ? SmsMessageStatus.DeadLetter : SmsMessageStatus.Failed));
        cmd.Parameters.AddWithValue("fc", (int)category); cmd.Parameters.AddWithValue("e", (object?)error ?? DBNull.Value);
        cmd.Parameters.AddWithValue("u", DateTimeOffset.UtcNow); cmd.Parameters.AddWithValue("id", id);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task MarkCancelledAsync(Guid id, string reason, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("UPDATE abrit_sms_outbox SET status=@s,last_error=@e,completed_utc=@u,processing_lease_until_utc=NULL,protected_payload=NULL WHERE id=@id", conn);
        cmd.Parameters.AddWithValue("s", (int)SmsMessageStatus.Cancelled); cmd.Parameters.AddWithValue("e", (object?)reason ?? DBNull.Value);
        cmd.Parameters.AddWithValue("u", DateTimeOffset.UtcNow); cmd.Parameters.AddWithValue("id", id);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task<int> RecoverExpiredLeasesAsync(DateTimeOffset now, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("UPDATE abrit_sms_outbox SET status=@retry,next_attempt_utc=@now,processing_lease_until_utc=NULL WHERE status=@proc AND processing_lease_until_utc<=@now", conn);
        cmd.Parameters.AddWithValue("retry", (int)SmsMessageStatus.RetryScheduled); cmd.Parameters.AddWithValue("proc", (int)SmsMessageStatus.Processing); cmd.Parameters.AddWithValue("now", now);
        return await cmd.ExecuteNonQueryAsync(ct);
    }
    public async Task<IReadOnlyList<SmsOutboxMessage>> ListAsync(string tenantId, int take, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT * FROM abrit_sms_outbox WHERE tenant_id=@t ORDER BY created_utc DESC LIMIT @take", conn);
        cmd.Parameters.AddWithValue("t", tenantId); cmd.Parameters.AddWithValue("take", take);
        var list = new List<SmsOutboxMessage>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(Read(r));
        return list;
    }

    private static void Bind(NpgsqlCommand cmd, SmsOutboxMessage m)
    {
        cmd.Parameters.AddWithValue("id", m.Id); cmd.Parameters.AddWithValue("tenant", m.TenantId); cmd.Parameters.AddWithValue("provider", m.ProviderCode);
        cmd.Parameters.AddWithValue("recipient", m.Recipient); cmd.Parameters.AddWithValue("purpose", (int)m.Purpose);
        cmd.Parameters.AddWithValue("template", (object?)m.TemplateKey ?? DBNull.Value); cmd.Parameters.AddWithValue("params", (object?)m.ParametersJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("preview", (object?)m.MessagePreview ?? DBNull.Value); cmd.Parameters.AddWithValue("prot", (object?)m.ProtectedPayload ?? DBNull.Value);
        cmd.Parameters.AddWithValue("priority", (int)m.Priority); cmd.Parameters.AddWithValue("status", (int)m.Status);
        cmd.Parameters.AddWithValue("idem", m.IdempotencyKey); cmd.Parameters.AddWithValue("attempts", m.AttemptCount); cmd.Parameters.AddWithValue("max", m.MaxAttempts);
        cmd.Parameters.AddWithValue("created", m.CreatedUtc); cmd.Parameters.AddWithValue("next", (object?)m.NextAttemptUtc ?? DBNull.Value);
        cmd.Parameters.AddWithValue("lease", (object?)m.ProcessingLeaseUntilUtc ?? DBNull.Value); cmd.Parameters.AddWithValue("worker", (object?)m.ProcessingWorker ?? DBNull.Value);
        cmd.Parameters.AddWithValue("expires", (object?)m.ExpiresUtc ?? DBNull.Value); cmd.Parameters.AddWithValue("submitted", (object?)m.SubmittedUtc ?? DBNull.Value);
        cmd.Parameters.AddWithValue("completed", (object?)m.CompletedUtc ?? DBNull.Value); cmd.Parameters.AddWithValue("pmid", (object?)m.ProviderMessageId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("pstatus", (object?)m.ProviderStatus ?? DBNull.Value); cmd.Parameters.AddWithValue("fcat", (int)m.FailureCategory);
        cmd.Parameters.AddWithValue("lasterr", (object?)m.LastError ?? DBNull.Value); cmd.Parameters.AddWithValue("meta", (object?)m.SanitizedMetadata ?? DBNull.Value);
    }
    private static SmsOutboxMessage Read(NpgsqlDataReader r) => new()
    {
        Id = r.GetGuid(r.GetOrdinal("id")), TenantId = r.GetString(r.GetOrdinal("tenant_id")), ProviderCode = r.GetString(r.GetOrdinal("provider_code")),
        Recipient = r.GetString(r.GetOrdinal("recipient")), Purpose = (SmsPurpose)r.GetInt32(r.GetOrdinal("purpose")),
        TemplateKey = r.IsDBNull(r.GetOrdinal("template_key")) ? null : r.GetString(r.GetOrdinal("template_key")),
        ParametersJson = r.IsDBNull(r.GetOrdinal("parameters_json")) ? null : r.GetString(r.GetOrdinal("parameters_json")),
        MessagePreview = r.IsDBNull(r.GetOrdinal("message_preview")) ? null : r.GetString(r.GetOrdinal("message_preview")),
        ProtectedPayload = r.IsDBNull(r.GetOrdinal("protected_payload")) ? null : r.GetString(r.GetOrdinal("protected_payload")),
        Priority = (SmsPriority)r.GetInt32(r.GetOrdinal("priority")), Status = (SmsMessageStatus)r.GetInt32(r.GetOrdinal("status")),
        IdempotencyKey = r.GetString(r.GetOrdinal("idempotency_key")), AttemptCount = r.GetInt32(r.GetOrdinal("attempt_count")),
        MaxAttempts = r.GetInt32(r.GetOrdinal("max_attempts")), CreatedUtc = r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("created_utc")),
        NextAttemptUtc = r.IsDBNull(r.GetOrdinal("next_attempt_utc")) ? null : r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("next_attempt_utc")),
        ProcessingLeaseUntilUtc = r.IsDBNull(r.GetOrdinal("processing_lease_until_utc")) ? null : r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("processing_lease_until_utc")),
        ProcessingWorker = r.IsDBNull(r.GetOrdinal("processing_worker")) ? null : r.GetString(r.GetOrdinal("processing_worker")),
        ExpiresUtc = r.IsDBNull(r.GetOrdinal("expires_utc")) ? null : r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("expires_utc")),
        SubmittedUtc = r.IsDBNull(r.GetOrdinal("submitted_utc")) ? null : r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("submitted_utc")),
        CompletedUtc = r.IsDBNull(r.GetOrdinal("completed_utc")) ? null : r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("completed_utc")),
        ProviderMessageId = r.IsDBNull(r.GetOrdinal("provider_message_id")) ? null : r.GetString(r.GetOrdinal("provider_message_id")),
        ProviderStatus = r.IsDBNull(r.GetOrdinal("provider_status")) ? null : r.GetString(r.GetOrdinal("provider_status")),
        FailureCategory = (SmsFailureCategory)r.GetInt32(r.GetOrdinal("failure_category")),
        LastError = r.IsDBNull(r.GetOrdinal("last_error")) ? null : r.GetString(r.GetOrdinal("last_error")),
        SanitizedMetadata = r.IsDBNull(r.GetOrdinal("sanitized_metadata")) ? null : r.GetString(r.GetOrdinal("sanitized_metadata")),
    };
}

