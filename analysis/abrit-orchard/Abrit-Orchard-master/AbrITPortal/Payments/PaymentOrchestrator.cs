using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Payments;

public interface IPaymentOrchestrator
{
    Task<(PaymentAttemptRecord Attempt, PaymentInitiationResult Result)> InitiateAsync(PaymentInitiationCommand command, CancellationToken ct);
}

public sealed record PaymentInitiationCommand(
    string TenantId,
    string OrderId,
    string ProviderCode,
    MoneyAmount PayableAmountFromSnapshot, // server-verified immutable snapshot amount
    string Description,
    string? CustomerMobile,
    bool IsRestrictedTestOrDevFixture = false);

public sealed class PaymentOrchestrator(
    IPaymentStore store,
    IPaymentProviderRegistry providers,
    IPaymentAmountConverter converter,
    IOptions<PaymentProviderOptions> options,
    ILogger<PaymentOrchestrator> logger) : IPaymentOrchestrator
{
    public async Task<(PaymentAttemptRecord Attempt, PaymentInitiationResult Result)> InitiateAsync(PaymentInitiationCommand command, CancellationToken ct)
    {
        if (options.Value.AllowPublicCheckout && !command.IsRestrictedTestOrDevFixture)
            throw new InvalidOperationException("Public checkout is disabled until M3 secure order lifecycle is complete.");

        var provider = providers.Get(command.ProviderCode) ?? throw new InvalidOperationException("Unknown payment provider.");
        if (!provider.IsEnabled || options.Value is { } o && o.GetType() != null && false) { }
        if (!provider.IsEnabled)
        {
            var failed = NewAttempt(command, provider.Code, command.PayableAmountFromSnapshot, command.PayableAmountFromSnapshot, PaymentAttemptStatus.Failed, PaymentErrorCategory.Configuration, "Provider disabled or misconfigured.");
            await store.CreateAttemptAsync(failed, ct);
            return (failed, new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null, "Provider disabled", PaymentErrorCategory.Configuration, null));
        }

        if (command.PayableAmountFromSnapshot.Amount <= 0)
            throw new ArgumentException("Payable amount must be positive.", nameof(command));

        var providerAmount = converter.ToProviderAmount(command.PayableAmountFromSnapshot, provider.Code);
        var attempt = NewAttempt(command, provider.Code, command.PayableAmountFromSnapshot, providerAmount, PaymentAttemptStatus.InitiationPending, PaymentErrorCategory.None, null);
        await store.CreateAttemptAsync(attempt, ct);

        var callbackBase = options.Value.CallbackBaseUrl?.TrimEnd('/') ?? string.Empty;
        var callbackUrl = callbackBase + "/payments/callback/" + provider.Code + "?attemptId=" + attempt.AttemptId + "&tenant=" + Uri.EscapeDataString(command.TenantId);
        var req = new PaymentInitiationRequest(command.TenantId, command.OrderId, attempt.AttemptId,
            command.PayableAmountFromSnapshot, providerAmount, callbackUrl, command.Description, command.CustomerMobile, null);

        PaymentInitiationResult result;
        try { result = await provider.InitiateAsync(req, ct); }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Payment initiation failed for {AttemptId}", attempt.AttemptId);
            result = new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null, "Initiation error", PaymentErrorCategory.ProviderError, null);
        }

        var target = result.Succeeded ? PaymentAttemptStatus.Initiated : (result.Status == PaymentAttemptStatus.Ambiguous ? PaymentAttemptStatus.Ambiguous : PaymentAttemptStatus.Failed);
        if (!PaymentStateMachine.CanTransition(PaymentAttemptStatus.InitiationPending, target)) target = PaymentAttemptStatus.Failed;
        var latest = (await store.GetAttemptAsync(command.TenantId, attempt.AttemptId, ct))!;
        await store.TryTransitionAsync(attempt.AttemptId, latest.Version, latest.Status, target, a =>
        {
            a.GatewayRequestId = result.GatewayRequestId;
            a.GatewayAuthority = result.GatewayAuthority;
            a.SanitizedResponseMetadata = result.SanitizedProviderData;
            a.ErrorCategory = result.ErrorCategory;
            a.LastError = result.ProviderMessage;
            if (target == PaymentAttemptStatus.Ambiguous) a.NextReconciliationUtc = DateTimeOffset.UtcNow.AddMinutes(5);
        }, ct);

        attempt = (await store.GetAttemptAsync(command.TenantId, attempt.AttemptId, ct))!;
        return (attempt, result);
    }

    private static PaymentAttemptRecord NewAttempt(PaymentInitiationCommand cmd, string provider, MoneyAmount original, MoneyAmount providerAmount, PaymentAttemptStatus status, PaymentErrorCategory err, string? msg) => new()
    {
        AttemptId = Guid.NewGuid(),
        TenantId = cmd.TenantId,
        OrderId = cmd.OrderId,
        ProviderCode = provider,
        OriginalAmount = original.Amount,
        OriginalCurrency = original.Currency,
        ProviderAmount = providerAmount.Amount,
        ProviderCurrency = providerAmount.Currency,
        Status = status,
        ErrorCategory = err,
        LastError = msg,
        IdempotencyKey = cmd.TenantId + ":" + cmd.OrderId + ":" + Guid.NewGuid().ToString("N")
    };
}
