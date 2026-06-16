# Build Wealth — Technical Documentation

> **Branch:** `feature/new-build-wealth`
> **Purpose:** Single source of truth for the Build Wealth module — schemas, endpoints, enums, and response shapes. Maintained for technical assessment by new devs and by the Admin backend team.
>
> **Maintenance rule:** Every change to the Build Wealth module on this branch must be reflected here, including a Change Log entry at the bottom. Update this file in the same commit as the code change.

---

## 1. Overview

Build Wealth is a savings **product** (a sibling to Burse Vault) with its own interest-rate calculation (details TBD). A user creates a **Wealth Plan** under this product, optionally guided by a **Wealth Goal**, and funds it in one of two **saving modes** (Solo or Elite Circle).

Module surface so far:

| Area | Status |
| --- | --- |
| Wealth Goals catalogue (`GetAllWealthGoals` + seeder) | ✅ Implemented |
| Enums (`WealthSavingMode`, `WealthPlanStatus`, ledger enums) | ✅ Implemented |
| Data layer: `WealthPlan`, `WealthPlanTransaction` ledger, `BuildWealthSetting` (admin-editable rate) | ✅ Implemented (models/repos/seeder) |
| Admin-editable interest rate (default 14.5% APY) | ✅ Implemented (config + seeder) |
| `CreateWealthPlan` (draft, validates goals) | ✅ Implemented |
| `ActivateWealthPlan` / `TopUpWealthPlan` (Card / Wallet / Bank Transfer) | ✅ Implemented |
| Monthly interest compounding job | 🚧 Planned |
| `GenerateWealthSimulation` (standalone projections) | 🚧 Planned |
| Withdrawals / penalties | 🚧 Planned |
| Build Wealth interest-rate **calculation** model | 🚧 Planned (spec TBD) |

---

## 2. Enums

### `WealthSavingMode`

How a user tops up their wealth plan.

| Value | Meaning |
| --- | --- |
| `SOLO` | The user funds the plan alone. |
| `ELITE_CIRCLE` | The user funds the plan through an Elite Circle (group). |

- **TS (source of truth):** [`src/types/wealth-plan.ts`](src/types/wealth-plan.ts) — `export enum WealthSavingMode`
- **GraphQL:** [`src/api/typeDefs/wealth-plan.ts`](src/api/typeDefs/wealth-plan.ts) — `enum WealthSavingMode`

### `WealthPlanStatus`

Lifecycle of a wealth plan. Will be extended as features land. Note: "maturity" refers to the monthly interest cycle, **not** the plan ending.

| Value | Meaning |
| --- | --- |
| `PENDING_ACTIVATION` | Draft — created but not yet funded/activated. |
| `ACTIVE` | Activated and accruing interest. |
| `COMPLETED` | Reached its target/duration; no longer accruing. |
| `CLOSED` | Closed/liquidated by user or admin. |

Source: [`src/types/wealth-plan.ts`](src/types/wealth-plan.ts) — `export enum WealthPlanStatus`. (Not yet exposed in GraphQL; will be added with the create endpoint.)

### Ledger enums (`WealthPlanTransaction`)

Defined in [`src/types/wealth-plan.ts`](src/types/wealth-plan.ts):

- **`WealthPlanTransactionType`** — `CREDIT`, `DEBIT`
- **`WealthPlanTransactionCategory`** — `ACTIVATION`, `CONTRIBUTION`, `INTEREST`, `WITHDRAWAL`, `PENALTY`
- **`WealthPlanFundingSource`** — `WALLET`, `CARD`, `BANK_TRANSFER`

### Shared `interestType` enum

Build Wealth accrues interest in the **existing** interest table ([`src/models/interest.ts`](src/models/interest.ts)). A `BUILD_WEALTH` member was added to `interestType` ([`src/types/Savings.ts`](src/types/Savings.ts)) so Build Wealth interest records are tagged distinctly from `SAVINGS` / `INVESTMENT`.

---

## 3. Wealth Goals

A curated catalogue of goals shown on the **Goals** screen during plan creation. CRUD (create/update/deactivate) is owned by the **Admin backend**; this service exposes read-only access plus a startup seeder.

### 3.1 Collection: `wealthgoals`

Schema: [`src/db/schema/wealth-goal.schema.ts`](src/db/schema/wealth-goal.schema.ts)

| Field | Type | Notes |
| --- | --- | --- |
| `code` | `String` | **Required, unique, uppercased.** Stable identifier (e.g. `CHILD_FUTURE`). Exposed to the frontend as `id`; referenced by downstream simulation/plan endpoints. |
| `title` | `String` | Required. |
| `description` | `String` | Required. |
| `icon` | `String \| null` | URL to the goal icon, uploaded to S3 via the `gcpUpload` mutation. Defaults to `null` until set. |
| `displayOrder` | `Number` | Required (default `0`). Ascending sort order for display. |
| `isActive` | `Boolean` | Default `true`. Inactive goals are excluded from `GetAllWealthGoals`. |
| `createdAt` / `updatedAt` | `Date` | Mongoose timestamps. |

Indexes: `{ isActive: 1, displayOrder: 1 }`, plus the unique index on `code`.

> **Admin backend contract:** new goals **must** set a unique `code`, or `GetAllWealthGoals` will return an empty `id` for them.

### 3.2 Icon upload

Admins upload icons through the existing mutation (no Build-Wealth-specific upload endpoint):

```graphql
mutation { gcpUpload(file: Upload!): Result! }   # data => uploaded file URL
```

The returned URL is then stored as the goal's `icon` via the Admin CRUD.

### 3.3 Seeder

[`src/scripts/seeds/seed-wealth-goals.ts`](src/scripts/seeds/seed-wealth-goals.ts)

