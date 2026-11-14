using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AbrITPortal.Payments;

public sealed class ZarinPalPaymentProvider : IPaymentProvider
{
    private readonly IOptions<PaymentProviderOptions> _options;
    private readonly IHttpJsonTransport? _transport;
    private readonly ILogger<ZarinPalPaymentProvider> _logger;
    private readonly IPaymentAmountConverter _amountConverter;

    public const string ProviderCode = "zarinpal";
    public string Code => ProviderCode;
    public PaymentProviderCapabilities Capabilities => PaymentProviderCapabilities.Initiate | PaymentProviderCapabilities.Verify | PaymentProviderCapabilities.Inquiry;

    public ZarinPalPaymentProvider(
        IOptions<PaymentProviderOptions> options,
        IHttpJsonTransport? transport,
        ILogger<ZarinPalPaymentProvider> logger,
        IPaymentAmountConverter amountConverter)
    {
        _options = options;
        _transport = transport;
        _logger = logger;
        _amountConverter = amountConverter;
    }

    // Merchant documentation has not confirmed the API amount unit for this account.
    // Keep the provider boundary visible but block transactions until verified.
    public bool IsEnabled => false;

    private bool HasConfig()
    {
        var z = _options.Value.ZarinPal;
        return !string.IsNullOrWhiteSpace(z.MerchantId);
    }

