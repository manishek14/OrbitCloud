# PRICING_ENGINE (M2)

**Component:** `AbrITPortal.Commercial` (`IPricingEngine` / `PricingEngine`, `CommercialRules`, `CommercialDefaults`, `ICommercialRulesService`, admin controller/view).

## Purpose

Single centralized, testable pricing service shared by admin/customer/order flows. **Server-side calculation is authoritative**; any client/JS values are preview-only and must be recalculated and validated on server before order creation.

## Inputs

- `PricingRequest { PlanCode, SelectedUsers, ContractMonths }`
- `CommercialRules` (plans, contract policies, currency/tax display, pricing version) — loaded from admin-manageable site settings with idempotent defaults.

## Validation

- Plan code must exist (case-insensitive).
- Contract months must be **3 or 6** only.
- `SelectedUsers` must be within plan `[MinimumUsers..MaximumUsers]` and `>= IncludedUsers`.
- Invalid requests return `PricingBreakdown.IsValid=false` with Persian error messages; snapshot creation throws `ArgumentException` for invalid input.

## Deterministic calculation order (decimal, whole Toman)

Rounding policy: **`decimal.Round(value, 0, MidpointRounding.AwayFromZero)`** applied at each monetary step (`Money(...)`) so amounts are whole Toman with deterministic half-up-away-from-zero behavior.

1. `AdditionalUsers = SelectedUsers - IncludedUsers`
2. `AdditionalUsersMonthlyTotal = Money(AdditionalUsers × AdditionalUserMonthlyFeeToman)`
3. `MonthlyTotal = Money(BaseMonthlyPriceToman + AdditionalUsersMonthlyTotal)`
4. `Subtotal = Money(MonthlyTotal × ContractMonths)`
5. `DiscountAmount = Money(Subtotal × DiscountRate)` (3 mo: 3%, 6 mo: 5%)
6. `OnboardingFee = Money(BaseMonthlyPriceToman × OnboardingRateOfBaseMonthlyPrice)`  
   - **3 months:** 50% of plan base monthly price. **6 months:** 25% of plan base monthly price.  
   - **Additional users excluded** from onboarding calculation.
7. `FinalTotal = Money(Subtotal - DiscountAmount + OnboardingFee)`
8. Conversions: `MonthlyTotalRial = Money(MonthlyTotal × 10)`, `FinalTotalRial = Money(FinalTotal × 10)` (Toman↔Rial boundary explicit; factor 10).

Formula summary:

- `MonthlyTotal = BaseMonthlyPrice + (SelectedUsers - IncludedUsers) × AdditionalUserFee`
- `Subtotal = MonthlyTotal × ContractMonths`
- `Discount = Subtotal × DiscountRate`
- `FinalTotal = Subtotal - Discount + Onboarding`

## Output

`PricingBreakdown`: plan/version, base/included/selected/additional counts and fees, monthly/additional/subtotal, discount rate/amount, onboarding, final total (Toman/Rial), currency, validity/errors.

## Immutable snapshot

`CreateSnapshot(request, rules)` (valid only) returns `PricingSnapshot` with `SnapshotId`, `CreatedUtc`, plan identity/SLA/limits/fees, selected users, pricing version, all monetary breakdown values, currency, and tax display note. Snapshots are immutable records intended to be persisted with orders at creation so later plan/config edits do not affect historical orders.

## Defaults / seed

`CommercialDefaults.CreateDefaultRules()` provides authoritative P1–P5 values and 3/6-month contract policies (idempotent seed when site-settings document empty). `PricingVersion` included for future controlled evolution.

## Admin & preview

`CommercialPlansAdminController` (`/Admin/AbrIT/Commercial/Plans`, `[Admin]`, Administrator role, antiforgery) lists/edits plans and contracts, persists via `ICommercialRulesService`, and offers server-side JSON preview (`POST Preview`) calling the same engine.

## Notes

- No 12-month/1-month contracts, no Endpoint fields, no invented tax amounts.
- No schema migration required for M2 (site-settings storage); any future DB schema changes must be on isolated dev clone with verified backup.