- Runs at app start in [`src/app.ts`](src/app.ts), after the DB connection is established.
- **Idempotent, self-healing, and admin-safe:** on every run it (1) deletes legacy documents without a `code` (an earlier schema seeded goals with a `ratio` field and no `code`/`displayOrder`/`icon`), then (2) inserts any **missing** canonical goal keyed on `code` using **`$setOnInsert`**. Because it uses `$setOnInsert` (not `$set`), it **never overwrites fields an admin has edited** (title/description/icon/displayOrder/isActive) on existing goals — only brand-new codes are added. The legacy cleanup repaired the DBs where the old shape made `GetAllWealthGoals` omit `id`/`displayOrder` (undefined keys are dropped by JSON serialization); deploying is enough to fix an affected environment.
- **Caveat:** a default goal that an admin **hard-deletes** will be re-inserted on next start. To retire a goal, set `isActive: false` (preserved by the seeder) rather than deleting it.
- Default seeded codes: `PEACEFUL_RETIREMENT`, `CHILD_FUTURE`, `FAMILY_WEALTH`, `OWN_PROPERTY`, `START_BUSINESS`, `FINANCIAL_FREEDOM`, `LIFE_UNCERTAINTIES`, `RETIRE_PARENTS`, `LEAVE_LEGACY`, `LIFE_ON_MY_TERMS` (each `icon: null`, `displayOrder` 1–10).

### 3.4 Endpoint: `GetAllWealthGoals`

| | |
| --- | --- |
| **Type** | Query |
| **Auth** | None (public catalogue) |
| **Arguments** | None |
| **Resolver** | [`src/api/wealth-goal.api.ts`](src/api/wealth-goal.api.ts) |
| **TypeDef** | [`src/api/typeDefs/wealth-goal.ts`](src/api/typeDefs/wealth-goal.ts) |

**Query:**

```graphql
query GetAllWealthGoals {
  GetAllWealthGoals {
    success
    message
    returnStatus
    data
  }
}
```

**Response** (`data` is a JSON array, sorted by `displayOrder`, active goals only):

```json
{
  "success": true,
  "message": "Wealth goals fetched successfully",
  "returnStatus": "SUCCESS",
  "data": [
    {
      "id": "CHILD_FUTURE",
      "title": "I want to secure my child's future",
      "description": "Education, inheritance, and opportunities",
      "icon": null,
      "displayOrder": 2,
      "isActive": true
    }
  ]
}
```

Per-goal shape:

```ts
{ id: string; title: string; description: string; icon: string | null; displayOrder: number; isActive: boolean }
```

---

## 4. Build Wealth product setting (admin-editable interest rate)

The Build Wealth interest rate (APY) is **not hard-coded** — it lives in a config record an admin can edit at any time. Current default: **14.5% APY**.

### 4.1 Collection: `buildwealthsettings`

Schema: [`src/db/schema/build-wealth-setting.schema.ts`](src/db/schema/build-wealth-setting.schema.ts). Singleton (one record per product).

| Field | Type | Notes |
| --- | --- | --- |
| `product` | `String` | Unique. Fixed value `"BUILD_WEALTH"`. |
| `description` | `String` | Human label. |
| `interestRate` | `Number` | **APY (%) — admin-editable.** Seeded to `14.5`. |
| `modifiedBy` | `ObjectId → Adminuser` | Last admin who changed it (nullable). |
| `createdAt` / `updatedAt` | `Date` | Timestamps. |

