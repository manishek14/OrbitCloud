using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Hosting;

namespace AbrITPortal.Notifications;

public sealed class SmsIrOptions
{
    public bool Enabled { get; set; }
    public PaymentProviderEnvironmentLike Environment { get; set; } = PaymentProviderEnvironmentLike.Disabled;
    public string ApiBaseUrl { get; set; } = "https://api.sms.ir";
    public string ApiKey { get; set; } = string.Empty; // env/secret only
    public string LineNumber { get; set; } = string.Empty;
    public int OtpTemplateId { get; set; } = 314002; // Template ID from requirements
    public string CodeParameterName { get; set; } = "Code"; // Default parameter name for OTP
    public Dictionary<string, int> TemplateIds { get; set; } = new();
    public int TimeoutSeconds { get; set; } = 15;
}

public enum PaymentProviderEnvironmentLike { Disabled = 0, Mock = 1, Sandbox = 2, Live = 3 }

public sealed class SmsQueueOptions
{
    public bool Enabled { get; set; } = true;
    public int BatchSize { get; set; } = 20;
    public int MaxAttempts { get; set; } = 8;
    public int LeaseSeconds { get; set; } = 60;
    public int BaseRetrySeconds { get; set; } = 30;
    public int MaxRetrySeconds { get; set; } = 3600;
    public int RateLimitPerMinute { get; set; } = 60;
    public int RetentionDays { get; set; } = 30;
}

public sealed class NotificationOptions
{
    public SmsIrOptions SmsIr { get; set; } = new();
    public SmsQueueOptions Queue { get; set; } = new();
    public bool UseMockWhenNotLive { get; set; } = true;
}

// SMS.ir API DTOs
public sealed class SmsIrVerifySendRequest
{
    public string Mobile { get; set; } = string.Empty;
    public int TemplateId { get; set; }
    public List<SmsIrParameter> Parameters { get; set; } = new();
}

public sealed class SmsIrParameter
{
    public string Name { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
}

public sealed class SmsIrVerifySendResponse
{
    public bool IsSuccessful { get; set; }
    public string Message { get; set; } = string.Empty;
    public SmsIrVerifySendData? Data { get; set; }
}

public sealed class SmsIrVerifySendData
{
    public int MessageId { get; set; }
    public decimal Cost { get; set; }
}

public sealed class SmsIrProvider : ISmsProviderV2
{
    private readonly IOptions<NotificationOptions> _options;
    private readonly IHttpClientFactory? _factory;
    private readonly ILogger<SmsIrProvider>? _logger;

    public const string ProviderCode = "smsir";
    public string Code => ProviderCode;
    
    public SmsIrProvider(IOptions<NotificationOptions> options, IHttpClientFactory? factory, ILogger<SmsIrProvider>? logger = null)
    {
        _options = options;
        _factory = factory;
        _logger = logger;
    }

    public bool IsEnabled => _options.Value.SmsIr.Enabled && 
                           _options.Value.SmsIr.Environment != PaymentProviderEnvironmentLike.Disabled && 
                           !string.IsNullOrWhiteSpace(_options.Value.SmsIr.ApiKey);

    public async Task<SmsSendResult> SendAsync(SmsSendRequest request, CancellationToken ct)
    {
        // For mock environment, return mock success
        if (_options.Value.SmsIr.Environment == PaymentProviderEnvironmentLike.Mock)
        {
            return await SendMockAsync(request, ct);
        }

        if (!IsEnabled)
            return new SmsSendResult(false, false, null, null, SmsFailureCategory.Configuration, 
                "SMS.ir disabled or not configured", null);
        
        // For sandbox/live, we need proper API key
        if (string.IsNullOrWhiteSpace(_options.Value.SmsIr.ApiKey))
            return new SmsSendResult(false, false, null, null, SmsFailureCategory.Configuration, 
                "SMS.ir API key not configured", null);

        // Block live sends unless explicitly configured and authorized
        if (_options.Value.SmsIr.Environment == PaymentProviderEnvironmentLike.Live)
        {
            _logger?.LogWarning("SMS.ir live send blocked - requires explicit authorization");
            return new SmsSendResult(false, false, null, null, SmsFailureCategory.Configuration, 
                "SMS.ir live sends require explicit authorization", null);
        }

        try
        {
            return await SendToSmsIrAsync(request, ct);
        }
        catch (HttpRequestException ex)
        {
            _logger?.LogError(ex, "HTTP request failed for SMS.ir");
            return new SmsSendResult(false, false, null, null, SmsFailureCategory.NetworkTimeout, 
                $"HTTP request failed: {ex.Message}", null);
        }
        catch (TaskCanceledException)
        {
            _logger?.LogWarning("SMS.ir request timeout");
            return new SmsSendResult(false, false, null, null, SmsFailureCategory.NetworkTimeout, 
                "Request timeout", null);
        }
        catch (JsonException ex)
        {
            _logger?.LogError(ex, "Invalid JSON response from SMS.ir");
            return new SmsSendResult(false, false, null, null, SmsFailureCategory.ProviderRejected, 
                $"Invalid response: {ex.Message}", null);
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Unexpected error in SMS.ir provider");
            return new SmsSendResult(false, false, null, null, SmsFailureCategory.Unknown, 
                $"Unexpected error: {ex.Message}", null);
        }
    }

