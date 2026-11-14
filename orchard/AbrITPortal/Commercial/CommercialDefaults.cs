using System.Collections.ObjectModel;

namespace AbrITPortal.Commercial;

public static class CommercialDefaults
{
    public const string CurrencyToman = "IRT";
    public const decimal TomanToRialFactor = 10m;
    public const string TaxDisplayNoteFa = "مالیات بر ارزش افزوده در صورت تأیید نهایی اعمال می‌شود؛ در حال حاضر مبلغ مالیات اضافه نشده است.";
    public const int CurrentPricingVersion = 1;

    public static CommercialRules CreateDefaultRules()
    {
        var plans = new List<CommercialPlanDefinition>
        {
            new("P1", "پایه", "Essential", 12_950_000m, 4, 4, 0, 0m, SlaType.Timed, 480, "۸ ساعت", false, false, 1),
            new("P2", "استاندارد", "Standard", 19_500_000m, 7, 7, 0, 0m, SlaType.Timed, 300, "۵ ساعت", false, false, 2),
            new("P3", "حرفه‌ای", "Professional", 29_500_000m, 10, 10, 0, 0m, SlaType.Timed, 180, "۳ ساعت", true, false, 3),
            new("P4", "سازمانی", "Business", 45_900_000m, 20, 20, 0, 0m, SlaType.Timed, 60, "۱ ساعت", false, false, 4),
            new("P5", "سازمانی پلاس", "Enterprise", 66_900_000m, 30, 30, 0, 0m, SlaType.Immediate, null, "لحظه‌ای", false, false, 5),
        };
        var contracts = new List<ContractPolicy>
        {
            new(ContractMonths.Three, 0.03m, 0m),
            new(ContractMonths.Six, 0.05m, 0m),
        };
        return new CommercialRules(
            new ReadOnlyCollection<CommercialPlanDefinition>(plans),
            new ReadOnlyCollection<ContractPolicy>(contracts),
            CurrencyToman,
            TaxDisplayNoteFa,
            false,
            CurrentPricingVersion);
    }
}