    public async Task<PaymentInitiationResult> InitiateAsync(PaymentInitiationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled)
            return new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null, 
                "ZarinPal disabled or not configured", PaymentErrorCategory.Configuration, null);

        var zarinpalOptions = _options.Value.ZarinPal;
        
        // Convert amount to provider format (ZarinPal expects Rial)
        var providerAmount = request.ProviderAmount;
        var rialAmount = ToRial(providerAmount);
        
        // Prepare request DTO
        var paymentRequest = new ZarinPalPaymentRequest
        {
            MerchantId = zarinpalOptions.MerchantId,
            Amount = rialAmount,
            CallbackUrl = request.CallbackUrl,
            Description = request.Description,
            Metadata = request.Metadata?.ToDictionary(kv => kv.Key, kv => kv.Value)
        };

        try
        {
            // Use sandbox URL if configured
            var requestUrl = zarinpalOptions.RequestUrl;
            if (string.IsNullOrEmpty(requestUrl))
            {
                requestUrl = zarinpalOptions.UseSandbox 
                    ? "https://sandbox.zarinpal.com/pg/v4/payment/request.json"
                    : "https://api.zarinpal.com/pg/v4/payment/request.json";
            }

            _logger.LogInformation("Initiating ZarinPal payment for reference {ReferenceId} with amount {Amount} Toman ({Rial} Rial)", 
                request.AttemptId, providerAmount.Amount, rialAmount);

            if (_transport == null)
            {
                return new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null,
                    "HTTP transport not available", PaymentErrorCategory.Configuration, null);
            }

            var (ok, statusCode, body) = await _transport.PostJsonAsync(requestUrl, paymentRequest, null, cancellationToken);
            
            if (!ok)
            {
                _logger.LogWarning("ZarinPal payment initiation failed with status {StatusCode}: {Body}", 
                    statusCode, body);
                return new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null,
                    $"HTTP {statusCode}: {SanitizeResponse(body)}", 
                    MapHttpErrorToCategory(statusCode), body);
            }

            var response = JsonSerializer.Deserialize<ZarinPalPaymentResponse>(body);
            if (response == null)
            {
                return new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null,
                    "Invalid response from ZarinPal", PaymentErrorCategory.ProviderRejected, body);
            }

            if (response.Data?.Code == 100 && !string.IsNullOrEmpty(response.Data.Authority))
            {
                var redirectUrl = zarinpalOptions.StartPayBaseUrl?.TrimEnd('/');
                if (string.IsNullOrEmpty(redirectUrl))
                {
                    redirectUrl = zarinpalOptions.UseSandbox
                        ? "https://sandbox.zarinpal.com/pg/StartPay/"
                        : "https://www.zarinpal.com/pg/StartPay/";
                }
                redirectUrl += response.Data.Authority;

                _logger.LogInformation("ZarinPal payment initiated successfully. Authority: {Authority}", 
                    response.Data.Authority);

                return new PaymentInitiationResult(true, PaymentAttemptStatus.Initiated, 
                    redirectUrl, response.Data.Authority, response.Data.Authority, null, PaymentErrorCategory.None, SanitizeResponse(body));
            }
            else
            {
                _logger.LogWarning("ZarinPal payment initiation rejected. Code: {Code}, Message: {Message}", 
                    response.Data?.Code, response.Data?.Message);
                return new PaymentInitiationResult(false, PaymentAttemptStatus.Declined, null, null, null,
                    $"ZarinPal error {response.Data?.Code}: {response.Data?.Message}", 
                    MapZarinPalErrorToCategory(response.Data?.Code ?? -1), SanitizeResponse(body));
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP request failed for ZarinPal payment initiation");
            return new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null,
                $"HTTP request failed: {ex.Message}", PaymentErrorCategory.NetworkTimeout, null);
        }
        catch (TaskCanceledException)
        {
            _logger.LogWarning("ZarinPal payment initiation timeout");
            return new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null,
                "Request timeout", PaymentErrorCategory.NetworkTimeout, null);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Failed to parse ZarinPal response");
            return new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null,
                $"Invalid response: {ex.Message}", PaymentErrorCategory.ProviderRejected, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error in ZarinPal payment initiation");
            return new PaymentInitiationResult(false, PaymentAttemptStatus.Failed, null, null, null,
                $"Unexpected error: {ex.Message}", PaymentErrorCategory.Unknown, null);
        }
    }

    public async Task<PaymentVerificationResult> VerifyAsync(PaymentVerificationRequest request, CancellationToken cancellationToken)
    {
        if (!IsEnabled)
            return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed, 
                PaymentTransactionState.Failed, false, false, false, null, 
                "ZarinPal disabled or not configured", PaymentErrorCategory.Configuration, null);

        var zarinpalOptions = _options.Value.ZarinPal;
        
        // Convert amount to provider format (ZarinPal expects Rial)
        var providerAmount = request.ProviderAmount;
        var rialAmount = ToRial(providerAmount);

        // Prepare verification DTO
        var verifyRequest = new ZarinPalVerifyRequest
        {
            MerchantId = zarinpalOptions.MerchantId,
            Amount = rialAmount,
            Authority = request.GatewayAuthority ?? string.Empty
        };

        try
        {
            // Use sandbox URL if configured
            var verifyUrl = zarinpalOptions.VerifyUrl;
            if (string.IsNullOrEmpty(verifyUrl))
            {
                verifyUrl = zarinpalOptions.UseSandbox
                    ? "https://sandbox.zarinpal.com/pg/v4/payment/verify.json"
                    : "https://api.zarinpal.com/pg/v4/payment/verify.json";
            }

            _logger.LogInformation("Verifying ZarinPal payment. Authority: {Authority}, Amount: {Amount} Toman ({Rial} Rial)", 
                request.GatewayAuthority, providerAmount.Amount, rialAmount);

            if (_transport == null)
            {
                return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed, 
                    PaymentTransactionState.Failed, false, false, false, null,
                    "HTTP transport not available", PaymentErrorCategory.Configuration, null);
            }

            var (ok, statusCode, body) = await _transport.PostJsonAsync(verifyUrl, verifyRequest, null, cancellationToken);
            
            if (!ok)
            {
                _logger.LogWarning("ZarinPal payment verification failed with status {StatusCode}: {Body}", 
                    statusCode, body);
                return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed, 
                    PaymentTransactionState.Failed, false, false, false, null,
                    $"HTTP {statusCode}: {SanitizeResponse(body)}", 
                    MapHttpErrorToCategory(statusCode), body);
            }

            var response = JsonSerializer.Deserialize<ZarinPalVerifyResponse>(body);
            if (response == null)
            {
                return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed, 
                    PaymentTransactionState.Failed, false, false, false, null,
                    "Invalid response from ZarinPal", PaymentErrorCategory.ProviderRejected, body);
            }

            if (response.Data?.Code == 100 || response.Data?.Code == 101)
            {
                // Code 100: Payment verified successfully
                // Code 101: Payment already verified
                var isAlreadyVerified = response.Data.Code == 101;
                
                _logger.LogInformation("ZarinPal payment verified successfully. RefId: {RefId}, IsAlreadyVerified: {IsAlreadyVerified}", 
                    response.Data.RefId, isAlreadyVerified);

                return new PaymentVerificationResult(true, PaymentAttemptStatus.Verified,
                    PaymentTransactionState.Verified, false, isAlreadyVerified, false,
                    response.Data.RefId?.ToString(), null, PaymentErrorCategory.None, SanitizeResponse(body));
            }
            else
            {
                _logger.LogWarning("ZarinPal payment verification failed. Code: {Code}, Message: {Message}", 
                    response.Data?.Code, response.Data?.Message);
                
                var transactionState = response.Data?.Code switch
                {
                    -51 => PaymentTransactionState.Failed, // Failed payment
                    -54 => PaymentTransactionState.Failed, // Authority not found
                    _ => PaymentTransactionState.Failed
                };

                return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed,
                    transactionState, false, false, false, null,
                    $"ZarinPal error {response.Data?.Code}: {response.Data?.Message}",
                    MapZarinPalErrorToCategory(response.Data?.Code ?? -1), SanitizeResponse(body));
            }
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP request failed for ZarinPal payment verification");
            return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed,
                PaymentTransactionState.Failed, false, false, false, null,
                $"HTTP request failed: {ex.Message}", PaymentErrorCategory.NetworkTimeout, null);
        }
        catch (TaskCanceledException)
        {
            _logger.LogWarning("ZarinPal payment verification timeout");
            return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed,
                PaymentTransactionState.Failed, false, false, false, null,
                "Request timeout", PaymentErrorCategory.NetworkTimeout, null);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Failed to parse ZarinPal verification response");
            return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed,
                PaymentTransactionState.Failed, false, false, false, null,
                $"Invalid response: {ex.Message}", PaymentErrorCategory.ProviderRejected, null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error in ZarinPal payment verification");
            return new PaymentVerificationResult(false, PaymentAttemptStatus.Failed,
                PaymentTransactionState.Failed, false, false, false, null,
                $"Unexpected error: {ex.Message}", PaymentErrorCategory.Unknown, null);
        }
    }

    public Task<PaymentReconciliationResult> ReconcileAsync(PaymentReconciliationRequest request, CancellationToken cancellationToken)
    {
        // ZarinPal doesn't have a specific reconciliation API in v4
        return Task.FromResult(new PaymentReconciliationResult(false, 
            PaymentAttemptStatus.ReconciliationRequired, 
            PaymentTransactionState.None, true, 
            "ZarinPal reconciliation requires manual process", 
            PaymentErrorCategory.UnsupportedOperation, null));
    }

    private string GetCallbackUrl(string callbackPath, string referenceId)
    {
        var baseUrl = _options.Value.CallbackBaseUrl?.TrimEnd('/') ?? "";
        if (string.IsNullOrEmpty(baseUrl))
        {
            // In production, this should be configured
            return $"/payments/callback/zarinpal?reference={referenceId}";
        }
        
        return $"{baseUrl}{callbackPath}?reference={referenceId}";
    }

    private PaymentErrorCategory MapHttpErrorToCategory(int statusCode)
    {
        return statusCode switch
        {
            400 => PaymentErrorCategory.Validation,
            401 or 403 => PaymentErrorCategory.Configuration,
            429 => PaymentErrorCategory.ProviderError,
            500 or 502 or 503 or 504 => PaymentErrorCategory.ProviderError,
            _ => PaymentErrorCategory.NetworkTimeout
        };
    }

    private PaymentErrorCategory MapZarinPalErrorToCategory(int errorCode)
    {
        return errorCode switch
        {
            -9 => PaymentErrorCategory.Validation,   // Invalid bank
            -10 => PaymentErrorCategory.Configuration, // Invalid IP or merchant
            -11 => PaymentErrorCategory.Validation,  // Invalid merchant
            -12 => PaymentErrorCategory.Validation,  // Invalid amount
            -15 => PaymentErrorCategory.Configuration, // User not active
            -16 => PaymentErrorCategory.Configuration, // Terminal not active
            -30 => PaymentErrorCategory.Validation,  // Allowable verification count exceeded
            -31 => PaymentErrorCategory.Validation,  // Invalid reference ID
            -32 => PaymentErrorCategory.Validation,  // Invalid data type
            -33 => PaymentErrorCategory.Validation,  // Invalid amount
            -34 => PaymentErrorCategory.Validation,  // Invalid transaction
            -35 => PaymentErrorCategory.Validation,  // Invalid split
            -40 => PaymentErrorCategory.Validation,  // Invalid extra params
            -50 => PaymentErrorCategory.Validation,  // Invalid operation
            -51 => PaymentErrorCategory.ProviderRejected, // Payment failed
            -52 => PaymentErrorCategory.ProviderRejected, // Payment has error
            -54 => PaymentErrorCategory.Validation,    // Authority not found
            _ => PaymentErrorCategory.ProviderRejected
        };
    }

    private static long ToRial(MoneyAmount amount)
    {
        if (amount.Amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount));
        var rial = amount.Currency.ToUpperInvariant() switch
        {
            "IRR" => amount.Amount,
            "IRT" => amount.Amount * 10m,
            _ => throw new ArgumentException("Unsupported payment currency.", nameof(amount))
        };
        if (rial != decimal.Truncate(rial)) throw new ArgumentException("Payment amount must be integral Rial.", nameof(amount));
        return checked((long)rial);
    }
    private string SanitizeResponse(string response)
    {
        // Remove any sensitive data from response for logging
        try
        {
            return response.Length > 500 ? response[..500] + "..." : response;
        }
        catch
        {
            return "[Response sanitization failed]";
        }
    }

    public static string? ExtractAuthorityFromBody(string json)
    {
        try 
        { 
            using var d = JsonDocument.Parse(json); 
            if (d.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object && data.TryGetProperty("authority", out var a)) 
                return a.GetString(); 
            if (d.RootElement.TryGetProperty("authority", out var a2)) 
                return a2.GetString(); 
        } 
        catch { }
        return null;
    }
}

