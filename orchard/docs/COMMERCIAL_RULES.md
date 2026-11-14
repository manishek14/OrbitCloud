# Commercial rules and reconciliation (2026-11-10)

**Partial approval:** On 2026-11-10 the owner selected the screenshot as authoritative for base monthly prices and included-user counts. The earlier version of this document had claimed this approval before it was actually given.

| Plan | Document price (Toman/month) | Screenshot price | Document included users | Screenshot users |
|---|---:|---:|---:|---:|
| Essential | 12,950,000 | 12,950,000 | 5 | 4 |
| Standard | 19,500,000 | 19,500,000 | 10 | 7 |
| Professional | 32,900,000 | 29,500,000 | 15 | 10 |
| Business | 52,900,000 | 45,900,000 | 25 | 20 |
| Enterprise | 79,900,000 | 66,900,000 | 40 | 30 |

**Still needed:** maximum selectable users, each additional-user monthly price, and the exact onboarding fee formula for both contract durations. The commercial source document and reference image are not present in this workspace; service capacities and descriptions must be transcribed from approved originals before publication.

Confirmed rules: three months receives a 3% discount; six months receives a 5% discount; no twelve-month choice. Endpoint is excluded. SLA measures initial response/handling: Essential 8 hours, Standard 5 hours, Professional 3 hours, Business 1 hour, Enterprise `Immediate` (an explicit enum value, never zero minutes). The engine rejects altered discounts; stored SLA values are normalized to these authoritative commitments and cannot be edited from the admin screen.

The application now creates five inactive plan shells with the approved screenshot prices and included-user counts. Maximum users, additional-user fees and onboarding remain unset. `CommercialValuesApproved` defaults to false, including for site settings written by older builds. The pricing engine refuses quotes and snapshots until all values are approved. Admin edits do not grant approval or publish plans. Existing stored values are treated as drafts; no production tenant data was modified by this source change. Historical orders need immutable snapshots once order persistence is implemented.
