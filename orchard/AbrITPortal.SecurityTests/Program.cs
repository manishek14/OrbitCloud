using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using AbrITPortal.Drive;
using AbrITPortal.Orders;
using AbrITPortal.Security;
using AbrITPortal.Commercial;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OrchardCore.ContentManagement;
using OrchardCore.ContentManagement.Display;
using OrchardCore.Contents;
using OrchardCore.Contents.Controllers;
using OrchardCore.Contents.Security;
using OrchardCore.Security;
using OrchardCore.Security.AuthorizationHandlers;
using OrchardCore.Security.Permissions;

var catalogTemplatePath = Path.Combine(AppContext.BaseDirectory, "Content-ServiceCatalogPage.Detail.liquid");
if (!File.Exists(catalogTemplatePath))
    throw new FileNotFoundException("Public catalog template was not found", catalogTemplatePath);
var catalogTemplate = File.ReadAllText(catalogTemplatePath);
var failures = 0;
var assertions = 0;
void Check(bool result, string name)
{
    assertions++;
    Console.WriteLine((result ? "PASS " : "FAIL ") + name);
    if (!result) failures++;
}
Check(!catalogTemplate.Contains("AdminAllOrders", StringComparison.Ordinal) && !catalogTemplate.Contains("Queries.MyOrders", StringComparison.Ordinal), "public catalog contains no order query");
// NOTE: the former PortalController (dashboard/account MVC pages) was retired
// when the customer portal moved to the Next.js application. Its authorization
// behavior (session-gated portal pages, per-identifier login throttling,
// ownership checks) is enforced by the portal API and covered by the bun test
// suite (tests/login-throttle.test.ts, tests/drive-entitlement.test.ts and
// the portal route auth tests) — nothing to assert here.
var serviceListPath = Path.Combine(AppContext.BaseDirectory, "Content-AbrITService.List.liquid");
Check(!File.ReadAllText(serviceListPath).Contains("/orders/new", StringComparison.Ordinal), "catalog has no fake checkout action");
Check(typeof(DriveController).GetMethod("Index")!.GetCustomAttributes(typeof(AuthorizeAttribute), true).Length > 0, "drive page requires authenticated user");
Check(typeof(DriveController).GetMethod("Provision")!.GetCustomAttributes(typeof(AuthorizeAttribute), true).Length > 0, "drive provisioning requires authenticated user");
Check(typeof(DriveController).GetMethod("Provision")!.GetCustomAttributes(typeof(ValidateAntiForgeryTokenAttribute), true).Length > 0, "drive provisioning requires antiforgery token");
var quotaXml = "<d:multistatus xmlns:d=\"DAV:\"><d:response><d:propstat><d:prop><d:quota-used-bytes>734003200</d:quota-used-bytes><d:quota-available-bytes>10737418240</d:quota-available-bytes></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>";
var driveReady = DriveStatusService.Interpret(HttpStatusCode.MultiStatus, quotaXml);
Check(DriveStatusService.FolderName("customer-a") == DriveStatusService.FolderName("customer-a"), "drive folder name is stable");
Check(DriveStatusService.FolderName("customer-a") != DriveStatusService.FolderName("customer-b"), "drive folder names differ per user");
Check(DriveStatusService.FolderName("customer-a").StartsWith("u-") && !DriveStatusService.FolderName("customer-a").Contains("customer"), "drive folder name does not leak the user id");
Check(driveReady.IsReady && driveReady.UsedBytes == 734003200 && driveReady.TotalBytes == 11471421440, "drive 207 quota parsed");
Check(DriveStatusService.Interpret(HttpStatusCode.NotFound, null).State == DriveState.Missing, "drive 404 means missing folder");
Check(DriveStatusService.Interpret(HttpStatusCode.Unauthorized, null).State == DriveState.Unreachable, "drive 401 means unreachable");
// NOTE: the former PortalController.CanDisplayOrders dashboard filter moved to
// the Next.js portal (src/app/api/portal/* ownership scoping) — its ownership
// rules are asserted below through the REAL Orchard authorization pipeline.
var a = Principal("customer-a");
var b = Principal("customer-b");
var admin = Principal("admin", "Administrator");
var anonymous = new ClaimsPrincipal(new ClaimsIdentity());
var orders = new Dictionary<string, ContentItem>
{
    ["a"] = new() { ContentType = "AbrITOrder", ContentItemId = "a", Owner = "customer-a", Published = true },
    ["b"] = new() { ContentType = "AbrITOrder", ContentItemId = "b", Owner = "customer-b", Published = true },
    ["unassigned"] = new() { ContentType = "AbrITOrder", ContentItemId = "unassigned", Published = true },
    ["draft"] = new() { ContentType = "AbrITOrder", ContentItemId = "draft", Owner = "customer-a" }
};

