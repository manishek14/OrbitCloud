namespace AbrITPortal.Payments;

public interface IPaymentStore
{
    Task<PaymentAttemptRecord> CreateAttemptAsync(PaymentAttemptRecord record, CancellationToken ct);
    Task<PaymentAttemptRecord?> GetAttemptAsync(string tenantId, Guid attemptId, CancellationToken ct);
    Task<PaymentAttemptRecord?> GetByAuthorityAsync(string tenantId, string providerCode, string authority, CancellationToken ct);
    Task<bool> TryTransitionAsync(Guid attemptId, int expectedVersion, PaymentAttemptStatus from, PaymentAttemptStatus to, Action<PaymentAttemptRecord> mutate, CancellationToken ct);
    Task AddTransactionAsync(PaymentTransactionRecord tx, CancellationToken ct);
    Task<IReadOnlyList<PaymentAttemptRecord>> ListAsync(string tenantId, int take, CancellationToken ct);
    Task<IReadOnlyList<PaymentAttemptRecord>> ListPendingReconciliationAsync(string tenantId, DateTimeOffset asOfUtc, int take, CancellationToken ct);
    Task AddRefundAsync(RefundAttemptRecord refund, CancellationToken ct);
}
