using System.Globalization;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using AbrITPortal.Commercial;
using AbrITPortal.Drive;
using AbrITPortal.Pages;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using OrchardCore.ContentManagement;
using OrchardCore.Queries;
using OrchardCore.Users;

namespace AbrITPortal.Portal;

[Route("", Order = -10)]
public sealed class PortalController(
    IQueryManager queries,
    UserManager<IUser> users,
    IAntiforgery antiforgery,
    DriveStatusService drive,
    ICommercialRulesService commercialRules,
    IPricingEngine pricingEngine) : Controller
{
    private static readonly CultureInfo Fa = CultureInfo.GetCultureInfo("fa-IR");

    [HttpGet("", Order = -10)]
    [AllowAnonymous]
    public IActionResult Home()
    {
        if (User.Identity?.IsAuthenticated == true)
            return Redirect("/dashboard");
        var body = new StringBuilder();
        body.Append("<section class='landing-hero'><div class='landing-hero__copy'><span class='eyebrow'>AbrIT · مدیریت فناوری اطلاعات</span>")
            .Append("<h1>زیرساخت فناوری کسب‌وکار شما، شفاف و یکپارچه</h1>")
            .Append("<p>پلن‌های مدیریت IT را با قیمت‌گذاری شفاف مقایسه کنید، تعداد کاربران و مدت قرارداد را تنظیم کنید و خلاصه هزینه معتبر را از سرور ببینید.</p>")
            .Append("<div class='landing-hero__actions'><a class='portal-button portal-button--primary' href='/services'>مشاهده پلن‌ها و قیمت‌گذاری</a>")
            .Append("<a class='portal-button portal-button--secondary' href='/Login'>ورود مشتریان</a></div></div></section>");
        return Page("پرتال AbrIT", "home", body.ToString());
    }

    [HttpGet("dashboard")]
    [Authorize]
    public async Task<IActionResult> Dashboard()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Forbid();
        var query = await queries.GetQueryAsync("MyOrders");
        if (query is null || query.Source != Orders.OwnedOrdersQuerySource.SourceName)
            return StatusCode(503);
        var result = await queries.ExecuteQueryAsync(query, new Dictionary<string, object>());
        var orders = result.Items.OfType<ContentItem>().ToList();
        if (!CanDisplayOrders(User, orders)) return StatusCode(503);
        if (await users.GetUserAsync(User) is null) return Forbid();

        var active = orders.Count(x => Status(x) is "فعال" or "Active");
        var completed = orders.Count(x => Status(x) is "تکمیل" or "Completed");
        var pending = orders.Count(x => Status(x) is not ("فعال" or "Active" or "تکمیل" or "Completed" or "لغو" or "لغو شده" or "Cancelled"));
        var owned = orders.Where(x => Status(x) is not ("لغو" or "لغو شده" or "Cancelled")).ToList();

        var body = new StringBuilder();
        body.Append("<div class='dash-shell'><aside class='dash-sidebar' aria-label='منوی پنل'>")
            .Append("<div class='dash-sidebar__brand'><span class='dash-sidebar__eyebrow'>فضای کاری</span><strong>پنل مشتری</strong></div>")
            .Append("<nav class='dash-sidebar__nav'>")
            .Append(SideLink("/dashboard", Icon("overview"), "نمای کلی", true))
            .Append(SideLink("/services", Icon("services"), "پلن‌ها و سرویس‌ها", false))
            .Append(SideLink("/drive", Icon("cloud"), "AbrIT Drive", false))
            .Append(SideLink("/account", Icon("user"), "حساب کاربری", false))
            .Append(SideLink("/ChangePassword", Icon("shield"), "امنیت و گذرواژه", false))
            .Append("</nav><div class='dash-sidebar__help'><span class='status-badge status-badge--info'>راهنما</span><p>برای مقایسه پلن‌ها و مشاهده قیمت دقیق از بخش خدمات استفاده کنید.</p><a class='portal-button portal-button--secondary dash-sidebar__cta' href='/services'>مشاهده پلن‌ها</a></div></aside><div class='dash-content'>");
        body.Append("<section class='dash-hero'><div><span class='eyebrow'>داشبورد AbrIT</span><h1>سلام، ").Append(E(User.Identity?.Name))
            .Append("</h1><p>خلاصه وضعیت حساب، سفارش‌ها و سرویس‌های شما در یک نمای حرفه‌ای.</p></div><div class='dash-hero__actions'>")
            .Append("<a class='portal-button portal-button--primary' href='/services'>انتخاب و مقایسه پلن‌ها</a>")
            .Append("<a class='portal-button portal-button--ghost' href='/account'>مدیریت حساب</a></div></section>");
        body.Append("<div class='stat-grid'>");
        Stat(body, "کل سفارش‌ها", orders.Count, Icon("orders"), "");
        Stat(body, "سرویس‌های فعال", active, Icon("active"), "stat-card__icon--green");
        Stat(body, "در انتظار", pending, Icon("pending"), "stat-card__icon--amber");
        Stat(body, "تکمیل‌شده", completed, Icon("completed"), "stat-card__icon--slate");
        body.Append("</div>");
        body.Append("<div class='dash-panels'><section class='panel'><div class='panel__header'><h2>سرویس‌های من</h2><span class='status-badge status-badge--info'>بر اساس سفارش‌های واقعی</span></div>");
        if (owned.Count == 0)
            body.Append("<div class='portal-empty-state portal-empty-state--compact'><h3 class='portal-empty-state__title'>سرویس فعالی ثبت نشده است</h3><p>هنوز سرویس فعالی برای حساب شما ثبت نشده است. می‌توانید پلن مناسب را مقایسه و انتخاب کنید.</p><a class='portal-button portal-button--secondary' href='/services'>رفتن به کاتالوگ پلن‌ها</a></div>");
        else
        {
            body.Append("<div class='service-lines'>");
            foreach (var order in owned.Take(8))
                body.Append("<div class='service-line'><span class='service-line__title'>").Append(E(fields(order)?["ServiceId"]?["Text"]?.ToString() ?? "سرویس ثبت‌شده"))
                    .Append("</span><span class='status-badge").Append(StatusClass(order)).Append("'>").Append(E(Status(order))).Append("</span></div>");
            body.Append("</div>");
        }
        body.Append("</section><section class='panel'><div class='panel__header'><h2>سفارش‌های اخیر</h2></div>");
        if (orders.Count == 0)
            body.Append("<div class='portal-empty-state portal-empty-state--compact'><h3 class='portal-empty-state__title'>سفارشی ثبت نشده است</h3><p>هنوز سفارشی ثبت نشده است. خرید آنلاین پس از تکمیل امن پرداخت/سفارش (M3) فعال می‌شود.</p><a class='portal-button portal-button--primary' href='/services'>مشاهده پلن‌ها</a></div>");
        else
        {
            body.Append("<div class='table-scroll'><table class='portal-table'><thead><tr><th>شماره</th><th>سرویس</th><th>تاریخ</th><th>مبلغ</th><th>وضعیت</th><th>جزئیات</th></tr></thead><tbody>");
            foreach (var order in orders.OrderByDescending(x => x.CreatedUtc).Take(10))
            {
                var date = order.CreatedUtc?.ToString("yyyy/MM/dd", CultureInfo.InvariantCulture) ?? "—";
                body.Append("<tr><td class='cell-mono'>").Append(E(order.ContentItemId)).Append("</td><td class='cell-strong'>")
                    .Append(E(fields(order)?["ServiceId"]?["Text"]?.ToString() ?? "—")).Append("</td><td dir='ltr'>").Append(E(date))
                    .Append("</td><td>").Append(E(fields(order)?["Price"]?["Text"]?.ToString() ?? "—"))
                    .Append("</td><td><span class='status-badge").Append(StatusClass(order)).Append("'>").Append(E(Status(order)))
                    .Append("</span></td><td><a href='/Contents/Item/Display/").Append(Uri.EscapeDataString(order.ContentItemId)).Append("'>مشاهده</a></td></tr>");
            }
            body.Append("</tbody></table></div>");
        }
        body.Append("</section></div>");
        var driveStatus = await drive.GetStatusAsync(userId, HttpContext.RequestAborted);
        body.Append("<div class='dash-panels' style='margin-top:1rem'>").Append(DriveViews.Card(driveStatus, Token()))
            .Append("<section class='panel'><div class='panel__header'><h2>میان‌بُرها</h2></div><div class='panel__body'><div class='quick-actions'>")
            .Append(QuickLink("/services", "مقایسه پلن‌ها", "انتخاب پلن، کاربران و قرارداد"))
            .Append(QuickLink("/account", "حساب کاربری", "ایمیل، شماره همراه و اطلاعات"))
            .Append(QuickLink("/ChangePassword", "تغییر گذرواژه", "مدیریت امنیت ورود"))
            .Append(QuickLink("/customer/recover", "بازیابی با کد پیامکی", "بازیابی حساب با OTP"))
            .Append("</div></div></section></div></div></div>");
        return ApplicationPage("داشبورد", "dashboard", body.ToString());
    }

    public static bool CanDisplayOrders(ClaimsPrincipal user, IEnumerable<ContentItem> orders)
    {
        var id = user.FindFirstValue(ClaimTypes.NameIdentifier);
        return user.Identity?.IsAuthenticated == true && !string.IsNullOrWhiteSpace(id)
            && orders.All(x => x.ContentType == "AbrITOrder" && x.Owner == id && x.Published);
    }

    [HttpGet("account")]
    [Authorize]
    public async Task<IActionResult> Account()
    {
        var account = await users.GetUserAsync(User);
        if (account is null) return Forbid();
        var mobile = account as OrchardCore.Users.Models.User;
        var body = new StringBuilder();
        body.Append("<div class='page-heading'><div><span class='eyebrow'>تنظیمات حساب</span><h1>حساب کاربری</h1><p>اطلاعات هویتی، تماس و امنیت حساب خود را مدیریت کنید.</p></div></div>")
            .Append("<div class='account-grid'><section class='panel account-panel'><div class='panel__header'><h2>اطلاعات شخصی</h2></div><div class='panel__body'><dl class='details-list'>")
            .Append("<div><dt>نام کاربری</dt><dd>").Append(E(await users.GetUserNameAsync(account))).Append("</dd></div>")
            .Append("<div><dt>ایمیل</dt><dd dir='ltr'>").Append(E(await users.GetEmailAsync(account) ?? "ثبت نشده")).Append("</dd></div>")
            .Append("<div><dt>شماره همراه</dt><dd dir='ltr'>").Append(E(mobile?.PhoneNumber ?? "ثبت نشده")).Append("</dd></div>")
            .Append("<div><dt>وضعیت شماره همراه</dt><dd>").Append(mobile?.PhoneNumberConfirmed == true ? "<span class='status-badge status-badge--success'>تأیید شده</span>" : "<span class='status-badge status-badge--warning'>در انتظار تأیید</span>")
            .Append("</dd></div></dl></div><div class='panel__actions'><a class='portal-button portal-button--secondary' href='/customer/mobile'>مدیریت شماره همراه</a><a class='portal-button portal-button--ghost' href='/ChangeEmail'>تغییر ایمیل</a></div></section>")
            .Append("<section class='panel account-panel'><div class='panel__header'><h2>امنیت و دسترسی</h2></div><div class='panel__body'><ul class='check-list'><li>از گذرواژه قوی و اختصاصی استفاده کنید.</li><li>شماره همراه تأییدشده برای بازیابی امن حساب لازم است.</li><li>از اشتراک‌گذاری اطلاعات ورود خودداری کنید.</li></ul>")
            .Append("<div class='portal-alert portal-alert--info'><span>رمز را فراموش کرده‌اید؟ <a href='/customer/recover'>بازیابی یا ورود با کد پیامکی (OTP)</a></span></div></div>")
            .Append("<div class='panel__actions'><a class='portal-button portal-button--primary' href='/ChangePassword'>تغییر گذرواژه</a><a class='portal-button portal-button--ghost' href='/ForgotPassword'>فراموشی گذرواژه</a></div></section></div>");
        return ApplicationPage("حساب کاربری", "account", body.ToString());
    }

    [HttpGet("services")]
    [AllowAnonymous]
    public async Task<IActionResult> Catalog()
    {
        var rules = await commercialRules.GetAsync();
        var plans = rules.Plans.Where(p => p.IsPublished).OrderBy(p => p.DisplayOrder).ToList();
        var body = new StringBuilder();
        body.Append("<div class='page-heading page-heading--hero services-hero'><div><span class='eyebrow'>پلن‌های مدیریت IT</span><h1>انتخاب پلن و محاسبه شفاف هزینه</h1>")
            .Append("<p>پلن را انتخاب کنید، تعداد کاربران و مدت قرارداد را تعیین کنید. محاسبه قیمت معتبر از سرور دریافت می‌شود.</p></div></div>");
        if (plans.Count == 0)
        {
            body.Append("<div class='portal-empty-state'><h2 class='portal-empty-state__title'>پلن تجاری منتشرشده‌ای در دسترس نیست</h2><p>در حال حاضر امکان انتخاب پلن وجود ندارد.</p></div>");
            return Page("خدمات و پلن‌ها", "services", body.ToString());
        }

        body.Append("<section class='pricing-layout' id='pricing-layout'><div class='pricing-main'>")
            .Append("<div class='panel pricing-config-top'><div class='panel__body pricing-config-top__body'>")
            .Append("<div class='contract-block'><span class='pricing-label'>مدت قرارداد</span><div class='contract-toggle' role='radiogroup' aria-label='مدت قرارداد'>")
            .Append("<button type='button' class='contract-btn is-active' data-months='1' role='radio' aria-checked='true'>۱ ماهه <small>بدون تخفیف</small></button>")
            .Append("<button type='button' class='contract-btn' data-months='3' role='radio' aria-checked='false'>۳ ماهه <small>۳٪ تخفیف</small></button>")
            .Append("<button type='button' class='contract-btn' data-months='6' role='radio' aria-checked='false'>۶ ماهه <small>۵٪ تخفیف</small></button>")
            .Append("</div><p class='contract-note' id='contract-note'>قرارداد ۱ ماهه: بدون تخفیف و هزینه راه‌اندازی. نرخ راه‌اندازی این قرارداد در انتظار تأیید نهایی Backend/M2 است.</p></div>")
            .Append("<div class='pricing-meta-note'><span class='status-badge status-badge--info'>محاسبه سمت سرور</span><span class='text-muted'>مبالغ نهایی فقط بر اساس پاسخ معتبر موتور قیمت‌گذاری نمایش داده می‌شوند.</span></div>")
            .Append("</div></div>")
            .Append("<div class='pricing-grid' id='pricing-grid' aria-label='انتخاب پلن'>");

        foreach (var plan in plans)
        {
            var isFeatured = plan.IsFeatured || plan.Code == "P3";
            var slaText = SlaText(plan);
            body.Append("<article class='plan-card plan-card--selectable").Append(isFeatured ? " plan-card--featured" : "").Append("' data-plan='").Append(E(plan.Code))
                .Append("' data-name='").Append(E(plan.PersianName)).Append("' data-en='").Append(E(plan.EnglishName))
                .Append("' data-min='").Append(plan.MinimumUsers).Append("' data-max='").Append(plan.MaximumUsers)
                .Append("' data-included='").Append(plan.IncludedUsers).Append("' tabindex='0' role='button' aria-pressed='false'>");
            if (isFeatured) body.Append("<div class='plan-card__ribbon'>پیشنهاد ویژه</div>");
            body.Append("<div class='plan-card__selecthint'><span class='plan-select-dot' aria-hidden='true'></span><span class='plan-select-text'>انتخاب پلن</span></div>")
                .Append("<header class='plan-card__head'><div class='plan-card__identity'><span class='plan-card__code'>").Append(E(plan.Code)).Append("</span><h3>").Append(E(plan.PersianName)).Append("</h3><p class='plan-card__en'>").Append(E(plan.EnglishName)).Append("</p></div>")
                .Append("<div class='plan-card__price'><span>قیمت پایه ماهانه</span><strong>").Append(FaMoney(plan.BaseMonthlyPriceToman)).Append("</strong><small>تومان</small></div></header>")
                .Append("<div class='plan-card__body'><ul class='plan-card__features'>")
                .Append("<li>کاربران شامل: <strong>").Append(FaNum(plan.IncludedUsers)).Append("</strong> نفر</li>")
                .Append("<li>حداکثر کاربران: <strong>").Append(FaNum(plan.MaximumUsers)).Append("</strong> نفر</li>")
                .Append("<li>هر کاربر اضافه: <strong>").Append(FaMoney(plan.AdditionalUserMonthlyFeeToman)).Append("</strong> تومان/ماه</li>")
                .Append("<li class='plan-sla'><span class='plan-sla__label'>SLA</span><strong class='plan-sla__value'>").Append(slaText).Append("</strong></li>")
                .Append("</ul><div class='plan-card__cta'><button type='button' class='portal-button portal-button--primary plan-select-btn'>انتخاب پلن</button></div></div></article>");
        }
        body.Append("</div>");

        var d = plans.FirstOrDefault(p => p.IsFeatured || p.Code == "P3") ?? plans[0];
        var db = pricingEngine.Calculate(new PricingRequest(d.Code, d.IncludedUsers, ContractMonths.One), rules);
        body.Append("<section class='panel plan-config' id='plan-config' aria-labelledby='plan-config-title'>")
            .Append("<div class='panel__header'><div><h2 id='plan-config-title'>تنظیمات پلن انتخاب‌شده</h2><p class='text-muted' id='config-plan-name'>").Append(E(d.PersianName)).Append(" (").Append(E(d.Code)).Append(")</p></div>")
            .Append("<span class='status-badge status-badge--success'>پلن انتخاب‌شده</span></div><div class='panel__body'><div class='config-grid'>")
            .Append("<div class='config-users'><label class='pricing-label' for='config-range'>تعداد کاربران</label><div class='qty-control'>")
            .Append("<button type='button' class='qty-btn' id='qty-minus' aria-label='کاهش تعداد کاربران'>−</button>")
            .Append("<input id='config-num' class='qty-input' type='number' min='").Append(d.MinimumUsers).Append("' max='").Append(d.MaximumUsers).Append("' value='").Append(d.IncludedUsers).Append("' inputmode='numeric' aria-label='تعداد کاربران'>")
            .Append("<button type='button' class='qty-btn' id='qty-plus' aria-label='افزایش تعداد کاربران'>+</button></div>")
            .Append("<input id='config-range' class='plan-users__range' type='range' min='").Append(d.MinimumUsers).Append("' max='").Append(d.MaximumUsers).Append("' value='").Append(d.IncludedUsers).Append("' step='1' aria-label='اسلایدر تعداد کاربران'>")
            .Append("<p class='plan-users__hint' id='config-hint'>محدوده مجاز این پلن: ").Append(FaNum(d.MinimumUsers)).Append(" تا ").Append(FaNum(d.MaximumUsers)).Append(" کاربر</p>")
            .Append("<p class='plan-users__hint' id='config-included'>کاربران شامل پلن: ").Append(FaNum(d.IncludedUsers)).Append(" نفر</p>")
            .Append("<div id='config-error' class='portal-alert portal-alert--warning' role='alert' hidden></div></div>")
            .Append("<div class='config-summary'><h3>خلاصه قیمت</h3><div id='selection-summary' class='selection-summary' aria-live='polite'>").Append(E(d.PersianName)).Append(" — ").Append(FaNum(d.IncludedUsers)).Append(" کاربر — ۱ ماهه</div>")
            .Append("<div id='price-summary' aria-live='polite'>").Append(BreakdownHtml(db, rules)).Append("</div>")
            .Append("<div id='price-pending' class='portal-alert portal-alert--warning' hidden><span id='price-pending-text'></span></div>")
            .Append("<div class='portal-alert portal-alert--info config-m3'><span><strong>ثبت سفارش آنلاین:</strong> پس از تکمیل فاز M3 (اتصال امن سفارش و پرداخت) فعال می‌شود. در حال حاضر انتخاب پلن و مشاهده قیمت فراهم است.</span></div>")
            .Append("<div class='panel__actions' style='padding:0'><button type='button' id='m3-cta' class='portal-button portal-button--primary' disabled aria-disabled='true'>ادامه و ثبت سفارش (غیرفعال تا M3)</button></div></div></div></div></section>")
            .Append("</div>");

        body.Append("<section class='panel comparison-section' aria-labelledby='cmp-title'><div class='panel__header'><div><span class='eyebrow'>مقایسه پلن‌ها</span><h2 id='cmp-title'>مقایسه سریع پلن‌ها</h2></div></div><div class='panel__body'><div class='table-scroll comparison-wrap'><table class='portal-table comparison-table'><thead><tr><th>پلن</th><th>قیمت پایه ماهانه</th><th>کاربران شامل</th><th>حداکثر کاربران</th><th>هر کاربر اضافه/ماه</th><th>SLA (شروع رسیدگی)</th></tr></thead><tbody>");
        foreach (var plan in plans)
        {
            var sla = SlaText(plan);
            body.Append("<tr").Append((plan.IsFeatured || plan.Code=="P3")?" class='row-featured'":"").Append("><th scope='row'>").Append(E(plan.PersianName)).Append(" <small dir='ltr'>(").Append(E(plan.Code)).Append(")</small></th><td>").Append(FaMoney(plan.BaseMonthlyPriceToman)).Append(" تومان</td><td>").Append(FaNum(plan.IncludedUsers)).Append("</td><td>").Append(FaNum(plan.MaximumUsers)).Append("</td><td>").Append(FaMoney(plan.AdditionalUserMonthlyFeeToman)).Append(" تومان</td><td class='sla-cell'>").Append(sla).Append("</td></tr>");
        }
        body.Append("</tbody></table></div></div></section></section>")
            .Append("<section class='panel pricing-notes' style='margin-top:1rem'><div class='panel__header'><h2>نکات شفاف قیمت‌گذاری</h2></div><div class='panel__body'><ul class='check-list'><li>قراردادهای قابل انتخاب: ۱ ماهه (بدون تخفیف)، ۳ ماهه (۳٪ تخفیف) و ۶ ماهه (۵٪ تخفیف).</li><li>هزینه راه‌اندازی قراردادهای ۳ ماهه و ۶ ماهه: به‌ترتیب ۵۰٪ و ۲۵٪ قیمت پایه ماهانه پلن (بدون احتساب کاربران اضافه).</li><li>نرخ راه‌اندازی قرارداد ۱ ماهه در انتظار تأیید نهایی Backend/M2 است؛ تا تکمیل پیکربندی، مبلغ نهایی قطعی این مدت قرارداد نمایش داده نمی‌شود.</li><li>واحد نمایش مبلغ: تومان (IRT). محاسبه نهایی از موتور قیمت‌گذاری سرور دریافت می‌شود.</li><li>پلن P5 دارای SLA شروع رسیدگی فوری (اولویت بحرانی) است.</li><li>").Append(E(rules.TaxDisplayNote)).Append("</li></ul></div></section>")
            .Append(PricingScript());
        return Page("خدمات و پلن‌ها", "services", body.ToString());
    }

    [HttpGet("services/{id}")]
    [AllowAnonymous]
    public async Task<IActionResult> Service(string id)
    {
        var query = await queries.GetQueryAsync("AllServices");
        if (query is null) return StatusCode(503);
        var result = await queries.ExecuteQueryAsync(query, new Dictionary<string, object>());
        var service = result.Items.OfType<ContentItem>().FirstOrDefault(x => x.ContentType == "AbrITService" && x.Published && x.ContentItemId == id);
        if (service is null) return Content(PortalShell.ErrorPage(HttpContext, 404, "سرویس پیدا نشد", "سرویس موردنظر وجود ندارد یا در دسترس نیست.", "/services", "بازگشت به سرویس‌ها"), "text/html; charset=utf-8");
        var name = Field(service, "title", "Text") ?? service.DisplayText ?? "سرویس";
        var desc = Field(service, "Description", "Text") ?? "توضیحی برای این سرویس ثبت نشده است.";
        var icon = Field(service, "Icon", "Text") ?? "◈";
        var body = new StringBuilder();
        body.Append("<a class='back-link' href='/services'>← بازگشت به پلن‌ها و سرویس‌ها</a><div class='detail-layout'><section class='panel detail-main'><span class='service-card__icon'>").Append(E(icon)).Append("</span><span class='eyebrow'>سرویس AbrIT</span><h1>")
            .Append(E(name)).Append("</h1><p>").Append(E(desc)).Append("</p><div class='portal-alert portal-alert--info'><span>برای قیمت‌گذاری تجاری و انتخاب ظرفیت، به <a href='/services'>صفحه مقایسه پلن‌ها</a> مراجعه کنید.</span></div></section>")
            .Append("<aside class='detail-aside'><div class='panel price-card'><span class='price-card__label'>مسیر خرید</span><a class='portal-button portal-button--primary' href='/services'>انتخاب پلن و مشاهده قیمت</a><p class='price-card__note'>ثبت سفارش آنلاین پس از تکمیل فاز M3 فعال می‌شود.</p></div></aside></div>");
        return Page("جزئیات سرویس", "services", body.ToString());
    }

    [HttpGet("portal")]
    [Authorize]
    public IActionResult Portal() => Redirect("/dashboard");

    private static string SlaText(CommercialPlanDefinition plan) =>
        plan.SlaType == SlaType.Immediate
            ? "شروع رسیدگی فوری"
            : "زمان شروع رسیدگی: <bdi dir='ltr'>" + E(plan.SlaDisplayFa) + "</bdi>";

    private static string BreakdownHtml(PricingBreakdown b, CommercialRules rules)
    {
        if (!b.IsValid)
        {
            var errs = b.Errors.Count > 0 ? string.Join(" ", b.Errors.Select(E)) : "اطلاعات محاسبه نامعتبر است.";
            return "<div class='portal-alert portal-alert--warning' role='alert'><span>" + errs + "</span></div>";
        }
        var sb = new StringBuilder();
        sb.Append("<dl class='breakdown-list'>")
          .Append(Row("پلن انتخاب‌شده", E(b.PlanCode)))
          .Append(Row("تعداد کاربران", FaNum(b.SelectedUsers) + " نفر"))
          .Append(Row("کاربران اضافه", FaNum(b.AdditionalUsers) + " نفر"))
          .Append(Row("قیمت پایه ماهانه", FaMoney(b.BaseMonthlyPriceToman) + " تومان"))
          .Append(Row("هزینه ماهانه کاربران اضافه", FaMoney(b.AdditionalUsersMonthlyTotalToman) + " تومان"))
          .Append(Row("جمع ماهانه", "<strong>" + FaMoney(b.MonthlyTotalToman) + " تومان</strong>"))
          .Append(Row("مدت قرارداد", FaNum(b.ContractMonths) + " ماه"))
          .Append(Row("جمع دوره (قبل از تخفیف)", FaMoney(b.SubtotalToman) + " تومان"))
          .Append(Row("نرخ تخفیف قرارداد", FaPercent(b.DiscountRate)))
          .Append(Row("مبلغ تخفیف", "− " + FaMoney(b.DiscountAmountToman) + " تومان"))
          .Append(Row("هزینه راه‌اندازی", FaMoney(b.OnboardingFeeToman) + " تومان"))
          .Append(Row("مبلغ نهایی دوره قرارداد", "<strong class='breakdown-total'>" + FaMoney(b.FinalTotalToman) + " تومان</strong>"))
          .Append("</dl><p class='breakdown-tax'>").Append(E(rules.TaxDisplayNote)).Append("</p>");
        return sb.ToString();
    }

    private static string PricingScript() => @"<script>