// Real Orchard permission handlers run both before and after the veto in separate containers.
foreach (var vetoFirst in new[] { false, true })
{
    var services = new ServiceCollection();
    services.AddLogging();
    services.AddAuthorization();
    services.AddSingleton<IPermissionGrantingService, DefaultPermissionGrantingService>();
    if (vetoFirst) services.AddTransient<IAuthorizationHandler, OrderAuthorizationHandler>();
    services.AddTransient<IAuthorizationHandler, PermissionHandler>();
    services.AddTransient<IAuthorizationHandler, ContentTypeAuthorizationHandler>();
    services.AddTransient<IAuthorizationHandler, PublicContentGrant>();
    if (!vetoFirst) services.AddTransient<IAuthorizationHandler, OrderAuthorizationHandler>();
    await using var provider = services.BuildServiceProvider();
    var authorization = provider.GetRequiredService<IAuthorizationService>();
    async Task<bool> Allowed(ClaimsPrincipal user, object item, Permission? permission = null) =>
        (await authorization.AuthorizeAsync(user, item,
            new[] { new PermissionRequirement(permission ?? CommonPermissions.ViewContent) })).Succeeded;

    Check(!await Allowed(anonymous, orders["a"]), $"anonymous denied; vetoFirst={vetoFirst}");
    Check(await Allowed(a, orders["a"]), $"A owns A; vetoFirst={vetoFirst}");
    Check(!await Allowed(a, orders["b"]), $"A cannot read B; vetoFirst={vetoFirst}");
    Check(await Allowed(b, orders["b"]), $"B owns B; vetoFirst={vetoFirst}");
    Check(await Allowed(admin, orders["b"]), $"administrator reads B; vetoFirst={vetoFirst}");
    Check(!await Allowed(a, orders["unassigned"]), "unassigned order denied");
    Check(!await Allowed(a, orders["draft"]), "customer draft denied");
    Check(!await Allowed(a, orders["a"], CommonPermissions.EditContent), "owner cannot edit order");
    Check(!await Allowed(Principal(null), orders["a"]), "missing stable identifier denied");
    Check(!await Allowed(Principal("other", name: "customer-a"), orders["a"]), "username is not ownership");
    Check(await Allowed(anonymous, new ContentItem { ContentType = "AbrITService", Published = true }), "public catalog preserved");
    Check(!await Allowed(a, "AbrITOrder"), "type-only permission cannot bypass ownership");
}

var builder = WebApplication.CreateBuilder();
builder.Logging.ClearProviders();

// ─── Phase 5: minimal WebDAV stand-in for Nextcloud, driven over real HTTP ───
var davCreated = new HashSet<string>();
var davPropfindStatus = 207;
const string DavUser = "abrit-portal";
const string DavSecret = "s3cret-app-password";
var davAuth = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes(DavUser + ":" + DavSecret));
var davBuilder = WebApplication.CreateBuilder();
davBuilder.Logging.ClearProviders();
davBuilder.WebHost.UseUrls("http://127.0.0.1:0");
await using var dav = davBuilder.Build();
dav.MapMethods("/dav/files/{user}/{**path}", ["MKCOL"], (HttpRequest request, HttpResponse response, string user, string? path) =>
{
    if (!string.Equals(request.Headers["Authorization"], davAuth, StringComparison.Ordinal)) { response.StatusCode = 401; return Task.CompletedTask; }
    var full = ("/dav/files/" + user + (string.IsNullOrEmpty(path) ? "" : "/" + path)).TrimEnd('/');
    var parent = full[..full.LastIndexOf('/')];
    var accountRoot = "/dav/files/" + user;
    if (parent != accountRoot && !davCreated.Contains(parent)) { response.StatusCode = 409; return Task.CompletedTask; }
    if (davCreated.Contains(full)) { response.StatusCode = 405; return Task.CompletedTask; }
    davCreated.Add(full);
    response.StatusCode = 201;
    return Task.CompletedTask;
});
dav.MapMethods("/dav/files/{user}/{**path}", ["PROPFIND"], async (HttpRequest request, HttpResponse response, string user, string? path) =>
{
    if (!string.Equals(request.Headers["Authorization"], davAuth, StringComparison.Ordinal)) { response.StatusCode = 401; await response.WriteAsync(""); return; }
    var full = ("/dav/files/" + user + (string.IsNullOrEmpty(path) ? "" : "/" + path)).TrimEnd('/');
    if (davPropfindStatus != 207) { response.StatusCode = davPropfindStatus; await response.WriteAsync(""); return; }
    if (!davCreated.Contains(full)) { response.StatusCode = 404; await response.WriteAsync(""); return; }
    response.StatusCode = 207;
    response.ContentType = "application/xml";
    await response.WriteAsync(quotaXml);
});
await dav.StartAsync();
var davAddress = dav.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single().TrimEnd('/');

