using System.Globalization;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Web;
using AbrITPortal.Pages;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AbrITPortal.Drive;

/// <summary>
/// Customer-facing AbrIT Drive page. Every state is honest: when the integration is
/// not configured the page says so, when provisioning fails it says so. Anonymous
/// users are rejected by [Authorize]; the provision action is a POST protected by
/// the Orchard antiforgery token.
/// </summary>
[Authorize]
[Route("drive")]
public sealed class DriveController(DriveStatusService drive, IAntiforgery antiforgery) : Controller
{
    [HttpGet("")]
    [Authorize]
    public async Task<IActionResult> Index()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Forbid();
        var status = await drive.GetStatusAsync(userId, HttpContext.RequestAborted);
        var token = antiforgery.GetAndStoreTokens(HttpContext).RequestToken;
        return Content(PortalShell.Render("AbrIT Drive", "drive", true, User.Identity?.Name, token,
            Body(status, HttpUtility.ParseQueryString(Request.QueryString.Value ?? ""), token)), "text/html; charset=utf-8");
    }

    [HttpPost("provision")]
    [Authorize]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Provision()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Forbid();
        var result = await drive.EnsureFolderAsync(userId, HttpContext.RequestAborted);
        return result.State switch
        {
            DriveState.Ready => RedirectToAction(nameof(Index), new { provisioned = "1" }),
            DriveState.NotConfigured => RedirectToAction(nameof(Index), new { error = "not-configured" }),
            _ => RedirectToAction(nameof(Index), new { error = "unreachable" })
        };
    }

    private static string Body(DriveStatus status, System.Collections.Specialized.NameValueCollection query, string? token)
    {
        var body = new StringBuilder();
        body.Append("<div class='page-heading'><div><span class='eyebrow'>AbrIT Drive</span><h1>فضای ابری من</h1>")
            .Append("<p>وضعیت فضای ذخیره‌سازی اختصاصی حساب شما در سرویس Drive.</p></div></div>");

        if (query["provisioned"] == "1")
            body.Append("<div class='portal-alert portal-alert--success' role='status'><span>فضای AbrIT Drive شما با موفقیت آماده شد.</span></div>");
        else if (query["error"] == "not-configured")
            body.Append("<div class='portal-alert portal-alert--warning' role='alert'><span>AbrIT Drive هنوز برای این محیط پیکربندی نشده است.</span></div>");
        else if (query["error"] == "unreachable")
            body.Append("<div class='portal-alert portal-alert--danger' role='alert'><span>فعال‌سازی فضا انجام نشد؛ لطفاً بعداً دوباره تلاش کنید.</span></div>");

        switch (status.State)
        {
            case DriveState.Ready:
                body.Append("<section class='panel quota-panel'><div class='panel__header'><h2>فضای ذخیره‌سازی</h2>")
                    .Append("<span class='status-badge status-badge--success'>متصل</span></div><div class='panel__body'>")
                    .Append("<div class='quota-figure'><strong class='quota-figure__value'>").Append(DriveViews.Bytes(status.UsedBytes))
                    .Append("</strong><span class='quota-figure__of'>از ").Append(DriveViews.Bytes(status.TotalBytes)).Append("</span></div>");
                if (status.TotalBytes is > 0)
                    body.Append(DriveViews.QuotaBar(status.UsedBytes, status.TotalBytes));
                body.Append("<dl class='details-list'><div><dt>وضعیت فضا</dt><dd><span class='status-badge status-badge--success'>آماده استفاده</span></dd></div>")
                    .Append("<div><dt>مدیریت فایل‌ها</dt><dd>از طریق کلاینت‌های AbrIT Drive (Nextcloud) روی رایانه و گوشی شما</dd></div></dl>")
                    .Append("<div class='portal-alert'><span>امکان آپلود مستقیم از پرتال در دست توسعه است؛ فایل‌های این فضا فقط از طریق حساب Drive شما قابل دسترسی‌اند.</span></div>")
                    .Append("</div></section>");
                break;
            case DriveState.Missing:
                body.Append("<section class='panel'><div class='panel__header'><h2>فضای شما هنوز فعال نشده است</h2>")
                    .Append("<span class='status-badge status-badge--warning'>در انتظار فعال‌سازی</span></div><div class='panel__body'>")
                    .Append("<p>با یک کلیک فضای اختصاصی Drive خود را روی سرور ایجاد کنید. این کار فقط ساخت پوشه اختصاصی شماست و هیچ فایلی جابه‌جا نمی‌شود.</p>")
                    .Append("<form method='post' action='/drive/provision' class='drive-provision'>")
                    .Append("<input type='hidden' name='__RequestVerificationToken' value='").Append(DriveViews.E(token ?? "")).Append("'>")
                    .Append("<button type='submit' class='portal-button portal-button--primary'>فعال‌سازی فضای من</button></form>")
                    .Append("</div></section>");
                break;
            case DriveState.NotConfigured:
                body.Append("<section class='panel'><div class='panel__header'><h2>اتصال برقرار نیست</h2>")
                    .Append("<span class='status-badge'>متصل نیست</span></div><div class='panel__body'>")
                    .Append("<p>AbrIT Drive برای این محیط فعال نشده است. پس از پیکربندی سرور Drive توسط مدیر پرتال، وضعیت فضای شما در همین صفحه نمایش داده می‌شود.</p>")
                    .Append("</div></section>");
                break;
            default:
                body.Append("<section class='panel'><div class='panel__header'><h2>اتصال برقرار نشد</h2>")
                    .Append("<span class='status-badge status-badge--danger'>در دسترس نیست</span></div><div class='panel__body'>")
                    .Append("<p>").Append(DriveViews.E(status.Detail ?? "سرور Drive موقتاً در دسترس نیست.")).Append("</p>")
                    .Append("<p class='text-muted'>وضعیت هر یک دقیقه بازبینی می‌شود؛ چند لحظه بعد صفحه را دوباره باز کنید.</p>")
                    .Append("</div></section>");
                break;
        }
        return body.ToString();
    }
}

