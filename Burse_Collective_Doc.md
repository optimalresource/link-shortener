# Burse Collective — Backend Documentation

Living record of the Burse Collective module: what has been built, the decisions
behind it, and the running change log. Update this file on **every** Burse Collective
change (mirrors how `Wealth_Plan_documentation.md` tracks Build Wealth).

Branch: `feature/burse-collective`

---

## 1. Product overview

Burse Collective is the third product in the Burse savings suite (after Burse Vault
and Build Wealth). It lets a group **pool monthly contributions** toward a shared
goal; the pot earns interest and the group decides together how and when to withdraw.

Core principles (from the FRD):

- **No single member moves money alone.** Once contributed, money only leaves via
  admin/group decisions.
- **Set at creation, locked for life.** Three choices can never change: withdrawal
  style (open vs locked), contribution style (fixed vs flexible), and the locked goal
  date.
- **Inflow confirms membership.** An invitee is *not* a member until their first
  contribution lands. Until then they are a pending invitee.

### Roles

| Role   | Powers |
|--------|--------|
| ADMIN  | Reminders, approvals, withdrawal proposals. Always also a member. The **creator** is always an admin and is the only one who can change admin roles. |
| MEMBER | Contributes, votes on lump withdrawals. |
| VIEWER | Read-only; cannot vote. Can be promoted to member. |

### Interest

Interest is drawn from the shared, admin-editable **interest-rate catalogue**
(the same mechanism Burse Vault and Build Wealth use), keyed by the collective's
**withdrawal style** — a **flat** rate each:

- **OPEN** → **13% / yr**. The group can withdraw any time it agrees.
- **LOCKED** → **13.5% / yr**, fixed at creation for the life of the collective.

The rate is resolved from the catalogue at creation and **snapshotted** onto the
collective (`interestRate`). LOCKED stays fixed for life; OPEN is the prevailing rate
at creation (a later stage may refresh OPEN live). Both rates are admin-editable via
the catalogue. WHT of **10%** applies to interest at payout time (later stage).

---

## 2. Build stages

The full spec has 16 endpoint groups. We are building in stages.

- **Stage 1 (DONE):** Admin creation + invitations.
  - `CreateBurseCollective` — POST /collectives (create draft)
  - `GetBurseCollectiveById` — GET /collectives/{id}
  - `SendBurseCollectiveInvitations` — POST /collectives/{id}/invitations
  - `ListBurseCollectivePendingInvitations` — GET /collectives/{id}/pending-invites
- **Stage 2 (DONE):** Initial contribution, activation & funding sources.
  - `AddInitialContributionToBurseCollective` — POST /collectives/{id}/initial-contribution
  - `ActivateBurseCollective` — POST /collectives/{id}/activate
  - `ListBurseCollectiveFundingSources` — GET /funding-sources
  - `UpdateBurseCollectiveFundingSourcePreferences` — PUT /funding-sources/preferences
- **Later stages (not yet built):** projection, dashboard, plan details, members,
  pause, top-up/auto-save, withdrawals (share / lump-sum / split-pot), monthly
  reports, maturity, extension.

---

## 3. Stage 1 — endpoints (GraphQL)

The service is GraphQL (not REST); the REST paths in the spec map to these
operations. All return the standard `Result!` envelope with the payload in `data`.

### 3.1 `CreateBurseCollective` (Mutation)

Creates a **DRAFT** collective. No money moves; the creator is auto-assigned admin.

Input (`CreateBurseCollectiveInput`):

| Field                   | Type     | Rules |
|-------------------------|----------|-------|
| `name`                  | String!  | Required. Max 60 chars. |
| `withdrawalType`        | enum!    | `OPEN` \| `LOCKED`. Required. |
| `contributionMode`      | enum!    | `FIXED` \| `FLEXIBLE`. Required. **Must be `FIXED` when `withdrawalType` is `LOCKED`.** |
| `contributionFrequency` | enum     | `ONE_TIME` \| `MONTHLY`. Defaults `MONTHLY`. |
| `contributionDay`       | Int!     | One of `1, 15, 25, 28`. |
| `standardAmount`        | Float    | Required for `FIXED` (so **required for `LOCKED`**). Min ₦1,000. |
| `minAmount`             | Float    | `FLEXIBLE` only, optional. Min ₦1,000. |
| `maxAmount`             | Float    | `FLEXIBLE` only, optional. Must be ≥ `minAmount`. |
| `suggestedAmount`       | Float    | `FLEXIBLE` only, optional. Must sit within bounds. |
| `lockedTermMonths`      | Int      | Required for `LOCKED`. 3–24 months. Rejected for `OPEN`. |