builder.Services.AddControllersWithViews().AddApplicationPart(typeof(DriveController).Assembly);
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Services.AddAuthorization();
builder.Services.AddMemoryCache();
builder.Services.AddAntiforgery();
builder.Services.Configure<AbrITDriveOptions>(options =>
{
    options.Enabled = true;
    options.BaseUrl = davAddress;
    options.Username = DavUser;
    options.AppPassword = DavSecret;
    options.DavPath = "/dav/files";
    options.CustomerRoot = "AbrITPortal";
    options.CacheSeconds = 0;
    options.AllowInsecure = true;
});
builder.Services.AddHttpClient<DriveStatusService>();
builder.Services.AddAuthentication("Fixture").AddScheme<AuthenticationSchemeOptions, FixtureAuthentication>("Fixture", _ => { });
builder.Services.AddSingleton<IAuthorizationHandler, PublicContentGrant>();
builder.Services.AddSingleton<IAuthorizationHandler, OrderAuthorizationHandler>();
builder.Services.AddSingleton<IContentManager>(Proxy<IContentManager>.Create((method, args) =>
{
    if (method.Name == "GetAsync") return Task.FromResult(orders.GetValueOrDefault((string)args![0]!));
    throw new InvalidOperationException("Unexpected content manager operation: " + method.Name);
}));
builder.Services.AddSingleton<IContentItemDisplayManager>(Proxy<IContentItemDisplayManager>.Create((method, _) =>
{
    if (method.Name == "BuildDisplayAsync") return Task.FromResult<OrchardCore.DisplayManagement.IShape>(null!);
    throw new InvalidOperationException("Unexpected display operation: " + method.Name);
}));
builder.Services.AddTransient<ItemController>();
await using var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
// Exercise the actual Orchard controller, not a replacement ownership endpoint.
async Task<IResult> Display(HttpContext context, string contentItemId)
{
    var controller = context.RequestServices.GetRequiredService<ItemController>();
    controller.ControllerContext = new ControllerContext { HttpContext = context };
    var result = await controller.Display(contentItemId, null!);
    return result switch
    {
        ViewResult => Results.Text("authorized"),
        ChallengeResult => Results.Unauthorized(),
        ForbidResult => Results.StatusCode(403),
        NotFoundResult => Results.NotFound(),
        _ => throw new InvalidOperationException("Unexpected MVC result")
    };
}
app.MapGet("/Contents/Item/Display/{contentItemId}", Display);
app.MapGet("/order-alias/{contentItemId}", Display);
await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
using var client = new HttpClient(new HttpClientHandler { UseProxy = false }) { BaseAddress = new Uri(address) };
async Task Status(string? user, string path, HttpStatusCode expected, string name)
{
    using var request = new HttpRequestMessage(HttpMethod.Get, path);
    if (user != null) request.Headers.Add("X-Fixture-User", user);
    using var response = await client.SendAsync(request);
    Check(response.StatusCode == expected, name + " HTTP " + (int)response.StatusCode);
}
await Status(null, "/Contents/Item/Display/a", HttpStatusCode.Unauthorized, "anonymous direct URL");
await Status("customer-a", "/Contents/Item/Display/a", HttpStatusCode.OK, "A direct own URL");
await Status("customer-a", "/Contents/Item/Display/b", HttpStatusCode.Forbidden, "A direct B URL");
await Status("customer-b", "/Contents/Item/Display/b", HttpStatusCode.OK, "B direct own URL");
await Status("admin", "/Contents/Item/Display/b", HttpStatusCode.OK, "administrator direct URL");
await Status("customer-a", "/order-alias/b", HttpStatusCode.Forbidden, "alias cannot bypass authorization");
await Status("customer-a", "/Contents/Item/Display/draft", HttpStatusCode.Forbidden, "draft direct URL");

