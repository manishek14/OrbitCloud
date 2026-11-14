using System.Text.Json;
using Npgsql;

namespace AbrITPortal.Payments;

using System.Text.Json;
using Npgsql;


public sealed class PostgresPaymentStore : IPaymentStore
{
    private readonly string _connectionString;
    public PostgresPaymentStore(string connectionString) => _connectionString = connectionString ?? throw new ArgumentNullException(nameof(connectionString));

    public async Task EnsureSchemaAsync(CancellationToken ct)
    {
        const string sql = @"
CREATE TABLE IF NOT EXISTS abrit_payment_attempt (
    attempt_id uuid PRIMARY KEY,
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    provider_code text NOT NULL,
    gateway_request_id text NULL,
    gateway_authority text NULL,
    gateway_reference text NULL,
    original_amount numeric(18,0) NOT NULL,
    original_currency text NOT NULL,
    provider_amount numeric(18,0) NOT NULL,
    provider_currency text NOT NULL,
    status int NOT NULL,
    transaction_state int NOT NULL,
    created_utc timestamptz NOT NULL,
    updated_utc timestamptz NOT NULL,
    verified_utc timestamptz NULL,
    settled_utc timestamptz NULL,
    sanitized_response_metadata text NULL,
    error_category int NOT NULL,
    last_error text NULL,
    retry_count int NOT NULL DEFAULT 0,
    next_reconciliation_utc timestamptz NULL,
    version int NOT NULL DEFAULT 0,
    idempotency_key text NULL
);
CREATE INDEX IF NOT EXISTS ix_abrit_payment_attempt_tenant_order ON abrit_payment_attempt(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS ix_abrit_payment_attempt_status ON abrit_payment_attempt(tenant_id, status, next_reconciliation_utc);
CREATE UNIQUE INDEX IF NOT EXISTS ux_abrit_payment_attempt_provider_authority ON abrit_payment_attempt(tenant_id, provider_code, gateway_authority) WHERE gateway_authority IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_abrit_payment_attempt_provider_request ON abrit_payment_attempt(tenant_id, provider_code, gateway_request_id) WHERE gateway_request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS abrit_payment_transaction (
    transaction_id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL REFERENCES abrit_payment_attempt(attempt_id),
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    state int NOT NULL,
    amount numeric(18,0) NOT NULL,
    currency text NOT NULL,
    provider_reference text NULL,
    occurred_utc timestamptz NOT NULL,
    details text NULL
);
CREATE TABLE IF NOT EXISTS abrit_refund_attempt (
    refund_id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL REFERENCES abrit_payment_attempt(attempt_id),
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    amount numeric(18,0) NOT NULL,
    currency text NOT NULL,
    partial boolean NOT NULL,
    status int NOT NULL,
    reason text NOT NULL,
    requested_by text NOT NULL,
    requested_utc timestamptz NOT NULL,
    completed_utc timestamptz NULL,
    provider_reference text NULL,
    audit_details text NULL
);";
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<PaymentAttemptRecord> CreateAttemptAsync(PaymentAttemptRecord record, CancellationToken ct)
    {
        if (record.AttemptId == Guid.Empty) record.AttemptId = Guid.NewGuid();
        record.CreatedUtc = record.UpdatedUtc = DateTimeOffset.UtcNow;
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        const string sql = @"INSERT INTO abrit_payment_attempt
(attempt_id,tenant_id,order_id,provider_code,gateway_request_id,gateway_authority,gateway_reference,original_amount,original_currency,provider_amount,provider_currency,status,transaction_state,created_utc,updated_utc,verified_utc,settled_utc,sanitized_response_metadata,error_category,last_error,retry_count,next_reconciliation_utc,version,idempotency_key)
VALUES (@id,@tenant,@order,@provider,@gwreq,@gwauth,@gwref,@oamt,@ocur,@pamt,@pcur,@status,@tx,@created,@updated,@verified,@settled,@meta,@errcat,@lasterr,@retry,@next,@ver,@idem)";
        await using var cmd = new NpgsqlCommand(sql, conn);
        Bind(cmd, record);
        await cmd.ExecuteNonQueryAsync(ct);
        return record;
    }

    public async Task<PaymentAttemptRecord?> GetAttemptAsync(string tenantId, Guid attemptId, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT * FROM abrit_payment_attempt WHERE tenant_id=@t AND attempt_id=@id", conn);
        cmd.Parameters.AddWithValue("t", tenantId);
        cmd.Parameters.AddWithValue("id", attemptId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? Read(r) : null;
    }

    public async Task<bool> TryTransitionAsync(Guid attemptId, int expectedVersion, PaymentAttemptStatus from, PaymentAttemptStatus to, Action<PaymentAttemptRecord> mutate, CancellationToken ct)
    {
        var current = await GetByIdAsync(attemptId, ct);
        if (current is null || current.Version != expectedVersion || current.Status != from) return false;
        if (!PaymentStateMachine.CanTransition(from, to)) return false;
        mutate(current);
        current.Status = to;
        current.Version++;
        current.UpdatedUtc = DateTimeOffset.UtcNow;
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        const string sql = @"UPDATE abrit_payment_attempt SET
gateway_request_id=@gwreq,gateway_authority=@gwauth,gateway_reference=@gwref,status=@status,transaction_state=@tx,updated_utc=@updated,verified_utc=@verified,settled_utc=@settled,sanitized_response_metadata=@meta,error_category=@errcat,last_error=@lasterr,retry_count=@retry,next_reconciliation_utc=@next,version=@ver
WHERE attempt_id=@id AND version=@expected AND status=@from";
        await using var cmd = new NpgsqlCommand(sql, conn);
        Bind(cmd, current);
        cmd.Parameters.AddWithValue("expected", expectedVersion);
        cmd.Parameters.AddWithValue("from", (int)from);
        var n = await cmd.ExecuteNonQueryAsync(ct);
        return n == 1;
    }

    public async Task<PaymentAttemptRecord?> GetByIdAsync(Guid attemptId, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT * FROM abrit_payment_attempt WHERE attempt_id=@id", conn);
        cmd.Parameters.AddWithValue("id", attemptId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? Read(r) : null;
    }

    public async Task AddTransactionAsync(PaymentTransactionRecord tx, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(@"INSERT INTO abrit_payment_transaction(transaction_id,attempt_id,tenant_id,order_id,state,amount,currency,provider_reference,occurred_utc,details)
VALUES(@id,@aid,@t,@o,@s,@a,@c,@ref,@occ,@d)", conn);
        cmd.Parameters.AddWithValue("id", tx.TransactionId); cmd.Parameters.AddWithValue("aid", tx.AttemptId); cmd.Parameters.AddWithValue("t", tx.TenantId);
        cmd.Parameters.AddWithValue("o", tx.OrderId); cmd.Parameters.AddWithValue("s", (int)tx.State); cmd.Parameters.AddWithValue("a", tx.Amount);
        cmd.Parameters.AddWithValue("c", tx.Currency); cmd.Parameters.AddWithValue("ref", (object?)tx.ProviderReference ?? DBNull.Value);
        cmd.Parameters.AddWithValue("occ", tx.OccurredUtc); cmd.Parameters.AddWithValue("d", (object?)tx.Details ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static void Bind(NpgsqlCommand cmd, PaymentAttemptRecord r)
    {
        cmd.Parameters.AddWithValue("id", r.AttemptId); cmd.Parameters.AddWithValue("tenant", r.TenantId); cmd.Parameters.AddWithValue("order", r.OrderId);
        cmd.Parameters.AddWithValue("provider", r.ProviderCode); cmd.Parameters.AddWithValue("gwreq", (object?)r.GatewayRequestId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("gwauth", (object?)r.GatewayAuthority ?? DBNull.Value); cmd.Parameters.AddWithValue("gwref", (object?)r.GatewayReference ?? DBNull.Value);
        cmd.Parameters.AddWithValue("oamt", r.OriginalAmount); cmd.Parameters.AddWithValue("ocur", r.OriginalCurrency);
        cmd.Parameters.AddWithValue("pamt", r.ProviderAmount); cmd.Parameters.AddWithValue("pcur", r.ProviderCurrency);
        cmd.Parameters.AddWithValue("status", (int)r.Status); cmd.Parameters.AddWithValue("tx", (int)r.TransactionState);
        cmd.Parameters.AddWithValue("created", r.CreatedUtc); cmd.Parameters.AddWithValue("updated", r.UpdatedUtc);
        cmd.Parameters.AddWithValue("verified", (object?)r.VerifiedUtc ?? DBNull.Value); cmd.Parameters.AddWithValue("settled", (object?)r.SettledUtc ?? DBNull.Value);
        cmd.Parameters.AddWithValue("meta", (object?)r.SanitizedResponseMetadata ?? DBNull.Value); cmd.Parameters.AddWithValue("errcat", (int)r.ErrorCategory);
        cmd.Parameters.AddWithValue("lasterr", (object?)r.LastError ?? DBNull.Value); cmd.Parameters.AddWithValue("retry", r.RetryCount);
        cmd.Parameters.AddWithValue("next", (object?)r.NextReconciliationUtc ?? DBNull.Value); cmd.Parameters.AddWithValue("ver", r.Version);
        cmd.Parameters.AddWithValue("idem", (object?)r.IdempotencyKey ?? DBNull.Value);
    }

    private static PaymentAttemptRecord Read(NpgsqlDataReader r) => new()
    {
        AttemptId = r.GetGuid(r.GetOrdinal("attempt_id")),
        TenantId = r.GetString(r.GetOrdinal("tenant_id")),
        OrderId = r.GetString(r.GetOrdinal("order_id")),
        ProviderCode = r.GetString(r.GetOrdinal("provider_code")),
        GatewayRequestId = r.IsDBNull(r.GetOrdinal("gateway_request_id")) ? null : r.GetString(r.GetOrdinal("gateway_request_id")),
        GatewayAuthority = r.IsDBNull(r.GetOrdinal("gateway_authority")) ? null : r.GetString(r.GetOrdinal("gateway_authority")),
        GatewayReference = r.IsDBNull(r.GetOrdinal("gateway_reference")) ? null : r.GetString(r.GetOrdinal("gateway_reference")),
        OriginalAmount = r.GetDecimal(r.GetOrdinal("original_amount")),
        OriginalCurrency = r.GetString(r.GetOrdinal("original_currency")),
        ProviderAmount = r.GetDecimal(r.GetOrdinal("provider_amount")),
        ProviderCurrency = r.GetString(r.GetOrdinal("provider_currency")),
        Status = (PaymentAttemptStatus)r.GetInt32(r.GetOrdinal("status")),
        TransactionState = (PaymentTransactionState)r.GetInt32(r.GetOrdinal("transaction_state")),
        CreatedUtc = r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("created_utc")),
        UpdatedUtc = r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("updated_utc")),
        VerifiedUtc = r.IsDBNull(r.GetOrdinal("verified_utc")) ? null : r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("verified_utc")),
        SettledUtc = r.IsDBNull(r.GetOrdinal("settled_utc")) ? null : r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("settled_utc")),
        SanitizedResponseMetadata = r.IsDBNull(r.GetOrdinal("sanitized_response_metadata")) ? null : r.GetString(r.GetOrdinal("sanitized_response_metadata")),
        ErrorCategory = (PaymentErrorCategory)r.GetInt32(r.GetOrdinal("error_category")),
        LastError = r.IsDBNull(r.GetOrdinal("last_error")) ? null : r.GetString(r.GetOrdinal("last_error")),
        RetryCount = r.GetInt32(r.GetOrdinal("retry_count")),
        NextReconciliationUtc = r.IsDBNull(r.GetOrdinal("next_reconciliation_utc")) ? null : r.GetFieldValue<DateTimeOffset>(r.GetOrdinal("next_reconciliation_utc")),
        Version = r.GetInt32(r.GetOrdinal("version")),
        IdempotencyKey = r.IsDBNull(r.GetOrdinal("idempotency_key")) ? null : r.GetString(r.GetOrdinal("idempotency_key")),
    };

    public async Task<PaymentAttemptRecord?> GetByAuthorityAsync(string tenantId, string providerCode, string authority, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT * FROM abrit_payment_attempt WHERE tenant_id=@t AND provider_code=@p AND gateway_authority=@a", conn);
        cmd.Parameters.AddWithValue("t", tenantId);
        cmd.Parameters.AddWithValue("p", providerCode);
        cmd.Parameters.AddWithValue("a", authority);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? Read(r) : null;
    }

    public async Task<IReadOnlyList<PaymentAttemptRecord>> ListAsync(string tenantId, int take, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT * FROM abrit_payment_attempt WHERE tenant_id=@t ORDER BY created_utc DESC LIMIT @take", conn);
        cmd.Parameters.AddWithValue("t", tenantId);
        cmd.Parameters.AddWithValue("take", take);
        var list = new List<PaymentAttemptRecord>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(Read(r));
        return list;
    }

    public async Task<IReadOnlyList<PaymentAttemptRecord>> ListPendingReconciliationAsync(string tenantId, DateTimeOffset asOfUtc, int take, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(@"SELECT * FROM abrit_payment_attempt WHERE tenant_id=@t AND status IN (@amb,@recon,@init) AND (next_reconciliation_utc IS NULL OR next_reconciliation_utc <= @now) ORDER BY updated_utc ASC LIMIT @take", conn);
        cmd.Parameters.AddWithValue("t", tenantId);
        cmd.Parameters.AddWithValue("amb", (int)PaymentAttemptStatus.Ambiguous);
        cmd.Parameters.AddWithValue("recon", (int)PaymentAttemptStatus.ReconciliationRequired);
        cmd.Parameters.AddWithValue("init", (int)PaymentAttemptStatus.Initiated);
        cmd.Parameters.AddWithValue("now", asOfUtc);
        cmd.Parameters.AddWithValue("take", take);
        var list = new List<PaymentAttemptRecord>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(Read(r));
        return list;
    }

    public async Task AddRefundAsync(RefundAttemptRecord refund, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(@"INSERT INTO abrit_refund_attempt(refund_id,attempt_id,tenant_id,order_id,amount,currency,partial,status,reason,requested_by,requested_utc,completed_utc,provider_reference,audit_details)
VALUES(@id,@aid,@t,@o,@amt,@cur,@part,@st,@reason,@by,@req,@comp,@ref,@audit)", conn);
        cmd.Parameters.AddWithValue("id", refund.RefundId); cmd.Parameters.AddWithValue("aid", refund.AttemptId); cmd.Parameters.AddWithValue("t", refund.TenantId);
        cmd.Parameters.AddWithValue("o", refund.OrderId); cmd.Parameters.AddWithValue("amt", refund.Amount); cmd.Parameters.AddWithValue("cur", refund.Currency);
        cmd.Parameters.AddWithValue("part", refund.Partial); cmd.Parameters.AddWithValue("st", (int)refund.Status); cmd.Parameters.AddWithValue("reason", refund.Reason);
        cmd.Parameters.AddWithValue("by", refund.RequestedBy); cmd.Parameters.AddWithValue("req", refund.RequestedUtc);
        cmd.Parameters.AddWithValue("comp", (object?)refund.CompletedUtc ?? DBNull.Value); cmd.Parameters.AddWithValue("ref", (object?)refund.ProviderReference ?? DBNull.Value);
        cmd.Parameters.AddWithValue("audit", (object?)refund.AuditDetails ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}