- **Seeder:** [`src/scripts/seeds/seed-build-wealth-setting.ts`](src/scripts/seeds/seed-build-wealth-setting.ts) — runs at app start, inserts the default `14.5%` only if absent (never overwrites an admin's edit).
- **Read access:** [`BuildWealthSettingRepository.getInterestRate()`](src/db/repository/build-wealth-setting.repository.ts) returns the current rate (falls back to the default constant if unseeded). All interest math must read the rate through this — never hard-code `14.5`.
- Default constant: `DEFAULT_BUILD_WEALTH_APY` in [`src/types/wealth-plan.ts`](src/types/wealth-plan.ts).

---

## 5. Wealth Plan data model

A wealth plan is a Build Wealth savings instrument owned by a user. Created as a **draft** (`PENDING_ACTIVATION`), it accrues interest once activated.

### 5.1 Collection: `wealthplans`

Schema: [`src/db/schema/wealth-plan.schema.ts`](src/db/schema/wealth-plan.schema.ts)

| Field | Type | Notes |
| --- | --- | --- |
| `user` | `ObjectId → User` | Required. Owner. |
| `planReference` | `String` | Required, unique. Public ref, e.g. `BW123456` (returned as `planId`). |
| `planName` | `String` | Required. |
| `goalIds` | `String[]` | Selected wealth goal **codes** — a plan can have **many** goals. |
| `monthlyIncome` | `Number` | Required. |
| `monthlyContribution` | `Number` | Required. |
| `targetAmount` | `Number` | Required. |
| `durationMonths` | `Number` | Required. **Derived** at creation from `targetAmount` + `monthlyContribution` (source of truth). |
| `durationYears` | `Number` | Required. Derived convenience value = `durationMonths / 12` (may be fractional). No longer user-supplied. |
| `savingMode` | `WealthSavingMode` | `SOLO` \| `ELITE_CIRCLE`. |
| `status` | `WealthPlanStatus` | Default `PENDING_ACTIVATION`. |
| `balance` | `Number` | Current total balance; monthly interest **compounds** into this. Default `0`. |
| `totalContributed` | `Number` | Lifetime contributions. Default `0`. |
| `totalInterestEarned` | `Number` | Lifetime interest credited. Default `0`. |
| `activatedAt` | `Date \| null` | Set on activation. |
| `nextInterestDate` | `Date \| null` | Next monthly interest/maturity date once active. |
| `giftToken` | `String` | Required, unique. Unguessable token (random 16-byte hex) identifying the plan in a shareable contribution URL. |
| `giftUrl` | `String` | Required. Full shareable link, e.g. `https://useburse.com/build-wealth/gift/<giftToken>` (root from `BUILD_WEALTH_GIFT_BASE_URL`). |
| `fundingSource` | `WealthPlanFundingSource` | The recurring auto-debit source, set at activation. `WALLET` \| `CARD` \| `BANK_TRANSFER` (Direct Debit). |
| `cardId` | `ObjectId → Card \| null` | Saved card when `fundingSource = CARD`. |
| `authorizationCode` | `String \| null` | Paystack auth code (card token or direct-debit mandate) for recurring charges. |
| `authorizationStatus` | `WealthPlanAuthorizationStatus` | `NONE` \| `PENDING` \| `ACTIVE`. Default `NONE`. |
| `autoTopUp` | `Boolean` | Whether scheduled auto top-up is on. Default `false` (set true at activation). |
| `debitDay` | `Number \| null` | Day of month (1–31; 31 clamps to the month's last day) for auto top-up. |
| `nextChargeDate` | `Date \| null` | Next scheduled auto-debit date. |
| `autoTopUpRetryCount` / `autoTopUpFirstFailedAt` | `Number` / `Date \| null` | 3-day retry window bookkeeping. |
| `missedContributions` | `Number` | Count of missed months awaiting arrears recovery. Default `0`. |
| `lastChargedCycle` | `String \| null` | `"YYYY-MM"` of the last applied current-cycle contribution (idempotency guard). |
| `lastChargeReference` | `String \| null` | Most recent Paystack reference initiated for the plan. |
| `createdAt` / `updatedAt` | `Date` | Timestamps. |

Indexes: `{ user: 1, status: 1 }` and `{ status: 1, autoTopUp: 1, nextChargeDate: 1 }` (auto top-up scan). Repository: [`src/db/repository/wealth-plan.repository.ts`](src/db/repository/wealth-plan.repository.ts).

> **Design note:** there is intentionally **no `simulationId`/`simulationReference`** on the plan. The previous wealth-plan design coupled the two and made things unnecessarily complicated. `GenerateWealthSimulation` will be a standalone endpoint that produces daily/weekly/monthly/yearly interest projections and has nothing to do with the persisted plan.

### 5.2 Collection: `wealthplantransactions` (auditable ledger)

Schema: [`src/db/schema/wealth-plan-transaction.schema.ts`](src/db/schema/wealth-plan-transaction.schema.ts)

Records every credit/debit against a plan (contributions, interest, withdrawals, penalties) — auditable, like `SavingsHistory`, but **dedicated** to Build Wealth.

| Field | Type | Notes |
| --- | --- | --- |
| `wealthPlan` | `ObjectId → WealthPlan` | Required. |
| `user` | `ObjectId → User` | Required. |
| `transactionType` | `WealthPlanTransactionType` | `CREDIT` \| `DEBIT`. |
| `transactionCategory` | `WealthPlanTransactionCategory` | `ACTIVATION`, `CONTRIBUTION`, `INTEREST`, `WITHDRAWAL`, `PENALTY`. |
| `fundingSource` | `WealthPlanFundingSource` | `WALLET` \| `CARD` (credits). Optional. |
| `amount` | `Number` | Required. |
| `balance` | `Number` | Running plan balance **after** this entry. |
| `narration` | `String` | Required. |
| `reference` | `String` | External/payment reference (optional). |
| `createdAt` / `updatedAt` | `Date` | Timestamps. |

Indexes: `{ wealthPlan: 1, createdAt: -1 }`, `{ user: 1, createdAt: -1 }`. Repository: [`src/db/repository/wealth-plan-transaction.repository.ts`](src/db/repository/wealth-plan-transaction.repository.ts).

> **Why a dedicated ledger (not `SavingsHistory`):** `SavingsHistory`'s `type` enum and `savings` ref are scoped to the legacy products (Emergency Funds / Eazilock / Target Savings), and its categories don't cover Build Wealth concepts (e.g. `PENALTY`, interest that compounds into balance rather than paying to wallet). A separate collection keeps the shared ledger clean and Build Wealth auditing self-contained.

### 5.3 Interest model — how Build Wealth differs

- Once a plan is **activated**, interest accrues into the **existing interest table** ([`src/models/interest.ts`](src/models/interest.ts)), tagged with `interestType.BUILD_WEALTH`, exactly like other savings plans.
- Interest matures **monthly**.
- **Key difference vs Burse Vault:** Burse Vault pays the matured monthly interest **out to the user's wallet**. Build Wealth instead **adds the matured interest to the plan's `balance` so it compounds** the following month. Each maturity also writes an `INTEREST` `CREDIT` entry into `wealthplantransactions` for audit.

### 5.4 Plan math & constraints (the achievability model)

A plan is modelled as a fixed monthly contribution `c` paid for `n` months, with the balance compounding monthly at rate `r`. The math lives in a **reusable, dependency-free module** — [`src/services/build-wealth/wealth-plan-calculator.ts`](src/services/build-wealth/wealth-plan-calculator.ts) — so simulation, creation, and future features share one implementation.

**Constants** ([`src/types/wealth-plan.ts`](src/types/wealth-plan.ts)):

| Constant | Value | Meaning |
| --- | --- | --- |
| `WEALTH_PLAN_MIN_DURATION_YEARS` / `WEALTH_PLAN_MIN_MONTHS` | `2` / `24` | A plan must run **at least** 2 years. |
| `WEALTH_PLAN_MAX_DURATION_YEARS` / `WEALTH_PLAN_MAX_MONTHS` | `20` / `240` | A plan must run **at most** 20 years. |
| `HEALTHY_CONTRIBUTION_MIN_RATIO` / `_MAX_RATIO` | `0.15` / `0.40` | Healthy contribution band = 15–40% of income. |

**Rate & formulas** (mirrors `SavingsInterestCalculatorService.getEffectiveMonthlyRate`; APY is treated as an *effective annual* rate, read via [`BuildWealthSettingRepository.getInterestRate()`](src/db/repository/build-wealth-setting.repository.ts)):

- Monthly rate: `r = (1 + APY/100)^(1/12) − 1`
- Future value: `FV(c, n) = c · ((1+r)^n − 1) / r`  (when `r = 0`: `c · n`)
- Months to target: `n = ceil( ln(1 + T·r/c) / ln(1+r) )`  (when `r = 0`: `ceil(T/c)`)
- Required contribution for `n` months: `c = T·r / ((1+r)^n − 1)`  (when `r = 0`: `T/n`)

**`evaluatePlan(target, contribution, r)`** returns one outcome — used by both `CreateWealthPlan` (throws on non-OK) and `SimulateWealthPlan` (returns it):

| Outcome | When | Returns / guidance |
| --- | --- | --- |
| `OK` | target reachable in 24–240 months | `durationMonths` (the derived plan length) |
| `TOO_SLOW` | `FV(c, 240) < target` (can't reach target in 20 yrs) | `suggestedMonthlyContribution` (to hit target in 20 yrs) + `maxReachableTarget` (most `c` reaches in 20 yrs) |
| `TOO_FAST` | reaches target in **under** 24 months | `suggestedMonthlyContribution` (stretches it to exactly 2 yrs) |
| `INVALID` | non-positive inputs, or `target ≤ contribution` | `reason` |

> **We never silently change the user's `monthlyContribution` or `targetAmount`.** When the pair is valid, the **duration** is derived from it. When it isn't, we **reject with guidance** telling the user exactly how to adjust.

---

## 6. Wealth Plan endpoints

Five **mutations** (`CreateWealthPlan`, `ActivateWealthPlan`, `TopUpWealthPlan`, `ToggleWealthPlanAutoTopUp`, `VerifyWealthPlanCharge`) and five read-only **queries** (`SimulateWealthPlan`, `GetHealthyContribution`, `PreviewWealthPlan`, `GetWealthPlanDetails`, `GetAllWealthPlans`). All require authentication and return `Result!`.
Resolvers: [`src/api/wealth-plan.api.ts`](src/api/wealth-plan.api.ts) · Service: [`src/services/wealth-plan.service.ts`](src/services/wealth-plan.service.ts) · TypeDefs: [`src/api/typeDefs/wealth-plan.ts`](src/api/typeDefs/wealth-plan.ts).

`ActivateWealthPlan`, `TopUpWealthPlan`, and `ToggleWealthPlanAutoTopUp` are guarded by the **email-verification** check (in [`src/api/index.ts`](src/api/index.ts) `EMAIL_VERIFIED_MUTATIONS`) since they can move money / set up debits. `CreateWealthPlan` and `VerifyWealthPlanCharge` are not; the two queries are pure calculations.

> **Frontend flow:** use `GetHealthyContribution` and `SimulateWealthPlan` to pre-validate while the user fills the form, then call `CreateWealthPlan`. `CreateWealthPlan` re-runs the same `evaluatePlan` check server-side, so an invalid pair is rejected even if the client skips simulation.

### 6.1 `CreateWealthPlan` ✅

Creates a **draft** plan (`PENDING_ACTIVATION`). No money moves. **No simulation reference** involved.

**Input** (`CreateWealthPlanInput`):

```jsonc
{
  "planName": "Freedom At 45",
  "goalIds": ["FINANCIAL_FREEDOM", "OWN_PROPERTY"], // many goal codes
  "monthlyIncome": 3200000,
  "monthlyContribution": 750000,
  "targetAmount": 135000000,
  "savingMode": "SOLO"                               // SOLO | ELITE_CIRCLE
}
```

> **`durationYears` is no longer an input.** Duration is **derived** from `targetAmount` + `monthlyContribution` (see §5.4) and stored as `durationMonths` (+ `durationYears = durationMonths/12`).

**Validation:**
1. `goalIds` are uppercased + de-duplicated and checked against the **active** `wealthgoals` codes; unknown codes are rejected (`VALIDATION_ERROR`).
2. `monthlyIncome`, `monthlyContribution`, `targetAmount` must be positive.
3. `evaluatePlan(targetAmount, monthlyContribution, r)` must return `OK`. On `TOO_SLOW` / `TOO_FAST` / `INVALID` the create is rejected (`VALIDATION_ERROR`) with a guided message, e.g.:
   - **TOO_SLOW:** _"On ₦750k monthly you can save up to ₦Xm in 20 years. To reach ₦135M, increase your monthly contribution to ₦Ym, or lower your target to ₦Xm."_
   - **TOO_FAST:** _"On ₦Xm monthly you'd reach ₦Ym in under 2 years. A plan must run at least 2 years — reduce your monthly contribution to ₦Zk, or raise your target."_

**Response** (`data`):

```json
{
  "planId": "BW123456",
  "status": "PENDING_ACTIVATION",
  "durationMonths": 121,
  "giftUrl": "https://useburse.com/build-wealth/gift/179c127c05c5fa6e969e9815ef9d756a",
  "message": "Plan created successfully."
}
```

> `planId` is the plan's `planReference` — the identifier the activate/top-up endpoints expect.
> `giftUrl` is a shareable link (gift-giving/accepting endpoints come later) built from an unguessable `giftToken`. Its root is **`BUILD_WEALTH_GIFT_BASE_URL`** (env), defaulting to `https://useburse.com`; set the env var per-environment to override.

### 6.2 `ActivateWealthPlan` ✅

**Activation = pay the first contribution + grant the auto-debit authorization.** The first contribution is **always exactly `monthlyContribution`** (there is **no `amount` field** — the backend uses the plan's `monthlyContribution`). The chosen `fundingSource` becomes the recurring auto-debit source; `debitDay` sets the monthly schedule and `autoTopUp` is turned on.

**Input** (`ActivateWealthPlanInput`):

```jsonc
{
  "planId": "BW123456",        // planReference from create
  "fundingSource": "WALLET",   // WALLET | CARD | BANK_TRANSFER (Direct Debit)
  "cardId": "<saved-card-id>", // required only when fundingSource = CARD
  "debitDay": 1                // 1–31 (31 = last day); day of month for auto top-up
}
```

**Behaviour by source** (the first contribution = `monthlyContribution`):

| `fundingSource` | Behaviour | Returns URL? |
| --- | --- | --- |
| `WALLET` | Debits the wallet now (`debitUsersWallet`). Plan → `ACTIVE`; `authorizationStatus = ACTIVE` (wallet needs no mandate). | No |
| `CARD` | Charges the saved, tokenised card now via Paystack `chargeAuthorization` (synchronous). On success → `ACTIVE`; stores `authorizationCode = card.token`, `cardId`. Non-success → error. | No |
| `BANK_TRANSFER` | **Paystack Direct Debit.** Initializes a transaction (`channels:['bank']`, `metadata.custom_filters.recurring=true`) that both collects the first payment and creates a reusable mandate. Plan stays `PENDING_ACTIVATION`, `authorizationStatus = PENDING`. **Returns `data.paymentUrl`** — the user approves, then the **webhook** (or `VerifyWealthPlanCharge`) activates the plan and captures the mandate. | **Yes** |

On `ACTIVE`, sets `activatedAt`, `nextInterestDate` (+1 month), `lastChargedCycle` (current `YYYY-MM`), `nextChargeDate` (next `debitDay`), and writes an `ACTIVATION` ledger entry. Response `data`: `{ planId, status, balance, paymentUrl, reference, message }` (`paymentUrl`/`reference` are set only for the Direct Debit flow).

### 6.3 `TopUpWealthPlan` ✅

A **discretionary extra** contribution of **any amount** (separate from the fixed monthly auto top-up). Requires the plan to be `ACTIVE`; writes a `CONTRIBUTION` ledger entry.

**Input** (`FundWealthPlanInput`): `{ planId, amount, fundingSource, cardId? }`.

| `fundingSource` | Behaviour |
| --- | --- |
| `WALLET` | Debits the wallet now. |
| `CARD` | Charges the saved card now via Paystack. |
| `BANK_TRANSFER` | Charges the stored direct-debit mandate if `authorizationStatus = ACTIVE`; otherwise initializes a one-off direct-debit transaction and **returns `data.paymentUrl`**. Async charges (`processing`) are finalized by the webhook. |

### 6.4 `ToggleWealthPlanAutoTopUp` ✅

Turns scheduled auto top-up on/off and lets the user switch funding source or debit day.

**Input** (`ToggleWealthPlanAutoTopUpInput`): `{ planId, enabled, fundingSource?, cardId?, debitDay? }`.

- `enabled: false` → `autoTopUp = false` (stops the cron from charging).
- `enabled: true` → sets `autoTopUp`, `fundingSource`, `debitDay`, `nextChargeDate`. `WALLET` enables immediately; `CARD` requires a tokenised card; `BANK_TRANSFER` reuses an active mandate, otherwise **issues a Direct Debit authorization request** (`/customer/authorization/initialize`) and **returns `data.paymentUrl`** (status `PENDING` until the mandate webhook arrives).

Response `data`: `{ planId, autoTopUp, paymentUrl?, reference?, message }`.

### 6.5 `VerifyWealthPlanCharge` ✅

Confirms a Paystack `reference` after the user returns from a payment/mandate URL. Idempotently applies the charge (activates / records the contribution) and captures any reusable card/direct-debit `authorizationCode` (so future charges are automatic). Useful as a fallback to the webhook.

**Input** (`VerifyWealthPlanChargeInput`): `{ planId, reference }`. Response `data`: `{ planId, status, authorizationStatus, message }`.

### 6.6 `SimulateWealthPlan` ✅ (Query)

Previews a plan without persisting anything, so the frontend can show the outcome and **block submissions that would fail**. Runs the §5.4 model.

**Input** (`SimulateWealthPlanInput`):

```jsonc
{
  "targetAmount": 135000000,
  "monthlyContribution": 750000,
  "targetYear": 2040          // OPTIONAL — see "adjust the target year" below
}
```

**Two modes:**

- **Default (no `targetYear`):** derives the duration for the supplied contribution. Returns `achievable: true` with `planDurationMonths`, `planDurationYears`, and a `durationDescription` like `"around April 2040"`; or `achievable: false` with a guided `message` (+ `suggestedMonthlyContribution`, and `maxReachableTarget` on `TOO_SLOW`).
- **Adjust the target year (`targetYear` set):** the user is steering the end year, so the **supplied `monthlyContribution` is ignored** and the contribution required to hit `targetAmount` by that year is returned as **`newMonthlyContribution`**. The target year must fall within 2–20 years, else `achievable: false` with guidance.

**Response** (`data` is a JSON object — optional numerics are `null`, never omitted):

```jsonc
{
  "achievable": true,
  "planDurationMonths": 121,
  "planDurationYears": 10.08,
  "durationDescription": "around July 2036",
  "newMonthlyContribution": null,          // set only when targetYear was supplied
  "suggestedMonthlyContribution": null,    // set on TOO_SLOW / TOO_FAST
  "maxReachableTarget": null,              // set on TOO_SLOW
  "minDurationYears": 2,
  "maxDurationYears": 20,
  "message": "On ₦750k monthly, you'll reach ₦135M around July 2036."
}
```

### 6.7 `GetHealthyContribution` ✅ (Query)

Returns the healthy monthly-contribution band — **15–40% of monthly income** — and where the supplied contribution sits within it.

**Input** (`GetHealthyContributionInput`):

```jsonc
{ "monthlyIncome": 3200000, "monthlyContribution": 750000 }
```

**Response** (`data`):

```jsonc
{
  "lowerBound": 480000,
  "upperBound": 1280000,
  "status": "WITHIN",            // BELOW | WITHIN | ABOVE
  "isWithinRange": true,
  "message": "Based on your income, a healthy contribution is between ₦480k and ₦1.3M."
}
```

### 6.8 `PreviewWealthPlan` ✅ (Query)

Rich, computed view of an **owned** plan — intended for a `PENDING_ACTIVATION` draft the user returns to (but works for any status). `data` is a JSON object. Owner-scoped (matched by `planReference` + `user`).

**Input:** `planId: ID!`. **Computed:** `projectedValue = futureValue(monthlyContribution, durationMonths, r)`; `projectedInterestEarned = projectedValue − monthlyContribution·durationMonths`; `estimatedCompletionDate = (activatedAt ?? createdAt) + durationMonths`. **Conventions:** `goals` is an **array** of `{ id, title, icon, description }`; `savingMode`/`availableFundingSources` are `{ id, name }` where **`id` is the enum value `ActivateWealthPlan` accepts** (`WALLET`/`BANK_TRANSFER`/`CARD`).

```jsonc
{
  "planId": "BW123456", "status": "PENDING_ACTIVATION", "planName": "Freedom At 45",
  "goals": [{ "id": "FINANCIAL_FREEDOM", "title": "...", "icon": null, "description": "..." }],
  "monthlyIncome": 3200000,
  "savingMode": { "id": "SOLO", "name": "On My Own" },
  "monthlyContribution": 750000, "targetAmount": 135000000,
  "durationYears": 10.08, "durationMonths": 121,
  "interestRate": 14.5, "interestType": "ANNUAL",
  "projectedValue": 135480000, "projectedInterestEarned": 44730000,
  "estimatedCompletionDate": "2036-07-01", "firstContributionAmount": 750000,
  "availableFundingSources": [
    { "id": "WALLET", "name": "Burse Wallet" },
    { "id": "BANK_TRANSFER", "name": "Bank Transfer" },
    { "id": "CARD", "name": "Debit Card" }
  ],
  "termsRequired": true, "activationAllowed": true, "warnings": [],
  "giftUrl": "https://useburse.com/build-wealth/gift/<token>",
  "createdAt": "2026-06-09T12:00:00Z"
}
```

### 6.9 `GetWealthPlanDetails` ✅ (Query)

Full details for an **ACTIVE** plan = the preview fields **plus live progress, recent activity, and action/state flags**. For a non-active plan it returns the **preview shape** (the `status` field conveys `PENDING_ACTIVATION`). Owner-scoped.

**Input:** `planId: ID!`. Active responses add (on top of the preview fields):

```jsonc
{
  "currentBalance": 560000, "totalContributed": 560000, "totalInterestEarned": 0,
  "progress": 14.0,
  "startDate": "2026-06-01", "endDate": "2030-11-01",
  "nextContributionDate": "2026-07-01", "nextInterestDate": null,
  "activatedAt": "2026-06-01T...", "lastUpdatedAt": "2026-06-09T...",
  "fundingSource": "WALLET", "authorizationStatus": "ACTIVE",
  "autoTopUp": true, "topUpEnabled": true, "debitDay": 1, "missedContributions": 0,
  "recentActivity": [
    { "date": "2026-05-25", "type": "CONTRIBUTION", "amount": 56000, "description": "Monthly contribution", "reference": "...", "balance": 560000 }
  ],
  "availableActions": { "canTopUp": true, "canWithdraw": false, "withdrawalWindowOpen": false, "liquidationWindowOpen": false, "canRequestLiquidation": false },
  "currentState": { "type": "NORMAL", "message": null, "expiresAt": null },
  "shareableLink": "https://useburse.com/build-wealth/gift/<token>"
}
```

> `availableActions` and `currentState` are **conservative placeholders** — withdrawal/liquidation flows aren't built yet, so `canWithdraw`/`canRequestLiquidation`/window flags are `false` and state is `NORMAL`. Wire real values when those features land.

### 6.10 `GetAllWealthPlans` ✅ (Query)

Returns `{ summary, plans }`: a per-plan **summary list** (most recent first) plus **aggregate Build Wealth metrics** across the user's plans. One catalogue + APY fetch is shared across all plans (no N+1).

```jsonc
{
  "summary": {
    "totalBalance": 4820000, "totalProjectedValue": 152400000, "totalInterestEarned": 2500500,
    "totalPlans": 5, "activePlans": 5, "maturedPlans": 0,
    "overallAPY": 14.5, "overallProgress": 12.05, "earningsAcrossPlans": 2500500
  },
  "plans": [
    {
      "planId": "BW123456", "planName": "Ikile Master's Fees",
      "goals": [{ "id": "CHILD_FUTURE", "title": "...", "icon": "...", "description": "..." }],
      "currentBalance": 560000, "targetAmount": 4000000, "progress": 14.0,
      "monthlyContribution": 56000, "nextContributionDate": "2026-07-01", "endDate": "2030-11-01",
      "interestRate": 14.5, "durationYears": 4.4, "status": "ACTIVE",
      "savingMode": { "id": "SOLO", "name": "On My Own" },
      "projectedValue": 4039487, "lastActivityDate": "2026-06-01"
    }
  ]
}
```

Aggregates: `totalBalance`/`totalProjectedValue`/`totalInterestEarned` are sums; `activePlans` = `ACTIVE`, `maturedPlans` = `COMPLETED`; `overallProgress = totalBalance / Σ targetAmount`; `overallAPY` = current rate; `earningsAcrossPlans` = `totalInterestEarned`.

### 6.11 Still planned

- **GenerateWealthSimulation** — standalone projection (daily/weekly/monthly/yearly interest), independent of any persisted plan.
- **Gift giving/accepting** endpoints (the `giftUrl`/`giftToken` plumbing already exists on the plan).
- **Withdrawals & penalties** (which will populate `availableActions`/`currentState`), **monthly interest compounding job**.

---

## 7. Auto-debit, Direct Debit & auto top-up

Build Wealth contributions are **auto-debited** from the source the user authorizes at activation. Source semantics (note `BANK_TRANSFER` differs from other products):

| Source | Authorization | Recurring charge |
| --- | --- | --- |
| `WALLET` | None (status `ACTIVE` immediately) | `debitUsersWallet` |
| `CARD` | Saved, tokenised card (`card.token`) | Paystack `chargeAuthorization` |
| `BANK_TRANSFER` | **Paystack Direct Debit mandate** (`authorizationCode`, status `PENDING → ACTIVE`) | Paystack `chargeAuthorization` against the mandate (async) |

### 7.1 Direct Debit (Paystack) — reference `Paystack_Direct_Debit.md`

Paystack helpers in [`paystack.ts`](src/services/classes/PaymentProcessors/paystack.ts):
- `initializeDirectDebit({ email, amount, metadata })` — `channels:['bank']` + `metadata.custom_filters.recurring=true`; returns the authorization URL (collect first payment **and** create a mandate in one step). Used by activation + one-off direct-debit top-ups.
- `initializeAuthorization({ email })` — mandate-only request (`channel:'direct_debit'`); returns a `redirectUrl`. Used by `ToggleWealthPlanAutoTopUp` when enabling Direct Debit without an existing mandate.
- `verifyAuthorization(reference)` — confirms a mandate and returns the reusable `authorizationCode` + active flag.

### 7.2 Webhook handling

**Every Build Wealth Paystack charge carries `metadata.purpose = build_wealth_*`** (`build_wealth_activation` / `build_wealth_topup` / `build_wealth_autodebit` / `build_wealth_autodebit_arrears`) plus `planReference` — passed to `initializeDirectDebit` **and** `chargeAuthorization` (recurring charges). This makes webhook routing **metadata-driven**, not a guess.

The Paystack webhook ([`app.ts`](src/app.ts) → `verifyPaymentFromWebhook`) routes events to [`WealthPlanWebhookService`](src/services/wealth-plan-webhook.service.ts) **before** the default wallet-credit path when `metadata.purpose` starts with `build_wealth_`, the event is `direct_debit.authorization.*`, or (defensive fallback) the charge channel is `direct_debit`:

- `charge.success` → credits the **plan** (never the wallet). Matches the plan by `metadata.planReference` → mandate `authorization_code` → `lastChargeReference`. **Idempotent** by ledger `reference`. Activates a `PENDING_ACTIVATION` plan; otherwise records a contribution (arrears when the purpose ends `_arrears` or the current cycle is already paid). Captures a reusable mandate/card `authorizationCode` when present. For direct-debit plans with arrears, chains the next arrears charge.
- `direct_debit.authorization.created|active` → stores the `authorizationCode` and sets `authorizationStatus` (`ACTIVE` when active) on the most recent `PENDING` direct-debit plan for that customer email.

### 7.3 Auto top-up cron + retry/arrears

Job [`wealth-plan-auto-topup.ts`](src/jobs/wealth-plan-auto-topup.ts), scheduled daily (`EVERY_DAY_AT_2AM`) in [`cron.ts`](src/services/cron.ts). It scans `ACTIVE` plans with `autoTopUp=true`, a non-`PENDING` authorization, and `nextChargeDate <= now`, then for each charges `monthlyContribution` via the funding source (`WealthPlanService.processScheduledCharge`):

- **Success** → credit plan, mark `lastChargedCycle`, advance `nextChargeDate` to next `debitDay`, reset retry counters.
- **Failure** → retry **daily for 3 days** (`AUTO_TOPUP_RETRY_WINDOW_DAYS`); if still failing, **mark the cycle missed** (`missedContributions++`), keep the plan `ACTIVE`, and reschedule for next month.
- **Arrears recovery** — after a successful current-cycle charge, missed months are recovered **one at a time** (charge succeeds → `missedContributions--`, stop on first failure). Synchronous sources (wallet/card) loop inline; Direct Debit chains via successive webhooks. Pure scheduling/retry logic lives in [`wealth-plan-schedule.ts`](src/services/build-wealth/wealth-plan-schedule.ts) (unit-tested).

Idempotency is enforced by the ledger `reference` and the `lastChargedCycle` (`YYYY-MM`) marker, so a plan is never double-charged for the same month.

### 7.4 Atomicity & reconciliation (no lost writes)

**Atomic writes.** Every money application is wrapped in a Mongo transaction ([`withTransaction`](src/db/utils/SessionContextWrapper.ts), the same mechanism the interest jobs use), so a partial state can never be persisted:

- **WALLET** (`settleWalletContribution`): the wallet debit **and** the plan credit + ledger entry commit together or not at all. A failure (e.g. insufficient balance) rolls the whole thing back — the user is never debited without the plan being credited.
- **CARD / Direct Debit** (`applySuccessfulCharge`): the external charge already happened at Paystack, so only the local writes (plan credit + ledger) are wrapped — they land together and are replayable by reference.

**Reconciliation cron** ([`wealth-plan-reconcile.ts`](src/jobs/wealth-plan-reconcile.ts), every 15 min) recovers from a **lost webhook**. It scans plans with an outstanding `lastChargeReference` (stuck `PENDING_ACTIVATION`, `PENDING` mandates, or active direct-debit plans), waits a 10-minute grace, then re-verifies against Paystack (`verifyPayment` / `verifyAuthorization`) and applies the result **idempotently** — reconstructing the correct effect from the verified **amount + `metadata.purpose`**. Because it runs before the daily auto-top-up and advances `lastChargedCycle` on a confirmed charge, a lost webhook cannot cause a duplicate re-charge.

> **Net guarantee:** what must be written is written atomically; anything Paystack confirmed but we missed is re-applied by reconciliation; nothing is double-applied (ledger `reference` + `lastChargedCycle`).

---

## Change Log

| Date | Change |
| --- | --- |
| 2026-06-11 | Initial doc. Added Wealth Goals (`wealthgoals` schema, seeder, `GetAllWealthGoals` query) and `WealthSavingMode` enum (TS + GraphQL). Documented planned Create Wealth Plan shape. |
| 2026-06-11 | Build Wealth redesign — data layer. Added `WealthPlanStatus` + ledger enums; `WealthPlan` model (`goalIds` is now a list; no simulation ref); dedicated `WealthPlanTransaction` ledger; admin-editable `BuildWealthSetting` (default 14.5% APY) with seeder + `getInterestRate()`; added `BUILD_WEALTH` to shared `interestType`. Documented monthly compounding (interest adds to plan balance vs Burse Vault paying to wallet). Endpoints still pending. |
| 2026-06-12 | Implemented `CreateWealthPlan` (draft + goal validation), `ActivateWealthPlan`, `TopUpWealthPlan`. Added `BANK_TRANSFER` to `WealthPlanFundingSource`; funding supports Card (Paystack `chargeAuthorization`), Wallet, and Bank Transfer (wallet-debit after virtual-account top-up). Added `WealthPlanService`, resolvers, GraphQL inputs/mutations; guarded the two money-moving mutations with email verification. |
| 2026-06-15 | Fixed `GetAllWealthGoals` omitting `id` (and `displayOrder`). Root cause was data, not code: DBs held legacy `wealthgoals` docs from an old schema (a `ratio` field, no `code`/`displayOrder`/`icon`), so `goal.code` was `undefined` and JSON serialization dropped the key. Rewrote the seeder to be self-healing — deletes legacy code-less docs and upserts the canonical catalogue by `code` on every app start. Re-seeding (or deploying) repairs affected environments. |
| 2026-06-15 | Made the wealth-goals seeder **admin-safe**: switched the upsert from `$set` to `$setOnInsert` so it inserts missing goals but never overwrites admin edits on existing ones (hard-deleted defaults are re-inserted; deactivate via `isActive:false` instead). |
| 2026-06-15 | Added wealth-plan **validation, simulation & healthy-contribution**. New reusable `wealth-plan-calculator.ts` (effective-monthly-rate annuity math; `evaluatePlan` → OK/TOO_SLOW/TOO_FAST/INVALID) and 2–20 yr + 15–40% constants. `CreateWealthPlan` now **derives & validates duration** from target + contribution (removed `durationYears` input; added `durationMonths` to the schema) and rejects unachievable pairs with guided messages. Added two authenticated queries: `SimulateWealthPlan` (duration preview / target-year adjustment → required contribution) and `GetHealthyContribution` (15–40% of income band). Added `formatNairaAbbrev` helper and a calculator jest test. |
| 2026-06-15 | **Auto-debit activation, Direct Debit, auto top-up & gift URL.** Activation now collects exactly `monthlyContribution` (removed the `amount` input) and grants an auto-debit authorization on the chosen source. `BANK_TRANSFER` reinterpreted as **Paystack Direct Debit** for Build Wealth (initialize/charge/verify mandate; webhook captures the `authorizationCode`). Added Paystack helpers (`initializeDirectDebit`, `initializeAuthorization`, `verifyAuthorization`) and routed Build Wealth events through `WealthPlanWebhookService` (credits the plan, idempotent). New mutations `ToggleWealthPlanAutoTopUp` and `VerifyWealthPlanCharge`; `TopUpWealthPlan` keeps an arbitrary amount and supports the new sources. Added a daily **auto top-up cron** with a 3-day retry window and missed-month arrears recovery (`wealth-plan-auto-topup.ts` + pure `wealth-plan-schedule.ts`, unit-tested). Plan schema gained `giftToken`/`giftUrl` (root from new `BUILD_WEALTH_GIFT_BASE_URL` env, default `useburse.com`), funding/authorization/schedule/retry fields, and an auto-top-up scan index. |
| 2026-06-16 | **Reliability hardening.** (1) All Build Wealth charges now send `metadata.purpose = build_wealth_*` (threaded through `chargeAuthorization`), so webhook routing is metadata-driven rather than channel-guessed. (2) Money applications are wrapped in Mongo transactions (`withTransaction`): WALLET debit + plan credit + ledger commit atomically (verified: a failed debit rolls back with zero partial writes); card/direct-debit local writes are wrapped too. (3) Added a 15-minute **reconciliation cron** (`wealth-plan-reconcile.ts`) that re-verifies outstanding `lastChargeReference`s against Paystack and applies them idempotently (using verified amount + purpose), so a lost webhook never loses a charge or causes a double-charge. Added `metadata` to `PaystackChargeAuthorizationInput`. |
| 2026-06-16 | **Read endpoints.** Added three authenticated, owner-scoped queries so a user can fetch plans after leaving the app: `PreviewWealthPlan` (rich draft view + projections), `GetWealthPlanDetails` (active plan = preview + live progress/`recentActivity`/`availableActions`/`currentState`/`shareableLink`; non-active → preview shape), and `GetAllWealthPlans` (`{ summary, plans }` — per-plan summaries + aggregate metrics: totals, active/matured counts, overall progress/APY). `goals` returned as a `{id,title,icon,description}` **array**; `savingMode`/`availableFundingSources` as `{id,name}` with `id` = the enum value `ActivateWealthPlan` accepts. Added `WEALTH_SAVING_MODE_NAMES` + `WEALTH_FUNDING_SOURCE_OPTIONS`; reused `futureValue` for projections. Withdrawal/liquidation action flags are placeholders pending those features. |