// ─── Phase 5: live Drive checks against the in-process WebDAV stand-in ───
var harnessEnvironment = app.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.IWebHostEnvironment>();
var driveCache = new MemoryCache(new MemoryCacheOptions());
var disabledDrive = new DriveStatusService(new HttpClient(), Options.Create(new AbrITDriveOptions()), driveCache, harnessEnvironment);
Check((await disabledDrive.GetStatusAsync("someone")).State == DriveState.NotConfigured, "drive disabled → honest not-configured state");
Check((await disabledDrive.EnsureFolderAsync("someone")).State == DriveState.NotConfigured, "provisioning refuses when drive is disabled");
var insecureDrive = new DriveStatusService(new HttpClient(), Options.Create(new AbrITDriveOptions
{
    Enabled = true, BaseUrl = "http://drive.example", Username = "u", AppPassword = "p"
}), driveCache, harnessEnvironment);
var insecureStatus = await insecureDrive.GetStatusAsync("someone");
Check(insecureStatus.State == DriveState.Unreachable && (insecureStatus.Detail ?? "").Contains("HTTPS"),
    "plain-http drive refused outside development");
var deadDrive = new DriveStatusService(new HttpClient(), Options.Create(new AbrITDriveOptions
{
    Enabled = true, BaseUrl = "http://127.0.0.1:1", Username = "u", AppPassword = "p", AllowInsecure = true
}), driveCache, harnessEnvironment);
Check((await deadDrive.GetStatusAsync("someone")).State == DriveState.Unreachable, "unreachable drive stays honest");

using var cookieHandler = new HttpClientHandler
{
    UseProxy = false,
    CookieContainer = new System.Net.CookieContainer(),
    AllowAutoRedirect = false
};
using var browser = new HttpClient(cookieHandler) { BaseAddress = new Uri(address) };
async Task<(HttpStatusCode Code, string Body)> Fetch(string? user, string path, HttpMethod? method = null,
    FormUrlEncodedContent? form = null)
{
    using var request = new HttpRequestMessage(method ?? HttpMethod.Get, path);
    if (user != null) request.Headers.Add("X-Fixture-User", user);
    if (form != null) request.Content = form;
    using var response = await browser.SendAsync(request);
    return (response.StatusCode, await response.Content.ReadAsStringAsync());
}
var (anonDrive, anonDriveBody) = await Fetch(null, "/drive");
Check(anonDrive == HttpStatusCode.Unauthorized || (int)anonDrive is 302 or 301,
    "anonymous /drive denied (HTTP " + (int)anonDrive + ")");
var (anonProvision, _) = await Fetch(null, "/drive/provision", HttpMethod.Post, new FormUrlEncodedContent([]));
Check(anonProvision == HttpStatusCode.Unauthorized || (int)anonProvision is 302 or 301,
    "anonymous /drive/provision denied (HTTP " + (int)anonProvision + ")");

var (missingCode, missingBody) = await Fetch("customer-drive-a", "/drive");
Check(missingCode == HttpStatusCode.OK && missingBody.Contains("فعال‌سازی فضای من"),
    "missing drive state offers provisioning (HTTP " + (int)missingCode + ")");
Check(!missingBody.Contains(DavSecret), "missing drive page leaks no credentials");
Check(!missingBody.Contains(DriveStatusService.FolderName("customer-drive-a")), "drive page hides the internal folder name");
var driveToken = Regex.Match(missingBody, "name='__RequestVerificationToken' value='([^']+)'").Groups[1].Value;
Check(driveToken.Length > 0, "provision form carries antiforgery token");
var (noTokenCode, _) = await Fetch("customer-drive-a", "/drive/provision", HttpMethod.Post,
    new FormUrlEncodedContent([]));
