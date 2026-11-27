// ============================================================================
// Orbit business administration — REAL Orchard Core admin pages.
//
// These pages are part of the actual Orchard administration (/Admin/AbrIT/*)
// and read the CANONICAL business records (customers, orders, payments,
// subscriptions, Drive accounts, tickets, pricing catalog) from the Next.js
// commerce application through the documented server-to-server API
// (CommerceApiClient + ABRIT_SERVICE_TOKEN). There is no second database of
// business data inside Orchard.
//
// This controller REPLACES the previous two conflicting controllers
// (AbrITOperationsAdminController + OperationsHomeAdminController, which
// mapped identical routes → AmbiguousMatchException) and the in-memory-store
// backed Payments/Sms/Jobs admin controllers.
// ============================================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OrchardCore.Admin;
using AbrITPortal.Commercial;

namespace AbrITPortal.Areas.Admin.Controllers;

[Admin]
[Authorize(Roles = "Administrator")]
[Route("Admin/AbrIT")]
public sealed class AbrITBusinessAdminController(CommerceApiClient commerce, ILogger<AbrITBusinessAdminController> logger) : Controller
{
    private const string NotConfiguredMessage =
        "اتصال به سرویس تجاری Orbit پیکربندی نشده است (AbrIT:CommerceApi در appsettings). داده‌های مشتریان/سفارش‌ها از منبع کانونی (اپلیکیشن Next.js) خوانده می‌شوند.";

    private IActionResult NotConfigured() => View("Unavailable", new UnavailableViewModel
    {
        Title = "سرویس تجاری متصل نیست",
        Message = NotConfiguredMessage,
    });

    private IActionResult Failed(Exception ex)
    {
        logger.LogWarning(ex, "Commerce API call failed");
        return View("Unavailable", new UnavailableViewModel
        {
            Title = "خطا در دریافت داده‌ها",
            Message = "فراخوانی سرویس تجاری Orbit ناموفق بود؛ چند لحظه بعد دوباره تلاش کنید. جزئیات در لاگ سرور ثبت شد.",
        });
    }

    // ------------------------------------------------------------------ home

