using System.Net;
using System.Text;

namespace AbrITPortal.Pages;

/// <summary>
/// Shared RTL page shell for every customer-facing page rendered by the portal
/// controllers (dashboard, account, catalog, service details and identity flows).
/// Navigation links point only to real routes of the application.
/// </summary>
public static class PortalShell
{
    private const string CssPath = "/AbrITPortalTheme/css/abrit-portal.css?v=7";
    private const string DeliveryCssPath = "/AbrITPortalTheme/css/abrit-portal-delivery.css?v=2";
    private const string PolishCssPath = "/AbrITPortalTheme/css/abrit-customer-polish.css?v=1";

    public static string Mark =>
        "<svg width=\"22\" height=\"22\" viewBox=\"0 0 48 48\" fill=\"none\" aria-hidden=\"true\">" +
        "<rect width=\"48\" height=\"48\" rx=\"11\" fill=\"#0B2447\"/>" +
        "<path d=\"M13.5 34.5 24 13l10.5 21.5\" stroke=\"#F4F8FF\" stroke-width=\"4.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" +
        "<path d=\"M18.2 26.6h11.6\" stroke=\"#3E9BFF\" stroke-width=\"4.4\" stroke-linecap=\"round\"/></svg>";

    private static string Burger =>
        "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\">" +
        "<path d=\"M4 7h16M4 12h16M4 17h16\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>";

    /// <summary>Renders a complete HTML document with the shared header, navigation and footer.</summary>
    public static string Render(string title, string active, bool authenticated,
        string? userName, string? antiforgeryToken, string body)
    {
        var name = E(userName);
        var initial = string.IsNullOrWhiteSpace(name) ? "؟" : name!.Trim()[..1];

        var nav = new StringBuilder();
        nav.Append(Link("/services", "خدمات و پلن‌ها", active == "services"));
        if (authenticated)
        {
            nav.Append(Link("/dashboard", "داشبورد", active == "dashboard"));
            nav.Append(Link("/drive", "AbrIT Drive", active == "drive"));
            nav.Append(Link("/account", "حساب کاربری", active == "account"));
        }
        nav.Append("<span class='portal-nav__spacer'></span><div class='portal-nav__auth'>");
        if (authenticated)
        {
            nav.Append("<a class='portal-userchip' href='/account' title='حساب کاربری'>")
                .Append("<span class='portal-userchip__avatar' aria-hidden='true'>").Append(E(initial)).Append("</span>")
                .Append("<span>").Append(name).Append("</span></a>");
            nav.Append("<form class='portal-logout' method='post' action='/Users/LogOff'>")
                .Append("<input type='hidden' name='__RequestVerificationToken' value='").Append(E(antiforgeryToken)).Append("'>")
                .Append("<button type='submit'>خروج</button></form>");
        }
        else
        {
            nav.Append("<a class='portal-button portal-button--secondary' href='/Login'>ورود</a>");
            nav.Append("<a class='portal-button portal-button--primary' href='/customer/register'>ثبت‌نام</a>");
        }
        nav.Append("</div>");

        return new StringBuilder()
            .Append("<!doctype html><html lang='fa' dir='rtl'><head><meta charset='utf-8'>")
            .Append("<meta name='viewport' content='width=device-width,initial-scale=1'>")
            .Append("<meta name='theme-color' content='#101A30'>")
            .Append("<title>").Append(E(title)).Append(" - AbrIT</title>")
            .Append("<link rel='preload' href='/AbrITPortalTheme/fonts/Vazirmatn-Regular.woff2' as='font' type='font/woff2' crossorigin>")
            .Append("<link rel='preload' href='/AbrITPortalTheme/fonts/Vazirmatn-Bold.woff2' as='font' type='font/woff2' crossorigin>")
            .Append("<link rel='stylesheet' href='").Append(CssPath).Append("'>")
            .Append("<link rel='stylesheet' href='").Append(DeliveryCssPath).Append("'>")
            .Append("<link rel='stylesheet' href='").Append(PolishCssPath).Append("'>")
            .Append("</head><body class='portal-body portal-body--").Append(E(active)).Append("'>")
            .Append("<a class='skip-link' href='#main-content'>پرش به محتوای اصلی</a>")
            .Append("<header class='portal-header'><div class='portal-header__inner'>")
            .Append("<a class='portal-brand' href='/services'><span class='portal-brand__mark'>").Append(Mark)
            .Append("</span><span>AbrIT<span class='portal-brand__sub'>پرتال مشتریان</span></span></a>")
            .Append("<input type='checkbox' id='portal-nav-toggle' class='portal-nav-toggle'>")
            .Append("<label class='portal-nav-burger' for='portal-nav-toggle' aria-label='نمایش منو'>").Append(Burger).Append("</label>")
            .Append("<nav class='portal-nav' aria-label='ناوبری اصلی'>").Append(nav).Append("</nav>")
            .Append("</div></header>")
            .Append("<main class='portal-main' id='main-content'><div class='portal-container'>")
            .Append(body)
            .Append("</div></main>")
            .Append(Footer(authenticated))
            .Append("</body></html>")
            .ToString();
    }