Check(noTokenCode == HttpStatusCode.BadRequest, "provision without antiforgery rejected (HTTP " + (int)noTokenCode + ")");
var (provisionCode, _) = await Fetch("customer-drive-a", "/drive/provision", HttpMethod.Post,
    new FormUrlEncodedContent(new Dictionary<string, string> { ["__RequestVerificationToken"] = driveToken }));
Check(provisionCode == HttpStatusCode.Redirect, "provisioning redirects (HTTP " + (int)provisionCode + ")");
var (readyCode, readyBody) = await Fetch("customer-drive-a", "/drive");
Check(readyCode == HttpStatusCode.OK, "drive ready page HTTP 200");
Check(readyBody.Contains("متصل"), "drive ready badge rendered");
Check(readyBody.Contains("مگابایت") || readyBody.Contains("گیگابایت"), "drive quota from real server data");
Check(davCreated.Contains("/dav/files/abrit-portal/AbrITPortal/" + DriveStatusService.FolderName("customer-drive-a")),
    "customer folder really created on the DAV server");
Check(!readyBody.Contains(DavSecret), "drive page never leaks the app password");
Check(!readyBody.Contains("فعال‌سازی فضای من"), "ready state hides provisioning");

davPropfindStatus = 401;
var (unreachableCode, unreachableBody) = await Fetch("customer-drive-b", "/drive");
Check(unreachableCode == HttpStatusCode.OK && unreachableBody.Contains("اعتبارنامه"),
    "drive 401 → honest unreachable message");
Check(!unreachableBody.Contains(DavSecret) && !unreachableBody.Contains(davAuth),
    "unreachable page leaks no credentials");
davPropfindStatus = 207;

await dav.StopAsync();
await app.StopAsync();

