# Burse Vault — API Documentation (Frontend Reference)

Burse Vault (internally `eazilock`) is a fixed-term savings product. This document
covers **all** Burse Vault GraphQL endpoints with their request and response
structures, and highlights the **new INSTALLMENTAL vault type** and related updates.

> All mutations/queries require the standard auth context (Bearer token) unless noted.
> Responses use the shared `Result` envelope: `{ success, message, returnStatus, data }`.
> Money values are Naira. Dates are ISO 8601.

---

## 1. Concepts & what's new

### Vault types (`vaultType`)
| Type | Meaning |
|------|---------|
| `ONE_TIME` (default) | A single lump sum locked for a fixed term. Original behaviour. Interest is paid **MONTHLY** to the wallet or in full at **MATURITY**. |
| `INSTALLMENTAL` | Goal-based. The user states a **target amount** (the maturity value, incl. interest) and a **duration**; the backend derives a fixed **monthly contribution** and auto-debits it every month. Interest is **deferred to maturity** by default. Always end-of-term at creation. |

### INSTALLMENTAL rules
- **Target = maturity value** (principal contributed + interest). The backend solves for the required `monthlyContribution`.
- The user picks a **duration** (months, max 24). The **APY** is set by the Burse Vault interest rate (duration/amount tiered).
- The first contribution is collected at creation; subsequent contributions are **auto-debited monthly** on the chosen `debitDay`.
- **Multiple funding sources (ordered fallback):** a vault can hold several auto-debit sources. The **primary** is the source used at creation (index 0). On each monthly charge the backend tries sources **in order** until one succeeds; a cycle is only "missed" if **all** fail. Source management is **add-only** for now (you can append sources; you cannot reorder or remove).
- **Missed contributions:** if every source fails through the retry window (3 days), the cycle is marked missed and recovered later (arrears) once a future charge succeeds.
- **No early break:** installmental vaults are fully locked until maturity (no break/withdraw endpoint).
- **Switch to monthly payout (optional):** after creation the user may switch interest payout from MATURITY → MONTHLY (see `UpdateBurseVaultInterestPayoutType`). From then on interest is paid to the wallet each month.
- **Extension:** on extend, the user chooses to **continue contributing** or **stop contributing but keep earning interest** (auto-save is cancelled immediately in the latter case). See `BurseVaultPlanExtend`.

### Enums
```graphql
enum VaultTypeEnum { ONE_TIME  INSTALLMENTAL }
enum FundingSourceEnum { WALLET  CARD  BANK_TRANSFER }
enum InterestPayoutTypeEnum { MONTHLY  MATURITY }   # MATURITY == end-of-term
enum EazilockStatus { ONGOING  MATURED }
enum WithdrawalMethodEnum { MONTHLY  ENDOFTERM }
```
`debitDay` allowed values: `1, 5, 10, 15, 20, 25, 31` (31 = last day of month).

---

## 2. Simulation & preview (no auth-side effects)

### `SimulateEazilockSavings`  (mutation)
Use this to show projected figures before creating a vault. For INSTALLMENTAL, it returns the required monthly contribution.

**Request**
```graphql
mutation {
  SimulateEazilockSavings(input: {
    duration: 12
    title: "New Car"
    vaultType: INSTALLMENTAL      # omit or ONE_TIME for lump-sum
    targetAmount: 1200000         # INSTALLMENTAL: the maturity value to reach
    amount: 0                     # ONE_TIME: the lump sum; ignored for INSTALLMENTAL
    interestPayoutType: MATURITY  # ONE_TIME only
    # topupAmount: 0              # ONE_TIME top-up simulation only
  }) { success message returnStatus data { ... } }
}
```

**Response `data`** (`EazilockSimulationResult`)
```jsonc
{
  "title": "New Car",
  "amount": 1150000,            // total contributions over the term (INSTALLMENTAL)
  "topupAmount": 0,
  "duration": 12,
  "startDate": "2026-07-08T00:00:00.000Z",
  "maturityDate": "2027-07-08T23:59:59.999Z",
  "interestPayoutType": "MATURITY",
  "totalDays": 365,
  "monthlyBreakdown": [ { "monthIndex": 0, "interestProrated": 1234.5, "days": 31, ... } ],
  "simulation": {
    "eazilock": { "amountLocked": 1150000, "maturityAmount": 1200000, "interestAmount": 50000, ... },
    "events": [
      { "type": "MONTHLY_CONTRIBUTION", "monthIndex": 0, "contribution": 95833.33, "interestProrated": 1234.5, ... },
      { "type": "END_OF_TERM_MATURITY", "amount": 1200000, "principal": 1150000, "totalInterest": 50000 }
    ],
    "totalDays": 365
  },
  "summary": { "monthlyInterestEarned": 0, "compoundInterestEarned": 50000, "marketInterestEarned": 30000, "extraInterestAmount": 0 }
}
```
> INSTALLMENTAL: read the required monthly amount from `simulation.events[].contribution`
> (all equal) and the projected interest from `simulation.eazilock.interestAmount`.

