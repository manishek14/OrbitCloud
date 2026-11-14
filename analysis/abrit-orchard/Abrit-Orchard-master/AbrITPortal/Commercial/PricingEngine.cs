namespace AbrITPortal.Commercial;

public interface IPricingEngine
{
    PricingBreakdown Calculate(PricingRequest request, CommercialRules rules);
    PricingSnapshot CreateSnapshot(PricingRequest request, CommercialRules rules);
}

public sealed class PricingEngine : IPricingEngine
{
    public PricingBreakdown Calculate(PricingRequest request, CommercialRules rules)
    {
        if (request is null) throw new ArgumentNullException(nameof(request));
        if (rules is null) throw new ArgumentNullException(nameof(rules));

        var errors = new List<string>();
        if (!rules.CommercialValuesApproved)
            errors.Add("مقادیر تجاری هنوز تأیید نشده‌اند.");
        if (request.ContractMonths is not (ContractMonths.Three or ContractMonths.Six))
            errors.Add("مدت قرارداد فقط می‌تواند ۳ ماهه یا ۶ ماهه باشد.");
        var plan = rules.Plans.FirstOrDefault(p => string.Equals(p.Code, request.PlanCode, StringComparison.OrdinalIgnoreCase));
        if (plan is null)
            errors.Add("پلن انتخاب‌شده معتبر نیست.");

        var contract = rules.Contracts.FirstOrDefault(c => c.Months == request.ContractMonths);
        if (contract is null)
            errors.Add("مدت قرارداد فقط می‌تواند ۳ ماهه یا ۶ ماهه باشد.");
        else if (contract.DiscountRate != (request.ContractMonths == ContractMonths.Three ? 0.03m : 0.05m))
            errors.Add("نرخ تخفیف قرارداد با قواعد مصوب سازگار نیست.");

        if (plan is not null)
        {
            if (!plan.IsPublished || plan.BaseMonthlyPriceToman <= 0 || plan.IncludedUsers <= 0 ||
                plan.MinimumUsers <= 0 || plan.MaximumUsers < plan.IncludedUsers || plan.AdditionalUserMonthlyFeeToman < 0)
                errors.Add("تنظیمات پلن برای قیمت‌گذاری معتبر یا منتشرشده نیست.");
            if (request.SelectedUsers < plan.MinimumUsers || request.SelectedUsers > plan.MaximumUsers)
                errors.Add($"تعداد کاربران برای پلن {plan.Code} باید بین {plan.MinimumUsers} تا {plan.MaximumUsers} باشد.");
            if (request.SelectedUsers < plan.IncludedUsers)
                errors.Add("تعداد کاربران انتخابی نمی‌تواند کمتر از کاربران شامل پلن باشد.");
        }

        if (errors.Count > 0 || plan is null || contract is null)
        {
            return Invalid(request, plan, rules, errors);
        }

        // Deterministic calculation order (all decimal, amounts in whole Toman):
        // 1) Additional users
        var additionalUsers = request.SelectedUsers - plan.IncludedUsers;
        // 2) Monthly total
        var additionalUsersMonthlyTotal = Money(additionalUsers * plan.AdditionalUserMonthlyFeeToman);
        var monthlyTotal = Money(plan.BaseMonthlyPriceToman + additionalUsersMonthlyTotal);
        // 3) Subtotal over contract
        var months = (int)contract.Months;
        var subtotal = Money(monthlyTotal * months);
        // 4) Discount on subtotal
        var discountAmount = Money(subtotal * contract.DiscountRate);
        // 5) Onboarding from base monthly price only (additional users excluded)
        var onboarding = Money(plan.BaseMonthlyPriceToman * contract.OnboardingRateOfBaseMonthlyPrice);
        // 6) Final total
        var finalTotal = Money(subtotal - discountAmount + onboarding);

        var monthlyRial = Money(monthlyTotal * CommercialDefaults.TomanToRialFactor);
        var finalRial = Money(finalTotal * CommercialDefaults.TomanToRialFactor);

        return new PricingBreakdown(
            plan.Code,
            rules.PricingVersion,
            plan.BaseMonthlyPriceToman,
            plan.IncludedUsers,
            request.SelectedUsers,
            additionalUsers,
            plan.AdditionalUserMonthlyFeeToman,
            additionalUsersMonthlyTotal,
            monthlyTotal,
            months,
            subtotal,
            contract.DiscountRate,
            discountAmount,
            onboarding,
            finalTotal,
            monthlyRial,
            finalRial,
            rules.Currency,
            true,
            Array.Empty<string>());
    }

    public PricingSnapshot CreateSnapshot(PricingRequest request, CommercialRules rules)
    {
        var breakdown = Calculate(request, rules);
        if (!breakdown.IsValid)
            throw new ArgumentException(string.Join("; ", breakdown.Errors), nameof(request));

        var plan = rules.Plans.First(p => string.Equals(p.Code, request.PlanCode, StringComparison.OrdinalIgnoreCase));
        return new PricingSnapshot(
            Guid.NewGuid(),
            DateTimeOffset.UtcNow,
            plan.Code,
            plan.PersianName,
            plan.EnglishName,
            breakdown.PricingVersion,
            plan.BaseMonthlyPriceToman,
            plan.IncludedUsers,
            plan.MinimumUsers,
            plan.MaximumUsers,
            plan.AdditionalUserMonthlyFeeToman,
            plan.SlaType,
            plan.SlaResponseMinutes,
            breakdown.SelectedUsers,
            breakdown.AdditionalUsers,
            breakdown.MonthlyTotalToman,
            breakdown.ContractMonths,
            breakdown.DiscountRate,
            breakdown.DiscountAmountToman,
            breakdown.OnboardingFeeToman,
            breakdown.FinalTotalToman,
            breakdown.FinalTotalRial,
            rules.Currency,
            rules.TaxDisplayNote);
    }

    private static PricingBreakdown Invalid(PricingRequest request, CommercialPlanDefinition? plan, CommercialRules rules, List<string> errors)
    {
        var months = request.ContractMonths == ContractMonths.Six ? 6 : request.ContractMonths == ContractMonths.Three ? 3 : 0;
        return new PricingBreakdown(
            plan?.Code ?? request.PlanCode ?? string.Empty,
            rules.PricingVersion,
            plan?.BaseMonthlyPriceToman ?? 0m,
            plan?.IncludedUsers ?? 0,
            request.SelectedUsers,
            0, 0, 0, 0, months, 0, 0, 0, 0, 0, 0, 0,
            rules.Currency,
            false,
            errors);
    }

    // Toman amounts are stored/calculated in whole currency units (no fractional toman in pricing).
    // Rounding policy: MidpointRounding.AwayFromZero to 0 decimal places at each monetary step.
    internal static decimal Money(decimal value) => decimal.Round(value, 0, MidpointRounding.AwayFromZero);
}
