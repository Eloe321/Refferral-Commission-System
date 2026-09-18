# Domain lifecycle and recovery ledger

This document explains how a referral becomes an earning, how an earning becomes a claim, and how refunds remain explainable after payout. It is both a state reference and the rationale for the accounting model.

For setup and the guided walkthrough, start with the [README](../../README.md). Notification behavior is documented separately in [Notification delivery](notification-delivery.md).

## Authority and tenant boundary

The NestJS API owns every domain decision. The Next.js client may display an estimated selected total, but the API recalculates the claim payout inside the same transaction that locks and reserves the earnings.

Every tenant-owned record includes `organization_id`. Composite foreign keys connect records through both organization and record ID. Queries also scope by the signed actor's organization. This prevents a valid ID from another organization from becoming a cross-tenant reference.

Money is stored as integer minor units in PostgreSQL `bigint` columns. Shared contracts serialize it as a decimal string plus a three-letter currency code. Authoritative code uses JavaScript `bigint`, never floating-point `number` arithmetic.

## Records and relationships

```text
organization
  ├─ users ── partners ── referral_codes
  ├─ programs ── commission_rules
  ├─ conversions ── conversion_items ── earnings ── earning_holds
  ├─ otp_challenges ── claims ── claim_items
  ├─ ledger_entries
  ├─ notification_outbox
  ├─ audit_events
  ├─ idempotency_records
  └─ demo_scenario_runs
```

- A conversion represents the referred business event.
- A conversion item is an independently refundable and compensable line.
- An earning contains the selected rule snapshot and commission amount for one item.
- A claim item links one reserved earning to the amount that will actually be paid after recovery.
- Ledger entries are signed events. Positive values add partner value; payout and reversal entries are negative.
- Audit events are immutable operational explanations with actor or system provenance.

## Rule selection

Only active and currently effective rules for the conversion's program are candidates. The first populated specificity bucket wins:

1. partner plus category;
2. partner-wide, with no category;
3. program category, with no partner;
4. program default, with no partner or category.

Within one bucket, the most recent `effective_from` wins. Equal dates use a stable rule ID ordering. If no rule matches, the earning is created as `needs_rule` with zero value instead of silently inventing a commission.

Flat rules return their configured minor-unit amount. Percentage rules store 1 to 10,000 basis points and calculate:

```text
commission = (baseMinor × basisPoints + 5000) ÷ 10000
```

The integer division gives half-up rounding to the nearest minor unit. A successful calculation snapshots the rule ID, rule kind, amount or basis points, program, partner, category, effective dates, calculation base, and result. Later rule changes do not rewrite that snapshot.

## Conversion state

| From                               | Allowed next state                  | Business meaning                                         |
| ---------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `attributed`                       | `scheduled`                         | A referral exists but is not yet scheduled.              |
| `scheduled`                        | `completed`, `cancelled`, `no_show` | The business decides the service outcome.                |
| `completed`                        | `partially_refunded`, `refunded`    | Refunds can begin only after completion.                 |
| `partially_refunded`               | `partially_refunded`, `refunded`    | Later cumulative refunds may increase the returned base. |
| `cancelled`, `no_show`, `refunded` | none                                | These are terminal for this demo.                        |

Normal conversion creation resolves an active referral code and creates the conversion as `scheduled`. Program pause or partner suspension blocks new conversion creation. Completing a scheduled conversion changes its pending earnings to eligible. Cancellation and no-show void every unpaid earning for that conversion and fail any active reservation that uses it.

## Earning state

| From                 | Allowed next state                                 | Typical cause                                                    |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| `needs_rule`         | `pending`, `voided`                                | A rule is assigned later, or the source becomes invalid.         |
| `pending`            | `eligible`, `held`, `voided`                       | Service completes, owner holds it, or source is cancelled.       |
| `eligible`           | `reserved`, `held`, `voided`                       | Partner starts a claim, owner holds it, or owner invalidates it. |
| `held`               | `pending`, `eligible`, `voided`                    | Owner releases based on conversion state, or voids it.           |
| `reserved`           | `pending`, `eligible`, `settled`, `held`, `voided` | Claim succeeds, fails, or an owner action invalidates it.        |
| `settled`            | `reversed`                                         | A refund creates a recovery after payout.                        |
| `voided`, `reversed` | none                                               | Terminal in the sandbox.                                         |

A hold stores its reason, placing actor, original status, and placed timestamp. Release closes the hold with its actor and timestamp, then derives the target state from the conversion:

- attributed or scheduled conversion: `pending`;
- completed or refunded conversion: `eligible`;
- cancelled or no-show conversion: `voided`.

