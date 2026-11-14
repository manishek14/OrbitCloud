using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Payments;

public sealed class MockPaymentProvider(IOptions<PaymentProviderOptions> options) : IPaymentProvider
{
    public const string ProviderCode = "mock";
    public string Code => ProviderCode;
    public PaymentProviderCapabilities Capabilities => PaymentProviderCapabilities.Initiate | PaymentProviderCapabilities.Verify | PaymentProviderCapabilities.Inquiry;
    public bool IsEnabled => options.Value.Mock.Enabled && options.Value.Mock.Environment != PaymentProviderEnvironment.Disabled;

    public Task<PaymentInitiationResult> InitiateAsync(PaymentInitiationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled) return Task.FromResult(Fail(PaymentAttemptStatus.Failed, PaymentErrorCategory.Configuration, "Mock provider disabled."));
        if (request.ProviderAmount.Amount <= 0) return Task.FromResult(Fail(PaymentAttemptStatus.Failed, PaymentErrorCategory.Validation, "Invalid amount."));
        var authority = "MOCK-AUTH-" + request.AttemptId.ToString("N");
        var redirect = (request.CallbackUrl ?? "") + (request.CallbackUrl?.Contains('?') == true ? "&" : "?") + "authority=" + Uri.EscapeDataString(authority) + "&status=OK&attemptId=" + request.AttemptId;
        return Task.FromResult(new PaymentInitiationResult(true, PaymentAttemptStatus.Initiated, redirect, "MOCK-REQ-" + request.AttemptId.ToString("N"), authority, "Mock initiated", PaymentErrorCategory.None, "{\"mock\":true}"));
    }

    public Task<PaymentVerificationResult> VerifyAsync(PaymentVerificationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled) return Task.FromResult(VFail(PaymentAttemptStatus.Failed, PaymentTransactionState.Failed, PaymentErrorCategory.Configuration, "Mock provider disabled."));
        var status = request.CallbackParameters != null && request.CallbackParameters.TryGetValue("status", out var s) ? s : "OK";
        if (string.Equals(status, "NOK", StringComparison.OrdinalIgnoreCase))
            return Task.FromResult(new PaymentVerificationResult(true, PaymentAttemptStatus.Declined, PaymentTransactionState.Failed, false, false, false, null, "Declined", PaymentErrorCategory.ProviderRejected, "{\"status\":\"NOK\"}"));
        if (string.Equals(status, "TIMEOUT", StringComparison.OrdinalIgnoreCase))
            return Task.FromResult(new PaymentVerificationResult(false, PaymentAttemptStatus.Ambiguous, PaymentTransactionState.None, false, false, true, null, "Timeout", PaymentErrorCategory.NetworkTimeout, "{\"status\":\"TIMEOUT\"}"));
        var reference = "MOCK-REF-" + (request.GatewayAuthority ?? request.AttemptId.ToString("N"));
        return Task.FromResult(new PaymentVerificationResult(true, PaymentAttemptStatus.Verified, PaymentTransactionState.Verified, false, false, false, reference, "Verified", PaymentErrorCategory.None, "{\"status\":\"OK\"}"));
    }

    public Task<PaymentReconciliationResult> ReconcileAsync(PaymentReconciliationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled) return Task.FromResult(new PaymentReconciliationResult(false, PaymentAttemptStatus.Ambiguous, PaymentTransactionState.None, true, "Disabled", PaymentErrorCategory.Configuration, null));
        return Task.FromResult(new PaymentReconciliationResult(true, PaymentAttemptStatus.Verified, PaymentTransactionState.Verified, false, "Reconciled", PaymentErrorCategory.None, "{\"reconciled\":true}"));
    }

    private static PaymentInitiationResult Fail(PaymentAttemptStatus status, PaymentErrorCategory cat, string msg) => new(false, status, null, null, null, msg, cat, null);
    private static PaymentVerificationResult VFail(PaymentAttemptStatus status, PaymentTransactionState tx, PaymentErrorCategory cat, string msg) => new(false, status, tx, false, false, cat==PaymentErrorCategory.Ambiguous || cat==PaymentErrorCategory.NetworkTimeout, null, msg, cat, null);
}