### `PreviewEazilockSavings`  (mutation)
Same inputs as create (without funding). Returns the plan preview.

**Request**
```graphql
mutation {
  PreviewEazilockSavings(input: {
    lockDuration: 12
    title: "New Car"
    vaultType: INSTALLMENTAL
    targetAmount: 1200000
    amount: 0
    interestPayoutType: MATURITY
  }) { success message returnStatus data }
}
```

**Response `data`**
```jsonc
{
  "title": "New Car",
  "startDate": "2026-07-08T00:00:00.000Z",
  "endDate": "2027-07-08T23:59:59.999Z",
  "interest": 14.5,                 // APY %
  "interestAmount": 50000,          // projected total interest
  "avgMonthlyInterestAmount": 4166.67,
  "durationInDays": 365,
  "durationInMonths": 12,
  "maturityAmount": 1200000,        // == targetAmount for INSTALLMENTAL
  "withdrawableInterestAmount": 0,
  "deferredInterestAmount": 50000,
  "monthlyBreakdown": [ ... ],
  // vault-type fields
  "vaultType": "INSTALLMENTAL",
  "monthlyContribution": 95833.33,  // the derived required monthly contribution
  "targetAmount": 1200000,
  "totalContributed": 1150000       // monthlyContribution × duration
}
```

---

## 3. Creating a vault — `EazilockTopup` (mutation)

Creates and funds a vault. (Name kept for backward compatibility.)

**Request — ONE_TIME (unchanged)**
```graphql
mutation {
  EazilockTopup(input: {
    lockDuration: 12
    amount: 500000
    title: "Emergency Lock"
    fundingSource: WALLET
    interestPayoutType: MATURITY   # or MONTHLY
    cardId: ""                     # required if fundingSource: CARD
    paymentId: ""
  }) { success message returnStatus data }
}
```

**Request — INSTALLMENTAL (new)**
```graphql
mutation {
  EazilockTopup(input: {
    lockDuration: 12
    title: "New Car"
    vaultType: INSTALLMENTAL
    targetAmount: 1200000          # maturity value to reach
    amount: 0                      # ignored for INSTALLMENTAL
    interestPayoutType: MATURITY   # required; MONTHLY is rejected for INSTALLMENTAL
    fundingSource: WALLET          # WALLET | CARD | BANK_TRANSFER (primary source)
    cardId: ""                     # required if fundingSource: CARD
    debitDay: 25                   # recurring auto-debit day (1,5,10,15,20,25,31)
    paymentId: ""
  }) { success message returnStatus data }
}
```

**Response `data`** — the created vault record:
```jsonc
{
  "_id": "665f...",
  "title": "New Car",
  "vaultType": "INSTALLMENTAL",
  "amountLocked": 95833.33,          // principal to date (first contribution)
  "totalContributed": 95833.33,
  "targetAmount": 1200000,
  "monthlyContribution": 95833.33,
  "interestRate": 14.5,
  "interestAmount": 50000,           // projected
  "maturityAmount": 1200000,         // projected
  "withdrawalMethod": "ENDOFTERM",
  "status": "ONGOING",
  "maturityDate": "2027-07-08T23:59:59.999Z",
  "debitDay": 25,
  "autoTopUp": true,
  "nextChargeDate": "2026-08-25T00:00:00.000Z",
  "fundingSources": [ { "source": "WALLET", "authorizationStatus": "NONE", "isPrimary": true } ]
  // For fundingSource: BANK_TRANSFER, the response also includes:
  // "paymentUrl": "https://checkout.paystack.com/...", "paymentReference": "..."
}
```
> **BANK_TRANSFER (Paystack Direct Debit):** the first contribution is asynchronous.
> Send the user to `paymentUrl` to approve the mandate. The vault activates and the
> first contribution is applied when Paystack confirms via webhook.

---

## 4. Managing funding sources — `AddVaultFundingSource` (mutation, new)

Appends an extra auto-debit source to an installmental vault (add-only, ordered fallback).

**Request**
```graphql
mutation {
  AddVaultFundingSource(input: {
    vaultPlanId: "665f..."
    fundingSource: CARD            # WALLET | CARD | BANK_TRANSFER
    cardId: "660a..."              # required for CARD
  }) { success message returnStatus data }
}
```

**Response `data`**
```jsonc
{ "vaultPlanId": "665f...", "fundingSource": "CARD", "redirectUrl": null }
// BANK_TRANSFER returns "redirectUrl" — send the user there to approve the mandate.
```

---

## 5. Payout type — `UpdateBurseVaultInterestPayoutType` (mutation)

