using AbrITPortal.Areas.Admin.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Text.RegularExpressions;

var type = typeof(AbrITBusinessAdminController);
if (!type.GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Any(a => a.Roles == "Administrator"))
    throw new Exception("Pricing controller lacks Administrator authorization");
foreach (var name in new[] { "SavePlan", "SaveContract", "ChangePricingStatus", "DeletePricing" })
{
    var method = type.GetMethod(name) ?? throw new Exception($"Missing {name}");
    if (!method.GetCustomAttributes(typeof(HttpPostAttribute), true).Any()) throw new Exception($"{name} is not POST-only");
    if (!method.GetCustomAttributes(typeof(ValidateAntiForgeryTokenAttribute), true).Any()) throw new Exception($"{name} lacks antiforgery validation");
}
var view = File.ReadAllText("orchard/AbrITPortal/Views/AbrITBusinessAdmin/Plans.cshtml");
var forms = Regex.Matches(view, "<form\\b[^>]*>.*?</form>", RegexOptions.Singleline);
if (forms.Count != 8 || forms.Any(f => !f.Value.Contains("@Html.AntiForgeryToken()", StringComparison.Ordinal)))
    throw new Exception("Pricing form is missing an antiforgery token");
Console.WriteLine("PASS: Administrator role, POST-only and antiforgery attributes on all pricing mutations");
