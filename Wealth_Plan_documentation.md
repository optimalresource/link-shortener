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
| Withdrawal / liquidation **window state + UI copy** (read side) | ✅ Implemented (`GetWealthPlanDetails`) |
| Withdrawal / liquidation **request / cancel / execute** (4 mutations + 7-day execution cron, PIN-guarded) | ✅ Implemented |
| Exit rules per **Build Wealth Exit FRD v1.1**: 2-year minimum gate, 30% withdrawal cap, 30-day anniversary liquidation window, anniversary-reset annual allowance, 24h-cancel rule | ✅ Implemented |
| Exit **charges** (last-90-day interest forfeiture + 2.5% fee + 10% WHT) applied at execution, with `PENALTY` ledger entries | ✅ Implemented |
| Exit **breakdown** preview (`GetWealthExitBreakdown`) for the amount/closure screens | ✅ Implemented |
| **WHT collection & remittance** — `taxcollections` queue (Build Wealth **+ savings**) + admin list/mark-remitted endpoints | ✅ Implemented (§8) |
| **Contribution streak + milestones** (`contributionStreak`, `wealthmilestones`, incl. anniversary job) | ✅ Implemented (§9.1) |
| **Elite Circle** — dashboard, single member plan, cheers (+ notifications), respond, circle inbox | ✅ Implemented (§9) |
| **Monthly interest compounding job** | 🚧 Planned (the remaining large item) |
| Portfolio-backed **loan ("Enjoy Life")** alternative + loan-aware 30% cap | 🚧 Not in this service (dependency) |
| Build Wealth interest-rate **calculation** model (plan-creation/simulation) | ✅ Implemented (see §5.4) |

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
- **`WealthPlanTransactionCategory`** — `ACTIVATION`, `CONTRIBUTION`, `INTEREST`, `WITHDRAWAL`, `PENALTY` (forfeited interest + fee), `WHT` (withholding tax, its own line so it can be remitted — §8)
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
| `autoTopUp` | `Boolean` | Whether scheduled auto save is on. Default `false`; turned on via `ToggleWealthPlanAutoSave` (not at activation). |
| `debitDay` | `Number \| null` | Day of month (1–31; 31 clamps to the month's last day) for auto save. Set when enabling auto save. |
| `nextChargeDate` | `Date \| null` | Next scheduled auto-debit date. |
| `autoTopUpRetryCount` / `autoTopUpFirstFailedAt` | `Number` / `Date \| null` | 3-day retry window bookkeeping. |
| `missedContributions` | `Number` | Count of missed months awaiting arrears recovery. Default `0`. |
| `contributionStreak` | `Number` | Consecutive on-time contributions up to the latest one; `+1` per current-cycle contribution (incl. activation), reset to `0` on a missed cycle. Drives the Elite Circle "streak" (§9). Default `0`. |
| `onTimeContributions` | `Number` | Lifetime count of on-time contributions (never reset). With the elapsed schedule it yields the Elite Circle "on-time %" (§9.2). Default `0`. |
| `lastChargedCycle` | `String \| null` | `"YYYY-MM"` of the last applied current-cycle contribution (idempotency guard). |
| `lastChargeReference` | `String \| null` | Most recent Paystack reference initiated for the plan. |
| `withdrawalRequest` | embedded `{ status, requestedAt, executeAt, amount, cancelledAt }` | The plan's current/most-recent **withdrawal** request. `status`: `WealthPlanRequestStatus` (`NONE` \| `IN_MOTION` \| `EXECUTED` \| `CANCELLED`, default `NONE`). `requestedAt` anchors the once-a-year lock; `executeAt` = `requestedAt` + 7 days. Drives the `withdrawal` window in §6.9. |
| `liquidationRequest` | embedded `{ status, requestedAt, executeAt, amount, cancelledAt }` | Same shape, for **liquidation** (`amount` unused — liquidation moves the whole balance). Drives the `liquidation` window in §6.9. |
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

### 5.5 Exit model — withdrawal & liquidation (Build Wealth Exit FRD v1.1)

The early-exit/liquidation/withdrawal rules implement **`Build_Wealth_Exit_FRD_v1.1.docx`**. The three "exit" paths and their rules:

| | **Withdraw** | **Liquidate** | (Loan — "Enjoy Life") |
| --- | --- | --- | --- |
| Plan continues | Yes, partially | No (plan closes) | Yes |
| Available when | After year 2, **once per plan year** | After year 2, **only in the 30-day window** | Anytime |
| Maximum amount | **30% of balance** at request time | Full balance | Up to collateral ratio |
| Notice period | 7 days (cancellable) | 7 days (cancellable) | None |
| Interest forfeited | Last 90 days on the withdrawal amount | Last 90 days on the plan | None |
| Service fee | 2.5% of amount withdrawn | 2.5% of payout | — |
| WHT | 10% of interest paid out | 10% of interest paid out | — |

**Eligibility gate (both kinds).** No exit is permitted before the plan completes its **2-year minimum term**, measured from `activatedAt` (FRD §3.1/§7.1). The window resolver reports `LOCKED` until then; the request mutations reject it.

**Constants** ([`src/types/wealth-plan.ts`](src/types/wealth-plan.ts)):

| Constant | Value | Meaning |
| --- | --- | --- |
| `WEALTH_PLAN_MIN_DURATION_YEARS` | `2` | 2-year minimum term before any exit. |
| `WEALTH_LIQUIDATION_WINDOW_DAYS` | `30` | Liquidation is only allowed in a 30-day window each plan year. |
| `WEALTH_WITHDRAWAL_MAX_RATIO` | `0.30` | A withdrawal is capped at 30% of the balance. |
| `WEALTH_EXIT_SERVICE_FEE_RATIO` | `0.025` | 2.5% service fee on the gross payout. |
| `WEALTH_WHT_RATIO` | `0.10` | 10% withholding tax on interest paid out. |
| `WEALTH_INTEREST_FORFEIT_DAYS` / `_BASIS_DAYS` | `90` / `360` | Forfeited-interest rate = `APY × (90/360)` (= `APY × 0.25`). |
| `WEALTH_CANCEL_SLOT_FORFEIT_HOURS` | `24` | A cancelled **withdrawal** spends the year's slot only if cancelled within 24h of execution. |

**Calculation engine** — pure module [`wealth-plan-exit.ts`](src/services/build-wealth/wealth-plan-exit.ts), shared by the breakdown query (§6.7a) and the execution cron (§7.3a). For a gross payout `G` (the withdrawal amount, clamped to the 30% cap; or the full balance for liquidation), balance `B`, lifetime interest `I`, APY `r%`:

- **Interest forfeited** = `G × (r/100) × (90/360)` — i.e. `G × r% × 0.25`.
- **Service fee** = `G × 2.5%`.
- **Interest paid out** = `max(G × (I/B) − interestForfeited, 0)` — the interest share of the payout (prorated from `I/B`), net of the forfeiture.
- **WHT** = `interestPaidOut × 10%`.
- **Net to wallet** = `G − interestForfeited − serviceFee − WHT`.
- **Stays in plan** = `B − G` (withdrawal) or `0` (liquidation).

> **FRD reconciliation (decisions baked in).** The FRD's worked examples (§5.5/§5.6) and its written formulas (§7.4) disagree; the **worked examples are authoritative** here: forfeiture uses a **360-day** basis (not 365), and the **2.5% fee is on the full gross** (not on gross-minus-forfeiture). Verified against both examples: ₦500k withdrawal → ₦18,125 forfeited / ₦12,500 fee; ₦1,802,481 liquidation → ₦65,340 forfeited / ₦45,062 fee. **WHT is deducted from the wallet payout** (a product decision); the FRD example "lands in wallet" lines omit WHT, so the real net is slightly lower than those illustrations when interest has accrued. The collected WHT gets its **own ledger line** and a **`taxcollections` record** for remittance (§8). The **WHT base** (interest portion of the payout) is under-specified in the FRD — we prorate it from `I/B`; revisit once the monthly-compounding job tracks the principal/interest split per plan (until then `totalInterestEarned` is `0`, so WHT computes as `0`).

**Not in this service (dependencies).** The portfolio-backed **loan ("Enjoy Life")** alternative the FRD nudges toward — including the loan-aware variant of the 30% cap ("30% of the balance **not backing a loan**") and "liquidation blocked while loans are outstanding" — lives outside this module. The 30% cap is currently computed on the **full** balance.

---

## 6. Wealth Plan endpoints

Nine **mutations** (`CreateWealthPlan`, `ActivateWealthPlan`, `TopUpWealthPlan`, `ToggleWealthPlanAutoSave`, `VerifyWealthPlanCharge`, `RequestWealthPlanWithdrawal`, `CancelWealthPlanWithdrawal`, `RequestWealthPlanLiquidation`, `CancelWealthPlanLiquidation`) and six read-only **queries** (`SimulateWealthPlan`, `GetHealthyContribution`, `GetWealthExitBreakdown`, `PreviewWealthPlan`, `GetWealthPlanDetails`, `GetAllWealthPlans`). All require authentication and return `Result!`.
Resolvers: [`src/api/wealth-plan.api.ts`](src/api/wealth-plan.api.ts) · Service: [`src/services/wealth-plan.service.ts`](src/services/wealth-plan.service.ts) · TypeDefs: [`src/api/typeDefs/wealth-plan.ts`](src/api/typeDefs/wealth-plan.ts).

`ActivateWealthPlan`, `TopUpWealthPlan`, `ToggleWealthPlanAutoSave`, `RequestWealthPlanWithdrawal`, and `RequestWealthPlanLiquidation` are guarded by the **email-verification** check (in [`src/api/index.ts`](src/api/index.ts) `EMAIL_VERIFIED_MUTATIONS`) since they can move money / set up debits; the two **request** mutations additionally validate the **transaction PIN**. `CreateWealthPlan`, `VerifyWealthPlanCharge`, and the two **cancel** mutations are not guarded (cancelling moves no money); the queries are pure reads.

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

**Activation = pay the first contribution + grant the auto-debit authorization.** The first contribution is **always exactly `monthlyContribution`** (there is **no `amount` field** — the backend uses the plan's `monthlyContribution`). The chosen `fundingSource` is stored (and its card token / direct-debit mandate captured) so it can back recurring charges later. **Activation no longer collects `debitDay` and does not turn on auto save** — the recurring schedule is set separately via [`ToggleWealthPlanAutoSave`](#64-togglewealthplanautosave-) (§6.4).

**Input** (`ActivateWealthPlanInput`):

```jsonc
{
  "planId": "BW123456",        // planReference from create
  "fundingSource": "WALLET",   // WALLET | CARD | BANK_TRANSFER (Direct Debit)
  "cardId": "<saved-card-id>"  // required only when fundingSource = CARD
}
```

**Behaviour by source** (the first contribution = `monthlyContribution`):

| `fundingSource` | Behaviour | Returns URL? |
| --- | --- | --- |
| `WALLET` | Debits the wallet now (`debitUsersWallet`). Plan → `ACTIVE`; `authorizationStatus = ACTIVE` (wallet needs no mandate). | No |
| `CARD` | Charges the saved, tokenised card now via Paystack `chargeAuthorization` (synchronous). On success → `ACTIVE`; stores `authorizationCode = card.token`, `cardId`. Non-success → error. | No |
| `BANK_TRANSFER` | **Paystack Direct Debit.** Initializes a transaction (`channels:['bank']`, `metadata.custom_filters.recurring=true`) that both collects the first payment and creates a reusable mandate. Plan stays `PENDING_ACTIVATION`, `authorizationStatus = PENDING`. **Returns `data.paymentUrl`** — the user approves, then the **webhook** (or `VerifyWealthPlanCharge`) activates the plan and captures the mandate. | **Yes** |

On `ACTIVE`, sets `activatedAt`, `nextInterestDate` (+1 month), `lastChargedCycle` (current `YYYY-MM`), and writes an `ACTIVATION` ledger entry. `nextChargeDate` is **not** set here (no `debitDay` yet — it is set when auto save is enabled). Response `data`: `{ planId, status, balance, paymentUrl, reference, message }` (`paymentUrl`/`reference` are set only for the Direct Debit flow).

### 6.3 `TopUpWealthPlan` ✅

A **discretionary extra** contribution of **any amount** (separate from the fixed monthly auto top-up). Requires the plan to be `ACTIVE`; writes a `CONTRIBUTION` ledger entry.

**Input** (`FundWealthPlanInput`): `{ planId, amount, fundingSource, cardId? }`.

| `fundingSource` | Behaviour |
| --- | --- |
| `WALLET` | Debits the wallet now. |
| `CARD` | Charges the saved card now via Paystack. |
| `BANK_TRANSFER` | Charges the stored direct-debit mandate if `authorizationStatus = ACTIVE`; otherwise initializes a one-off direct-debit transaction and **returns `data.paymentUrl`**. Async charges (`processing`) are finalized by the webhook. |

### 6.4 `ToggleWealthPlanAutoSave` ✅

Turns scheduled auto save on/off and lets the user switch funding source or debit day. (Formerly `ToggleWealthPlanAutoTopUp`.)

**Input** (`ToggleWealthPlanAutoSaveInput`): `{ planId, enabled, fundingSource?, cardId?, debitDay? }`.

- `enabled: false` → `autoTopUp = false` (stops the cron from charging).
- `enabled: true` → sets `autoTopUp`, `fundingSource`, `debitDay`, `nextChargeDate`. When enabling, the user **chooses the funding source and the `debitDay`** (day of month, 1–31; 31 = last day) on which they want to be debited — **`debitDay` is now required** (validation error if missing). `WALLET` enables immediately; `CARD` requires a tokenised card; `BANK_TRANSFER` reuses an active mandate, otherwise **issues a Direct Debit authorization request** (`/customer/authorization/initialize`) and **returns `data.paymentUrl`** (status `PENDING` until the mandate webhook arrives).

Response `data`: `{ planId, autoTopUp, paymentUrl?, reference?, message }`.

### 6.5 `VerifyWealthPlanCharge` ✅

Confirms a Paystack `reference` after the user returns from a payment/mandate URL. Idempotently applies the charge (activates / records the contribution) and captures any reusable card/direct-debit `authorizationCode` (so future charges are automatic). Useful as a fallback to the webhook.

**Input** (`VerifyWealthPlanChargeInput`): `{ planId, reference }`. Response `data`: `{ planId, status, authorizationStatus, message }`.

### 6.5a Withdrawal & liquidation requests ✅

Four mutations drive the **one-per-year** withdrawal/liquidation lifecycle whose read-side state is surfaced by `GetWealthPlanDetails` (§6.9). A request doesn't move money immediately — it schedules the move for **7 days** later (`WEALTH_REQUEST_EXECUTION_DAYS`); the [execution cron](#73a-withdrawalliquidation-execution-cron) (§7.3a) settles it, and the user can cancel before then. The two **request** mutations require the **transaction PIN** (validated in the resolver, `transactionType: 'WITHDRAWAL'`) and are guarded by email verification. All four return the affected window object (`withdrawal` or `liquidation`, same shape as §6.9) in `data`, plus `planId`, `status`, and `message`.

| Mutation | Input | What it does |
| --- | --- | --- |
| `RequestWealthPlanWithdrawal` | `{ planId, amount, transactionPin }` | Requires ACTIVE plan **past its 2-year term**, an **OPEN** withdrawal window, `0 < amount ≤ 30% of balance` (the **30% cap**, §5.5), and no in-motion liquidation. Sets `withdrawalRequest` → `IN_MOTION` (`requestedAt`, `executeAt = +7d`, `amount`). |
| `CancelWealthPlanWithdrawal` | `{ planId }` | Only when `IN_MOTION` (before `executeAt`). Sets `CANCELLED` + `cancelledAt`, **keeping `requestedAt`**. Whether it **spends the year's allowance** now depends on timing: a cancel in the **final 24h** before `executeAt` consumes the slot (window stays `CLOSED` to the anniversary); an earlier cancel **returns the slot** (window reopens). |
| `RequestWealthPlanLiquidation` | `{ planId, transactionPin }` | Requires ACTIVE plan **past its 2-year term**, an **OPEN** liquidation window (inside the **30-day anniversary window**, §5.5), and no in-motion withdrawal. Sets `liquidationRequest` → `IN_MOTION`. Liquidation moves the **whole balance** (no `amount`). |
| `CancelWealthPlanLiquidation` | `{ planId }` | Same as the withdrawal cancel, for `liquidationRequest`. A cancelled **liquidation never consumes** the window slot. |

Validation failures throw `ACTION_NOT_ALLOWED` — for a non-OPEN window the thrown message is the window's own copy (e.g. "You've already used your withdrawal for this plan year. …", or the 2-year `LOCKED` copy), so the client can surface it directly. The 30%-cap rejection carries its own guided message.

> **The request mutations only schedule.** No charges are computed or money moved at request time — the **exit charges** (forfeited interest + 2.5% fee + 10% WHT) and the net payout are applied by the execution cron (§7.3a) using the §5.5 calc engine. The client previews the exact figures via `GetWealthExitBreakdown` (§6.7a) before the user confirms.

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

### 6.7a `GetWealthExitBreakdown` ✅ (Query)

Live money breakdown for the withdrawal/liquidation amount screens (FRD §5.5/§5.6) — the figures shown as the member types, before they confirm. **Pure read, owner-scoped, moves no money.** Requires an **ACTIVE** plan. Runs the §5.5 calc engine.

**Input** (`WealthExitBreakdownInput`):

```jsonc
{
  "planId": "BW123456",
  "kind": "WITHDRAWAL",   // WITHDRAWAL | LIQUIDATION
  "amount": 500000        // required for WITHDRAWAL (clamped to the 30% cap); ignored for LIQUIDATION
}
```

**Response** (`data`) — all amounts Naira, 2 dp:

```jsonc
{
  "planId": "BW123456", "kind": "WITHDRAWAL", "balance": 1802481,
  "grossAmount": 500000,            // clamped to withdrawableCap for a withdrawal
  "interestForfeited": 18125,       // gross × APY × 90/360
  "serviceFee": 12500,              // gross × 2.5%
  "interestPaidOut": 0,             // prorated interest share, post-forfeiture
  "wht": 0,                         // 10% of interestPaidOut
  "netToWallet": 469375,            // gross − forfeited − fee − WHT
  "staysInPlan": 1302481,           // balance − gross (0 for liquidation)
  "withdrawableCap": 540744.3,      // 30% of balance (full balance for liquidation)
  "clamped": false,                 // true when amount was clamped to the cap
  "note": null                      // set when a withdrawal amount was clamped
}
```

> WHT is **deducted** from `netToWallet`. When interest has accrued, the net is a touch lower than the FRD's illustrative breakdowns (which omit WHT). See the §5.5 "FRD reconciliation" note for why these figures match the worked examples (360-day forfeiture, fee on full gross).

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
  "withdrawableAmount": 168000, // 30% of currentBalance — most a single withdrawal can take now
  "onTrackBalance": 3440000,   // targetAmount − currentBalance; how much is left to hit the goal (floored at 0)
  "progress": 14.0,
  "startDate": "2026-06-01", "endDate": "2030-11-01",
  "nextContributionDate": "2026-07-01", "nextInterestDate": null,
  "activatedAt": "2026-06-01T...", "lastUpdatedAt": "2026-06-09T...",
  "fundingSource": "WALLET", "authorizationStatus": "ACTIVE",
  "autoTopUp": true, "topUpEnabled": true, "debitDay": 1, "missedContributions": 0,
  "recentActivity": [
    { "date": "2026-05-25", "type": "CONTRIBUTION", "amount": 56000, "description": "Monthly contribution", "reference": "...", "balance": 560000 }
  ],
  "withdrawal": {
    "status": "OPEN",            // LOCKED | OPEN | IN_MOTION | CLOSED
    "windowOpen": true, "inMotion": false, "canRequest": true, "canCancel": false,
    "title": "Withdrawal window open",
    "message": "Your withdrawal window is open until 1 January 2027. You can withdraw up to 30% of your balance, once this plan year.",
    "windowStart": "1 January 2026", "windowEnd": "1 January 2027",
    "executeAt": null, "daysLeft": null, "amount": null, "reopensAt": null
  },
  "liquidation": {
    "status": "CLOSED",          // open only inside the 30-day anniversary window
    "windowOpen": false, "inMotion": false, "canRequest": false, "canCancel": false,
    "title": "Liquidation window closed",
    "message": "Closing your plan is a once-a-year decision. Your liquidation window opens on 1 January 2027.",
    "windowStart": null, "windowEnd": null,
    "executeAt": null, "daysLeft": null, "amount": null, "reopensAt": "1 January 2027"
  },
  "availableActions": {
    "canTopUp": true,
    "canWithdraw": true, "withdrawalWindowOpen": true, "withdrawalInMotion": false, "canCancelWithdrawal": false,
    "canRequestLiquidation": true, "liquidationWindowOpen": true, "liquidationInMotion": false, "canCancelLiquidation": false
  },
  "shareableLink": "https://useburse.com/build-wealth/gift/<token>"
}
```

#### Withdrawal & liquidation windows

`withdrawal` and `liquidation` are the **status flags + UI copy** the screens render. Each is the same shape; the UI switches on `status`:

| `status` | Meaning | Title | Message (interpolated) | Key fields |
| --- | --- | --- | --- | --- |
| `LOCKED` | The plan hasn't completed its **2-year minimum term** yet — no exit is permitted (FRD §3.1). | `"Withdrawal available after your 2-year minimum"` / `"Liquidation available after your 2-year minimum"` | "Build Wealth plans can't be withdrawn from before they're two years old. You'll be able to … from **reopensAt**." | `reopensAt` (= the 2-year date) |
| `OPEN` | Eligible to request once this plan year. Withdrawal: open all plan year (needs `balance > 0` for `canRequest`). Liquidation: only **inside the 30-day anniversary window**. | `"Withdrawal window open"` / `"Liquidation window open"` | Withdrawal: "Your withdrawal window is open until **windowEnd**. You can withdraw up to 30% of your balance, once this plan year." Liquidation: "Your liquidation window is open from **windowStart** to **windowEnd**. …" | `windowStart`, `windowEnd` |
| `IN_MOTION` | A request is pending; funds move on `executeAt` unless cancelled. | `"Withdrawal request in motion"` / `"Liquidation request in motion"` | Withdrawal: "Your request is in motion. We will move **₦amount** to your wallet on **executeAt** (**daysLeft** days left). You can cancel anytime before then." Liquidation: "Your request is in motion. **daysLeft** days left until execution. …" | `executeAt`, `daysLeft`, `amount` (withdrawal), `reopensAt` |
| `CLOSED` | The plan-year allowance is used, **or** the liquidation 30-day window has passed for this year. | `"Withdrawal window closed"` / `"Liquidation window closed"` | "You've already used your … for this plan year. …" or "Closing your plan is a once-a-year decision. Your liquidation window opens on **reopensAt**." | `reopensAt` |

Convenience booleans `windowOpen` / `inMotion` mirror `status`; `canRequest` / `canCancel` are the action gates. Dates are formatted `D MMMM YYYY`; amounts as `₦1,234.00`. `availableActions` is a flat roll-up of the same flags (plus `canTopUp`).

**Business rules (Build Wealth Exit FRD, see §5.5).**

- **2-year minimum term:** before `activatedAt + 2 years`, both windows are `LOCKED`.
- **Plan year anchored on the anniversary:** the once-per-year allowance resets on each plan anniversary (year 2+), **not** on `requestedAt + 1 year`. A request stays `IN_MOTION` for **7 days** (`WEALTH_REQUEST_EXECUTION_DAYS`) before funds move; the user can cancel before then.
- **Withdrawal:** available any time in the plan year (once), capped at **30% of balance**.
- **Liquidation:** available **only** during the **30-day window** opening on each anniversary; outside it the button is inert (`CLOSED`).
- **Cancellation & the annual slot:** a cancelled **withdrawal** consumes the year's allowance **only if cancelled in the final 24h** before `executeAt` (`WEALTH_CANCEL_SLOT_FORFEIT_HOURS`, anti-gaming); an earlier cancel returns the slot. A cancelled **liquidation never** consumes it.

State is persisted on the plan's embedded `withdrawalRequest` / `liquidationRequest` (`{ status, requestedAt, executeAt, amount, cancelledAt }`). The pure, unit-tested [`wealth-plan-windows.ts`](src/services/build-wealth/wealth-plan-windows.ts) (`resolveRequestWindow`) computes all of the above from those fields + `activatedAt`; the request/cancel/execute flows drive them.

### 6.10 `GetAllWealthPlans` ✅ (Query)

Returns `{ summary, filter, plans }`: a per-plan **summary list** (most recent first) plus **aggregate Build Wealth metrics**. One catalogue + APY fetch is shared across all plans (no N+1).

**Input (optional):** `status: WealthPlanStatus` — filters the returned `plans` list. **Defaults to `ACTIVE`.** Values: `ACTIVE`, `PENDING_ACTIVATION`, `COMPLETED` (matured), `CLOSED` (liquidated). The echoed `filter` field reports which status was applied.

> The `plans` list is filtered, but the `summary` aggregates are **always computed across all of the user's plans regardless of status** — so `totalBalance` (and the other totals) stay stable as the user switches filters. Missing/absent values coalesce to **`0`, never `null`**.

```jsonc
{
  "summary": {
    "totalBalance": 4820000, "totalProjectedValue": 152400000, "totalInterestEarned": 2500500,
    "totalPlans": 5, "activePlans": 5, "pendingPlans": 0, "maturedPlans": 0, "liquidatedPlans": 0,
    "overallAPY": 14.5, "overallProgress": 12.05, "earningsAcrossPlans": 2500500
  },
  "filter": "ACTIVE",
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

Aggregates (across **all** plans): `totalBalance`/`totalProjectedValue`/`totalInterestEarned` are sums (null-safe → 0); `activePlans` = `ACTIVE`, `pendingPlans` = `PENDING_ACTIVATION`, `maturedPlans` = `COMPLETED`, `liquidatedPlans` = `CLOSED`; `overallProgress = totalBalance / Σ targetAmount`; `overallAPY` = current rate; `earningsAcrossPlans` = `totalInterestEarned`.

### 6.11 Still planned

- **GenerateWealthSimulation** — standalone projection (daily/weekly/monthly/yearly interest), independent of any persisted plan.
- **Gift giving/accepting** endpoints (the `giftUrl`/`giftToken` plumbing already exists on the plan).
- **Monthly interest compounding job** — interest still needs to mature monthly into the plan balance (and feed `totalInterestEarned`, which the exit WHT base prorates from). Until it lands, accrued interest is `0`, so exit WHT is `0`.
- **Portfolio-backed loan ("Enjoy Life")** + loan-aware 30% cap + "no liquidation with outstanding loans" — a cross-module dependency (see §5.5), not built in this service.
- **Exit notifications** — the FRD §7.6 reminder cadence (window-open notice; 3/2/1/0-day withdrawal countdown; 30/15/7/3/2/1/0-day "money is coming" reminders) is not wired yet.

> **Exit charges are now implemented** (§5.5 + §7.3a): the request/cancel/execute flows deduct forfeited interest + 2.5% fee + 10% WHT and credit the net, writing a `PENALTY` ledger entry for the charges.

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
- `initializeAuthorization({ email })` — mandate-only request (`channel:'direct_debit'`); returns a `redirectUrl`. Used by `ToggleWealthPlanAutoSave` when enabling Direct Debit without an existing mandate.
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

### 7.3a Withdrawal/liquidation execution cron

Job [`wealth-plan-execute-requests.ts`](src/jobs/wealth-plan-execute-requests.ts), scheduled daily (`EVERY_DAY_AT_2AM`). It scans plans with an `IN_MOTION` `withdrawalRequest`/`liquidationRequest` whose `executeAt <= now` (backed by two scan indexes) and calls `WealthPlanService.processDueRequests`:

Both settle via the shared `settleExit`, which runs the **§5.5 calc engine** (`computeExitBreakdown` with the current APY + the plan's `totalInterestEarned`) to derive forfeited interest, 2.5% fee, 10% WHT, and the **net to wallet**, then:

- **Liquidation takes precedence** (it closes the plan): credit the **net** of the whole balance to the wallet (`creditUsersWallet`, `savings_debit`), set `balance = 0`, `status = CLOSED`, `autoTopUp = false`, `nextChargeDate = null`, mark the request `EXECUTED`.
- **Withdrawal**: credit the **net** of the requested gross (clamped to the live balance) to the wallet, decrement the plan by the **gross** (`balance -= gross`), mark `EXECUTED`.

Each settlement writes a **three-entry ledger set** whose amounts sum to the gross, so the running `balance` stays consistent (charges → WHT → cash):
1. `PENALTY` `DEBIT` — forfeited interest + 2.5% fee (line-items in the narration; reference `…-CHG`).
2. `WHT` `DEBIT` — the 10% withholding tax (reference `…-WHT`), **also recorded into the dedicated `taxcollections` queue** (§8) so it can be remitted independently. Skipped when `wht = 0` (e.g. no accrued interest yet).
3. `WITHDRAWAL` `DEBIT` — the **net cash** that reached the wallet.

The plan balance drops by the **gross** — the charges are Burse's (fee revenue / WHT to remit / reabsorbed interest), not returned to the plan.

Each settlement is wrapped in a Mongo transaction (`withTransaction`), so the wallet credit and the plan/ledger writes commit together. Flipping the request to `EXECUTED` makes the scan idempotent — a plan is settled at most once. Cancelled requests are never picked up (status ≠ `IN_MOTION`); the annual lock they leave behind is purely a read-side computation off `requestedAt` + `activatedAt` (§6.9), so no job is needed to "reopen" a window.

### 7.4 Atomicity & reconciliation (no lost writes)

**Atomic writes.** Every money application is wrapped in a Mongo transaction ([`withTransaction`](src/db/utils/SessionContextWrapper.ts), the same mechanism the interest jobs use), so a partial state can never be persisted:

- **WALLET** (`settleWalletContribution`): the wallet debit **and** the plan credit + ledger entry commit together or not at all. A failure (e.g. insufficient balance) rolls the whole thing back — the user is never debited without the plan being credited.
- **CARD / Direct Debit** (`applySuccessfulCharge`): the external charge already happened at Paystack, so only the local writes (plan credit + ledger) are wrapped — they land together and are replayable by reference.

**Reconciliation cron** ([`wealth-plan-reconcile.ts`](src/jobs/wealth-plan-reconcile.ts), every 15 min) recovers from a **lost webhook**. It scans plans with an outstanding `lastChargeReference` (stuck `PENDING_ACTIVATION`, `PENDING` mandates, or active direct-debit plans), waits a 10-minute grace, then re-verifies against Paystack (`verifyPayment` / `verifyAuthorization`) and applies the result **idempotently** — reconstructing the correct effect from the verified **amount + `metadata.purpose`**. Because it runs before the daily auto-top-up and advances `lastChargedCycle` on a confirmed charge, a lost webhook cannot cause a duplicate re-charge.

> **Net guarantee:** what must be written is written atomically; anything Paystack confirmed but we missed is re-applied by reconciliation; nothing is double-applied (ledger `reference` + `lastChargedCycle`).

---

## 8. Withholding tax (WHT) collection & remittance

WHT withheld anywhere in the app is recorded in a **dedicated ledger** so the finance team has a clean queue of amounts to remit — not just narrated inside a product ledger. As of this change it covers **both** Build Wealth exits **and** the savings products (Burse Flex / Burse Vault / Eazilock).

> **Why this exists.** Historically the savings WHT (deducted via `TaxService.getWHT()`, 10%) was recorded only as a `SavingsHistory` entry with `transactionCategory: TAX` — there was **no remittance table**. Build Wealth introduced `taxcollections`, and the savings deduction points now write to it too (§8.2).

### 8.1 Collection: `taxcollections`

Schema: [`src/db/schema/tax-collection.schema.ts`](src/db/schema/tax-collection.schema.ts). One row per tax withheld.

| Field | Type | Notes |
| --- | --- | --- |
| `source` | `TaxCollectionSource` | `BUILD_WEALTH_WITHDRAWAL` \| `BUILD_WEALTH_LIQUIDATION` \| `SAVINGS_BURSE_FLEX_INTEREST` \| `SAVINGS_BURSE_VAULT_INTEREST`. Extend as other products remit here. |
| `taxType` | `TaxType` | `WHT` (only kind for now). |
| `user` | `ObjectId → User` | Who the tax was withheld from. |
| `wealthPlan` | `ObjectId → WealthPlan \| null` | Plan the tax came from (Build Wealth sources). |
| `sourceRef` | `String \| null` | Originating record id for non-wealth sources (e.g. the savings/eazilock id). |
| `taxableAmount` | `Number` | The interest paid out (the WHT base). |
| `rate` | `Number` | Rate applied (%), e.g. `10` (`WHT_RATE`). |
| `amount` | `Number` | The WHT amount withheld. |
| `reference` | `String` | **Unique.** The settlement reference — ties back to the product ledger and makes recording **idempotent**. Build Wealth: `…-WHT`. Savings: deterministic per month for the recurring jobs (`WHT-EMERGENCY-<id>-<month>`, `WHT-BURSEVAULT-<id>-<YYYY-MM>`), unique per event for claims/maturity. |
| `status` | `TaxCollectionStatus` | `COLLECTED` (default) → `REMITTED` (set by the remittance flow, §8.3). |
| `remittedAt` | `Date \| null` | Set on `REMITTED`. |

Indexes: `{ status, source, createdAt }` (remittance queue — oldest outstanding first), `{ user, createdAt }`. Repository: [`src/db/repository/tax-collection.repository.ts`](src/db/repository/tax-collection.repository.ts).

### 8.2 How it's written

- **Build Wealth exits** — inside `WealthPlanService.settleExit` (§7.3a), when `wht > 0` the WHT is written **both** as a `WHT` `DEBIT` plan-ledger entry **and** as a `taxcollections` row, in the **same Mongo transaction** as the wallet credit + plan writes (the repository auto-joins the ambient session), so the tax record can never drift from the money that moved.
- **Savings products** — the central [`TaxService.recordWHTCollection()`](src/services/impl/TaxService.ts) is called at each savings WHT deduction point (Burse Flex monthly interest + Burse Vault monthly payout in [`payMonthlyInterest.ts`](src/jobs/payMonthlyInterest.ts); Eazilock **claim** and **maturity** in [`default-eazilock.service.ts`](src/services/savings/implementation/default-eazilock.service.ts)). It's **best-effort and idempotent by `reference`** — a duplicate (e.g. a re-run of the monthly job) is swallowed, and a failure there never breaks the interest payout. (The existing `SavingsHistory` `TAX` entries are unchanged — `taxcollections` is the *remittance* record alongside them.)

The unique `reference` makes a retried write a no-op.

### 8.3 Remittance — admin endpoints

Two **admin-authenticated** ([`authenticateAdmin`](src/helpers/authenticateAdmin.ts)) operations over the queue. Service: [`tax-collection.service.ts`](src/services/tax-collection.service.ts) · Resolvers: [`tax-collection.api.ts`](src/api/tax-collection.api.ts) · TypeDefs: [`tax-collection.ts`](src/api/typeDefs/tax-collection.ts).

- **`GetTaxCollections(status, source, page, limit)`** ✅ (Query) — paginated rows (newest first) **plus an always-on outstanding summary** (`totalOutstanding`, `outstandingCount`, and a per-source breakdown) computed across all `COLLECTED` rows regardless of the list filter, so the team always sees what's owed.
- **`MarkTaxCollectionsRemitted(input)`** ✅ (Mutation) — flips outstanding (`COLLECTED`) rows to `REMITTED` with `remittedAt`. Input requires **one selector** — `ids`, `source`, or `reference` — so a remittance can never sweep the whole queue by accident. Returns `{ remittedCount, remittedAmount }`.

> **Outstanding WHT** = `taxcollections.find({ status: COLLECTED })` (or `GetTaxCollections`). Recommended follow-up: backfill historical savings WHT from existing `SavingsHistory` `TAX` entries.

---

## 9. Elite Circle

A Build Wealth plan funded in **`ELITE_CIRCLE`** mode (chosen at creation, §2) with a **monthly contribution ≥ ₦500,000** is part of the **Elite Circle**: its progress is visible to other elites so members keep each other moving (shared discipline). Members can cheer each other on.

- **Qualification:** `savingMode = ELITE_CIRCLE` **and** `monthlyContribution ≥ ₦500,000` (`ELITE_MIN_MONTHLY_CONTRIBUTION`). The dashboard/visibility scope counts **ACTIVE** such plans.
- **Membership gate:** all Elite endpoints require the caller to *be* an elite member (own at least one qualifying plan), else `ACTION_NOT_ALLOWED`.
- **"Elite since":** derived as the **earliest activation** among the member's qualifying plans — not tied to the plan being viewed.

Types: [`src/types/elite-circle.ts`](src/types/elite-circle.ts) · Service: [`src/services/elite-circle.service.ts`](src/services/elite-circle.service.ts) · Resolvers: [`src/api/elite-circle.api.ts`](src/api/elite-circle.api.ts) · TypeDefs: [`src/api/typeDefs/elite-circle.ts`](src/api/typeDefs/elite-circle.ts).

### 9.1 Streak & milestones (the data behind the circle)

- **`contributionStreak`** (plan field) — consecutive on-time contributions; `+1` per current-cycle contribution (incl. activation), **reset to 0** when a cycle is missed (`registerFailedAttempt`). This is the "streak" shown on every card.
- **`onTimeContributions`** (plan field) — lifetime on-time count (never reset); with the elapsed months it yields the **on-time %**.
- **`wealthmilestones`** collection ([schema](src/db/schema/wealth-milestone.schema.ts)) — notable moments, recorded **as contributions land** via the pure [`wealth-milestones.ts`](src/services/build-wealth/wealth-milestones.ts) detector (best-effort, deduped by a unique `(wealthPlan, key)` index, written **outside** the money transaction so a duplicate can never roll back a contribution). Types: `FIRST_CONTRIBUTION`; `PROGRESS` at 10/25/50/80/100%; `SAVINGS_AMOUNT` at ₦1M/2M/5M/10M/25M/50M/100M; `STREAK` at 3 then every 6 months.
- **`ANNIVERSARY`** milestones ("Year N · plan anniversary, rate renewed") are recorded by a daily job [`wealth-plan-anniversary-milestones.ts`](src/jobs/wealth-plan-anniversary-milestones.ts) (scheduled `EVERY_DAY_AT_2AM`). It's **calendar-based** off `activatedAt` — independent of the (still-pending) monthly-interest job — and idempotent via the same unique key (`ANNIVERSARY:<year>`). The "rate renewed" wording is forward-looking; actual interest/rate mechanics arrive with the compounding job.

### 9.2 `GetAllEliteCircleMembersWealthPlans` ✅ (Query)

The Elite Circle dashboard ([`elite_dashboard.png`]): aggregate metrics + the filterable list of elite plans. Elite members only. Data is a JSON object. One pass builds member names, this-month contributions, and this-month milestones (no N+1).

**Input:** `filter: EliteCircleFilter = ALL` — `ALL` (most recently active first), `MOST_PROGRESS`, `NEW_THIS_MONTH` (became elite this calendar month), `LONGEST_STREAK`.

```jsonc
{
  "totalContributionsFromElitesThisMonth": 68400000,   // Σ ACTIVATION+CONTRIBUTION credits this month
  "averageProgressOfElites": 47,                        // avg progress % across ACTIVE elite plans
  "totalEliteMembers": 12,                              // distinct members
  "totalElitePlans": 12,
  "filter": "ALL",
  "elitePlanList": [
    {
      "planId": "BW123456", "planTitle": "Freedom at 45",
      "memberId": "...", "memberName": "Olamide Oladehinde", "isYou": true,
      "monthlyContribution": 500000, "targetAmount": 15000000,
      "currentBalance": 1802481, "progress": 20, "streak": 47,
      "activatedAt": "2024-04-24T...",
      "recentMilestone": { "title": "Crossed 80% complete", "type": "PROGRESS", "achievedAt": "2026-06-15T..." }
    }
  ]
}
```

### 9.3 `GetEliteMemberPlan` ✅ (Query)

Deeper view of one member's elite plan ([`single_elite_plan.png`]). Elite members only.

**Input:** `planId: ID!`. **Response** (`data`):

```jsonc
{
  "planId": "BW123456", "planTitle": "Ikile Master's Fees",
  "memberId": "...", "memberName": "Ada N.", "isYou": false,
  "eliteSince": "2024-04-24T...",          // first became elite (not this plan)
  "status": "ACTIVE",
  "monthlyContribution": 500000, "targetAmount": 4000000,
  "totalContributed": 3200000, "currentBalance": 3200000, "totalInterestEarned": 0,
  "progress": 80, "streak": 47, "onTimePercentage": 100,
  "mostRecentMilestone": { "title": "Crossed 80% complete", "type": "PROGRESS", "value": 80, "achievedAt": "..." },
  "milestones": [ { "title": "Crossed 80% complete", "type": "PROGRESS", "value": 80, "achievedAt": "..." } ]
}
```

### 9.4 Cheers — `CheerEliteMember` / `RespondToCheer` ✅ (Mutations)

Stored in the **`elitecheers`** collection ([schema](src/db/schema/elite-cheer.schema.ts)): `{ fromUser, toUser, wealthPlan, message, emoji, responseEmoji, respondedAt, isRead }`.

- **`CheerEliteMember`** (`{ planId, message?, emoji }`) — cheer the member who owns `planId` ([`cheer_an_elite.png`]). Both parties must be elite; you can't cheer your own plan. **Message rules (circle = kind notes only):** optional, **≤ 60 chars**, and **no digits** (`VALIDATION_ERROR` otherwise); `emoji` required (the UI offers 👏 🔥 💪 🙌 ✨ 🚀, any single emoji accepted). Returns `{ cheerId, toMemberName, note, emoji }`.
- **`RespondToCheer`** (`{ cheerId, emoji }`) — the recipient replies with an emoji ([`respond_to_a_cheer.png`]); only the cheer's `toUser` may respond. Marks the cheer read. Returns `{ cheerId, responseEmoji }`.

> **Notifications.** Both actions fire a **best-effort in-app + push notification** (via `notificationFactory`/`pushNotificationFactory`): the recipient is notified of a new cheer; the original sender is notified when their cheer gets a reply. Delivery failures are swallowed — they never block the cheer/response.

### 9.5 `GetCircleInbox` ✅ (Query)

The member's received cheers ([`respond_to_a_cheer.png`]), newest first, + unread count. Elite members only.

**Input:** `filter: CircleInboxFilter = ALL` (`ALL` \| `UNREAD`).

```jsonc
{
  "unreadCount": 2, "filter": "ALL", "total": 12,
  "cheers": [
    {
      "cheerId": "...", "fromMemberId": "...", "fromMemberName": "Olamide Oladehinde",
      "message": "Crossing eighty percent is huge. Inspired", "emoji": "🔥",
      "responseEmoji": null, "isRead": false,
      "createdAt": "2026-06-19T...", "timeAgo": "2 minutes ago"
    }
  ]
}
```

### 9.6 Still planned (Elite Circle)

- **Loan-aware** elite figures once the portfolio-backed loan lands.
- **Monthly-interest compounding job** (the remaining large Build Wealth item) — credits monthly interest into the plan balance, feeds `totalInterestEarned` (which sharpens the exit WHT base and "interest earned" displays) and the true rate-renewal mechanics behind the anniversary milestone.

> Plan-anniversary milestones and cheer notifications are **now implemented** (§9.1, §9.4).

---

## Change Log

| Date | Change |
| --- | --- |
| 2026-06-19 | **WHT remittance follow-ups + Elite Circle polish.** (1) **Savings WHT → `taxcollections`:** added `TaxService.recordWHTCollection()` (idempotent by `reference`) and wired it into all four savings WHT deduction points (Burse Flex + Burse Vault monthly in `payMonthlyInterest.ts`; Eazilock claim + maturity in `default-eazilock.service.ts`); added `SAVINGS_*` sources + a generic `sourceRef`. (2) **Remittance admin:** new `TaxCollectionService` + admin-authenticated `GetTaxCollections` (rows + outstanding summary) and `MarkTaxCollectionsRemitted` (selector-guarded `COLLECTED→REMITTED`) — §8.3. (3) **Cheer notifications:** `CheerEliteMember`/`RespondToCheer` now fire best-effort in-app + push notifications. (4) **Anniversary milestones:** new `ANNIVERSARY` milestone type + a daily calendar-based job (`wealth-plan-anniversary-milestones.ts`, `EVERY_DAY_AT_2AM`), decoupled from the pending interest job. The monthly-interest compounding job remains the main outstanding Build Wealth item. |
| 2026-06-19 | **Elite Circle + WHT remittance.** (1) **WHT remittance:** split exit WHT into its own `WHT` ledger line and a dedicated **`taxcollections`** queue (`source`, `user`, `plan`, `taxableAmount`, `rate`, `amount`, unique `reference`, `status` COLLECTED→REMITTED) so the team can remit outstanding WHT (§8). `settleExit` now writes a three-entry set (PENALTY = forfeited+fee, WHT, WITHDRAWAL = net) atomically. Confirmed the rest of the app had **no** remittance table (savings WHT only narrated as `SavingsHistory` TAX entries). (2) **Streak & milestones:** added `contributionStreak` (resets to 0 on a miss) + lifetime `onTimeContributions` plan fields, and a **`wealthmilestones`** collection populated as contributions land via the pure, unit-tested `wealth-milestones.ts` (first contribution, 10/25/50/80/100% progress, ₦ landmarks, streak landmarks). (3) **Elite Circle module** (§9): membership = `ELITE_CIRCLE` + monthly ≥ ₦500k; new `EliteCircleService` + GraphQL — `GetAllEliteCircleMembersWealthPlans` (aggregates + ALL/MOST_PROGRESS/NEW_THIS_MONTH/LONGEST_STREAK filters), `GetEliteMemberPlan` (totals, on-time %, milestones, eliteSince), `CheerEliteMember` (≤60-char, no-digit note + emoji), `RespondToCheer`, `GetCircleInbox` (received cheers + unread). New `elitecheers` collection. Added `wealth-milestones.test.ts`. |
| 2026-06-11 | Initial doc. Added Wealth Goals (`wealthgoals` schema, seeder, `GetAllWealthGoals` query) and `WealthSavingMode` enum (TS + GraphQL). Documented planned Create Wealth Plan shape. |
| 2026-06-11 | Build Wealth redesign — data layer. Added `WealthPlanStatus` + ledger enums; `WealthPlan` model (`goalIds` is now a list; no simulation ref); dedicated `WealthPlanTransaction` ledger; admin-editable `BuildWealthSetting` (default 14.5% APY) with seeder + `getInterestRate()`; added `BUILD_WEALTH` to shared `interestType`. Documented monthly compounding (interest adds to plan balance vs Burse Vault paying to wallet). Endpoints still pending. |
| 2026-06-12 | Implemented `CreateWealthPlan` (draft + goal validation), `ActivateWealthPlan`, `TopUpWealthPlan`. Added `BANK_TRANSFER` to `WealthPlanFundingSource`; funding supports Card (Paystack `chargeAuthorization`), Wallet, and Bank Transfer (wallet-debit after virtual-account top-up). Added `WealthPlanService`, resolvers, GraphQL inputs/mutations; guarded the two money-moving mutations with email verification. |
| 2026-06-15 | Fixed `GetAllWealthGoals` omitting `id` (and `displayOrder`). Root cause was data, not code: DBs held legacy `wealthgoals` docs from an old schema (a `ratio` field, no `code`/`displayOrder`/`icon`), so `goal.code` was `undefined` and JSON serialization dropped the key. Rewrote the seeder to be self-healing — deletes legacy code-less docs and upserts the canonical catalogue by `code` on every app start. Re-seeding (or deploying) repairs affected environments. |
| 2026-06-15 | Made the wealth-goals seeder **admin-safe**: switched the upsert from `$set` to `$setOnInsert` so it inserts missing goals but never overwrites admin edits on existing ones (hard-deleted defaults are re-inserted; deactivate via `isActive:false` instead). |
| 2026-06-15 | Added wealth-plan **validation, simulation & healthy-contribution**. New reusable `wealth-plan-calculator.ts` (effective-monthly-rate annuity math; `evaluatePlan` → OK/TOO_SLOW/TOO_FAST/INVALID) and 2–20 yr + 15–40% constants. `CreateWealthPlan` now **derives & validates duration** from target + contribution (removed `durationYears` input; added `durationMonths` to the schema) and rejects unachievable pairs with guided messages. Added two authenticated queries: `SimulateWealthPlan` (duration preview / target-year adjustment → required contribution) and `GetHealthyContribution` (15–40% of income band). Added `formatNairaAbbrev` helper and a calculator jest test. |
| 2026-06-15 | **Auto-debit activation, Direct Debit, auto top-up & gift URL.** Activation now collects exactly `monthlyContribution` (removed the `amount` input) and grants an auto-debit authorization on the chosen source. `BANK_TRANSFER` reinterpreted as **Paystack Direct Debit** for Build Wealth (initialize/charge/verify mandate; webhook captures the `authorizationCode`). Added Paystack helpers (`initializeDirectDebit`, `initializeAuthorization`, `verifyAuthorization`) and routed Build Wealth events through `WealthPlanWebhookService` (credits the plan, idempotent). New mutations `ToggleWealthPlanAutoTopUp` and `VerifyWealthPlanCharge`; `TopUpWealthPlan` keeps an arbitrary amount and supports the new sources. Added a daily **auto top-up cron** with a 3-day retry window and missed-month arrears recovery (`wealth-plan-auto-topup.ts` + pure `wealth-plan-schedule.ts`, unit-tested). Plan schema gained `giftToken`/`giftUrl` (root from new `BUILD_WEALTH_GIFT_BASE_URL` env, default `useburse.com`), funding/authorization/schedule/retry fields, and an auto-top-up scan index. |
| 2026-06-16 | **Reliability hardening.** (1) All Build Wealth charges now send `metadata.purpose = build_wealth_*` (threaded through `chargeAuthorization`), so webhook routing is metadata-driven rather than channel-guessed. (2) Money applications are wrapped in Mongo transactions (`withTransaction`): WALLET debit + plan credit + ledger commit atomically (verified: a failed debit rolls back with zero partial writes); card/direct-debit local writes are wrapped too. (3) Added a 15-minute **reconciliation cron** (`wealth-plan-reconcile.ts`) that re-verifies outstanding `lastChargeReference`s against Paystack and applies them idempotently (using verified amount + purpose), so a lost webhook never loses a charge or causes a double-charge. Added `metadata` to `PaystackChargeAuthorizationInput`. |
| 2026-06-16 | **Read endpoints.** Added three authenticated, owner-scoped queries so a user can fetch plans after leaving the app: `PreviewWealthPlan` (rich draft view + projections), `GetWealthPlanDetails` (active plan = preview + live progress/`recentActivity`/`availableActions`/`currentState`/`shareableLink`; non-active → preview shape), and `GetAllWealthPlans` (`{ summary, plans }` — per-plan summaries + aggregate metrics: totals, active/matured counts, overall progress/APY). `goals` returned as a `{id,title,icon,description}` **array**; `savingMode`/`availableFundingSources` as `{id,name}` with `id` = the enum value `ActivateWealthPlan` accepts. Added `WEALTH_SAVING_MODE_NAMES` + `WEALTH_FUNDING_SOURCE_OPTIONS`; reused `futureValue` for projections. Withdrawal/liquidation action flags are placeholders pending those features. |
| 2026-06-17 | **Withdrawal & liquidation request / cancel / execute.** Added the money-moving flows behind the §6.9 window state: mutations `RequestWealthPlanWithdrawal` (`{ planId, amount, transactionPin }`), `CancelWealthPlanWithdrawal`, `RequestWealthPlanLiquidation` (`{ planId, transactionPin }`), `CancelWealthPlanLiquidation` — all returning the affected window object. Requests validate the **transaction PIN** (`transactionType: 'WITHDRAWAL'`) and are email-verification guarded; they enforce the one-per-year rule via `resolveRequestWindow` (must be `OPEN`), `0 < amount ≤ balance`, and mutual exclusion (no withdrawal while a liquidation is in motion, and vice versa). A request schedules `executeAt = +7d`; the new daily **execution cron** ([`wealth-plan-execute-requests.ts`](src/jobs/wealth-plan-execute-requests.ts)) settles due `IN_MOTION` requests atomically — withdrawal credits the wallet and decrements the balance; liquidation credits the whole balance, sets `status=CLOSED`/`autoTopUp=false`, writes a `WITHDRAWAL` ledger `DEBIT`, and marks the request `EXECUTED` (idempotent). `recordLedgerEntry` now takes a `transactionType` (CREDIT default); added two execution scan indexes. |
| 2026-06-17 | **Withdrawal & liquidation window state.** `GetWealthPlanDetails` now returns `withdrawal` and `liquidation` objects — each a `status` (`OPEN` \| `IN_MOTION` \| `CLOSED`) with mirror booleans, action gates (`canRequest`/`canCancel`), and a pre-formatted `title` + `message` (dates `D MMMM YYYY`, amounts `₦1,234.00`) matching the agreed UI copy; `availableActions` now rolls these up. Encoded the **one-request-per-year, per-kind** rule: a request is `IN_MOTION` for 7 days (`WEALTH_REQUEST_EXECUTION_DAYS`) before funds move, the user can cancel before then, and **cancelling still consumes the year's allowance** (window stays `CLOSED` until the anniversary of `requestedAt`). Added the embedded `withdrawalRequest`/`liquidationRequest` plan fields + `WealthPlanRequestStatus` enum, a `formatNaira` helper, and the pure, unit-tested `wealth-plan-windows.ts` (`resolveRequestWindow`). The request/cancel/execute flows that populate these are still pending — active plans report `OPEN` until then. |
| 2026-06-17 | **Details + list polish.** `GetWealthPlanDetails` now returns `onTrackBalance` (= `targetAmount − currentBalance`, floored at 0 — how much is left to hit the goal). `GetAllWealthPlans` gained a `status` filter (`WealthPlanStatus` enum; **defaults to `ACTIVE`**; `COMPLETED` = matured, `CLOSED` = liquidated) that filters the `plans` list and echoes back a `filter` field; the `summary` aggregates (incl. `totalBalance`) are now computed across **all** of the user's plans regardless of filter and are **null-safe (coalesce to 0)** so `totalBalance` is never null. Added `pendingPlans`/`liquidatedPlans` counts to the summary. Added a GraphQL `WealthPlanStatus` enum. |
| 2026-06-19 | **Build Wealth Exit FRD v1.1 — exit rules, charges & breakdown.** Implemented the early-exit/liquidation/withdrawal rules from `Build_Wealth_Exit_FRD_v1.1.docx`. (1) **2-year minimum gate**: no withdrawal/liquidation before `activatedAt + 2yr` — new `LOCKED` window state; both request mutations reject it. (2) **Anniversary-anchored plan year**: the once-a-year allowance now resets on the **plan anniversary** (not `requestedAt + 1yr`). (3) **Liquidation** is now only available inside a **30-day window** opening each anniversary (year 2+); outside it the window is `CLOSED`. (4) **30% withdrawal cap** enforced in `requestWithdrawal` + surfaced as `withdrawableAmount` in `GetWealthPlanDetails`. (5) **Exit charges** applied at execution via the new pure [`wealth-plan-exit.ts`](src/services/build-wealth/wealth-plan-exit.ts): forfeited interest (`gross × APY × 90/360`), 2.5% service fee, 10% WHT on the prorated interest paid out, net to wallet; settlement writes a `PENALTY` + `WITHDRAWAL` ledger pair. (6) **Cancellation rule change**: a cancelled **withdrawal** consumes the annual slot only if cancelled in the final 24h before execution; a cancelled **liquidation** never consumes it. (7) New read query **`GetWealthExitBreakdown`** for the §5.5/§5.6 amount-screen figures. Added exit constants + `IWealthExitBreakdown` types, rewrote `wealth-plan-windows.ts` + its tests, and added `wealth-plan-exit.test.ts` (verified against the FRD worked examples). **FRD reconciliation:** worked examples are authoritative over the §7.4 formulas (360-day forfeiture, fee on full gross); WHT is **deducted** from the payout (product decision). **Out of scope (dependencies):** the loan ("Enjoy Life") alternative + loan-aware cap, monthly compounding, and the FRD §7.6 notification cadence (see §6.11). |
| 2026-06-17 | **Activation/auto-save flow split.** `ActivateWealthPlan` no longer takes `debitDay` and no longer turns on auto save — it only collects the first contribution and captures the funding source's authorization (card token / direct-debit mandate). The recurring schedule is now set deliberately when enabling auto save. Renamed `ToggleWealthPlanAutoTopUp` → **`ToggleWealthPlanAutoSave`** (resolver, GraphQL mutation + `ToggleWealthPlanAutoSaveInput`, service `toggleAutoSave`, email-verification guard); when enabling, the user picks the funding source **and `debitDay` is now required** (validation error if missing). The persisted `autoTopUp`/`debitDay` plan fields and the cron are unchanged. |
