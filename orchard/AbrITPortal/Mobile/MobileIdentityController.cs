using System.Net;
using AbrITPortal.Pages;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using OrchardCore.Users;
using OrchardCore.Users.Models;

namespace AbrITPortal.Mobile;

[Route("customer")]
public sealed class MobileIdentityController(
    MobileIdentityService identity,
    UserManager<IUser> users,
    IAntiforgery antiforgery,
    IWebHostEnvironment environment) : Controller
{
    [HttpGet("register")]
    [AllowAnonymous]
    public IActionResult Register() => Page("ثبت‌نام مشتری", "",
        AuthWrap(
            CardHead("ثبت‌نام مشتری", "ساخت حساب کاربری AbrIT", "برای فعال‌سازی حساب، شماره همراه خود را وارد کنید تا کد تأیید پیامکی دریافت شود.")
            + "<div class='auth-card__body'><form method='post' action='/customer/register' class='auth-form'>"
            + Token()
            + Field("reg-username", "نام کاربری", "username", "text", "required autocomplete='username' autofocus")
            + PasswordField("reg-password", "گذرواژه", "password", "required autocomplete='new-password'")
            + PasswordField("reg-confirmation", "تکرار گذرواژه", "confirmation", "required autocomplete='new-password'")
            + "<div class='portal-field'><label for='reg-mobile'>شماره همراه</label><input id='reg-mobile' name='mobile' class='form-control' inputmode='tel' dir='ltr' required placeholder='09xxxxxxxxx' autocomplete='tel'>"
            + "<span class='otp-hint'>کد تأیید ۶ رقمی به این شماره ارسال می‌شود.</span></div>"
            + "<button class='portal-button portal-button--primary' type='submit'>دریافت کد تأیید</button></form></div>"
            + "<div class='auth-alt'>حساب دارید؟ <a href='/Login'>ورود به حساب</a></div>"));

    [HttpPost("register")]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Register(string username, string password, string confirmation, string mobile)
    {
        if (environment.IsProduction()) return LegacySmsUnavailable();
        if (password != confirmation || MobileIdentityService.NormalizeIranianMobile(mobile) is null ||
            string.IsNullOrWhiteSpace(username))
            return Fail("ثبت‌نام ناموفق", "اطلاعات واردشده معتبر نیست. گذرواژه‌ها باید یکسان و شماره همراه معتبر باشد.", "/customer/register");
        var prospective = new User { UserName = username };
        foreach (var validator in users.UserValidators)
            if (!(await validator.ValidateAsync(users, prospective)).Succeeded)
                return Fail("ثبت‌نام ناموفق", "نام کاربری انتخاب‌شده معتبر نیست یا قابل استفاده نمی‌باشد.", "/customer/register");
        foreach (var validator in users.PasswordValidators)
            if (!(await validator.ValidateAsync(users, prospective, password)).Succeeded)
                return Fail("ثبت‌نام ناموفق", "گذرواژه انتخاب‌شده با الزامات امنیتی سازگار نیست.", "/customer/register");
        var challenge = await identity.BeginRegistrationAsync(username, password, mobile, Ip());
        if (!challenge.Accepted)
            return Fail("ثبت‌نام ناموفق", "در حال حاضر امکان ثبت‌نام وجود ندارد. اطلاعات را بررسی کنید یا کمی بعد دوباره تلاش کنید.", "/customer/register");
        return Page("تأیید شماره همراه", "", AuthWrap(VerifyForm("/customer/register/verify", challenge.ChallengeId,
            "تأیید همراه", "کد تأیید ارسال‌شده", "کد ۶ رقمی ارسال‌شده به شماره همراه را وارد کنید تا حساب شما ایجاد شود.", "تأیید و ایجاد حساب", "/customer/register", "ویرایش اطلاعات ثبت‌نام")));
    }

    [HttpPost("register/verify")]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> VerifyRegistration(string challenge, string code)
    {
        if (!(await identity.CompleteRegistrationAsync(challenge, code)).Succeeded)
            return Fail("تأیید ناموفق", "کد واردشده نامعتبر یا منقضی شده است. می‌توانید دوباره تلاش کنید.", "/customer/register");
        return Page("ثبت‌نام انجام شد", "",
            AuthWrap("<section class='portal-card auth-success'><div class='portal-empty-state__icon'>" + PortalShell.Mark + "</div>"
            + "<h1>حساب کاربری ایجاد شد</h1><p class='text-muted'>حساب شما با موفقیت فعال شد. اکنون می‌توانید با نام کاربری و گذرواژه وارد شوید.</p>"
            + "<a class='portal-button portal-button--primary' href='/Login'>ورود به حساب</a></section>", false));
    }

    [HttpGet("mobile")]
    [Authorize]
    public async Task<IActionResult> Mobile()
    {
        var account = await users.GetUserAsync(User);
        if (account is not User user) return Forbid();
        var status = user.PhoneNumberConfirmed
            ? "<span class='status-badge status-badge--success'>تأیید شده</span>"
            : "<span class='status-badge status-badge--warning'>در انتظار تأیید</span>";
        return Page("مدیریت شماره همراه", "account",
            "<div class='page-heading'><div><span class='eyebrow'>حساب کاربری</span><h1>مدیریت شماره همراه</h1>"
            + "<p>شماره همراه تأییدشده برای اطلاع‌رسانی و بازیابی امن حساب استفاده می‌شود.</p></div></div>"
            + "<section class='panel' style='max-width:720px'><div class='panel__header'><h2>وضعیت فعلی</h2>" + status + "</div>"
            + "<div class='panel__body'><dl class='details-list'><div><dt>شماره فعلی</dt><dd dir='ltr'>"
            + E(string.IsNullOrWhiteSpace(user.PhoneNumber) ? "ثبت نشده" : user.PhoneNumber)
            + "</dd></div><div><dt>تغییر شماره</dt><dd>شماره جدید پس از تأیید کد پیامکی جایگزین می‌شود.</dd></div></dl>"
            + "<form method='post' action='/customer/mobile' class='auth-form' style='margin-top:1.25rem'>"
            + Token()
            + "<div class='portal-field'><label for='mob-new'>شماره همراه جدید</label><input id='mob-new' name='mobile' class='form-control' inputmode='tel' dir='ltr' required placeholder='09xxxxxxxxx' autocomplete='tel'></div>"
            + "<div class='panel__actions' style='padding:0'><button class='portal-button portal-button--primary' type='submit'>ارسال کد تأیید</button><a class='portal-button portal-button--ghost' href='/account'>بازگشت به حساب</a></div></form>"
            + "<p class='text-muted' style='margin:.9rem 0 0;font-size:.85rem'>تا زمان تأیید شماره جدید، شماره قبلی حفظ می‌شود.</p></div></section>");
    }

    [HttpPost("mobile")]
    [Authorize]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> BeginMobile(string mobile)
    {
        if (environment.IsProduction()) return LegacySmsUnavailable();
        var account = await users.GetUserAsync(User);
        if (account is null) return Forbid();
        var challenge = await identity.BeginMobileVerificationAsync(account, mobile, Ip());
        if (!challenge.Accepted)
            return Fail("تأیید همراه ناموفق", "شماره واردشده قابل تأیید نیست. لطفاً شماره معتبر وارد کنید.", "/customer/mobile");
        return Page("تأیید شماره جدید", "account", AuthWrap(VerifyForm("/customer/mobile/verify", challenge.ChallengeId,
            "تأیید همراه", "تأیید شماره جدید", "کد ۶ رقمی ارسال‌شده به شماره جدید را وارد کنید.", "تأیید شماره", "/customer/mobile", "تغییر شماره")));
    }

    [HttpPost("mobile/verify")]
    [Authorize]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> VerifyMobile(string challenge, string code)
    {
        var account = await users.GetUserAsync(User);
        if (account is null) return Forbid();
        if (!(await identity.CompleteMobileVerificationAsync(account, challenge, code)).Succeeded)
            return Fail("تأیید همراه ناموفق", "کد واردشده نامعتبر یا منقضی شده است.", "/customer/mobile");
        return Redirect("/account");
    }

    [HttpGet("recover")]
    [AllowAnonymous]
    public IActionResult Recover() => Page("بازیابی گذرواژه", "",
        AuthWrap(
            CardHead("بازیابی حساب", "بازیابی گذرواژه با شماره همراه", "در صورت وجود حساب با شماره همراه تأییدشده، کد تأیید برای بازیابی ارسال می‌شود.")
            + "<div class='auth-card__body'><form method='post' action='/customer/recover' class='auth-form'>"
            + Token()
            + Field("rec-id", "نام کاربری یا شماره همراه", "usernameOrMobile", "text", "required autocomplete='username'")
            + "<button class='portal-button portal-button--primary' type='submit'>ارسال کد تأیید</button></form></div>"
            + "<div class='auth-alt'>شماره تأییدشده ندارید؟ <a href='/ForgotPassword'>بازیابی با ایمیل (Orchard)</a></div>"));

    [HttpPost("recover")]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> BeginRecovery(string usernameOrMobile)
    {
        if (environment.IsProduction()) return LegacySmsUnavailable();
        var challenge = await identity.BeginRecoveryAsync(usernameOrMobile, Ip());
        return Page("بازیابی گذرواژه", "", AuthWrap(VerifyForm("/customer/recover/verify", challenge.ChallengeId,
            "بازیابی حساب", "تأیید کد بازیابی", "اگر حسابی با شناسه واردشده و شماره تأییدشده وجود داشته باشد، کد ارسال شده است. کد را وارد کنید.", "ادامه", "/customer/recover", "بازگشت")));
    }

    [HttpPost("recover/verify")]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public IActionResult VerifyRecovery(string challenge, string code)
    {
        var result = identity.VerifyRecovery(challenge, code);
        if (!result.Succeeded)
            return Fail("بازیابی ناموفق", "کد واردشده نامعتبر یا منقضی شده است.", "/customer/recover");
        return Page("تعیین گذرواژه جدید", "",
            AuthWrap(
                CardHead("بازیابی حساب", "تعیین گذرواژه جدید", "گذرواژه جدید خود را وارد کنید. پس از ذخیره، می‌توانید وارد حساب شوید.")
                + "<div class='auth-card__body'><form method='post' action='/customer/recover/reset' class='auth-form'>"
                + Token()
                + "<input type='hidden' name='authorization' value='" + E(result.Authorization) + "'>"
                + PasswordField("new-pass", "گذرواژه جدید", "password", "required autocomplete='new-password'")
                + PasswordField("new-pass2", "تکرار گذرواژه جدید", "confirmation", "required autocomplete='new-password'")
                + "<button class='portal-button portal-button--primary' type='submit'>ذخیره گذرواژه جدید</button></form></div>"));
    }

    [HttpPost("recover/reset")]
    [AllowAnonymous]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> ResetPassword(string authorization, string password, string confirmation)
    {
        if (password != confirmation || !await identity.ResetPasswordAsync(authorization, password))
            return Fail("بازنشانی ناموفق", "درخواست بازنشانی نامعتبر یا منقضی شده است. لطفاً فرآیند را دوباره آغاز کنید.", "/customer/recover");
        return Page("بازنشانی انجام شد", "",
            AuthWrap("<section class='portal-card auth-success'><div class='portal-empty-state__icon'>" + PortalShell.Mark + "</div>"
            + "<h1>گذرواژه با موفقیت تغییر کرد</h1><p class='text-muted'>اکنون می‌توانید با گذرواژه جدید وارد حساب کاربری شوید.</p>"
            + "<a class='portal-button portal-button--primary' href='/Login'>ورود به حساب</a></section>", false));
    }

    private ContentResult Fail(string title, string message, string backHref) =>
        Content(PortalShell.ErrorPage(HttpContext, 400, title, message, backHref, "بازگشت"), "text/html; charset=utf-8");

    private ContentResult LegacySmsUnavailable() => new()
    {
        StatusCode = 503,
        ContentType = "text/html; charset=utf-8",
        Content = PortalShell.ErrorPage(HttpContext, 503, "ارسال پیامک در این بخش در دسترس نیست",
            "برای دریافت کد تأیید از بخش ورود و بازیابی پورتال استفاده کنید.", "/auth/login", "بازگشت به پورتال")
    };

    private static string AuthWrap(string inner, bool asCard = true) =>
        "<div class='auth-wrap'>" + (asCard ? "<section class='auth-card'>" + inner + "</section>" : inner) + "</div>";

    private static string CardHead(string eyebrow, string title, string lead) =>
        "<div class='auth-card__head'><span class='eyebrow'>" + E(eyebrow) + "</span><h1>" + E(title) + "</h1><p>" + E(lead) + "</p></div>";

    private static string Field(string id, string label, string name, string type, string attrs) =>
        "<div class='portal-field'><label for='" + id + "'>" + E(label) + "</label><input id='" + id + "' name='" + name + "' type='" + type + "' class='form-control' " + attrs + "></div>";

    private static string PasswordField(string id, string label, string name, string attrs) =>
        "<div class='portal-field'><label for='" + id + "'>" + E(label) + "</label>"
        + "<div class='password-control'><input id='" + id + "' name='" + name + "' type='password' class='form-control' " + attrs + ">"
        + "<button type='button' class='pw-toggle' data-target='" + id + "' aria-pressed='false'>نمایش</button></div></div>"
        + "<script>(function(){var b=document.querySelector(\"button.pw-toggle[data-target='" + id + "']\");if(!b||b._w)return;b._w=1;b.addEventListener('click',function(){var f=document.getElementById('" + id + "');if(!f)return;var v=f.type==='password';f.type=v?'text':'password';b.textContent=v?'پنهان':'نمایش';b.setAttribute('aria-pressed',String(v));});})();</script>";

    private string VerifyForm(string action, string challenge, string eyebrow, string title, string lead, string button, string backHref, string backText) =>
        CardHead(eyebrow, title, lead)
        + "<div class='auth-card__body'><form method='post' action='" + E(action) + "' class='auth-form'>"
        + Token()
        + "<input type='hidden' name='challenge' value='" + E(challenge) + "'>"
        + "<div class='portal-field'><label for='otp-code'>کد تأیید ۶ رقمی</label>"
        + "<input id='otp-code' name='code' class='form-control' inputmode='numeric' maxlength='6' pattern='[0-9]*' required autocomplete='one-time-code' dir='ltr' style='letter-spacing:.45em;text-align:center;font-weight:700;font-size:1.15rem' placeholder='------'></div>"
        + "<span class='otp-hint'>اعتبار کد محدود است. کد را دقیق وارد کنید.</span>"
        + "<button class='portal-button portal-button--primary' type='submit'>" + E(button) + "</button></form></div>"
        + "<div class='auth-alt'><a href='" + E(backHref) + "'>" + E(backText) + "</a></div>";

    private string Token() => "<input type='hidden' name='__RequestVerificationToken' value='" +
        E(antiforgery.GetAndStoreTokens(HttpContext).RequestToken) + "'>";
    private string Ip() => HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    private IActionResult Page(string title, string active, string body)
    {
        var token = antiforgery.GetAndStoreTokens(HttpContext).RequestToken;
        return Content(PortalShell.Render(title, active, User.Identity?.IsAuthenticated == true,
            User.Identity?.Name, token, body), "text/html; charset=utf-8");
    }
    private static string E(string? value) => WebUtility.HtmlEncode(value ?? "");
}
