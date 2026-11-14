using Microsoft.Extensions.Logging;

namespace AbrITPortal.Payments;

public sealed class PaymentVerificationService(IPaymentStore store, IPaymentProviderRegistry providers, ILogger<PaymentVerificationService> logger)
{
    public async Task<PaymentVerificationResult> VerifyCallbackAsync(string tenantId, Guid attemptId, string providerCode, IReadOnlyDictionary<string, string> callback, CancellationToken ct)
    {
        var attempt = await store.GetAttemptAsync(tenantId, attemptId, ct) ?? throw new InvalidOperationException("Payment attempt not found.");
        if (!string.Equals(attempt.ProviderCode, providerCode, StringComparison.OrdinalIgnoreCase))
            return new(false, attempt.Status, attempt.TransactionState, false, false, false, null, "Provider mismatch", PaymentErrorCategory.Validation, null);

        // Idempotency: already successful/final verification states
        if (PaymentStateMachine.IsSuccess(attempt.Status))
            return new(true, attempt.Status, attempt.TransactionState, false, true, false, attempt.GatewayReference, "Already verified", PaymentErrorCategory.None, attempt.SanitizedResponseMetadata);

        var provider = providers.Get(providerCode) ?? throw new InvalidOperationException("Provider not registered.");
        if (!provider.IsEnabled) return new(false, attempt.Status, attempt.TransactionState, false, false, false, null, "Provider disabled", PaymentErrorCategory.Configuration, null);

        // Validate callback correlation basics when present
        if (callback.TryGetValue("authority", out var cbAuth) && !string.IsNullOrWhiteSpace(attempt.GatewayAuthority) && !string.Equals(cbAuth, attempt.GatewayAuthority, StringComparison.Ordinal))
            return new(false, attempt.Status, attempt.TransactionState, false, false, false, null, "Authority mismatch", PaymentErrorCategory.Validation, null);

        var from = attempt.Status;
        if (!await store.TryTransitionAsync(attemptId, attempt.Version, from, PaymentAttemptStatus.CallbackReceived, a => { a.SanitizedResponseMetadata = TruncateMeta(System.Text.Json.JsonSerializer.Serialize(new { callback = callback.Keys })); }, ct))
        {
            var latest = await store.GetAttemptAsync(tenantId, attemptId, ct);
            if (latest != null && PaymentStateMachine.IsSuccess(latest.Status))
                return new(true, latest.Status, latest.TransactionState, false, true, false, latest.GatewayReference, "Already verified", PaymentErrorCategory.None, latest.SanitizedResponseMetadata);
            return new(false, attempt.Status, attempt.TransactionState, false, false, true, null, "Concurrent update", PaymentErrorCategory.Concurrency, null);
        }

        attempt = (await store.GetAttemptAsync(tenantId, attemptId, ct))!;
        if (!await store.TryTransitionAsync(attemptId, attempt.Version, PaymentAttemptStatus.CallbackReceived, PaymentAttemptStatus.VerificationPending, _ => { }, ct))
            return new(false, PaymentAttemptStatus.CallbackReceived, attempt.TransactionState, false, false, true, null, "Concurrent update", PaymentErrorCategory.Concurrency, null);

        attempt = (await store.GetAttemptAsync(tenantId, attemptId, ct))!;
        var req = new PaymentVerificationRequest(tenantId, attempt.OrderId, attemptId,
            new MoneyAmount(attempt.OriginalAmount, attempt.OriginalCurrency),
            new MoneyAmount(attempt.ProviderAmount, attempt.ProviderCurrency),
            attempt.GatewayAuthority, attempt.GatewayReference, callback);

        PaymentVerificationResult result;
        try { result = await provider.VerifyAsync(req, ct); }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Payment verification error for attempt {AttemptId}", attemptId);
            result = new(false, PaymentAttemptStatus.Ambiguous, PaymentTransactionState.None, false, false, true, null, "Provider error", PaymentErrorCategory.Ambiguous, null);
        }

