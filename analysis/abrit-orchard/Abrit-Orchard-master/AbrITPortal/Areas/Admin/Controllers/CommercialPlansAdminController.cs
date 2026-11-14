using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OrchardCore.Admin;

namespace AbrITPortal.Commercial;

[Admin]
[Authorize(Roles = "Administrator")]
[Route("Admin/AbrIT/Commercial/Plans")]
public sealed class CommercialPlansAdminController(ICommercialRulesService rulesService, IPricingEngine pricingEngine) : Controller
{
    [HttpGet("")]
    public async Task<IActionResult> Index()
    {
        var rules = await rulesService.GetAsync();
        return View(rules);
    }

    [HttpPost("Save")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Save([FromForm] CommercialRulesEditModel model)
    {
        if (model?.Plans is null || model.Plans.Count == 0)
        {
            TempData["Error"] = "اطلاعات پلن‌ها معتبر نیست.";
            return RedirectToAction(nameof(Index));
        }
        var current = await rulesService.GetAsync();
        // Preserve stable codes/identity; update editable commercial fields only.
        var updated = new List<CommercialPlanDefinition>();
        foreach (var existing in current.Plans.OrderBy(p => p.DisplayOrder))
        {
            var edit = model.Plans.FirstOrDefault(p => string.Equals(p.Code, existing.Code, StringComparison.OrdinalIgnoreCase));
            if (edit is null)
            {
                updated.Add(existing);
                continue;
            }
            var slaType = edit.SlaTypeImmediate ? SlaType.Immediate : SlaType.Timed;
            var minutes = slaType == SlaType.Immediate ? (int?)null : edit.SlaResponseMinutes;
            updated.Add(existing with
            {
                BaseMonthlyPriceToman = edit.BaseMonthlyPriceToman,
                IncludedUsers = edit.IncludedUsers,
                MinimumUsers = edit.MinimumUsers,
                MaximumUsers = edit.MaximumUsers,
                AdditionalUserMonthlyFeeToman = edit.AdditionalUserMonthlyFeeToman,
                SlaType = slaType,
                SlaResponseMinutes = minutes,
                SlaDisplayFa = edit.SlaDisplayFa ?? existing.SlaDisplayFa,
                IsPublished = edit.IsPublished,
                IsFeatured = edit.IsFeatured,
            });
        }
        var contracts = current.Contracts.ToList();
        if (model.Contracts is { Count: > 0 })
        {
            contracts = model.Contracts.Select(c => new ContractPolicy(
                c.Months == 6 ? ContractMonths.Six : c.Months == 1 ? ContractMonths.One : ContractMonths.Three,
                c.DiscountRate,
                c.OnboardingRateOfBaseMonthlyPrice)).ToList();
        }
        var saved = new CommercialRules(
            updated,
            contracts,
            current.Currency,
            model.TaxDisplayNote ?? current.TaxDisplayNote,
            false,
            current.PricingVersion);
        await rulesService.SaveAsync(saved);
        TempData["Success"] = "تنظیمات تجاری ذخیره شد.";
        return RedirectToAction(nameof(Index));
    }

    [HttpPost("Preview")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Preview(string planCode, int selectedUsers, int contractMonths)
    {
        var rules = await rulesService.GetAsync();
        var months = contractMonths == 6 ? ContractMonths.Six : contractMonths == 1 ? ContractMonths.One : ContractMonths.Three;
        var result = pricingEngine.Calculate(new PricingRequest(planCode, selectedUsers, months), rules);
        return Json(result);
    }
}

public sealed class CommercialRulesEditModel
{
    public List<PlanEditModel> Plans { get; set; } = new();
    public List<ContractEditModel> Contracts { get; set; } = new();
    public string? TaxDisplayNote { get; set; }
}

public sealed class PlanEditModel
{
    public string Code { get; set; } = "";
    public decimal BaseMonthlyPriceToman { get; set; }
    public int IncludedUsers { get; set; }
    public int MinimumUsers { get; set; }
    public int MaximumUsers { get; set; }
    public decimal AdditionalUserMonthlyFeeToman { get; set; }
    public bool SlaTypeImmediate { get; set; }
    public int? SlaResponseMinutes { get; set; }
    public string? SlaDisplayFa { get; set; }
    public bool IsPublished { get; set; }
    public bool IsFeatured { get; set; }
}

public sealed class ContractEditModel
{
    public int Months { get; set; }
    public decimal DiscountRate { get; set; }
    public decimal OnboardingRateOfBaseMonthlyPrice { get; set; }
}