/// <summary>Shared rendering helpers for Drive status surfaces (page, dashboard card).</summary>
public static class DriveViews
{
    public static string E(string? text) => WebUtility.HtmlEncode(text ?? "");

    /// <summary>Human-readable byte size with Persian digits, e.g. "۲٫۳ گیگابایت".</summary>
    public static string Bytes(long? value)
    {
        if (value is null) return "—";
        var absolute = Math.Abs(value.Value);
        var culture = CultureInfo.GetCultureInfo("fa-IR");
        return (absolute switch
        {
            >= 1L << 30 => value.Value / (double)(1L << 30) + " گیگابایت",
            >= 1L << 20 => value.Value / (double)(1L << 20) + " مگابایت",
            >= 1L << 10 => value.Value / (double)(1L << 10) + " کیلوبایت",
            _ => value.Value + " بایت"
        }).Replace("Infinity", "∞");
    }

    /// <summary>Quota progress bar with an accessible label; percentages never exceed the track.</summary>
    public static string QuotaBar(long? used, long? total)
    {
        if (used is null || total is null || total <= 0) return "";
        var percent = Math.Clamp((int)Math.Round(used.Value * 100.0 / total.Value), 0, 100);
        var culture = CultureInfo.GetCultureInfo("fa-IR");
        return "<div class='quota-bar' role='img' aria-label='" + percent.ToString(culture) + " درصد پر شده'>"
            + "<div class='quota-bar__fill" + (percent >= 90 ? " quota-bar__fill--full" : "") + "' style='width:" + percent + "%'></div></div>"
            + "<span class='quota-bar__label'>" + percent.ToString(culture) + "٪ پر شده</span>";
    }

    /// <summary>The dashboard Drive card; real status only, honest fallbacks otherwise.</summary>
    public static string Card(DriveStatus status, string? antiforgeryToken)
    {
        var card = new StringBuilder();
        card.Append("<section class='panel'><div class='drive-card drive-card--").Append(status.State switch
        {
            DriveState.Ready => "ready",
            DriveState.Missing => "missing",
            DriveState.Unreachable => "warn",
            _ => "off"
        }).Append("'><span class='drive-card__icon' aria-hidden='true'>")
            .Append("<svg width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M7 18a4 4 0 01-.6-7.95A5.5 5.5 0 0117.2 9.6 3.75 3.75 0 0116.75 17H7z' stroke='currentColor' stroke-width='1.8' stroke-linejoin='round'/></svg>")
            .Append("</span><div class='drive-card__body'><span class='eyebrow'>AbrIT Drive</span><h2>فضای ابری شما</h2>");
        switch (status.State)
        {
            case DriveState.Ready:
                card.Append("<p>").Append(Bytes(status.UsedBytes)).Append(" از ").Append(Bytes(status.TotalBytes))
                    .Append(" استفاده شده است.</p>");
                if (status.TotalBytes is > 0) card.Append(QuotaBar(status.UsedBytes, status.TotalBytes));
                break;
            case DriveState.Missing:
                card.Append("<p>فضای اختصاصی شما ساخته نشده است؛ با یک کلیک فعالش کنید.</p>");
                break;
            case DriveState.Unreachable:
                card.Append("<p>").Append(E(status.Detail ?? "سرور Drive موقتاً در دسترس نیست.")).Append("</p>");
                break;
            default:
                card.Append("<p>اتصال Drive به پرتال هنوز برقرار نشده است؛ پس از فعال‌سازی، وضعیت فضای ذخیره‌سازی اینجا نمایش داده می‌شود.</p>");
                break;
        }
        card.Append("</div><div class='drive-card__side'>");
        card.Append(status.State switch
        {
            DriveState.Ready => "<span class='status-badge status-badge--success'>متصل</span><a class='portal-button portal-button--secondary drive-card__cta' href='/drive'>مدیریت فضا</a>",
            DriveState.Missing => "<span class='status-badge status-badge--warning'>در انتظار فعال‌سازی</span>" + ProvisionForm(antiforgeryToken),
            DriveState.Unreachable => "<span class='status-badge status-badge--danger'>در دسترس نیست</span><a class='portal-button portal-button--ghost drive-card__cta' href='/drive'>جزئیات</a>",
            _ => "<span class='status-badge'>متصل نیست</span>"
        });
        card.Append("</div></div></section>");
        return card.ToString();
    }

    private static string ProvisionForm(string? token) =>
        "<form method='post' action='/drive/provision' class='drive-provision'>"
        + "<input type='hidden' name='__RequestVerificationToken' value='" + E(token ?? "") + "'>"
        + "<button type='submit' class='portal-button portal-button--primary drive-card__cta'>فعال‌سازی فضا</button></form>";
}
