using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Payments;


public sealed class InMemoryPaymentStore : IPaymentStore
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, PaymentAttemptRecord> _attempts = new();
    private readonly List<PaymentTransactionRecord> _tx = new();
    private readonly List<RefundAttemptRecord> _refunds = new();

    public Task<PaymentAttemptRecord> CreateAttemptAsync(PaymentAttemptRecord record, CancellationToken ct)
    {
        lock (_gate)
        {
            // prevent incompatible simultaneous active attempts for same order/provider context? simplified: allow multiple but app logic checks.
            if (record.AttemptId == Guid.Empty) record.AttemptId = Guid.NewGuid();
            record.CreatedUtc = record.UpdatedUtc = DateTimeOffset.UtcNow;
            _attempts[record.AttemptId] = Clone(record);
            return Task.FromResult(Clone(record));
        }
    }

    public Task<PaymentAttemptRecord?> GetAttemptAsync(string tenantId, Guid attemptId, CancellationToken ct)
    {
        lock (_gate)
            return Task.FromResult(_attempts.TryGetValue(attemptId, out var a) && a.TenantId == tenantId ? Clone(a) : null);
    }

    public Task<PaymentAttemptRecord?> GetByAuthorityAsync(string tenantId, string providerCode, string authority, CancellationToken ct)
    {
        lock (_gate)
        {
            var a = _attempts.Values.FirstOrDefault(x => x.TenantId == tenantId && x.ProviderCode == providerCode && string.Equals(x.GatewayAuthority, authority, StringComparison.Ordinal));
            return Task.FromResult(a is null ? null : Clone(a));
        }
    }

    public Task<bool> TryTransitionAsync(Guid attemptId, int expectedVersion, PaymentAttemptStatus from, PaymentAttemptStatus to, Action<PaymentAttemptRecord> mutate, CancellationToken ct)
    {
        lock (_gate)
        {
            if (!_attempts.TryGetValue(attemptId, out var current)) return Task.FromResult(false);
            if (current.Version != expectedVersion || current.Status != from) return Task.FromResult(false);
            if (!PaymentStateMachine.CanTransition(from, to)) return Task.FromResult(false);
            mutate(current);
            current.Status = to;
            current.Version++;
            current.UpdatedUtc = DateTimeOffset.UtcNow;
            return Task.FromResult(true);
        }
    }

    public Task AddTransactionAsync(PaymentTransactionRecord tx, CancellationToken ct)
    { lock (_gate) { _tx.Add(tx); } return Task.CompletedTask; }
    public Task<IReadOnlyList<PaymentAttemptRecord>> ListAsync(string tenantId, int take, CancellationToken ct)
    { lock (_gate) return Task.FromResult<IReadOnlyList<PaymentAttemptRecord>>(_attempts.Values.Where(x => x.TenantId == tenantId).OrderByDescending(x => x.CreatedUtc).Take(take).Select(Clone).ToList()); }
    public Task<IReadOnlyList<PaymentAttemptRecord>> ListPendingReconciliationAsync(string tenantId, DateTimeOffset asOfUtc, int take, CancellationToken ct)
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<PaymentAttemptRecord>>(_attempts.Values.Where(x => x.TenantId == tenantId && (x.Status == PaymentAttemptStatus.ReconciliationRequired || x.Status == PaymentAttemptStatus.Ambiguous || x.Status == PaymentAttemptStatus.Initiated) && (x.NextReconciliationUtc == null || x.NextReconciliationUtc <= asOfUtc)).Take(take).Select(Clone).ToList());
    }
    public Task AddRefundAsync(RefundAttemptRecord refund, CancellationToken ct)
    { lock (_gate) { _refunds.Add(refund); } return Task.CompletedTask; }

    private static PaymentAttemptRecord Clone(PaymentAttemptRecord r) => JsonSerializer.Deserialize<PaymentAttemptRecord>(JsonSerializer.Serialize(r))!;
}

