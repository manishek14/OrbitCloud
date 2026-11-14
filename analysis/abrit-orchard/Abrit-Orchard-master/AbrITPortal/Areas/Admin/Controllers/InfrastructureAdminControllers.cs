using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OrchardCore.Admin;
using AbrITPortal.Payments;

namespace AbrITPortal.Areas.Admin.Controllers;

[Admin]
[Authorize(Roles = "Administrator")]
[Route("Admin/AbrIT/Payments")]
public sealed class PaymentsAdminController(IPaymentStore store, IPaymentProviderRegistry providers, PaymentReconciliationService recon) : Controller
{
    [HttpGet("")]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var items = await store.ListAsync("Default", 100, ct);
        ViewBag.Providers = providers.GetAll().Select(p => new ProviderVm(p.Code, p.IsEnabled, p.Capabilities.ToString())).ToList();
        return View("~/Areas/Admin/Views/Payments/Index.cshtml", items);
    }

    [HttpPost("Reconcile")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Reconcile(CancellationToken ct)
    {
        var n = await recon.ReconcilePendingAsync("Default", 50, ct);
        TempData["Success"] = $"Reconciled/processed: {n}";
        return RedirectToAction(nameof(Index));
    }
    public sealed record ProviderVm(string Code, bool Enabled, string Capabilities);
}

[Admin]
[Authorize(Roles = "Administrator")]
[Route("Admin/AbrIT/Sms")]
public sealed class SmsAdminController(AbrITPortal.Notifications.ISmsOutboxStore store, IEnumerable<AbrITPortal.Notifications.ISmsProviderV2> providers) : Controller
{
    [HttpGet("")]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var items = await store.ListAsync("Default", 100, ct);
        ViewBag.Providers = providers.Select(p => new { p.Code, p.IsEnabled }).ToList();
        return View("~/Areas/Admin/Views/Sms/Index.cshtml", items);
    }

    [HttpPost("RecoverLeases")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> RecoverLeases(CancellationToken ct)
    {
        var n = await store.RecoverExpiredLeasesAsync(DateTimeOffset.UtcNow, ct);
        TempData["Success"] = $"Recovered leases: {n}";
        return RedirectToAction(nameof(Index));
    }
}

[Admin]
[Authorize(Roles = "Administrator")]
[Route("Admin/AbrIT/Jobs")]
public sealed class JobsAdminController : Controller
{
    [HttpGet("")]
    public IActionResult Index()
    {
        var jobs = new[]
        {
            new JobVm("SmsOutboxBackgroundTask","*/1 * * * *","Process pending SMS outbox messages","در دسترس نیست","در دسترس نیست","ثبت‌شده؛ سابقه اجرا در این صفحه موجود نیست","در دسترس نیست"),
            new JobVm("SmsLeaseRecoveryBackgroundTask","*/5 * * * *","Recover stalled SMS worker leases","در دسترس نیست","در دسترس نیست","ثبت‌شده؛ سابقه اجرا در این صفحه موجود نیست","در دسترس نیست"),
            new JobVm("PaymentReconciliationBackgroundTask","*/10 * * * *","Reconcile pending/ambiguous payments","در دسترس نیست","در دسترس نیست","ثبت‌شده؛ سابقه اجرا در این صفحه موجود نیست","در دسترس نیست"),
            new JobVm("OtpCleanupBackgroundTask","0 * * * *","OTP cleanup (best-effort)","در دسترس نیست","در دسترس نیست","ثبت‌شده؛ سابقه اجرا در این صفحه موجود نیست","در دسترس نیست"),
        };
        return View("~/Areas/Admin/Views/Jobs/Index.cshtml", jobs);
    }
    public sealed record JobVm(string Name, string Schedule, string Description, string LastExecution, string NextExecution, string Status, string LastError);
}