This prevents a release from making an unfinished or cancelled service claimable.

## OTP challenge state

```text
pending ── correct code ──> verified ── claim created ──> used
   │
   ├─ five failed attempts ──> blocked
   └─ five-minute deadline ──> expired
```

The challenge is bound to organization, actor, partner, selection, server-calculated payout total, and currency through a claim-draft hash. The six-digit code is generated with `crypto.randomInt`; only `HMAC-SHA-256(challengeId:code)` is stored. Comparison is constant-time. Every issuance has a five-minute lifetime and a 60-second resend or re-issuance cooldown.

A new partner-wide challenge supersedes older pending challenges and terminalizes their queued delivery rows. A verified challenge cannot authorize a different selection. Claim creation rechecks expiry after row-lock waits and consumes the challenge in the same transaction as the claim reservation.

## Claim state

```text
created ──> processing ──> settled
                    └────> failed
failed ── owner retry ──> created
```

Partner-only claim creation requires:

- an active partner whose signed actor matches the partner user;
- a verified, unexpired challenge bound to the same actor, partner, and server draft;
- unique selected earnings owned by that partner;
- `eligible` status, no active hold, one currency, and exact row counts;
- a valid idempotency key.

Claim creation locks the selected earnings, allocates recovery, inserts the claim and items, changes earnings to `reserved`, changes the challenge to `used`, writes audit history, and queues a notification in one transaction.

The sandbox owner can simulate settlement or failure. Settlement validates every reservation, changes the claim through `processing` to `settled`, changes earnings to `settled`, and appends accrual and payout entries. Failure returns the reserved earnings to `eligible`, leaves the failed claim in history, and does not append a payout debit. Owner retry validates the failed claim and current earnings, reserves them again, and uses a new idempotency key.

## Refund semantics

Refund input is cumulative per conversion item. `refundedBaseMinor=3000` means the total refunded base for that item is now 3,000 minor units, not “add another 3,000.” The new cumulative value cannot decrease and cannot exceed the original gross amount.

For unpaid earnings, a refund voids the earning after failing any affected active claim reservation. It does not create a recovery ledger entry because nothing was paid.

For settled earnings, the API:

1. recalculates commission on the cumulative refunded base from the immutable rule snapshot;
2. caps the desired reversal at the original earning amount;
3. subtracts the amount already reversed;
4. appends only the new negative `reversal` delta;
5. records the cumulative reversed amount and marks the earning `reversed`.

The original accrual and payout entries remain unchanged.

## Recovery ledger semantics

A post-payout reversal creates a negative partner ledger balance. The sandbox never initiates a real debit. Future eligible earnings first absorb that recovery before any payout becomes available.

For one currency:

```text
ledgerBalance = sum(all signed ledger entries)
reservedRecovery = sum(openClaimItem.earningAmount - openClaimItem.payoutAmount)
projectedBalance = ledgerBalance + reservedRecovery
remainingDebt = max(0, -projectedBalance)
```

`reservedRecovery` matters because a `created` or `processing` claim may already have assigned some debt to its selected earnings. Adding it to the projected balance prevents the same debt from reducing another claim a second time.

The claim service sorts selected earnings by stable ID. For each earning:

```text
recovery = min(earningAmount, remainingDebt)
payout = earningAmount - recovery
remainingDebt = remainingDebt - recovery
```

Example: a refund leaves a `-2500` ledger balance. A new eligible earning is `4000`. The claim item records `earningAmount=4000`, `payout=1500`, and `recovery=2500`. At settlement, the ledger receives `+4000` accrual and `-1500` payout. Their net `+2500` clears the old debt without changing the historical reversal.

## Concurrency and replay safety

- Tenant-scoped advisory locks serialize claim reservation and reset-sensitive operations.
- Candidate earning, claim, conversion, hold, and ledger rows are locked before validation and mutation.
- Database uniqueness prevents one earning per item, duplicate claim items, repeated provider events, and repeated idempotency scopes.
- Mutation request hashes reject an idempotency key reused with different input.
- Completion, refund, guide advance, claim creation, and retry return stored responses for safe replay where supported.
- A transaction failure rolls back its domain writes, ledger changes, audit event, and queued notification together.

## Auditability and trade-offs

The model favors explicit history over in-place correction. It uses more rows and requires balance projection, but an operator can explain what was earned, paid, refunded, recovered, held, or retried without reconstructing overwritten values.

This remains a demonstration. It has one seeded organization currency, simulated payouts, and demo identities. Production adaptation needs real identity, payout reconciliation, regulatory policy, and organization-specific accounting rules. See [Privacy boundary](privacy-boundary.md) for the clean-room and production boundary.