> **LOCKED rule (updated).** A LOCKED collective **must** use a **FIXED** contribution
> — the creator states a fixed monthly amount every member contributes (`standardAmount`)
> **and** a duration in months (`lockedTermMonths`). A flexible / each-as-they-can style
> is only valid for OPEN collectives.

Returns `data`: `{ collectiveId, status, interestRate, message }`
(`collectiveId` is the public reference, e.g. `BC123456`).

### 3.2 `GetBurseCollectiveById` (Query)

Returns a single collective by its public reference **or** Mongo id.
**Creator-scoped** for now (drafts are private to the creator; member/admin
visibility widens in a later stage).

Returns `data`: the collective configuration + balances + `pendingInvitesCount`.

### 3.3 `SendBurseCollectiveInvitations` (Mutation)

Invites people by **email OR phone**, each with an optional display name, role
(`ADMIN`/`MEMBER`/`VIEWER`, default `MEMBER`) and note (max 280 chars). Creator-scoped.

Behaviour:

- Requires at least one contact (email or phone) per entry; validates email shape.
- **Skips** contacts already invited (outstanding invitation) and duplicates within
  the same request — returned under `skipped` with a reason (nothing throws).
- Enforces the **60-member hard cap** (creator + outstanding invites); returns a
  **soft warning** once the roster passes 50.
- Matches each contact to an existing Burse user (by email/phone) so the invite can
  deep-link in-app (`isExistingUser`).
- Creates invitations in **`QUEUED`** status while the collective is a draft. Actual
  dispatch (push / SMS / email) is wired in the activation stage — per the FRD,
  invitations are dispatched when the collective is launched.

Returns `data`: `{ invitedCount, skippedCount, totalPending, invitations[], skipped[], warning, message }`.

### 3.4 `ListBurseCollectivePendingInvitations` (Query)

Lists still-open invitations (`QUEUED` / `SENT` / `OPENED`) for a collective, most
recent first. Creator-scoped. Returns `data`: `{ collectiveId, total, invitations[] }`.

---

## 3A. Stage 2 — endpoints (GraphQL)

Initial contribution, activation & funding sources. Money-moving mutations
(`AddInitialContributionToBurseCollective`, `ActivateBurseCollective`) are guarded by
**email verification** (added to `EMAIL_VERIFIED_MUTATIONS` in `api/index.ts`), like
the Build Wealth funding mutations.

### 3A.1 `AddInitialContributionToBurseCollective` (Mutation)

The **creator's first contribution**, which funds and activates the collective (§3 of
the spec: "the first contribution by the creator activates the collective"). Creator-
scoped; the collective must still be `DRAFT`.

Input (`AddInitialContributionInput`): `{ collectiveId, amount?, fundingSource, cardId? }`.

- `fundingSource` = `WALLET` | `CARD` | `BANK_TRANSFER`.
- `amount` optional — defaults to the collective's `standardAmount` (FIXED) or
  `suggestedAmount`/`minAmount` (FLEXIBLE). For FIXED it must equal `standardAmount`;
  for FLEXIBLE it must sit within any min/max bounds.
- A saved **card** / bank **mandate** is expected to already exist (the caller uses the
  existing add-card / direct-debit-add flows first); `cardId` is required for `CARD`.

Behaviour by funding source:

| Source | Flow |
|--------|------|
| `WALLET` | Atomic wallet debit **+** activation in one Mongo transaction (settles immediately). |
| `CARD` | Charges the saved card's authorization via Paystack, then activates. |
| `BANK_TRANSFER` | Paystack **Direct Debit**: returns `data.paymentUrl` + `reference`; the collective stays `DRAFT` until the payment is confirmed (webhook / `ActivateBurseCollective`). |

On success: creates the creator's **ADMIN**, `ACTIVE` membership (`joinedAt`), writes an
`INITIAL_CONTRIBUTION` ledger entry, and flips the collective to **ACTIVE** — setting
`activatedAt`, the LOCKED **`goalDate`** (`activatedAt + lockedTermMonths`),
`nextInterestDate` (+1 month), and `nextContributionDate` (the configured contribution
day). Idempotent via the unique ledger `reference`.

