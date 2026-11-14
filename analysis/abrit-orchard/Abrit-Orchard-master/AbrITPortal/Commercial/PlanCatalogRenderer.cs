using System.Globalization;
using System.Net;
using System.Text;

namespace AbrITPortal.Commercial;

public static class PlanCatalogRenderer
{
    private static readonly CultureInfo Persian = CultureInfo.GetCultureInfo("fa-IR");

    public static string Render(IEnumerable<CommercialPlanDefinition> plans, bool checkoutReady)
    {
        var visible = plans.OrderBy(p => p.DisplayOrder).Take(5).ToList();
        var html = new StringBuilder();
        html.Append("<section class='plan-section' aria-labelledby='plan-heading'>")
            .Append("<div class='plan-section__heading'><div><span class='eyebrow'>AbrIT Plans</span>")
            .Append("<h2 id='plan-heading'>پلن مناسب کسب‌وکار شما</h2>")
            .Append("<p>مبلغ پایه و تعداد کاربران شامل پلن از فهرست تأییدشده است. زمان SLA به معنی شروع رسیدگی است.</p></div>")
            .Append("<div class='plan-contracts' aria-label='مدت قرارداد'><span>۳ ماهه · ۳٪ تخفیف</span><span>۶ ماهه · ۵٪ تخفیف</span></div></div>")
            .Append("<div class='plan-grid'>");
        foreach (var plan in visible)
        {
            var featured = plan.IsFeatured;
            html.Append("<article class='plan-card").Append(featured ? " plan-card--featured" : "").Append("'>");
            if (featured) html.Append("<span class='plan-card__ribbon'>پیشنهاد AbrIT</span>");
            html.Append("<div class='plan-card__top'><span class='plan-card__code'>").Append(E(plan.Code))
                .Append("</span><h3>").Append(E(plan.PersianName)).Append("</h3>")
                .Append("<span class='plan-card__english' lang='en'>").Append(E(plan.EnglishName)).Append("</span></div>")
                .Append("<div class='plan-card__price'><span>از ماهانه</span><strong dir='ltr'>")
                .Append(FormatNumber(plan.BaseMonthlyPriceToman))
                .Append("</strong><small>تومان</small></div>")
                .Append("<div class='plan-card__facts'><div><span>کاربر شامل</span><strong>")
                .Append(FormatNumber(plan.IncludedUsers)).Append(" نفر</strong></div>")
                .Append("<div><span>شروع رسیدگی</span><strong>").Append(E(plan.SlaDisplayFa))
                .Append("</strong></div></div>");
            if (checkoutReady)
                html.Append("<a class='portal-button portal-button--primary plan-card__action' href='/orders/new?plan=")
                    .Append(Uri.EscapeDataString(plan.Code)).Append("'>انتخاب پلن</a>");
            else
                html.Append("<span class='plan-card__action plan-card__action--pending' aria-label='ثبت سفارش هنوز فعال نیست'>ثبت سفارش پس از تکمیل تعرفه</span>");
            html.Append("</article>");
        }
        html.Append("</div><p class='plan-section__notice' role='status'>")
            .Append("سقف کاربران، هزینه کاربر اضافه و هزینه راه‌اندازی هنوز نهایی نشده‌اند؛ مبلغ نهایی قرارداد و ثبت سفارش پس از تأیید آن‌ها فعال می‌شود.")
            .Append("</p></section>");
        return html.ToString();
    }

    private static string E(string? value) => WebUtility.HtmlEncode(value ?? "");

    private static string FormatNumber(decimal value)
    {
        var source = value.ToString("N0", Persian);
        var result = new StringBuilder(source.Length);
        foreach (var digit in source)
            result.Append(digit is >= '0' and <= '9' ? (char)('۰' + digit - '0') : digit);
        return result.ToString();
    }
}