    [HttpGet("")]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try
        {
            var totals = await commerce.GetTotalsAsync(ct);
            return View("Index", totals);
        }
        catch (Exception ex) { return Failed(ex); }
    }

    // ------------------------------------------------------------- customers

    private const int CustomersPageSize = 25;

    [HttpGet("Customers")]
    public async Task<IActionResult> Customers(string? query, int page = 1, CancellationToken ct = default)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try
        {
            if (page < 1) page = 1;
            var result = await commerce.GetCustomersAsync(query, page, CustomersPageSize, ct);
            ViewBag.Query = query;
            return View("Customers", result);
        }
        catch (Exception ex) { return Failed(ex); }
    }

    [HttpGet("Customers/{id}")]
    public async Task<IActionResult> Customer(string id, CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try
        {
            var customer = await commerce.GetCustomerAsync(id, ct);
            if (customer is null) return NotFound();
            return View("Customer", customer);
        }
        catch (Exception ex) { return Failed(ex); }
    }

    // ---------------------------------------------------------------- orders

    [HttpGet("Orders")]
    public async Task<IActionResult> Orders(CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try { return View("Orders", await commerce.GetOrdersAsync(ct)); }
        catch (Exception ex) { return Failed(ex); }
    }

    // -------------------------------------------------------------- payments

    [HttpGet("Payments")]
    public async Task<IActionResult> Payments(CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try { return View("Payments", await commerce.GetTransactionsAsync(ct)); }
        catch (Exception ex) { return Failed(ex); }
    }

    // ---------------------------------------------------------- subscriptions

    [HttpGet("Subscriptions")]
    public async Task<IActionResult> Subscriptions(CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try { return View("Subscriptions", await commerce.GetSubscriptionsAsync(ct)); }
        catch (Exception ex) { return Failed(ex); }
    }

    // ------------------------------------------------------------------ drive

    [HttpGet("Drive")]
    public async Task<IActionResult> Drive(CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try { return View("Drive", await commerce.GetDriveAccountsAsync(ct)); }
        catch (Exception ex) { return Failed(ex); }
    }

    // ---------------------------------------------------------------- tickets

    [HttpGet("Tickets")]
    public async Task<IActionResult> Tickets(CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try { return View("Tickets", await commerce.GetTicketsAsync(ct)); }
        catch (Exception ex) { return Failed(ex); }
    }

    // ---------------------------------------------------------------- reports

    [HttpGet("Reports")]
    public async Task<IActionResult> Reports(CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try { return View("Reports", await commerce.GetReportAsync(ct)); }
        catch (Exception ex) { return Failed(ex); }
    }

    // ------------------------------------------------------------ plan catalog

    [HttpGet("Plans")]
    public async Task<IActionResult> Plans(CancellationToken ct)
    {
        if (!commerce.IsConfigured) return NotConfigured();
        try
        {
            var catalog = await commerce.GetCatalogAsync(ct);
            ViewBag.PricingNotice = TempData["PricingNotice"];
            ViewBag.PricingError = TempData["PricingError"];
            return View("Plans", catalog);
        }
        catch (Exception ex) { return Failed(ex); }
    }

    [HttpPost("Plans/SavePlan")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SavePlan([FromForm] PlanPricingForm form, CancellationToken ct)
    {
        try
        {
            if (form.DriveStorageGb < 0) throw new ArgumentException("فضای Drive معتبر نیست.");
            var payload = new {
                form.Code, form.NameFa, form.NameEn, form.AudienceFa, form.Order,
                form.Orderable, form.MonthlyPriceToman, form.IncludedUsers, form.IncludedEndpoints,
                form.IncludedServers, form.IncludedSites, form.IncludedNetworkDevices,
                driveQuotaBytes = checked((long)decimal.Round(form.DriveStorageGb * 1073741824m, 0, MidpointRounding.AwayFromZero)),
                form.ExtraUserFeeTomanPerMonth, form.ExtraEndpointFeeTomanPerMonth,
                form.SlaLabelFa, form.SlaDetailFa, form.SupportHoursFa,
                benefitsFa = (form.BenefitsFa ?? "").Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries),
                form.Featured, vpsFa = string.IsNullOrWhiteSpace(form.VpsFa) ? null : form.VpsFa,
                form.OnSiteFa
            };
            await commerce.SendPricingAsync("plans", form.IsNew ? null : form.Code,
                form.IsNew ? HttpMethod.Post : HttpMethod.Put,
                form.IsNew ? new { payload } : new { revision = form.Revision, payload }, ct);
            TempData["PricingNotice"] = "پکیج با موفقیت ذخیره شد.";
        }
        catch (Exception ex) when (ex is CommerceApiException or ArgumentException or OverflowException)
        { TempData["PricingError"] = ex.Message; }
        return RedirectToAction(nameof(Plans));
    }

    [HttpPost("Plans/SaveContract")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> SaveContract([FromForm] ContractPricingForm form, CancellationToken ct)
    {
        try
        {
            var payload = new {
                form.Months, discountRate = (double)(form.DiscountPercent / 100m),
                onboardingRate = (double)(form.OnboardingPercent / 100m),
                form.LabelFa, form.DiscountLabelFa, form.OnboardingLabelFa,
                form.NoteFa, form.RequiresBusinessApproval
            };
            await commerce.SendPricingAsync("contracts", form.IsNew ? null : form.Months.ToString(),
                form.IsNew ? HttpMethod.Post : HttpMethod.Put,
                form.IsNew ? new { payload } : new { revision = form.Revision, payload }, ct);
            TempData["PricingNotice"] = "شرایط قرارداد با موفقیت ذخیره شد.";
        }
        catch (CommerceApiException ex) { TempData["PricingError"] = ex.Message; }
        return RedirectToAction(nameof(Plans));
    }

    [HttpPost("Plans/ChangeStatus")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ChangePricingStatus(string kind, string id, int revision, bool active, CancellationToken ct)
    {
        try
        {
            if (kind is not ("plans" or "contracts")) return BadRequest();
            await commerce.SendPricingAsync(kind, id, HttpMethod.Put, new { revision, active }, ct);
            TempData["PricingNotice"] = active ? "رکورد فعال شد." : "رکورد غیرفعال شد.";
        }
        catch (CommerceApiException ex) { TempData["PricingError"] = ex.Message; }
        return RedirectToAction(nameof(Plans));
    }

    [HttpPost("Plans/DeletePricing")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> DeletePricing(string kind, string id, int revision, CancellationToken ct)
    {
        try
        {
            if (kind is not ("plans" or "contracts")) return BadRequest();
            await commerce.SendPricingAsync(kind, id, HttpMethod.Delete, new { revision }, ct);
            TempData["PricingNotice"] = "رکورد بدون وابستگی حذف شد.";
        }
        catch (CommerceApiException ex) { TempData["PricingError"] = ex.Message; }
        return RedirectToAction(nameof(Plans));
    }

    // --------------------------------------------------------------- settings

    [HttpGet("Settings")]
    public IActionResult Settings() => View("Settings");
}

public sealed record UnavailableViewModel
{
    public string Title { get; init; } = "";
    public string Message { get; init; } = "";
}

public sealed class PlanPricingForm
{
    public bool IsNew { get; set; }
    public int Revision { get; set; }
    public string Code { get; set; } = "";
    public string NameFa { get; set; } = "";
    public string NameEn { get; set; } = "";
    public string AudienceFa { get; set; } = "";
    public int Order { get; set; }
    public bool Orderable { get; set; } = true;
    public long MonthlyPriceToman { get; set; }
    public int IncludedUsers { get; set; }
    public int IncludedEndpoints { get; set; }
    public int IncludedServers { get; set; }
    public int IncludedSites { get; set; }
    public int IncludedNetworkDevices { get; set; }
    public decimal DriveStorageGb { get; set; }
    public long ExtraUserFeeTomanPerMonth { get; set; }
    public long ExtraEndpointFeeTomanPerMonth { get; set; }
    public string SlaLabelFa { get; set; } = "";
    public string SlaDetailFa { get; set; } = "";
    public string SupportHoursFa { get; set; } = "";
    public string BenefitsFa { get; set; } = "";
    public bool Featured { get; set; }
    public string? VpsFa { get; set; }
    public string OnSiteFa { get; set; } = "";
}

public sealed class ContractPricingForm
{
    public bool IsNew { get; set; }
    public int Revision { get; set; }
    public int Months { get; set; }
    public decimal DiscountPercent { get; set; }
    public decimal OnboardingPercent { get; set; }
    public string LabelFa { get; set; } = "";
    public string DiscountLabelFa { get; set; } = "";
    public string OnboardingLabelFa { get; set; } = "";
    public string? NoteFa { get; set; }
    public bool RequiresBusinessApproval { get; set; }
}