Returns `data`: `{ collectiveId, status, balance, activatedAt, goalDate, paymentUrl, reference, message }`.

### 3A.2 `ActivateBurseCollective` (Mutation)

Verifies an **asynchronous** initial-contribution payment (the `BANK_TRANSFER` path) by
its Paystack `reference` and, on success, applies the contribution and activates the
collective (same writes as above, idempotent). `WALLET`/`CARD` settle inline and never
need this. A collective that is already active just returns its state.

> Per the FRD, activation is really a side-effect of a successful first contribution, so
> this endpoint exists **only** to finalise the async (bank-transfer) case — matching the
> original note that a standalone activate step may not be needed for wallet/card.

Input (`ActivateBurseCollectiveInput`): `{ collectiveId, reference }`. Returns the
collective state.

### 3A.3 `ListBurseCollectiveFundingSources` (Query — **global**)

Lists the funding sources available to the user for collective contributions. Not scoped
to a collective (the spec's `/funding-sources` endpoints carry no id, so this is a
user-wide view). Returns `data`:
`{ channels: [{id,name}], wallet: { balance }, cards: [{id,lastFourDigits,issuer,type,isDefault}], preferences: { primary, fallback1, fallback2 } }`.

### 3A.4 `UpdateBurseCollectiveFundingSourcePreferences` (Mutation — **global**)

Sets the user's **global** funding preference: an ordered `primary` plus up to two
fallbacks (`fallback1`, `fallback2`), tried in sequence on a recurring charge before
failure is raised (§4 business logic; the 3-day retry window is `FUNDING_RETRY_WINDOW_DAYS`
and is enforced by the recurring-charge job in a later stage). Rejects duplicates and
unknown sources; upserts one record per user. Returns `data`: `{ preferences, message }`.

> **Funding-sources interpretation (flagged).** The spec's §4 endpoints were ambiguous.
> Implemented as **user-global** preferences (no collective id in the paths) over the
> existing funding rails (wallet / saved cards / bank mandate). The list currently
> surfaces channels + wallet balance + saved cards + the saved preference. If the intent
> is per-collective preferences or a richer source inventory (e.g. enumerated bank
> mandates), this is easy to adjust — happy to refine once details are confirmed.

---

## 4. Data model

Two new collections (Mongoose), following the existing `db/{schema,model,repository}`
layering used by Build Wealth.

### `BurseCollective` (`burse-collective.schema.ts`)

`creator`, `collectiveReference` (unique, `BC######`), `name`, `withdrawalType`,
`contributionMode`, `contributionFrequency`, `contributionDay`, `standardAmount`,
`minAmount`, `maxAmount`, `suggestedAmount`, `lockedTermMonths`, `goalDate`
(computed at activation), `interestType` (OPEN/LOCKED), `interestRate` (snapshot),
`status` (DRAFT→PENDING→ACTIVE→MATURED/DISSOLVED), balance fields, `activatedAt`,
`nextInterestDate`, `nextContributionDate`, `virtualAccountNumber`, timestamps.

Index: `{ creator, status }`.

### `BurseCollectiveInvitation` (`burse-collective-invitation.schema.ts`)

`collective`, `invitedBy`, `channel` (EMAIL/PHONE), `email`, `phoneNumber`,
`displayName`, `role`, `note`, `status`, `token` (unique, unguessable), `inviteUrl`,
`invitedUser` (matched existing user), `expiresAt` (30 days), `sentAt`,
`respondedAt`, timestamps.

Indexes: `{ collective, status }`, `{ collective, email }`, `{ collective, phoneNumber }`.

### `BurseCollectiveMember` (`burse-collective-member.schema.ts`) — *Stage 2*

Created when a person's first contribution lands (§3.3). `collective`, `user`, `role`
(the creator is `ADMIN`), `status` (INVITED/ACTIVE/PAUSED/EXITED), `joinedAt`,
`totalContributed`, `autoSave`, timestamps. Unique index `{ collective, user }`.

### `BurseCollectiveTransaction` (`burse-collective-transaction.schema.ts`) — *Stage 2*

