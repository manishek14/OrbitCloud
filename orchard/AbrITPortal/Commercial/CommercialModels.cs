namespace AbrITPortal.Commercial;

public enum SlaType
{
    Timed = 0,
    Immediate = 1
}

public enum ContractMonths
{
    One = 1,
    Three = 3,
    Six = 6
}

public sealed record CommercialPlanDefinition(
    string Code,
    string PersianName,
    string EnglishName,
    decimal BaseMonthlyPriceToman,
    int IncludedUsers,
    int MinimumUsers,
    int MaximumUsers,
    decimal AdditionalUserMonthlyFeeToman,
    SlaType SlaType,
    int? SlaResponseMinutes,
    string SlaDisplayFa,
    bool IsFeatured,
    bool IsPublished,
    int DisplayOrder);

public sealed record ContractPolicy(
    ContractMonths Months,
    decimal DiscountRate,
    decimal OnboardingRateOfBaseMonthlyPrice);

public sealed record CommercialRules(
    IReadOnlyList<CommercialPlanDefinition> Plans,
    IReadOnlyList<ContractPolicy> Contracts,
    string Currency,
    string TaxDisplayNote,
    bool TaxAmountConfirmed,
    int PricingVersion,
    bool CommercialValuesApproved = false);

public sealed record PricingRequest(
    string PlanCode,
    int SelectedUsers,
    ContractMonths ContractMonths);

public sealed record PricingBreakdown(
    string PlanCode,
    int PricingVersion,
    decimal BaseMonthlyPriceToman,
    int IncludedUsers,
    int SelectedUsers,
    int AdditionalUsers,
    decimal AdditionalUserMonthlyFeeToman,
    decimal AdditionalUsersMonthlyTotalToman,
    decimal MonthlyTotalToman,
    int ContractMonths,
    decimal SubtotalToman,
    decimal DiscountRate,
    decimal DiscountAmountToman,
    decimal OnboardingFeeToman,
    decimal FinalTotalToman,
    decimal MonthlyTotalRial,
    decimal FinalTotalRial,
    string Currency,
    bool IsValid,
    IReadOnlyList<string> Errors);

public sealed record PricingSnapshot(
    Guid SnapshotId,
    DateTimeOffset CreatedUtc,
    string PlanCode,
    string PersianName,
    string EnglishName,
    int PricingVersion,
    decimal BaseMonthlyPriceToman,
    int IncludedUsers,
    int MinimumUsers,
    int MaximumUsers,
    decimal AdditionalUserMonthlyFeeToman,
    SlaType SlaType,
    int? SlaResponseMinutes,
    int SelectedUsers,
    int AdditionalUsers,
    decimal MonthlyTotalToman,
    int ContractMonths,
    decimal DiscountRate,
    decimal DiscountAmountToman,
    decimal OnboardingFeeToman,
    decimal FinalTotalToman,
    decimal FinalTotalRial,
    string Currency,
    string TaxDisplayNote);