**Request**
```graphql
mutation {
  UpdateBurseVaultInterestPayoutType(input: {
    vaultPlanId: "665f..."
    interestPayoutType: MONTHLY
  }) { success message returnStatus data }
}
```
Rules:
- ONE_TIME: only `MONTHLY → MATURITY` is allowed (MATURITY → MONTHLY is rejected).
- **INSTALLMENTAL: `MATURITY → MONTHLY` is allowed** — interest then pays to the wallet each month until maturity.

**Response `data`**
```jsonc
{ "vaultPlanId": "665f...", "previousInterestPayoutType": "MATURITY", "currentInterestPayoutType": "MONTHLY" }
```

---

## 6. Extending — `BurseVaultPlanExtend` (mutation)

**Request**
```graphql
mutation {
  BurseVaultPlanExtend(input: {
    vaultPlanId: "665f..."
    extensionDuration: 3           # months to add; total must stay <= 24
    continueContributing: true     # INSTALLMENTAL only (see below)
  }) { success message returnStatus data }
}
```
- `continueContributing: true` (default): auto-save continues over the longer term.
- `continueContributing: false`: **auto-save is cancelled immediately**; no more debits, but the balance keeps earning interest until the extended maturity date.

**Response `data`** (`BurseVaultPlanExtendData`)
```jsonc
{
  "vaultPlanId": "665f...",
  "oldMaturityDate": "2027-07-08T23:59:59.999Z",
  "newMaturityDate": "2027-10-08T23:59:59.999Z",
  "totalDuration": 15,
  "interestRate": 14.5,
  "interestPayoutType": "MATURITY",
  "newInterestAtMaturity": 62000
}
```

---

## 7. Other Burse Vault endpoints (unchanged behaviour)

| Operation | Type | Request | Notes |
|-----------|------|---------|-------|
| `GetEazilockSavings(status, withdrawalMethod)` | query | optional `status`, `withdrawalMethod` | Lists the user's vaults. Response items now include `vaultType`, `monthlyContribution`, `totalContributed`, `targetAmount`, `fundingSources`, `nextChargeDate`, `missedContributions`. |
| `PreviewEazilockTopup(input)` | mutation | `{ eazilockId, amount }` | **Rejected for INSTALLMENTAL** vaults. |
| `TopupExistingEazilock(input)` | mutation | `{ eazilockId, amount, fundingSource, cardId }` | **Rejected for INSTALLMENTAL** vaults (they are funded by scheduled contributions). |
| `ClaimEazilockInterest(eazilockId)` | mutation | `eazilockId` | For INSTALLMENTAL, **rejected while payout is MATURITY**; allowed once switched to MONTHLY. |
| `StopMonthlyWithdrawal(eazilockId)` | mutation | `eazilockId` | Switches a MONTHLY vault to ENDOFTERM. |
| `GetBurseVaultTransactionHistory(input)` | query | `{ vaultPlanId, transactionType?, startDate?, endDate?, search?, page?, limit? }` | Installmental contributions appear as `TOP_UP`; the first as `PLAN_PLEDGED`; maturity as `PLAN_MATURED`; monthly interest (MONTHLY payout) as `INTEREST_PAID`. |
| `GenerateEazilockGrowthChart(...)` | query | `initialAmount, duration, period, periodCount` | Chart.js projection (ONE_TIME oriented). |
| `GetBurseSavedCards` | query | – | Saved cards for funding selection. |

---

## 8. Lifecycle summary (INSTALLMENTAL)

1. **Simulate** (`SimulateEazilockSavings`) → show monthly contribution + projected interest.
2. **Create** (`EazilockTopup`, `vaultType: INSTALLMENTAL`) → first contribution collected, primary funding source registered, `nextChargeDate` scheduled.
3. **(Optional) Add sources** (`AddVaultFundingSource`) → ordered-fallback backups.
4. **Monthly (cron `eazilock_installment_charge`)** → auto-debit the contribution across sources in order; retries/arrears on failure.
5. **Monthly (cron `eazilock_installment_interest`)** → interest compounds into the vault (MATURITY) or pays to the wallet (MONTHLY).
6. **(Optional) Switch payout** (`UpdateBurseVaultInterestPayoutType` MATURITY → MONTHLY) or **extend** (`BurseVaultPlanExtend`).
7. **Maturity (cron)** → principal + all accrued interest (− WHT) is paid to the wallet; status → `MATURED`.

---

## 9. Maturity payout bug fix (all vaults)

Fixed a defect where matured **end-of-term** vaults were paid **principal only**:
the payout now includes `withdrawableInterestAmount` in addition to
`deferredInterestAmount`, and the maturity date match uses `$lte` (inclusive of
end-of-day maturity timestamps). No API shape change — matured vaults now credit
principal **and** interest as expected.

---

## 10. Central Auto Save (primary + fallback funding sources)

