import { claimSchema, earningViewSchema, partnerDetailSchema } from "@referral-sandbox/contracts";
import { describe, expect, it } from "vitest";
import { projectPartnerFinancials } from "./partner-financials.js";

const partnerId = "11111111-1111-4111-8111-000000000005";
const timestamp = "2026-09-16T05:00:00.000Z";
const eligible = earningViewSchema.parse({
  id: "11111111-1111-4111-8111-000000000024",
  organizationId: "11111111-1111-4111-8111-000000000001",
  conversionItemId: "11111111-1111-4111-8111-000000000019",
  programId: "11111111-1111-4111-8111-000000000007",
  partnerId,
  ruleId: null,
  amount: { amountMinor: "2500", currency: "USD" },
  reversedAmount: { amountMinor: "0", currency: "USD" },
  status: "eligible",
  statusExplanation: "Available to claim",
  ruleSnapshot: { type: "flat", category: "plumbing", externalRef: "SERVICE-1" },
  holds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
});
const pending = earningViewSchema.parse({
  ...eligible,
  id: "11111111-1111-4111-8111-000000000025",
  conversionItemId: "11111111-1111-4111-8111-000000000020",
  status: "pending",
  amount: { amountMinor: "1250", currency: "USD" },
  statusExplanation: "Waiting for conversion completion",
});
const reserved = earningViewSchema.parse({
  ...eligible,
  id: "11111111-1111-4111-8111-000000000026",
  conversionItemId: "11111111-1111-4111-8111-000000000021",
  status: "reserved",
  amount: { amountMinor: "1000", currency: "USD" },
  statusExplanation: "Reserved by an open claim",
});
const detail = partnerDetailSchema.parse({
  id: partnerId,
  organizationId: "11111111-1111-4111-8111-000000000001",
  userId: "11111111-1111-4111-8111-000000000003",
  displayName: "Jamie Cruz",
  email: "jamie@example.invalid",
  phoneE164: "+12025550101",
  status: "active",
  balances: [{ currency: "USD", ledgerMinor: "4000", eligibleMinor: "2500", heldMinor: "500" }],
  createdAt: timestamp,
  updatedAt: timestamp,
});