    /// <summary>Renders an application-style shell for authenticated customer workspace pages.</summary>
    public static string RenderApplication(string title, string active, string? userName, string? antiforgeryToken, string body)
    {
        var name = E(userName);
        var initial = string.IsNullOrWhiteSpace(name) ? "؟" : name!.Trim()[..1];
        var nav = new StringBuilder()
            .Append(AppLink("/dashboard", "نمای کلی", active == "dashboard"))
            .Append(AppLink("/services", "پلن‌ها و سرویس‌ها", active == "services"))
            .Append(AppLink("/drive", "AbrIT Drive", active == "drive"))
            .Append(AppLink("/account", "حساب کاربری", active == "account"));

        return new StringBuilder()
            .Append("<!doctype html><html lang='fa' dir='rtl'><head><meta charset='utf-8'>")
            .Append("<meta name='viewport' content='width=device-width,initial-scale=1'>")
            .Append("<meta name='theme-color' content='#101A30'><title>").Append(E(title)).Append(" - AbrIT</title>")
            .Append("<link rel='preload' href='/AbrITPortalTheme/fonts/Vazirmatn-Regular.woff2' as='font' type='font/woff2' crossorigin>")
            .Append("<link rel='preload' href='/AbrITPortalTheme/fonts/Vazirmatn-Bold.woff2' as='font' type='font/woff2' crossorigin>")
            .Append("<link rel='stylesheet' href='").Append(CssPath).Append("'>")
            .Append("<link rel='stylesheet' href='").Append(DeliveryCssPath).Append("'>")
            .Append("<link rel='stylesheet' href='").Append(PolishCssPath).Append("'>")
            .Append("</head><body class='customer-app'><a class='skip-link' href='#main-content'>پرش به محتوای اصلی</a>")
            .Append("<div class='app-shell'><aside class='app-sidebar' aria-label='ناوبری پنل مشتری'>")
            .Append("<a class='portal-brand app-brand' href='/dashboard'><span class='portal-brand__mark'>").Append(Mark)
            .Append("</span><span>AbrIT<span class='portal-brand__sub'>فضای مشتریان</span></span></a>")
            .Append("<section class='app-account-context' aria-label='حساب فعال'><span class='app-account-context__avatar' aria-hidden='true'>")
            .Append(E(initial)).Append("</span><span><small>حساب فعال</small><strong>").Append(name).Append("</strong></span></section>")
            .Append("<nav class='app-nav' aria-label='ناوبری فضای مشتری'><span class='app-nav__label'>فضای کاری</span>").Append(nav).Append("</nav>")
            .Append("<div class='app-sidebar__bottom'><a href='/services'>مقایسه پلن‌ها</a>")
            .Append("<form method='post' action='/Users/LogOff'><input type='hidden' name='__RequestVerificationToken' value='")
            .Append(E(antiforgeryToken)).Append("'><button type='submit'>خروج از حساب</button></form></div></aside>")
            .Append("<main class='app-main' id='main-content'><header class='app-topbar'><div><p class='app-breadcrumb'>فضای مشتری <span aria-hidden='true'>/</span> ")
            .Append(E(title)).Append("</p><h1>").Append(E(title)).Append("</h1></div><a class='app-topbar__profile' href='/account'>")
            .Append("<span class='app-account-context__avatar' aria-hidden='true'>").Append(E(initial)).Append("</span><span>")
            .Append(name).Append("</span></a></header><div class='app-content'>").Append(body)
            .Append("</div><footer class='app-footer'><span>AbrIT · پنل امن مشتریان</span><a href='/services'>راهنمای پلن‌ها و قیمت‌گذاری</a></footer></main></div>")
            .Append("</body></html>")
            .ToString();
    }