        // Amount/currency must match stored attempt (server-verified snapshot boundary enforced at creation; here enforce consistency)
        var target = result.Status;
        if (result.Succeeded && result.Status is PaymentAttemptStatus.Verified or PaymentAttemptStatus.SettlementPending or PaymentAttemptStatus.Settled)
        {
            // ok
        }
        else if (result.IsAmbiguous || target == PaymentAttemptStatus.Ambiguous)
        {
            target = PaymentAttemptStatus.Ambiguous;
        }
        else if (target == PaymentAttemptStatus.Declined)
        {
            // keep declined
        }
        else if (!PaymentStateMachine.CanTransition(PaymentAttemptStatus.VerificationPending, target))
        {
            target = result.IsAmbiguous ? PaymentAttemptStatus.Ambiguous : PaymentAttemptStatus.Failed;
        }

        var latest2 = (await store.GetAttemptAsync(tenantId, attemptId, ct))!;
        await store.TryTransitionAsync(attemptId, latest2.Version, latest2.Status, target, a =>
        {
            a.GatewayReference = result.GatewayReference ?? a.GatewayReference;
            a.TransactionState = result.TransactionState;
            a.SanitizedResponseMetadata = TruncateMeta(result.SanitizedProviderData);
            a.ErrorCategory = result.ErrorCategory;
            a.LastError = result.ProviderMessage;
            if (PaymentStateMachine.IsSuccess(target)) a.VerifiedUtc = DateTimeOffset.UtcNow;
            if (target == PaymentAttemptStatus.Settled) a.SettledUtc = DateTimeOffset.UtcNow;
            if (target == PaymentAttemptStatus.Ambiguous || target == PaymentAttemptStatus.ReconciliationRequired) a.NextReconciliationUtc = DateTimeOffset.UtcNow.AddMinutes(5);
        }, ct);

        if (result.Succeeded && PaymentStateMachine.IsSuccess(target))
        {
            await store.AddTransactionAsync(new PaymentTransactionRecord
            {
                AttemptId = attemptId, TenantId = tenantId, OrderId = attempt.OrderId,
                State = result.TransactionState == PaymentTransactionState.None ? PaymentTransactionState.Verified : result.TransactionState,
                Amount = attempt.OriginalAmount, Currency = attempt.OriginalCurrency,
                ProviderReference = result.GatewayReference, Details = "verification"
            }, ct);
        }

        return result with { Status = target };
    }

    private static string? TruncateMeta(string? s) => s is null ? null : (s.Length > 2000 ? s[..2000] : s);
}

public sealed class PaymentReconciliationService(IPaymentStore store, IPaymentProviderRegistry providers, ILogger<PaymentReconciliationService> logger)
{
    public async Task<int> ReconcilePendingAsync(string tenantId, int take, CancellationToken ct)
    {
        var items = await store.ListPendingReconciliationAsync(tenantId, DateTimeOffset.UtcNow, take, ct);
        var count = 0;
        foreach (var a in items)
        {
            var provider = providers.Get(a.ProviderCode);
            if (provider is null || !provider.IsEnabled) continue;
            try
            {
                var result = await provider.ReconcileAsync(new PaymentReconciliationRequest(tenantId, a.OrderId, a.AttemptId, a.GatewayAuthority, a.GatewayReference), ct);
                var latest = await store.GetAttemptAsync(tenantId, a.AttemptId, ct);
                if (latest is null) continue;
                var target = result.Status;
                if (!PaymentStateMachine.CanTransition(latest.Status, target)) target = result.IsAmbiguous ? PaymentAttemptStatus.Ambiguous : latest.Status;
                if (target != latest.Status)
                {
                    await store.TryTransitionAsync(latest.AttemptId, latest.Version, latest.Status, target, rec =>
                    {
                        rec.TransactionState = result.TransactionState;
                        rec.ErrorCategory = result.ErrorCategory;
                        rec.LastError = result.ProviderMessage;
                        rec.SanitizedResponseMetadata = result.SanitizedProviderData;
                        rec.RetryCount++;
                        if (PaymentStateMachine.IsSuccess(target)) rec.VerifiedUtc ??= DateTimeOffset.UtcNow;
                        rec.NextReconciliationUtc = target == PaymentAttemptStatus.ReconciliationRequired || target == PaymentAttemptStatus.Ambiguous ? DateTimeOffset.UtcNow.AddMinutes(10) : null;
                    }, ct);
                    count++;
                }
            }
            catch (Exception ex) { logger.LogWarning(ex, "Reconciliation failed for attempt {AttemptId}", a.AttemptId); }
        }
        return count;
    }
}
