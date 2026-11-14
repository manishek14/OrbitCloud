using AbrITPortal.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AbrITPortal.Portal;

[AllowAnonymous]
[Route("pricing")]
public sealed class PricingController(ICommercialRulesService rulesService, IPricingEngine pricingEngine) : Controller
{
[HttpGet("preview")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> Preview(string planCode, int selectedUsers, int contractMonths)
    {
        var rules = await rulesService.GetAsync();
        var months = contractMonths == 6 ? ContractMonths.Six : contractMonths == 1 ? ContractMonths.One : ContractMonths.Three;
        if (contractMonths is not (1 or 3 or 6))
            return BadRequest(new { isValid = false, errors = new[] { "مدت قرارداد فقط می‌تواند ۱ ماهه، ۳ ماهه یا ۶ ماهه باشد." } });
        var result = pricingEngine.Calculate(new PricingRequest(planCode, selectedUsers, months), rules);
        if (!result.IsValid) return Ok(result);
        return Ok(result);
    }
}
