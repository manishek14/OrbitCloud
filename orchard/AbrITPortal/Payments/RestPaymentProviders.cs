using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Payments;

public interface IHttpJsonTransport
{
    Task<(bool Ok, int StatusCode, string Body)> PostJsonAsync(string url, object payload, IDictionary<string, string>? headers, CancellationToken ct);
}

public sealed class HttpJsonTransport(HttpClient http) : IHttpJsonTransport
{
    public async Task<(bool Ok, int StatusCode, string Body)> PostJsonAsync(string url, object payload, IDictionary<string, string>? headers, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(payload) };
        if (headers != null) foreach (var kv in headers) req.Headers.TryAddWithoutValidation(kv.Key, kv.Value);
        using var res = await http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        return (res.IsSuccessStatusCode, (int)res.StatusCode, body);
    }
}



public sealed class ZibalPaymentProvider : IPaymentProvider
{
    private readonly IOptions<PaymentProviderOptions> _options;
    private readonly IHttpJsonTransport? _transport;
    private readonly ILogger<ZibalPaymentProvider> _logger;
    private readonly IPaymentAmountConverter _amountConverter;

    public const string ProviderCode = "zibal";
    public string Code => ProviderCode;
    public PaymentProviderCapabilities Capabilities => PaymentProviderCapabilities.Initiate | PaymentProviderCapabilities.Verify | PaymentProviderCapabilities.Inquiry;

    public ZibalPaymentProvider(
        IOptions<PaymentProviderOptions> options,
        IHttpJsonTransport? transport,
        ILogger<ZibalPaymentProvider> logger,
        IPaymentAmountConverter amountConverter)
    {
        _options = options;
        _transport = transport;
        _logger = logger;
        _amountConverter = amountConverter;
    }

    public bool IsEnabled => _options.Value.Zibal.Enabled && 
                           _options.Value.Zibal.Environment != PaymentProviderEnvironment.Disabled && 
                           HasConfig();

    private bool HasConfig()
    {
        var z = _options.Value.Zibal;
        return !string.IsNullOrWhiteSpace(z.MerchantId);
    }

    public Task<PaymentInitiationResult> InitiateAsync(PaymentInitiationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled) return Task.FromResult(new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null, "Zibal disabled or not configured", PaymentErrorCategory.Configuration, null));
        if (_options.Value.Zibal.Environment == PaymentProviderEnvironment.Live)
            return Task.FromResult(new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null, "Zibal live mode disabled pending verified credentials/tests", PaymentErrorCategory.Configuration, null));
        
        // Simple stub implementation for now
        return Task.FromResult(new PaymentInitiationResult(false, PaymentAttemptStatus.Ambiguous, null, null, null, 
            "Zibal sandbox implementation requires test merchant configuration", PaymentErrorCategory.UnsupportedOperation, null));
    }

    public Task<PaymentVerificationResult> VerifyAsync(PaymentVerificationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled) return Task.FromResult(new PaymentVerificationResult(false, PaymentAttemptStatus.Failed, PaymentTransactionState.Failed, false, false, false, null, "Zibal disabled or not configured", PaymentErrorCategory.Configuration, null));
        return Task.FromResult(new PaymentVerificationResult(false, PaymentAttemptStatus.Ambiguous, PaymentTransactionState.None, false, false, true, null, "Zibal verify requires test merchant configuration", PaymentErrorCategory.UnsupportedOperation, null));
    }

    public Task<PaymentReconciliationResult> ReconcileAsync(PaymentReconciliationRequest request, CancellationToken cancellationToken)
        => Task.FromResult(new PaymentReconciliationResult(false, PaymentAttemptStatus.ReconciliationRequired, PaymentTransactionState.None, true, "Zibal reconciliation requires test configuration", PaymentErrorCategory.UnsupportedOperation, null));
}
