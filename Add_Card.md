# Add Card — Simplified Inline Flow (Vue + Backend)

## Goal

Replace the redirect-to-Paystack "Add Card" experience with an **inline** one: the
user enters card details on our own page, the card is tokenised by Paystack
directly from the frontend, and the backend only **verifies the reference and
saves the card**.

The saved card is **product-agnostic** — it lives in the per-user `cards`
collection and is reused by every savings product via
`paystack.chargeAuthorization(card.token)`. So this change touches **only the
add-card path**; no savings product (Build Wealth, Emergency Fund, EaziLock,
Investment, etc.) needs any change.

---

## 1. How it works today (for reference)

1. **`InitiateAddCard`** → `settings.initiateAddCard(userId)`
   - Generates a reference, calls `paystack.createPayment` with
     `amount: 100`, `channels: ['card']`,
     `metadata: { userId, purpose: 'add_card', reference }`.
   - Returns `{ paymentUrl, reference }`.
2. Frontend **redirects** the user to `paymentUrl` (Paystack-hosted page). User
   types the card details there and is charged ₦100.
3. On return, frontend calls **`VerifyAddCard(reference)`** →
   `settings.verifyAddCard` → `paystack.verifyPayment` → on success extracts
   `authorization` and calls `saveCardFromPaystackAuthorization`.
4. In parallel, the **`charge.success` webhook** (`verifyPaymentFromWebhook`)
   sees `metadata.purpose === 'add_card'`, saves the same card, and **skips
   wallet crediting**. Save is idempotent (keyed on user + bin + last4 +
   expiry), so whichever of webhook/verify lands first wins.

Relevant files:
- [src/api/mutations/Settings/initiate-add-card.ts](src/api/mutations/Settings/initiate-add-card.ts)
- [src/api/mutations/Settings/verify-add-card.ts](src/api/mutations/Settings/verify-add-card.ts)
- [src/services/classes/settings.ts](src/services/classes/settings.ts) (`initiateAddCard`, `verifyAddCard`)
- [src/services/classes/PaymentProcessors/paystack.ts](src/services/classes/PaymentProcessors/paystack.ts) (`createPayment`, `verifyPayment`, `verifyPaymentFromWebhook`)
- [src/helpers/save-card-from-paystack.ts](src/helpers/save-card-from-paystack.ts)
- [src/models/cards.ts](src/models/cards.ts)

The pieces we want to **keep** are exactly the valuable ones: `VerifyAddCard`,
the idempotent save helper, and the webhook. We only want to drop the redirect.

---

## 2. Important: "post the card directly to Paystack" — the PCI reality

The team's instinct (our own input boxes, POST card details straight to Paystack)
is right in spirit but has one hard constraint to be aware of:

- **Raw card data (PAN/CVV) in our own `<input>` fields + POST to
  `https://api.paystack.co/charge`** puts our frontend in **PCI-DSS SAQ-D**
  scope (we are handling cardholder data) and forces us to implement the
  **multi-step charge flow** ourselves — `submit_pin`, `submit_otp`,
  `submit_phone`, and 3-D Secure redirects. That is **more** code and more
  compliance risk, not less.

- **Recommended (PCI-safe, genuinely simpler): Paystack Inline JS**
  (`@paystack/inline-js`, formerly the "Popup"). Paystack renders the card
  fields in a **secure iframe embedded on our own page** (no full-page redirect,
  no new tab — it looks inline to the user). The card number never touches our
  code, so we stay in the low-burden PCI scope we already have, and Paystack
  handles OTP/PIN/3DS for us. On success it hands us back a **`reference`** — the
  exact thing our backend already knows how to verify.

So "input boxes on our frontend" is achieved with Inline JS: the user feels like
they're entering the card on our page, but the actual sensitive fields are
Paystack's secure iframe. **This is the approach the rest of this document
assumes.**

> If the business genuinely requires fully custom-rendered card inputs (our own
> HTML fields), that is the Charge API path and a separate, larger effort with a
> PCI assessment — out of scope here. Call this out before committing to it.

---

## 3. Two designs — a case for each

Both designs deliver the experience the team asked for (inline card entry on our
own page, no redirect, backend only verifies + saves). They differ on **who
initialises the Paystack transaction**: the backend (Variant A) or the frontend
(Variant B). Each has a real, defensible case — they are presented in full below
so the team can choose with eyes open. Section 3.3 summarises the trade-offs side
by side.

### Variant A — backend-initialised, inline-resumed

Keep `InitiateAddCard` so that **metadata (`userId`, `purpose: 'add_card'`) and
the charge amount stay server-controlled**, but use the `access_code` to drive an
inline popup instead of redirecting.

**The case for A:**
- **Smallest possible change.** Backend delta is a single additional field
  (`accessCode`) in one existing response; `verifyAddCard`, the webhook, and the
  save helper are untouched. Lowest risk, fastest to ship and review.