Auto Save is now a **shared, product-agnostic** feature. One set of endpoints configures
the recurring funding for any supported product; the reusable Auto Save UI calls these.

- Each **plan/resource** has its own Auto Save settings (`productType` + `resourceId`).
- A config has **one PRIMARY** funding source plus ordered **FALLBACK**s. On each monthly
  charge the engine tries them **in order** (primary first) until one succeeds; a cycle is
  only "missed" when **all** fail (then retried/recovered as arrears).
- The user can **change the primary** at any time; extra sources are **fallbacks**.

`resourceId` per product: **BURSE_VAULT** → vault id; **BUILD_WEALTH** → plan reference;
**BURSE_COLLECTIVE** → collective id (each member configures their own, per collective).

> Rollout note: **Burse Vault, Build Wealth, and Burse Collective** are all cut over to
> this engine — the single `auto_save_charge` cron collects every product's contribution
> (the old `eazilock_installment_charge` and `wealth_plan_auto_topup` crons are retired).
> Run the backfill scripts (`src/scripts/backfill-vault-auto-save.ts`,
> `backfill-wealth-auto-save.ts`) before deploying so existing plans get an AutoSaveSetting.

### Enums
```graphql
enum AutoSaveProductType { BUILD_WEALTH  BURSE_VAULT  BURSE_COLLECTIVE }
enum AutoSaveFundingChannel { WALLET  CARD  BANK_TRANSFER }
enum AutoSaveSourceRole { PRIMARY  FALLBACK }
enum AutoSaveAuthorizationStatus { NONE  PENDING  ACTIVE }
```

### `ConfigureAutoSave` (mutation) — set up / replace a resource's Auto Save
```graphql
mutation {
  ConfigureAutoSave(input: {
    productType: BURSE_VAULT
    resourceId: "665f..."
    enabled: true
    debitDay: 25                       # 1,5,10,15,20,25 or 31 (last day)
    primary: { source: WALLET }
    fallbacks: [{ source: CARD, cardId: "660a..." }, { source: BANK_TRANSFER }]
  }) { success message returnStatus data }
}
```
`data` (`AutoSaveSettingsData`):
```jsonc
{
  "productType": "BURSE_VAULT",
  "resourceId": "665f...",
  "enabled": true,
  "debitDay": 25,
  "nextChargeDate": "2026-08-25T00:00:00.000Z",
  "missedContributions": 0,
  "primary":  { "role": "PRIMARY",  "source": "WALLET",       "cardId": null,      "authorizationStatus": "NONE" },
  "fallbacks":[{ "role": "FALLBACK", "source": "CARD",         "cardId": "660a...", "authorizationStatus": "ACTIVE" },
               { "role": "FALLBACK", "source": "BANK_TRANSFER","cardId": null,      "authorizationStatus": "PENDING" }],
  "redirectUrl": "https://checkout.paystack.com/...",   // present only when a BANK_TRANSFER mandate must be authorised
  "reference": "..."
}
```
`enabled: false` turns Auto Save off (keeps the record). BANK_TRANSFER sources return a
`redirectUrl` to authorise the direct-debit mandate (captured via webhook).

### `SetPrimaryFundingSource` (mutation) — change the primary
```graphql
mutation {
  SetPrimaryFundingSource(input: {
    productType: BURSE_VAULT, resourceId: "665f...", source: CARD, cardId: "660a..."
  }) { success message returnStatus data }
}
```
Promotes `source` to PRIMARY and demotes the previous primary to a FALLBACK. If the channel
isn't registered yet it is added first (CARD needs `cardId`; BANK_TRANSFER returns a mandate URL).

### `AddFallbackFundingSource` (mutation)
```graphql
mutation {
  AddFallbackFundingSource(input: {
    productType: BURSE_VAULT, resourceId: "665f...", source: BANK_TRANSFER
  }) { success message returnStatus data }
}
```

### `RemoveAutoSaveFundingSource` (mutation)
Removes a fallback. The primary cannot be removed directly — set another primary first.
```graphql
mutation {
  RemoveAutoSaveFundingSource(input: {
    productType: BURSE_VAULT, resourceId: "665f...", source: CARD
  }) { success message returnStatus data }
}
```

### `GetAutoSaveSettings` (query)
```graphql
query {
  GetAutoSaveSettings(input: { productType: BURSE_VAULT, resourceId: "665f..." }) {
    success message returnStatus data
  }
}
```
Returns the `AutoSaveSettingsData` shape above (or `enabled: false`, `primary: null`,
`fallbacks: []` when nothing is configured).

### Legacy endpoints (kept as thin wrappers)
`AddVaultFundingSource` now delegates to `AddFallbackFundingSource`. Build Wealth's
`ToggleWealthPlanAutoSave` and Burse Collective's funding-preference endpoint remain for
back-compat; new screens should prefer the central endpoints above.