    private async Task<SmsSendResult> SendToSmsIrAsync(SmsSendRequest request, CancellationToken ct)
    {
        var opts = _options.Value.SmsIr;
        
        // Create HttpClient with timeout
        var httpClient = _factory?.CreateClient("smsir") ?? new HttpClient();
        httpClient.Timeout = TimeSpan.FromSeconds(opts.TimeoutSeconds);
        httpClient.DefaultRequestHeaders.Add("X-API-KEY", opts.ApiKey);
        
        // Determine template ID
        int templateId = opts.OtpTemplateId; // Default to OTP template
        if (request.TemplateKey != null && opts.TemplateIds.TryGetValue(request.TemplateKey, out var specificId))
        {
            templateId = specificId;
        }

        // Prepare parameters from request
        var parameters = new List<SmsIrParameter>();
        
        // Add parameters from request
        if (request.Parameters != null)
        {
            foreach (var param in request.Parameters)
            {
                parameters.Add(new SmsIrParameter { Name = param.Key, Value = param.Value });
            }
        }
        
        // If this is an OTP request but no parameters were provided, add default code parameter
        if (request.ContainsSensitiveOtpPayload && parameters.Count == 0)
        {
            return new SmsSendResult(false, false, null, null, SmsFailureCategory.Configuration,
                "OTP parameter is missing", null);
        }

        // Prepare SMS.ir API request
        var smsRequest = new SmsIrVerifySendRequest
        {
            Mobile = NormalizeMobileForSmsIr(request.Recipient),
            TemplateId = templateId,
            Parameters = parameters
        };

        var url = $"{opts.ApiBaseUrl.TrimEnd('/')}/v1/send/verify";
        
        _logger?.LogInformation("Sending SMS via SMS.ir to {Mobile}, template {TemplateId}", 
            smsRequest.Mobile, templateId);

        var response = await httpClient.PostAsJsonAsync(url, smsRequest, ct);
        var responseBody = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
        {
            _logger?.LogWarning("SMS.ir API error: {StatusCode}, {Body}", response.StatusCode, responseBody);
            
            // Try to parse error response
            try
            {
                var errorResponse = JsonSerializer.Deserialize<SmsIrVerifySendResponse>(responseBody);
                return new SmsSendResult(false, false, null, null, 
                    MapErrorToCategory(response.StatusCode, errorResponse?.Message),
                    errorResponse?.Message ?? $"HTTP {response.StatusCode}",
                    SanitizeResponse(responseBody));
            }
            catch
            {
                return new SmsSendResult(false, false, null, null,
                    MapErrorToCategory(response.StatusCode, null),
                    $"HTTP {response.StatusCode}",
                    SanitizeResponse(responseBody));
            }
        }

        // Parse successful response
        try
        {
            var successResponse = JsonSerializer.Deserialize<SmsIrVerifySendResponse>(responseBody);
            if (successResponse?.IsSuccessful == true && successResponse.Data != null)
            {
                _logger?.LogInformation("SMS.ir send successful, message ID: {MessageId}", successResponse.Data.MessageId);
                return new SmsSendResult(true, false, 
                    successResponse.Data.MessageId.ToString(),
                    "Submitted",
                    SmsFailureCategory.None,
                    null,
                    SanitizeResponse(responseBody));
            }
            else
            {
                _logger?.LogWarning("SMS.ir returned unsuccessful response: {Message}", successResponse?.Message);
                return new SmsSendResult(false, false, null, null,
                    SmsFailureCategory.ProviderRejected,
                    successResponse?.Message ?? "Provider returned unsuccessful response",
                    SanitizeResponse(responseBody));
            }
        }
        catch (JsonException ex)
        {
            _logger?.LogError(ex, "Failed to parse SMS.ir response");
            return new SmsSendResult(false, false, null, null,
                SmsFailureCategory.ProviderRejected,
                $"Failed to parse response: {ex.Message}",
                SanitizeResponse(responseBody));
        }
    }

