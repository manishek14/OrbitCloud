using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Payments;

public interface ISoapTransport
{
    Task<string> PostAsync(string url, string action, string soapEnvelope, CancellationToken ct);
}

public sealed class HttpSoapTransport(HttpClient http) : ISoapTransport
{
    public async Task<string> PostAsync(string url, string action, string soapEnvelope, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Content = new StringContent(soapEnvelope, Encoding.UTF8, "text/xml");
        if (!string.IsNullOrWhiteSpace(action)) req.Headers.Add("SOAPAction", action);
        using var res = await http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new HttpRequestException("SOAP HTTP " + (int)res.StatusCode);
        return body;
    }
}

public sealed class MellatPaymentProvider(IOptions<PaymentProviderOptions> options, ISoapTransport? soap, ILogger<MellatPaymentProvider> logger) : IPaymentProvider
{
    public const string ProviderCode = "mellat";
    public string Code => ProviderCode;
    public PaymentProviderCapabilities Capabilities => PaymentProviderCapabilities.Initiate | PaymentProviderCapabilities.Verify | PaymentProviderCapabilities.Settle | PaymentProviderCapabilities.Inquiry | PaymentProviderCapabilities.Reversal;
    public bool IsEnabled => options.Value.Mellat.Enabled && options.Value.Mellat.Environment != PaymentProviderEnvironment.Disabled && HasConfig();

    private bool HasConfig()
    {
        var m = options.Value.Mellat;
        return !string.IsNullOrWhiteSpace(m.TerminalId) && !string.IsNullOrWhiteSpace(m.UserName) && !string.IsNullOrWhiteSpace(m.UserPassword) && !string.IsNullOrWhiteSpace(m.WsdlUrl);
    }

    public Task<PaymentInitiationResult> InitiateAsync(PaymentInitiationRequest request, CancellationToken cancellationToken)
    {
        // Verified-contract implementation scaffold: Mellat requires SOAP bpPayRequest; live disabled until credentials & verified WSDL/contract.
        // Mock transport tests exercise parsing/state; real call only when enabled+configured.
        if (!IsEnabled) return Task.FromResult(new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null, "Mellat disabled or not configured", PaymentErrorCategory.Configuration, null));
        return Task.FromResult(new PaymentInitiationResult(false, PaymentAttemptStatus.Ambiguous, null, null, null, "Mellat live call not executed in this environment; use mock transport tests", PaymentErrorCategory.UnsupportedOperation, null));
    }

    public Task<PaymentVerificationResult> VerifyAsync(PaymentVerificationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled) return Task.FromResult(new PaymentVerificationResult(false, PaymentAttemptStatus.Failed, PaymentTransactionState.Failed, false, false, false, null, "Mellat disabled or not configured", PaymentErrorCategory.Configuration, null));
        return Task.FromResult(new PaymentVerificationResult(false, PaymentAttemptStatus.Ambiguous, PaymentTransactionState.None, true, false, true, null, "Mellat verify requires verified live contract/credentials", PaymentErrorCategory.UnsupportedOperation, null));
    }

    public Task<PaymentReconciliationResult> ReconcileAsync(PaymentReconciliationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled) return Task.FromResult(new PaymentReconciliationResult(false, PaymentAttemptStatus.ReconciliationRequired, PaymentTransactionState.None, true, "Mellat disabled", PaymentErrorCategory.Configuration, null));
        return Task.FromResult(new PaymentReconciliationResult(false, PaymentAttemptStatus.ReconciliationRequired, PaymentTransactionState.None, true, "Inquiry requires verified live contract/credentials", PaymentErrorCategory.UnsupportedOperation, null));
    }

    // Parsing helpers for verified composite responses (e.g. "0,token") used by mocked transport tests.
    public static (string Code, string? Token) ParsePayRequestResponse(string? returnValue)
    {
        if (string.IsNullOrWhiteSpace(returnValue)) return ("", null);
        var parts = returnValue.Split(',', 2);
        return (parts[0].Trim(), parts.Length > 1 ? parts[1].Trim() : null);
    }

    public static bool IsSuccessCode(string? code) => string.Equals(code, "0", StringComparison.Ordinal);
}