Auditable ledger. `collective`, `member`, `user`, `transactionType` (CREDIT/DEBIT),
`category` (INITIAL_CONTRIBUTION/CONTRIBUTION/TOPUP/INTEREST/WITHDRAWAL),
`fundingSource`, `amount`, `balance` (running collective balance), `status`,
`narration`, `reference`, `cycle` (YYYY-MM), timestamps. Indexes `{ collective, createdAt }`,
`{ user, createdAt }`, and a **unique sparse `{ reference }`** for idempotency.

### `BurseCollectiveFundingPreference` (`burse-collective-funding-preference.schema.ts`) — *Stage 2*

One per user (global). `user` (unique), `primary`, `fallback1`, `fallback2`
(each a `BurseCollectiveFundingSource`), timestamps.

---

## 5. Files touched

**New (Stage 1)**
- `src/types/burse-collective.ts` — enums, interfaces, constants, helpers.
- `src/db/model/burse-collective.entity.ts` + `...-invitation.entity.ts`
- `src/db/schema/burse-collective.schema.ts` + `...-invitation.schema.ts`
- `src/db/repository/burse-collective.repository.ts` + `...-invitation.repository.ts`
- `src/services/burse-collective.service.ts`
- `src/api/typeDefs/burse-collective.ts`
- `src/api/burse-collective.api.ts`
- `Burse_Collective_Doc.md` (this file)

**New (Stage 2)**
- `src/db/model/` + `src/db/schema/` + `src/db/repository/` for
  `burse-collective-member`, `burse-collective-transaction`,
  `burse-collective-funding-preference`.

**Modified**
- `src/types/interest-rate.ts` — added `BURSE_COLLECTIVE` product + `OPEN`/`LOCKED`
  interest types *(Stage 1)*.
- `src/scripts/seeds/seed-interest-rates.ts` — seed OPEN + LOCKED collective rates
  (idempotent; runs on app start) *(Stage 1)*.
- `src/helpers/config.ts` — `BURSE_COLLECTIVE_INVITE_BASE_URL` (invite deep-link base)
  *(Stage 1)*.
- `src/api/index.ts` — registered typeDefs + resolvers *(Stage 1)*; added the two
  money-moving mutations to `EMAIL_VERIFIED_MUTATIONS` *(Stage 2)*.
- `src/types/burse-collective.ts`, `.../burse-collective.schema.ts`,
  `src/services/burse-collective.service.ts`, `src/api/typeDefs/burse-collective.ts`,
  `src/api/burse-collective.api.ts` — extended for Stage 2 (funding source / member /
  transaction / preference types, `nextContributionDate`, the LOCKED→FIXED rule, the
  four new endpoints).

---

## 6. Notes, assumptions & open questions

- **Locked term range:** the backend spec caps a locked term at **3–24 months**; the
  design's term picker offers 6/12/18/24. We accept any whole month in 3–24 so the
  picker can evolve without a backend change. (Flag if 6/12/18/24 must be enforced
  strictly.)
- **`collectiveId`** is the public `collectiveReference` (like `planId` for Build
  Wealth). Lookups also accept the Mongo id for convenience.
- **Visibility:** Stage 1 restricts reads/invites to the **creator**. Once
  memberships exist (later stage), admins/members will be authorised too.
- **Invitation dispatch** (push/SMS/email) and **membership creation on first
  contribution** are deferred to the contribution/activation stage; invitations are
  persisted as `QUEUED` now.
- **Interest rates are flat**: OPEN 13%, LOCKED 13.5% (confirmed with product).
  - ⚠️ The FRD (§6.2 active-summary pill) illustrates **LOCKED · 12.5%**; the doc/product-confirmed value is **13.5%**. Flag before the projection/dashboard stage so the displayed rate is right.

### Funding model (Stage 2 — implemented)

The three pay-from sources map to existing plumbing as follows:

- **Burse Wallet** — instant, no fee → `debitUsersWallet` (the wallet service, as Build Wealth uses). Atomic debit + activation in one Mongo transaction.
- **Card** — the **product-agnostic saved-card layer** (`chargeAuthorization(card.token)`), shared across all products (see `Wealth_Plan_documentation.md` §7.1a). *TODO (FRD §10.4): enforce that the cardholder name matches the user's verified Burse account name — not yet added.*
- **Bank Transfer** — **Paystack Direct Debit** against a connected bank account (`initializeDirectDebit` → authorise URL → confirm), mirroring Build Wealth's `BANK_TRANSFER`. Per the Stage 2 clarification ("charge an existing … bank account … else they use our direct-debit add flow"), the funding source is a **direct-debit charge**, and the user is expected to already have a saved card / bank mandate before selecting it.