// --- M2: Commercial pricing engine ---
{
    var engine = new PricingEngine();
    var defaults = CommercialDefaults.CreateDefaultRules();
    Check(defaults.Plans.Count == 5 && defaults.Plans.All(p => !p.IsPublished && p.MaximumUsers == 0 && p.AdditionalUserMonthlyFeeToman == 0m), "incomplete plans remain unpublished");
    Check(!defaults.CommercialValuesApproved && defaults.Contracts.All(c => c.OnboardingRateOfBaseMonthlyPrice == 0m), "unapproved onboarding stays unavailable");
    Check(!engine.Calculate(new PricingRequest("P1", 4, ContractMonths.Three), defaults).IsValid, "unapproved prices cannot be quoted");

    var expected = new (string Code, decimal Base, int Inc, int Min, int Max, decimal Extra, SlaType Sla, int? MinResp, string Disp, bool Featured)[]
    {
        ("P1",12950000m,4,4,6,1700000m,SlaType.Timed,480,"۸ ساعت",false),
        ("P2",19500000m,7,7,9,1990000m,SlaType.Timed,300,"۵ ساعت",false),
        ("P3",29500000m,10,10,13,2290000m,SlaType.Timed,180,"۳ ساعت",true),
        ("P4",45900000m,20,20,25,2790000m,SlaType.Timed,60,"۱ ساعت",false),
        ("P5",66900000m,30,30,37,3390000m,SlaType.Immediate,null,"لحظه‌ای",false),
    };
    // Screenshot base amounts are approved; extra users and onboarding remain test-only fixture values.
    var fixturePlans = defaults.Plans.Select(p =>
    {
        var e = expected.Single(x => x.Code == p.Code);
        return p with { BaseMonthlyPriceToman = e.Base, IncludedUsers = e.Inc,
            MinimumUsers = e.Min, MaximumUsers = e.Max, AdditionalUserMonthlyFeeToman = e.Extra,
            IsPublished = true };
    }).ToList();
    var rules = defaults with { Plans = fixturePlans, Contracts = new[] {
        new ContractPolicy(ContractMonths.Three, 0.03m, 0.50m),
        new ContractPolicy(ContractMonths.Six, 0.05m, 0.25m)
    }, CommercialValuesApproved = true };
    Check(rules.Contracts.Count == 2 && rules.Contracts.Any(c => c.Months == ContractMonths.Three && c.DiscountRate == 0.03m), "3-month contract policy");
    Check(rules.Contracts.Any(c => c.Months == ContractMonths.Six && c.DiscountRate == 0.05m), "6-month contract policy");
    foreach (var e in expected)
    {
        var p = rules.Plans.Single(x => x.Code == e.Code);
        Check(p.BaseMonthlyPriceToman == e.Base && p.IncludedUsers == e.Inc && p.MinimumUsers == e.Min && p.MaximumUsers == e.Max && p.AdditionalUserMonthlyFeeToman == e.Extra, $"{e.Code} commercial values");
        Check(p.SlaType == e.Sla && p.SlaResponseMinutes == e.MinResp && p.SlaDisplayFa == e.Disp, $"{e.Code} SLA");
        Check(p.IsFeatured == e.Featured && p.IsPublished, $"{e.Code} flags");
        if (p.SlaType == SlaType.Immediate) Check(p.SlaResponseMinutes is null, $"{e.Code} immediate not timed-zero");
    }

    PricingBreakdown Calc(string code, int users, ContractMonths m) => engine.Calculate(new PricingRequest(code, users, m), rules);
    // Boundaries & base cases per plan
    foreach (var e in expected)
    {
        Check(Calc(e.Code, e.Min, ContractMonths.Three).IsValid, $"{e.Code} min users valid");
        Check(Calc(e.Code, e.Max, ContractMonths.Six).IsValid, $"{e.Code} max users valid");
        Check(!Calc(e.Code, e.Min - 1, ContractMonths.Three).IsValid, $"{e.Code} below min invalid");
        Check(!Calc(e.Code, e.Max + 1, ContractMonths.Three).IsValid, $"{e.Code} above max invalid");
    }
    // Invalid selections
    Check(!Calc("PX", 4, ContractMonths.Three).IsValid, "unknown plan invalid");
    Check(!Calc("P1", 4, (ContractMonths)12).IsValid, "12-month contract rejected");
    Check(!Calc("P1", 4, (ContractMonths)1).IsValid, "1-month contract rejected");
    Check(!Calc("P1", 3, ContractMonths.Three).IsValid, "P1 below included/min invalid");

    // Pricing math samples (all plans, 3m & 6m, included users)
    void Expect(string code, int users, ContractMonths m, decimal monthly, decimal subtotal, decimal discount, decimal onboarding, decimal final)
    {
        var b = Calc(code, users, m);
        Check(b.IsValid, $"{code} {users}u {m} valid");
        Check(b.MonthlyTotalToman == monthly, $"{code} monthly");
        Check(b.SubtotalToman == subtotal, $"{code} subtotal");
        Check(b.DiscountAmountToman == discount, $"{code} discount");
        Check(b.OnboardingFeeToman == onboarding, $"{code} onboarding");
        Check(b.FinalTotalToman == final, $"{code} final");
        Check(b.MonthlyTotalRial == monthly * 10m && b.FinalTotalRial == final * 10m, $"{code} rial conversion");
    }
    // P1 base
    Expect("P1",4,ContractMonths.Three,12950000m,38850000m,1165500m,6475000m,44159500m);
    Expect("P1",4,ContractMonths.Six,12950000m,77700000m,3885000m,3237500m,77052500m);
    // P1 max +2 users
    Expect("P1",6,ContractMonths.Three,16350000m,49050000m,1471500m,6475000m,54053500m);
    Expect("P1",6,ContractMonths.Six,16350000m,98100000m,4905000m,3237500m,96432500m);
    // P2
    Expect("P2",7,ContractMonths.Three,19500000m,58500000m,1755000m,9750000m,66495000m);
    Expect("P2",9,ContractMonths.Six,23480000m,140880000m,7044000m,4875000m,138711000m);
    // P3
    Expect("P3",10,ContractMonths.Three,29500000m,88500000m,2655000m,14750000m,100595000m);
    Expect("P3",13,ContractMonths.Six,36370000m,218220000m,10911000m,7375000m,214684000m);
    // P4
    Expect("P4",20,ContractMonths.Three,45900000m,137700000m,4131000m,22950000m,156519000m);
    Expect("P4",25,ContractMonths.Six,59850000m,359100000m,17955000m,11475000m,352620000m);
    // P5
    Expect("P5",30,ContractMonths.Three,66900000m,200700000m,6021000m,33450000m,228129000m);
    Expect("P5",37,ContractMonths.Six,90630000m,543780000m,27189000m,16725000m,533316000m);

    // Onboarding excludes additional users (compare base vs extra-user same plan/contract)
    var p1Base3 = Calc("P1",4,ContractMonths.Three); var p1Extra3 = Calc("P1",6,ContractMonths.Three);
    Check(p1Base3.OnboardingFeeToman == p1Extra3.OnboardingFeeToman && p1Extra3.OnboardingFeeToman == 6475000m, "onboarding excludes additional users");
    Check(p1Extra3.MonthlyTotalToman > p1Base3.MonthlyTotalToman, "additional users affect monthly total");

    // Currency precision / deterministic rounding
    Check(rules.TaxAmountConfirmed == false && !string.IsNullOrWhiteSpace(rules.TaxDisplayNote), "tax not invented");
    Check(CommercialDefaults.TomanToRialFactor == 10m, "toman-rial factor explicit");

    // Snapshot immutability
    var snap = engine.CreateSnapshot(new PricingRequest("P2",8,ContractMonths.Three), rules);
    Check(snap.PlanCode == "P2" && snap.SelectedUsers == 8 && snap.AdditionalUsers == 1 && snap.ContractMonths == 3, "snapshot values");
    Check(snap.FinalTotalToman == Calc("P2",8,ContractMonths.Three).FinalTotalToman, "snapshot matches breakdown");
    // config change does not affect captured snapshot
    var modifiedPlans = rules.Plans.Select(p => p.Code=="P2" ? p with { BaseMonthlyPriceToman = 1m } : p).ToList();
    var modifiedRules = new CommercialRules(modifiedPlans, rules.Contracts.ToList(), rules.Currency, rules.TaxDisplayNote, rules.TaxAmountConfirmed, rules.PricingVersion + 1, true);
    var after = engine.Calculate(new PricingRequest("P2",8,ContractMonths.Three), modifiedRules);
    Check(after.FinalTotalToman != snap.FinalTotalToman && snap.BaseMonthlyPriceToman == 19500000m, "snapshot immutable after config change");
    // snapshot creation rejects invalid request
    bool snapInvalidThrew = false; try { engine.CreateSnapshot(new PricingRequest("P2",99,ContractMonths.Three), rules); } catch(ArgumentException){ snapInvalidThrew = true; }
    Check(snapInvalidThrew, "invalid snapshot request rejected");
}