    /// <summary>Renders a complete error document with the given HTTP status code.</summary>
    public static string ErrorPage(HttpContext context, int status, string title, string message, string backHref, string backText)
    {
        context.Response.StatusCode = status;
        var body = "<div class='auth-wrap'><section class='portal-card' style='padding:2.5rem 2rem;text-align:center'>"
            + "<div class='portal-empty-state__icon' style='margin:0 auto .8rem'>" + Mark + "</div>"
            + "<h1 style='font-size:1.25rem'>" + E(title) + "</h1>"
            + "<p class='text-muted'>" + E(message) + "</p>"
            + "<a class='portal-button portal-button--secondary' href='" + E(backHref) + "'>" + E(backText) + "</a>"
            + "</section></div>";
        var token = UserSignedIn(context) && context.RequestServices
            .GetService<Microsoft.AspNetCore.Antiforgery.IAntiforgery>() is { } antiforgery
            ? antiforgery.GetAndStoreTokens(context).RequestToken
            : null;
        return Render(title, "", UserSignedIn(context), context.User.Identity?.Name, token, body);
    }

    private static bool UserSignedIn(HttpContext context) => context.User.Identity?.IsAuthenticated == true;

    private static string Link(string href, string text, bool active) =>
        "<a class='portal-nav__link" + (active ? " is-active" : "") + (active ? "' aria-current='page" : "")
        + "' href='" + href + "'>" + text + "</a>";

    private static string AppLink(string href, string text, bool active) =>
        "<a class='app-nav__link" + (active ? " is-active" : "") + "'" + (active ? " aria-current='page'" : "")
        + " href='" + href + "'>" + text + "</a>";

    private static string Footer(bool authenticated)
    {
        var quick = authenticated
            ? "<li><a href='/dashboard'>داشبورد</a></li><li><a href='/services'>خدمات و پلن‌ها</a></li><li><a href='/drive'>AbrIT Drive</a></li><li><a href='/account'>حساب کاربری</a></li>"
            : "<li><a href='/services'>خدمات و پلن‌ها</a></li><li><a href='/Login'>ورود</a></li><li><a href='/customer/register'>ثبت‌نام</a></li>";
        return "<footer class='portal-footer'><div class='portal-footer__grid'>"
            + "<div><div class='portal-footer__brand'><span class='portal-brand__mark'>" + Mark + "</span><span>AbrIT</span></div>"
            + "<p>پرتال مشتریان AbrIT برای مدیریت خدمات، سفارش‌ها و فضای ابری شما.</p></div>"
            + "<div><h3 class='portal-footer__title'>دسترسی سریع</h3><ul class='portal-footer__links'>" + quick + "</ul></div>"
            + "<div><h3 class='portal-footer__title'>راهنما</h3><ul class='portal-footer__links'>"
            + "<li><a href='/services'>مقایسه پلن‌ها و محاسبه قیمت</a></li>"
            + "<li><a href='/customer/recover'>بازیابی گذرواژه</a></li></ul></div>"
            + "</div><div class='portal-footer__bottom'>© AbrIT — تمامی حقوق محفوظ است.</div></footer>";
    }

    private static string E(string? text) => WebUtility.HtmlEncode(text ?? "");
}