> **Decision (supersedes the earlier Stage 1 note).** An earlier planning note assumed
> Burse Collective "Bank Transfer" would be a **virtual-account deposit** (name-matched
> allocation, FRD §6.4/§6.5) rather than a direct-debit charge. The Stage 2 instruction
> reframed it as **direct debit**, so that is what's implemented. The FRD's
> virtual-account-deposit + name-match allocation flow is a **separate, still-unbuilt
> capability** (for external/manual transfers into a collective) and can be added later
> without changing the direct-debit funding path. ⚠️ Confirm this is the intended model.

**Activation/launch:** the creator pays their **first contribution** (any source) → on
success the creator's ADMIN membership is created, the contribution is ledgered, and the
collective flips to **`ACTIVE`**. Per the Stage 2 instruction ("the first contribution by
the creator activates the collective") we go straight to `ACTIVE` — **not** the FRD
§5.5–5.6 `PENDING`-until-second-member model. On failure nothing is activated.

> **Still deferred (not in Stage 2):** dispatching the queued invitations on activation
> (push/SMS/email), creating a dedicated **Providus virtual account** per collective, and
> the FRD's `PENDING`→`ACTIVE` two-member gate. Flag if the `PENDING` step is required.

---

## 7. Change log

- **2026-07-06** — **Stage 2** implemented: initial contribution, activation & funding
  sources. New endpoints `AddInitialContributionToBurseCollective` (wallet / card /
  bank-transfer charge → creator ADMIN membership + `INITIAL_CONTRIBUTION` ledger entry →
  collective `ACTIVE`, with `goalDate`/`nextContributionDate` set), `ActivateBurseCollective`
  (verify async bank-transfer payment → activate, idempotent), `ListBurseCollectiveFundingSources`
  (channels + wallet balance + saved cards + saved preference), and
  `UpdateBurseCollectiveFundingSourcePreferences` (global primary + 2 fallbacks). New
  collections: `BurseCollectiveMember`, `BurseCollectiveTransaction`,
  `BurseCollectiveFundingPreference`. **Creation rule updated:** a LOCKED collective now
  requires a **FIXED** contribution (fixed monthly amount + duration). Money-moving
  mutations added to the email-verification guard. Decisions flagged: BANK_TRANSFER =
  direct debit (not virtual-account deposit); creator's first contribution → `ACTIVE`
  (not `PENDING`); funding preferences are user-global. Type check clean.
- **2026-07-01** — Stage 1 implemented: `CreateBurseCollective`,
  `GetBurseCollectiveById`, `SendBurseCollectiveInvitations`,
  `ListBurseCollectivePendingInvitations`. Interest-rate catalogue extended with the
  `BURSE_COLLECTIVE` product and seeded. Rates are flat: OPEN 13%, LOCKED 13.5%
  (confirmed with product). Type check clean.

---

## Auto Save (central engine) — per member, per collective

Each member sets up their own recurring funding for a collective they belong to (not an
admin/global setting) via the **central Auto Save engine** (shared with Burse Vault and
Build Wealth). See "Central Auto Save" in `Burse_Vault_Documentation.md` for the endpoints.

- Configure via `ConfigureAutoSave(productType: BURSE_COLLECTIVE, resourceId: <collectiveId | collectiveReference>, ...)`
  with a **primary + fallback** funding sources; change the primary with `SetPrimaryFundingSource`.
- The recurring charge amount is the collective's contribution amount for the member
  (FIXED → `standardAmount`; FLEXIBLE → the member's chosen/suggested amount). Settlement
  credits the collective balance + the member's `totalContributed` and writes a
  `CONTRIBUTION` ledger entry (idempotent per reference).
- The legacy user-wide `UpdateBurseCollectiveFundingSourcePreferences` endpoint remains for
  back-compat, but funding is now **per-collective**; new screens should use the central
  endpoints. Members set Auto Save up per collective via the central endpoint (no backfill —
  the old preference was channel-only and never drove a live charge).