(function(){
  var grid=document.getElementById('pricing-grid'); if(!grid) return;
  var cards=[].slice.call(grid.querySelectorAll('.plan-card'));
  var contractBtns=document.querySelectorAll('.contract-btn');
  var range=document.getElementById('config-range'), num=document.getElementById('config-num');
  var minus=document.getElementById('qty-minus'), plus=document.getElementById('qty-plus');
  var hint=document.getElementById('config-hint'), included=document.getElementById('config-included');
  var err=document.getElementById('config-error');
  var summary=document.getElementById('price-summary'), sel=document.getElementById('selection-summary'), nameEl=document.getElementById('config-plan-name');
  var pending=document.getElementById('price-pending'), pendingText=document.getElementById('price-pending-text');
  var note=document.getElementById('contract-note');
  var cta=document.getElementById('m3-cta');
  var state={code:null,name:null,min:1,max:1,inc:0,users:1,months:1,req:0};
  function fa(n){ try{ return Number(n).toLocaleString('fa-IR'); }catch(e){ return n; } }
function mLabel(m){ return m===1?'۱ ماهه':(m===6?'۶ ماهه':'۳ ماهه'); }
   function noteText(m){ if(m===1) return 'قرارداد ۱ ماهه: بدون تخفیف و هزینه راه‌اندازی. نرخ راه‌اندازی این قرارداد در انتظار تأیید نهایی Backend/M2 است؛ تا تکمیل پیکربندی، مبلغ نهایی قطعی این مدت قرارداد نمایش داده نمی‌شود.'; if(m===6) return 'قرارداد ۶ ماهه: ۵٪ تخفیف و هزینه راه‌اندازی ۲۵٪ قیمت پایه ماهانه پلن.'; return 'قرارداد ۳ ماهه: ۳٪ تخفیف و هزینه راه‌اندازی ۵۰٪ قیمت پایه ماهانه پلن.'; }
  function updateSel(){ if(sel) sel.textContent=(state.name||state.code)+' — '+fa(state.users)+' کاربر — '+mLabel(state.months); }
  function setPending(msg){ if(!pending) return; if(msg){ pending.hidden=false; if(pendingText) pendingText.textContent=msg; if(summary) summary.innerHTML=''; } else { pending.hidden=true; if(pendingText) pendingText.textContent=''; } }
  function setContract(m){ state.months=m; contractBtns.forEach(function(b){ var on=+b.dataset.months===m; b.classList.toggle('is-active',on); b.setAttribute('aria-checked',on?'true':'false'); }); if(note) note.textContent=noteText(m); updateSel(); fetchPrice(); }
  contractBtns.forEach(function(b){ b.addEventListener('click',function(){ setContract(+b.dataset.months||3); }); });
  function selectCard(card,scroll){
    cards.forEach(function(c){ var on=c===card; c.classList.toggle('is-selected',on); c.setAttribute('aria-pressed',on?'true':'false'); var t=c.querySelector('.plan-select-text'); if(t) t.textContent=on?'انتخاب شده':'انتخاب پلن'; var btn=c.querySelector('.plan-select-btn'); if(btn){ btn.textContent=on?'پلن انتخاب‌شده':'انتخاب پلن'; btn.classList.toggle('portal-button--primary',on); btn.classList.toggle('portal-button--secondary',!on);} });
    state.code=card.dataset.plan; state.name=card.dataset.name||state.code; state.min=+card.dataset.min; state.max=+card.dataset.max; state.inc=+card.dataset.included||state.min;
    if(state.users<state.min) state.users=state.min; if(state.users>state.max) state.users=state.max;
    if(range){ range.min=state.min; range.max=state.max; range.value=state.users; }
    if(num){ num.min=state.min; num.max=state.max; num.value=state.users; }
    if(nameEl) nameEl.textContent=state.name+' ('+state.code+')';
    if(hint) hint.textContent='محدوده مجاز این پلن: '+fa(state.min)+' تا '+fa(state.max)+' کاربر';
    if(included) included.textContent='کاربران شامل پلن: '+fa(state.inc)+' نفر';
    if(err){ err.hidden=true; err.textContent=''; }
    syncBtns(); updateSel(); fetchPrice();
    if(scroll){ var cfg=document.getElementById('plan-config'); if(cfg) cfg.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  }
  cards.forEach(function(c){
    c.addEventListener('click',function(){ selectCard(c,true); });
    c.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); selectCard(c,true); } });
    var b=c.querySelector('.plan-select-btn'); if(b) b.addEventListener('click',function(e){ e.stopPropagation(); selectCard(c,true); });
  });
  function clamp(v){ v=Math.round(Number(v)); if(!isFinite(v)) v=state.min; if(v<state.min) v=state.min; if(v>state.max) v=state.max; return v; }
  function syncBtns(){ if(minus) minus.disabled=state.users<=state.min; if(plus) plus.disabled=state.users>=state.max; }
  function applyUsers(v){ state.users=clamp(v); if(range) range.value=state.users; if(num) num.value=state.users; syncBtns(); updateSel(); fetchPrice(); }
  if(range) range.addEventListener('input',function(){ applyUsers(range.value); });
  if(num){ num.addEventListener('input',function(){ if(num.value!==''&&isFinite(+num.value)){ var v=Math.round(+num.value); if(v>=state.min&&v<=state.max){ if(range) range.value=v; state.users=v; syncBtns(); updateSel(); fetchPrice(); } } }); num.addEventListener('change',function(){ applyUsers(num.value); }); }
  if(minus) minus.addEventListener('click',function(){ applyUsers(state.users-1); });
  if(plus) plus.addEventListener('click',function(){ applyUsers(state.users+1); });
  function render(b){
    if(!b||b.isValid===false){ var msg=(b&&b.errors&&b.errors.length)?b.errors.join(' '):'مقادیر انتخابی نامعتبر است.'; return '<div class=\'portal-alert portal-alert--warning\' role=\'alert\'><span>'+msg+'</span></div>'; }
    function row(l,v){ return '<div><dt>'+l+'</dt><dd>'+v+'</dd></div>'; }
    return '<dl class=\'breakdown-list\'>'
      +row('پلن انتخاب‌شده', (b.planCode||state.code))
      +row('تعداد کاربران', fa(b.selectedUsers)+' نفر')
      +row('کاربران اضافه', fa(b.additionalUsers)+' نفر')
      +row('قیمت پایه ماهانه', fa(b.baseMonthlyPriceToman)+' تومان')
      +row('هزینه ماهانه کاربران اضافه', fa(b.additionalUsersMonthlyTotalToman)+' تومان')
      +row('جمع ماهانه','<strong>'+fa(b.monthlyTotalToman)+' تومان</strong>')
      +row('مدت قرارداد', fa(b.contractMonths)+' ماه')
      +row('جمع دوره (قبل از تخفیف)', fa(b.subtotalToman)+' تومان')
      +row('نرخ تخفیف قرارداد', (b.discountRate!=null?fa((b.discountRate*100))+'٪':'—'))
      +row('مبلغ تخفیف','− '+fa(b.discountAmountToman)+' تومان')
      +row('هزینه راه‌اندازی', fa(b.onboardingFeeToman)+' تومان')
      +row('مبلغ نهایی دوره قرارداد','<strong class=\'breakdown-total\'>'+fa(b.finalTotalToman)+' تومان</strong>')
      +'</dl>';
  }
  function fetchPrice(){
    if(!state.code||!summary) return; var r=++state.req; if(err){err.hidden=true;}
    if(state.months===1){ setPending('قرارداد ۱ ماهه (بدون تخفیف) انتخاب شده است. نرخ راه‌اندازی این قرارداد در Backend/M2 هنوز نهایی نشده و محاسبه سروری معتبر قرارداد ۱ ماهه ممکن است در دسترس نباشد؛ تا تکمیل پیکربندی، مبلغ نهایی قطعی نمایش داده نمی‌شود.'); summary.setAttribute('aria-busy','false'); return; }
    setPending('');
    summary.setAttribute('aria-busy','true');
    fetch('/pricing/preview?planCode='+encodeURIComponent(state.code)+'&selectedUsers='+state.users+'&contractMonths='+state.months,{headers:{'Accept':'application/json'},cache:'no-store'})
      .then(function(res){ return res.json().then(function(b){ return {ok:res.ok,status:res.status,b:b}; }).catch(function(){ return {ok:res.ok,status:res.status,b:null}; }); })
      .then(function(out){ if(r!==state.req) return; summary.setAttribute('aria-busy','false');
        if(!out.ok){ var msg=(out.b&&out.b.errors&&out.b.errors[0])||('پیش‌نمایش قیمت برای قرارداد '+fa(state.months)+' ماهه در حال حاضر در دسترس نیست.'); setPending(msg); return; }
        summary.innerHTML=render(out.b);
        if(out.b && !out.b.isValid&&err){ err.hidden=false; err.textContent=(out.b.errors&&out.b.errors[0])||'مقادیر نامعتبر است.'; }
      })
      .catch(function(){ if(r!==state.req) return; summary.setAttribute('aria-busy','false'); setPending('خطا در دریافت قیمت از سرور. لطفاً دوباره تلاش کنید.'); });
  }
  var initial=cards.find(function(c){return c.classList.contains('plan-card--featured');})||cards[0]; if(initial) selectCard(initial,false); else syncBtns();
  if(cta){ cta.disabled=true; cta.setAttribute('aria-disabled','true'); }
})();
</script>";

    private static string Row(string k, string v) => "<div><dt>" + E(k) + "</dt><dd>" + v + "</dd></div>";
    private static string FaMoney(decimal v) => decimal.Truncate(v).ToString("N0", Fa);
    private static string FaNum(int v) => v.ToString("N0", Fa);
    private static string FaPercent(decimal r) => (r * 100m).ToString("0.##", Fa) + "٪";
    private string? Token() => User.Identity?.IsAuthenticated == true ? antiforgery.GetAndStoreTokens(HttpContext).RequestToken : null;
    private IActionResult Page(string title, string active, string body) => Content(PortalShell.Render(title, active, User.Identity?.IsAuthenticated == true, User.Identity?.Name, Token(), body), "text/html; charset=utf-8");
    private IActionResult ApplicationPage(string title, string active, string body) => Content(PortalShell.RenderApplication(title, active, User.Identity?.Name, Token(), body), "text/html; charset=utf-8");
    private static string? Field(ContentItem item, string field, string property) => item.Content["AbrITService"]?[field]?[property]?.ToString();
    private static JsonNode? fields(ContentItem order) => order.Content["AbrITOrder"];
    private static string Status(ContentItem item) => item.Content["AbrITOrder"]?["Status"]?["Text"]?.ToString() ?? "در انتظار";
    private static string StatusClass(ContentItem item) => Status(item) switch { "فعال" or "Active" => " status-badge--success", "تکمیل" or "Completed" => " status-badge--info", "لغو" or "لغو شده" or "Cancelled" => " status-badge--danger", _ => " status-badge--warning" };
    private static string SideLink(string href, string icon, string text, bool active) => "<a class='dash-sidebar__link" + (active ? " is-active'" : "'") + (active?" aria-current='page'":"") + " href='" + href + "'><span class='dash-sidebar__icon'>" + icon + "</span><span>" + text + "</span></a>";
    private static string QuickLink(string href, string title, string desc) => "<a class='quick-link' href='" + href + "'><strong>" + title + "</strong><span>" + desc + "</span></a>";
    private static string Icon(string name) => name switch {
        "overview" => "<svg width='18' height='18' viewBox='0 0 24 24' fill='none'><path d='M4 5h7v6H4zM13 5h7v4h-7zM13 11h7v8h-7zM4 13h7v6H4z' stroke='currentColor' stroke-width='1.8' stroke-linejoin='round'/></svg>",
        "services" => "<svg width='18' height='18' viewBox='0 0 24 24' fill='none'><path d='M12 3l8 4.5-8 4.5-8-4.5L12 3z' stroke='currentColor' stroke-width='1.8'/><path d='M4 12l8 4.5 8-4.5M4 16.5L12 21l8-4.5' stroke='currentColor' stroke-width='1.8'/></svg>",
        "user" => "<svg width='18' height='18' viewBox='0 0 24 24' fill='none'><circle cx='12' cy='8' r='3.4' stroke='currentColor' stroke-width='1.8'/><path d='M5 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'/></svg>",
        "orders" => "<svg width='18' height='18' viewBox='0 0 24 24' fill='none'><path d='M4 7l8-4 8 4v10l-8 4-8-4V7z' stroke='currentColor' stroke-width='1.8'/><path d='M4 7l8 4 8-4M12 11v10' stroke='currentColor' stroke-width='1.8'/></svg>",
        "active" => "<svg width='19' height='19' viewBox='0 0 24 24' fill='none'><circle cx='12' cy='12' r='8.5' stroke='currentColor' stroke-width='1.8'/><path d='M8.5 12.2l2.4 2.4 4.6-4.8' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>",
        "pending" => "<svg width='19' height='19' viewBox='0 0 24 24' fill='none'><circle cx='12' cy='12' r='8.5' stroke='currentColor' stroke-width='1.8'/><path d='M12 7.5V12l3 2' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>",
        "completed" => "<svg width='19' height='19' viewBox='0 0 24 24' fill='none'><path d='M4 7l8-4 8 4v10l-8 4-8-4V7z' stroke='currentColor' stroke-width='1.8'/><path d='M8.7 12l2.3 2.3 4.3-4.5' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>",
        "cloud" => "<svg width='18' height='18' viewBox='0 0 24 24' fill='none'><path d='M7 18a4 4 0 01-.6-7.95A5.5 5.5 0 0117.2 9.6 3.75 3.75 0 0116.75 17H7z' stroke='currentColor' stroke-width='1.8' stroke-linejoin='round'/></svg>",
        "shield" => "<svg width='18' height='18' viewBox='0 0 24 24' fill='none'><path d='M12 3l8 3.5V11c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6.5L12 3z' stroke='currentColor' stroke-width='1.8' stroke-linejoin='round'/><path d='M9 12l2 2 4-4' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>",
        _ => ""
    };
    private static void Stat(StringBuilder body, string heading, int count, string icon, string iconClass)
    {
        body.Append("<div class='stat-card'><div class='stat-card__top'><span class='stat-card__label'>").Append(E(heading))
            .Append("</span><span class='stat-card__icon ").Append(iconClass).Append("'>").Append(icon).Append("</span></div>")
            .Append("<strong class='stat-card__value'>").Append(E(count.ToString("N0", Fa))).Append("</strong></div>");
    }
    private static string E(string? text) => WebUtility.HtmlEncode(text ?? "");
}
