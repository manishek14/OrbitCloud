using OrchardCore.Entities;
using OrchardCore.Settings;

namespace AbrITPortal.Commercial;

public sealed class CommercialRulesDocument
{
    public List<CommercialPlanDefinition> Plans { get; set; } = new();
    public List<ContractPolicy> Contracts { get; set; } = new();
    public string Currency { get; set; } = CommercialDefaults.CurrencyToman;
    public string TaxDisplayNote { get; set; } = CommercialDefaults.TaxDisplayNoteFa;
    public bool TaxAmountConfirmed { get; set; }
    public int PricingVersion { get; set; } = CommercialDefaults.CurrentPricingVersion;
    public bool CommercialValuesApproved { get; set; }
}

public interface ICommercialRulesService
{
    Task<CommercialRules> GetAsync();
    Task SaveAsync(CommercialRules rules);
}

public sealed class CommercialRulesService(ISiteService siteService) : ICommercialRulesService
{
    private const string Key = "AbrIT.CommercialRules";

    public async Task<CommercialRules> GetAsync()
    {
        var site = await siteService.GetSiteSettingsAsync();
        var doc = site.As<CommercialRulesDocument>(Key);
        if (doc.Plans is null || doc.Plans.Count == 0)
        {
            var defaults = CommercialDefaults.CreateDefaultRules();
            return defaults;
        }
        return ToRules(doc);
    }

    public async Task SaveAsync(CommercialRules rules)
    {
        var site = await siteService.LoadSiteSettingsAsync();
        site.Alter<CommercialRulesDocument>(Key, doc =>
        {
            doc.Plans = rules.Plans.Select(Clone).ToList();
            doc.Contracts = rules.Contracts.ToList();
            doc.Currency = rules.Currency;
            doc.TaxDisplayNote = rules.TaxDisplayNote;
            doc.TaxAmountConfirmed = rules.TaxAmountConfirmed;
            doc.PricingVersion = rules.PricingVersion;
            doc.CommercialValuesApproved = rules.CommercialValuesApproved;
        });
        await siteService.UpdateSiteSettingsAsync(site);
    }

    private static CommercialRules ToRules(CommercialRulesDocument doc)
    {
        var defaults = CommercialDefaults.CreateDefaultRules();
        var contracts = defaults.Contracts.Select(policy => policy with
        {
            OnboardingRateOfBaseMonthlyPrice = doc.Contracts?.FirstOrDefault(c => c.Months == policy.Months)?.OnboardingRateOfBaseMonthlyPrice ?? 0m
        }).ToList();
        return new CommercialRules(
            (doc.Plans ?? defaults.Plans.ToList()).Select(p =>
            {
                var sla = defaults.Plans.FirstOrDefault(x => x.Code == p.Code);
                return p with
                {
                    SlaType = sla?.SlaType ?? p.SlaType,
                    SlaResponseMinutes = sla is null ? p.SlaResponseMinutes : sla.SlaResponseMinutes,
                    SlaDisplayFa = sla?.SlaDisplayFa ?? p.SlaDisplayFa,
                    IsPublished = doc.CommercialValuesApproved && p.IsPublished
                };
            }).ToList().AsReadOnly(),
            contracts.AsReadOnly(),
            string.IsNullOrWhiteSpace(doc.Currency) ? defaults.Currency : doc.Currency,
            string.IsNullOrWhiteSpace(doc.TaxDisplayNote) ? defaults.TaxDisplayNote : doc.TaxDisplayNote,
            doc.TaxAmountConfirmed,
            doc.PricingVersion <= 0 ? defaults.PricingVersion : doc.PricingVersion,
            doc.CommercialValuesApproved);
    }

    private static CommercialPlanDefinition Clone(CommercialPlanDefinition p) => p with { };
}