- **Security stays where it already is.** `userId`, `purpose`, and the charge
  amount are set by the server, so the webhook's two trust assumptions —
  "which user owns this card" and "skip wallet crediting for add-card" — remain
  valid without any hardening work.
- **Amount/business rules are server-owned.** If the tokenisation amount,
  channels, or fraud filters change later, it's a backend change the client
  can't drift from.
- **Honest cost:** one extra network round-trip (`InitiateAddCard`) before the
  popup opens, and the frontend depends on the backend being reachable to start
  add-card.

**Backend change (tiny, additive):** surface the already-computed `accessCode`
in the `InitiateAddCard` response.

```ts
// settings.initiateAddCard — payment already returns accessCode from createPayment
return ResultFn(true, 'Card authorization initialized', 'OK', {
    paymentUrl: payment.authorizationUrl, // keep — old clients still work
    accessCode: payment.accessCode,       // NEW — used by inline popup
    reference: payment.reference,
});
```

`createPayment` already returns `accessCode`
([paystack.ts](src/services/classes/PaymentProcessors/paystack.ts) lines ~82-86)
— we're just passing it through. **No GraphQL schema change** (the field rides
inside the generic `Result.data` JSON), so this is fully backward compatible.

**Frontend:** call `InitiateAddCard`, then `resumeTransaction(accessCode)`.

`VerifyAddCard`, the webhook, and the save helper are **unchanged**.

### Variant B — fully frontend-initialised (no `InitiateAddCard` call)

Frontend initialises the transaction itself with the **public key** via
`PaystackPop.newTransaction(...)`, setting `email`, `amount`, and
`metadata: { userId, purpose: 'add_card' }`. No `InitiateAddCard` round-trip — the
frontend goes straight to Paystack, and only the result (the `reference`) comes
back to us via `VerifyAddCard`.

**The case for B:**
- **This is literally what the team described** — "post directly to Paystack on
  the frontend … then send the reference to the backend." No backend init step at
  all; the flow reads exactly as the team pictured it.
- **One fewer round-trip and one fewer dependency.** Add-card can begin instantly
  on the client; it doesn't wait on (or fail because of) our backend being up to
  start the charge. The backend is only involved once there's a real reference to
  verify.
- **Thinner backend surface over time.** `InitiateAddCard` can eventually be
  retired entirely, leaving a single backend responsibility: verify a reference
  and save the card. Conceptually the simplest end-state.
- **Honest cost — the metadata is now client-set**, and that has teeth because:
  - the **webhook trusts `metadata.userId`** to decide *which user* gets the
    card, and trusts `metadata.purpose === 'add_card'` to **skip crediting the
    wallet**.
  - A tampered `userId` could save a card under another account via the webhook
    path; a missing/wrong `purpose` would make the webhook mistake the ₦100
    tokenisation charge for a **wallet top-up**.
  - **Mandatory hardening if we pick B:** in the webhook, ignore
    `metadata.userId` for add-card and resolve the owner only from the
    authenticated `VerifyAddCard` call (i.e. let the webhook handle *wallet-skip*
    routing but make the **authenticated mutation the sole authority on card
    ownership**), and only treat a charge as add-card/wallet-skipping when the
    amount matches the tokenisation amount. This is real, security-sensitive work
    on the most critical path (money-in), and must be tested carefully.

### 3.3 Side-by-side

| Dimension | Variant A (backend-init) | Variant B (frontend-init) |
| --- | --- | --- |
| Matches team's literal description | Close (adds an init call) | Exact |
| Backend change | 1 field added; webhook untouched | `InitiateAddCard` removable; **webhook must be hardened** |
| Security posture | Unchanged — metadata server-set | New trust on client metadata; needs mitigation |
| Round-trips before card form | 2 (init → popup) | 1 (popup) |
| Frontend independence | Needs backend to start | Starts without backend |
| Risk / review effort | Lowest | Higher (touches money-in path) |
| Best when… | We want the safest, smallest diff now | We want the leanest long-term flow and will invest in webhook hardening |

**Recommendation:** start with **Variant A** to ship safely and immediately, and
treat **Variant B** as the intended end-state once the webhook hardening
described under Variant B is implemented and tested. Both are non-breaking to existing clients (`paymentUrl`
keeps working throughout).

---

## 4. What the Vue frontend will do (Variant A)

### 4.1 Install / load Paystack Inline JS

```bash
npm i @paystack/inline-js
```

### 4.2 Add-card component flow