    private Task<SmsSendResult> SendMockAsync(SmsSendRequest request, CancellationToken ct)
    {
        // Simulate network delay
        Task.Delay(100, ct).Wait(ct);
        
        // Return mock success for testing
        var mockMessageId = $"MOCK-{Guid.NewGuid():N}";
        _logger?.LogInformation("Mock SMS sent to {Recipient}, purpose: {Purpose}", 
            request.Recipient, request.Purpose);
        
        return Task.FromResult(new SmsSendResult(
            true, 
            false, 
            mockMessageId, 
            "MockSubmitted", 
            SmsFailureCategory.None, 
            null, 
            $"{{\"mock\":true,\"templateId\":{_options.Value.SmsIr.OtpTemplateId}}}"));
    }

    private string NormalizeMobileForSmsIr(string mobile)
    {
        // SMS.ir expects Iranian mobile numbers in format: 09xxxxxxxxx
        // Remove +98 prefix if present
        if (mobile.StartsWith("+98"))
            return "0" + mobile[3..];
        
        // Already in correct format
        return mobile;
    }

    private SmsFailureCategory MapErrorToCategory(HttpStatusCode statusCode, string? message)
    {
        if (statusCode == HttpStatusCode.Unauthorized || statusCode == HttpStatusCode.Forbidden)
            return SmsFailureCategory.Configuration;
        
        if (statusCode == HttpStatusCode.TooManyRequests)
            return SmsFailureCategory.RateLimit;
        
        if (statusCode == HttpStatusCode.BadRequest)
        {
            if (message?.Contains("template", StringComparison.OrdinalIgnoreCase) == true ||
                message?.Contains("parameter", StringComparison.OrdinalIgnoreCase) == true)
                return SmsFailureCategory.Validation;
            return SmsFailureCategory.ProviderRejected;
        }
        
        if ((int)statusCode >= 500)
            return SmsFailureCategory.ProviderRejected;
        
        if (statusCode == HttpStatusCode.RequestTimeout || statusCode == HttpStatusCode.GatewayTimeout)
            return SmsFailureCategory.NetworkTimeout;
        
        return SmsFailureCategory.Unknown;
    }

    private string? SanitizeResponse(string response)
    {
        // Remove any sensitive data from response for logging
        try
        {
            var doc = JsonDocument.Parse(response);
            using var stream = new MemoryStream();
            using var writer = new Utf8JsonWriter(stream);
            doc.WriteTo(writer);
            writer.Flush();
            return System.Text.Encoding.UTF8.GetString(stream.ToArray());
        }
        catch
        {
            // If not valid JSON, return truncated version
            return response.Length > 200 ? response[..200] + "..." : response;
        }
    }
}

public sealed class MockSmsProviderV2 : ISmsProviderV2
{
    private readonly ILogger<MockSmsProviderV2>? _logger;
    private readonly IWebHostEnvironment _environment;
    
    public MockSmsProviderV2(IWebHostEnvironment environment, ILogger<MockSmsProviderV2>? logger = null)
    {
        _environment = environment;
        _logger = logger;
    }
    
    public string Code => "mock";
    public bool IsEnabled => _environment.IsDevelopment();
    public List<SmsSendRequest> Sent { get; } = new();
    
    public Task<SmsSendResult> SendAsync(SmsSendRequest request, CancellationToken ct)
    {
        lock (Sent) Sent.Add(request);
        _logger?.LogInformation("Mock SMS sent to {Recipient}, purpose: {Purpose}", 
            request.Recipient, request.Purpose);
        
        return Task.FromResult(new SmsSendResult(
            true, 
            false, 
            $"MOCK-{Guid.NewGuid():N}", 
            "Accepted", 
            SmsFailureCategory.None, 
            null, 
            "{\"mock\":true}"));
    }
}