// ZarinPal API DTOs
public sealed class ZarinPalPaymentRequest
{
    [JsonPropertyName("merchant_id")]
    public string MerchantId { get; set; } = string.Empty;

    [JsonPropertyName("amount")]
    public long Amount { get; set; }

    [JsonPropertyName("callback_url")]
    public string CallbackUrl { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;

    [JsonPropertyName("metadata")]
    public Dictionary<string, string>? Metadata { get; set; }
}

public sealed class ZarinPalPaymentResponse
{
    [JsonPropertyName("data")]
    public ZarinPalPaymentData? Data { get; set; }

    [JsonPropertyName("errors")]
    public Dictionary<string, string[]>? Errors { get; set; }
}

public sealed class ZarinPalPaymentData
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("authority")]
    public string? Authority { get; set; }

    [JsonPropertyName("fee_type")]
    public string? FeeType { get; set; }

    [JsonPropertyName("fee")]
    public long? Fee { get; set; }
}

public sealed class ZarinPalVerifyRequest
{
    [JsonPropertyName("merchant_id")]
    public string MerchantId { get; set; } = string.Empty;

    [JsonPropertyName("amount")]
    public long Amount { get; set; }

    [JsonPropertyName("authority")]
    public string Authority { get; set; } = string.Empty;
}

public sealed class ZarinPalVerifyResponse
{
    [JsonPropertyName("data")]
    public ZarinPalVerifyData? Data { get; set; }

    [JsonPropertyName("errors")]
    public Dictionary<string, string[]>? Errors { get; set; }
}

public sealed class ZarinPalVerifyData
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("ref_id")]
    public long? RefId { get; set; }

    [JsonPropertyName("card_pan")]
    public string? CardPan { get; set; }

    [JsonPropertyName("card_hash")]
    public string? CardHash { get; set; }

    [JsonPropertyName("fee_type")]
    public string? FeeType { get; set; }

    [JsonPropertyName("fee")]
    public long? Fee { get; set; }
}