Console.WriteLine($"Assertions: {assertions}; failures: {failures}");
return failures == 0 ? 0 : 1;

static ClaimsPrincipal Principal(string? id, string? role = null, string? name = null)
{
    var claims = new List<Claim> { new(ClaimTypes.Name, name ?? id ?? "fixture"), new(Permission.ClaimType, "ViewContent") };
    if (id != null) claims.Add(new(ClaimTypes.NameIdentifier, id));
    if (role != null) claims.Add(new(ClaimTypes.Role, role));
    return new ClaimsPrincipal(new ClaimsIdentity(claims, "Fixture"));
}

public sealed class PublicContentGrant : AuthorizationHandler<PermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        // Mirrors the existing broad public grant, including grants made before our veto.
        if (requirement.Permission.Name == "ViewContent") context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

public class Proxy<T> : DispatchProxy where T : class
{
    public Func<MethodInfo, object?[]?, object?> Callback { get; set; } = null!;
    public static T Create(Func<MethodInfo, object?[]?, object?> callback)
    {
        var proxy = DispatchProxy.Create<T, Proxy<T>>();
        ((Proxy<T>)(object)proxy).Callback = callback;
        return proxy;
    }
    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => Callback(targetMethod!, args);
}

// This authentication scheme exists only in this executable; it is never registered in the portal.
public sealed class FixtureAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger, UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var id = Request.Headers["X-Fixture-User"].ToString();
        if (string.IsNullOrEmpty(id)) return Task.FromResult(AuthenticateResult.NoResult());
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, id), new(ClaimTypes.Name, id) };
        if (id == "admin") claims.Add(new(ClaimTypes.Role, "Administrator"));
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name)), Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