```ts
import PaystackPop from '@paystack/inline-js';

async function addCard() {
  // 1. Ask the backend to initialise the tokenisation charge.
  //    Returns { accessCode, reference, paymentUrl } inside Result.data.
  const { data } = await graphql(INITIATE_ADD_CARD_MUTATION);
  const { accessCode, reference } = data.InitiateAddCard.data;

  // 2. Open Paystack's secure inline card form on our own page.
  const popup = new PaystackPop();
  popup.resumeTransaction(accessCode, {
    onSuccess: async () => {
      // 3. Card was charged + tokenised. Hand the reference to the backend
      //    to verify and persist the card.
      const res = await graphql(VERIFY_ADD_CARD_MUTATION, { reference });
      // res.data.VerifyAddCard.data.card  -> the saved card
      // Handle data.status === 'PENDING' by retrying VerifyAddCard after a few
      // seconds (the webhook may still be finalising) — backend already returns
      // this signal.
    },
    onCancel: () => {/* user closed the form */},
    onError: (err) => {/* surface err.message */},
  });
}
```

Key frontend points:
- **No raw card fields in our code** — `resumeTransaction` renders Paystack's
  secure iframe. The user still perceives it as inline on our page.
- The **`reference` comes from `InitiateAddCard`** (server-generated). The
  frontend never invents it.
- On `onSuccess`, call the existing **`VerifyAddCard(reference)`** and respect
  the **`PENDING`** result by polling/retrying (the backend already documents and
  returns this).
- The card list is refreshed via the existing **`ListCards`** query.

### 4.3 GraphQL the frontend uses (all already exist)

```graphql
mutation InitiateAddCard { InitiateAddCard { success message data } }
mutation VerifyAddCard($reference: String!) {
  VerifyAddCard(reference: $reference) { success message data }
}
query ListCards { ListCards { success data } }
```

---

## 5. What we do in the backend

| Area | Change | Why |
| --- | --- | --- |
| `settings.initiateAddCard` | **Add `accessCode` to the returned `data`** | Lets the frontend drive the inline popup via `resumeTransaction`. `createPayment` already returns it. |
| `InitiateAddCard` GraphQL schema | **None** | The field travels inside the generic `Result.data` JSON; no SDL change, fully backward compatible. |
| `settings.verifyAddCard` | **None** | Already verifies the reference (confirms it exists + succeeded on Paystack) and saves the tokenised card idempotently. This *is* the "backend confirms the reference exists before saving" step the team asked for. |
| `charge.success` webhook | **None (Variant A)** | Metadata stays server-set, so add-card routing + wallet-skip stay correct. |
| `save-card-from-paystack.ts` | **None** | Idempotent upsert keyed on user + bin + last4 + expiry. |
| `AddCard` (legacy Flutterwave) | **None** | Already `@deprecated`. Leave for old clients; remove later. |

Net backend change for Variant A: **one additional field in one response object.**

### "Backend confirms the reference exists before saving"

This is exactly what `verifyAddCard` already does:
`paystack.verifyPayment({ reference })` → if `status !== 'success'` it refuses to
save (and returns `PENDING` when Paystack hasn't finalised yet); only on a
genuine success with an `authorization_code` does it persist the card. No new
"confirm reference" endpoint is needed.

---

## 6. Why this is non-breaking and reusable

- **Backward compatible:** `paymentUrl` is still returned, so any client not yet
  updated keeps working with the redirect. New clients use `accessCode`. No
  schema/contract break.
- **Product-agnostic by construction:** cards are stored per-user in the `cards`
  collection (no product reference). Every savings product already charges the
  default/saved card through `chargeAuthorization(card.token)`. Because we only
  change *how the card gets tokenised and saved*, **the same single Add-Card flow
  serves all savings products** with zero product-side edits.
- **Idempotency preserved:** webhook + `VerifyAddCard` still race safely; the
  upsert dedupes.

---

## 7. Edge cases & checklist

- [ ] Handle `VerifyAddCard` returning `data.status === 'PENDING'` on the
      frontend (retry after a few seconds; the webhook will also save it).
- [ ] Keep `bvnVerified` gate — both `InitiateAddCard` and `VerifyAddCard`
      already enforce it.
- [ ] Confirm the Paystack **public key** used by Inline JS matches the
      **secret key** environment the backend verifies against
      (`RI_PAYSTACK_SECRET_LIVE`) — they must be the same Paystack
      account/environment or `verifyPayment` won't find the reference.
- [ ] ₦100 tokenisation charge (`ADD_CARD_CHARGE_AMOUNT`) unchanged; confirm it's
      acceptable to keep charging it (consider refund/auto-reversal policy if not).
- [ ] If/when we drop the legacy hosted-redirect entirely, also retire the
      deprecated `AddCard` (Flutterwave) mutation.

---

## 8. Migration order (safe rollout)

1. Ship the backend one-liner (`accessCode` in `InitiateAddCard.data`). Harmless
   to existing clients.
2. Update the Vue app to use Inline JS `resumeTransaction(accessCode)` and call
   the unchanged `VerifyAddCard`.
3. Verify end-to-end (real ₦100 card charge → card appears in `ListCards`,
   chargeable by a savings product).
4. Later: remove the old redirect UI and the deprecated `AddCard` path.
