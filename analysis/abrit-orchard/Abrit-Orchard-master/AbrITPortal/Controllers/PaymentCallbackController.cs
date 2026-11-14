using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using AbrITPortal.Payments;

namespace AbrITPortal.Controllers;

/// <summary>
/// External gateway callbacks are untrusted. No public checkout is enabled (M3 required).
/// This endpoint supports restricted/dev-mock verification flows and provider callbacks when explicitly configured.
/// </summary>
[ApiController]
[Route("payments/callback")]
public sealed class PaymentCallbackController(PaymentVerificationService verification, IPaymentStore store, ILogger<PaymentCallbackController> logger) : ControllerBase
{
    [HttpGet("{provider}")]
    [HttpPost("{provider}")]
    [AllowAnonymous]
    [IgnoreAntiforgeryToken] // external gateway callback; security via correlation+server-side verify+idempotency
    public async Task<IActionResult> Callback(string provider, [FromQuery] Guid attemptId, [FromQuery] string? tenant, CancellationToken ct)
    {
        var tenantId = string.IsNullOrWhiteSpace(tenant) ? "Default" : tenant;
        if (attemptId == Guid.Empty) return BadRequest("invalid attempt");

        // Collect callback parameters (query + form) - untrusted
        var parameters = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in Request.Query) parameters[kv.Key] = kv.Value.ToString();
        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync(ct);
            foreach (var kv in form) parameters[kv.Key] = kv.Value.ToString();
        }

        try
        {
            var attempt = await store.GetAttemptAsync(tenantId, attemptId, ct);
            if (attempt is null) return NotFound();
            if (!string.Equals(attempt.ProviderCode, provider, StringComparison.OrdinalIgnoreCase)) return BadRequest();

            var result = await verification.VerifyCallbackAsync(tenantId, attemptId, provider, parameters, ct);
            logger.LogInformation("Payment callback processed for attempt {AttemptId} provider {Provider} status {Status}", attemptId, provider, result.Status);
            // Never mark order paid/create services here based on callback alone; verification service performs server-side verify.
            return Ok(new { attemptId, provider, status = result.Status.ToString(), transactionState = result.TransactionState.ToString(), duplicate = result.IsDuplicate, ambiguous = result.IsAmbiguous });
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Payment callback handling failed for attempt {AttemptId}", attemptId);
            return StatusCode(500);
        }
    }
}