function recoveryClaim(
  status: "created" | "processing" | "settled" | "failed",
  options: {
    claimId?: string;
    itemId?: string;
    earningId?: string;
    payoutMinor?: string;
    payoutCurrency?: string;
    claimCurrency?: string;
  } = {},
) {
  const claimId = options.claimId ?? "33333333-3333-4333-8333-000000000010";
  return claimSchema.parse({
    id: claimId,
    organizationId: detail.organizationId,
    partnerId,
    actorId: detail.userId,
    amount: {
      amountMinor: options.payoutMinor ?? "500",
      currency: options.claimCurrency ?? "USD",
    },
    status,
    idempotencyKey: `recovery-${claimId}`,
    selectionHash: `selection-${claimId}`,
    items: [
      {
        id: options.itemId ?? "33333333-3333-4333-8333-000000000011",
        organizationId: detail.organizationId,
        claimId,
        earningId: options.earningId ?? reserved.id,
        amount: {
          amountMinor: options.payoutMinor ?? "500",
          currency: options.payoutCurrency ?? "USD",
        },
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

describe("projectPartnerFinancials", () => {
  it("does not charge recovery twice when an open claim already reserved the full debt", () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-500", eligibleMinor: "2500", heldMinor: "0" }],
    });
    const financials = projectPartnerFinancials({
      partner: debtDetail,
      earnings: [eligible, reserved],
      claims: [recoveryClaim("created")],
    });
    expect(financials).toMatchObject({
      available: "2500",
      recoveryApplied: "0",
      incompleteRecovery: false,
    });
  });

  it("applies only recovery still outstanding after an open claim reservation", () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" }],
    });
    const financials = projectPartnerFinancials({
      partner: debtDetail,
      earnings: [eligible, reserved],
      claims: [recoveryClaim("created")],
    });
    expect(financials).toMatchObject({
      available: "2000",
      recoveryApplied: "500",
      incompleteRecovery: false,
    });
  });

  it("counts processing reservations but excludes settled and failed claims", () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" }],
    });
    const processing = recoveryClaim("processing");
    const settled = recoveryClaim("settled", {
      claimId: "33333333-3333-4333-8333-000000000012",
      itemId: "33333333-3333-4333-8333-000000000013",
    });
    const failed = recoveryClaim("failed", {
      claimId: "33333333-3333-4333-8333-000000000014",
      itemId: "33333333-3333-4333-8333-000000000015",
    });
    const financials = projectPartnerFinancials({
      partner: debtDetail,
      earnings: [eligible, reserved],
      claims: [processing, settled, failed],
    });
    expect(financials).toMatchObject({
      available: "2000",
      recoveryApplied: "500",
      incompleteRecovery: false,
    });
  });

  it("keeps the estimate conservative when open claim associations cannot be reconciled", () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" }],
    });
    const valid = recoveryClaim("created");
    const missing = recoveryClaim("created", {
      claimId: "33333333-3333-4333-8333-000000000016",
      itemId: "33333333-3333-4333-8333-000000000017",
      earningId: "11111111-1111-4111-8111-000000000099",
    });
    const crossCurrency = recoveryClaim("created", {
      claimId: "33333333-3333-4333-8333-000000000018",
      itemId: "33333333-3333-4333-8333-000000000019",
      payoutCurrency: "EUR",
    });
    const impossible = recoveryClaim("created", {
      claimId: "33333333-3333-4333-8333-000000000020",
      itemId: "33333333-3333-4333-8333-000000000021",
      payoutMinor: "1500",
    });
    const financials = projectPartnerFinancials({
      partner: debtDetail,
      earnings: [eligible, reserved],
      claims: [valid, missing, crossCurrency, impossible],
    });
    expect(financials).toMatchObject({ available: "1500", incompleteRecovery: true });
  });

  it("does not credit recovery for an earning that is still eligible", () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-500", eligibleMinor: "2500", heldMinor: "0" }],
    });
    const staleClaim = recoveryClaim("created", {
      earningId: eligible.id,
      payoutMinor: "2000",
    });
    const financials = projectPartnerFinancials({
      partner: debtDetail,
      earnings: [eligible],
      claims: [staleClaim],
    });
    expect(financials).toMatchObject({ available: "2000", incompleteRecovery: true });
  });

  it.each([
    ["created item first", false],
    ["processing item first", true],
  ])(
    "excludes conflicting duplicate recovery across open claims with %s",
    (_label, reverseClaims) => {
      const debtDetail = partnerDetailSchema.parse({
        ...detail,
        balances: [
          { currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" },
        ],
      });
      const first = recoveryClaim("created");
      const duplicate = recoveryClaim("processing", {
        claimId: "33333333-3333-4333-8333-000000000022",
        itemId: "33333333-3333-4333-8333-000000000023",
        payoutMinor: "750",
      });
      const claims = reverseClaims ? [duplicate, first] : [first, duplicate];
      const financials = projectPartnerFinancials({
        partner: debtDetail,
        earnings: [eligible, reserved],
        claims: claims,
      });
      expect(financials).toMatchObject({ available: "1500", incompleteRecovery: true });
    },
  );

  it.each(["created", "processing"] as const)(
    "warns when a %s open claim has no items",
    (status) => {
      const emptyClaim = claimSchema.parse({ ...recoveryClaim(status), items: [] });
      const financials = projectPartnerFinancials({
        partner: detail,
        earnings: [eligible],
        claims: [emptyClaim],
      });
      expect(financials).toMatchObject({ incompleteRecovery: true });
    },
  );

  it("excludes a duplicated earning even when the second open claim has another currency", () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" }],
    });
    const usdClaim = recoveryClaim("created");
    const conflictingEuroClaim = recoveryClaim("processing", {
      claimId: "33333333-3333-4333-8333-000000000031",
      itemId: "33333333-3333-4333-8333-000000000032",
      claimCurrency: "EUR",
      payoutCurrency: "EUR",
    });
    const financials = projectPartnerFinancials({
      partner: debtDetail,
      earnings: [eligible, reserved],
      claims: [usdClaim, conflictingEuroClaim],
    });
    expect(financials).toMatchObject({ available: "1500", incompleteRecovery: true });
  });

  it("excludes identical same-currency associations for one reserved earning", () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" }],
    });
    const first = recoveryClaim("created");
    const identical = recoveryClaim("processing", {
      claimId: "33333333-3333-4333-8333-000000000033",
      itemId: "33333333-3333-4333-8333-000000000034",
    });
    const financials = projectPartnerFinancials({
      partner: debtDetail,
      earnings: [eligible, reserved],
      claims: [first, identical],
    });
    expect(financials).toMatchObject({ available: "1500", incompleteRecovery: true });
  });

  it("warns about an empty open claim even when its currency differs from the visible balance", () => {
    const euroClaim = claimSchema.parse({
      ...recoveryClaim("created", { claimCurrency: "EUR" }),
      items: [],
    });
    const financials = projectPartnerFinancials({
      partner: detail,
      earnings: [eligible],
      claims: [euroClaim],
    });
    expect(financials).toMatchObject({ incompleteRecovery: true });
  });

  it("rejects open claim organization, partner, and item-claim ownership mismatches", () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" }],
    });
    const valid = recoveryClaim("created");
    const organizationEarning = earningViewSchema.parse({
      ...reserved,
      id: "11111111-1111-4111-8111-000000000092",
      conversionItemId: "11111111-1111-4111-8111-000000000093",
    });
    const partnerEarning = earningViewSchema.parse({
      ...reserved,
      id: "11111111-1111-4111-8111-000000000094",
      conversionItemId: "11111111-1111-4111-8111-000000000095",
    });
    const itemClaimEarning = earningViewSchema.parse({
      ...reserved,
      id: "11111111-1111-4111-8111-000000000096",
      conversionItemId: "11111111-1111-4111-8111-000000000097",
    });
    const organizationBase = recoveryClaim("created", {
      claimId: "33333333-3333-4333-8333-000000000024",
      itemId: "33333333-3333-4333-8333-000000000025",
      earningId: organizationEarning.id,
    });
    const organizationMismatch = claimSchema.parse({
      ...organizationBase,
      organizationId: "11111111-1111-4111-8111-000000000090",
      items: organizationBase.items.map((item) => ({
        ...item,
        organizationId: "11111111-1111-4111-8111-000000000090",
      })),
    });
    const partnerBase = recoveryClaim("created", {
      claimId: "33333333-3333-4333-8333-000000000026",
      itemId: "33333333-3333-4333-8333-000000000027",
      earningId: partnerEarning.id,
    });
    const partnerMismatch = claimSchema.parse({
      ...partnerBase,
      partnerId: "11111111-1111-4111-8111-000000000091",
    });
    const itemClaimBase = recoveryClaim("created", {
      claimId: "33333333-3333-4333-8333-000000000028",
      itemId: "33333333-3333-4333-8333-000000000029",
      earningId: itemClaimEarning.id,
    });
    const itemClaimMismatch = claimSchema.parse({
      ...itemClaimBase,
      items: itemClaimBase.items.map((item) => ({
        ...item,
        claimId: "33333333-3333-4333-8333-000000000030",
      })),
    });
    const financials = projectPartnerFinancials({
      partner: debtDetail,
      earnings: [eligible, reserved, organizationEarning, partnerEarning, itemClaimEarning],
      claims: [valid, organizationMismatch, partnerMismatch, itemClaimMismatch],
    });
    expect(financials).toMatchObject({ available: "2000", incompleteRecovery: true });
  });

  it("projects exact pending totals in the selected currency and recovery invariants", () => {
    const financials = projectPartnerFinancials({
      partner: {
        ...detail,
        balances: [
          { currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" },
        ],
      },
      earnings: [
        eligible,
        { ...pending, amount: { amountMinor: "2500", currency: "USD" } },
        { ...pending, amount: { amountMinor: "999", currency: "EUR" } },
      ],
      claims: [],
    });
    expect(financials).toEqual({
      currency: "USD",
      available: "1500",
      pending: "2500",
      held: "0",
      recoveryApplied: "1000",
      recoveryRemaining: "0",
      recoveryDebt: "1000",
      incompleteRecovery: false,
    });
    expect(BigInt(financials.available) + BigInt(financials.recoveryApplied)).toBe(2500n);
    expect(BigInt(financials.recoveryApplied) + BigInt(financials.recoveryRemaining)).toBe(
      BigInt(financials.recoveryDebt),
    );
  });

  it("keeps large integer recovery exact after exhausting eligibility", () => {
    const financials = projectPartnerFinancials({
      partner: {
        ...detail,
        balances: [
          {
            currency: "USD",
            ledgerMinor: "-900719925474099399",
            eligibleMinor: "900719925474099301",
            heldMinor: "0",
          },
        ],
      },
      earnings: [],
      claims: [],
    });
    expect(financials).toMatchObject({
      available: "0",
      recoveryApplied: "900719925474099301",
      recoveryRemaining: "98",
      recoveryDebt: "900719925474099399",
    });
    expect(BigInt(financials.available) + BigInt(financials.recoveryApplied)).toBe(
      900719925474099301n,
    );
    expect(BigInt(financials.recoveryApplied) + BigInt(financials.recoveryRemaining)).toBe(
      BigInt(financials.recoveryDebt),
    );
  });

  it.each(["negative earning", "negative payout", "payout exceeds earning"])(
    "rejects %s amounts in a reservation",
    (kind) => {
      const claim = recoveryClaim("created", {
        payoutMinor:
          kind === "negative payout" ? "-500" : kind === "payout exceeds earning" ? "1500" : "500",
      });
      const earning =
        kind === "negative earning"
          ? { ...reserved, amount: { amountMinor: "-1000", currency: "USD" } }
          : reserved;
      expect(
        projectPartnerFinancials({
          partner: {
            ...detail,
            balances: [
              { currency: "USD", ledgerMinor: "-1000", eligibleMinor: "2500", heldMinor: "0" },
            ],
          },
          earnings: [earning],
          claims: [claim],
        }),
      ).toMatchObject({ available: "1500", incompleteRecovery: true });
    },
  );

  it("clamps negative eligibility and falls back from balance to earning currency to USD", () => {
    expect(
      projectPartnerFinancials({
        partner: {
          ...detail,
          balances: [
            { currency: "EUR", ledgerMinor: "-500", eligibleMinor: "-100", heldMinor: "20" },
          ],
        },
        earnings: [],
        claims: [],
      }),
    ).toMatchObject({
      currency: "EUR",
      available: "0",
      recoveryApplied: "0",
      recoveryRemaining: "500",
      held: "20",
    });
    expect(
      projectPartnerFinancials({
        partner: { ...detail, balances: [] },
        earnings: [{ ...pending, amount: { amountMinor: "1250", currency: "EUR" } }],
        claims: [],
      }),
    ).toMatchObject({ currency: "EUR", pending: "1250" });
    expect(
      projectPartnerFinancials({ partner: { ...detail, balances: [] }, earnings: [], claims: [] }),
    ).toMatchObject({ currency: "USD", available: "0", pending: "0", held: "0" });
  });
});
