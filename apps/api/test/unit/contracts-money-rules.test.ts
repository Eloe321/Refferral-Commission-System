import { describe, expect, it } from "vitest";

import {
  commissionRuleInput,
  commissionRuleSchema,
  createConversionInput,
  otpDeliverySchema,
  refundInput,
  partnerBalanceSchema,
  signedMinorStringSchema,
  type CommissionRule,
} from "../../../../packages/contracts/src/index.js";

const max = "9223372036854775807";
const tooLarge = "9223372036854775808";
const id = "550e8400-e29b-41d4-a716-446655440000";
const effectiveFrom = "2026-01-01T00:00:00.000Z";

describe("OTP delivery status contract", () => {
  const delivery = {
    id,
    organizationId: id,
    channel: "sms",
    status: "pending",
    deliveryStatus: "unknown",
    maskedRecipient: "***0000",
    attempts: 1,
    expiresAt: effectiveFrom,
    resendAfter: effectiveFrom,
  };

  it("accepts a non-resending unknown provider outcome", () => {
    expect(otpDeliverySchema.safeParse(delivery).success).toBe(true);
  });

  it("continues to reject invalid delivery statuses", () => {
    expect(
      otpDeliverySchema.safeParse({ ...delivery, deliveryStatus: "untracked" }).success,
    ).toBe(false);
  });
});

describe("individual and aggregate money boundaries", () => {
  it.each(["not-money", "", "--1", "1.2"])(
    "rejects malformed signed money %s without throwing",
    (value) => {
      expect(() => signedMinorStringSchema.safeParse(value)).not.toThrow();
      expect(signedMinorStringSchema.safeParse(value).success).toBe(false);
    },
  );
  it.each(["-9223372036854775808", max])("accepts PostgreSQL signed boundary %s", (value) => {
    expect(signedMinorStringSchema.safeParse(value).success).toBe(true);
  });
  it.each(["-9223372036854775809", tooLarge])(
    "rejects individual money beyond signed bigint %s",
    (value) => {
      expect(signedMinorStringSchema.safeParse(value).success).toBe(false);
    },
  );
  it("accepts aggregate sums beyond a single bigint row", () => {
    const sum = (2n * BigInt(max)).toString();
    expect(
      partnerBalanceSchema.safeParse({
        currency: "USD",
        ledgerMinor: `-${sum}`,
        eligibleMinor: sum,
        heldMinor: sum,
      }).success,
    ).toBe(true);
  });
  it.each(["eligibleMinor", "heldMinor"])("rejects negative unsigned aggregate %s", (field) => {
    expect(
      partnerBalanceSchema.safeParse({
        currency: "USD",
        ledgerMinor: "0",
        eligibleMinor: "0",
        heldMinor: "0",
        [field]: "-1",
      }).success,
    ).toBe(false);
  });
  it("safely rejects malformed aggregate values", () => {
    expect(() =>
      partnerBalanceSchema.safeParse({
        currency: "USD",
        ledgerMinor: "not-money",
        eligibleMinor: "0",
        heldMinor: "0",
      }),
    ).not.toThrow();
    expect(
      partnerBalanceSchema.safeParse({
        currency: "USD",
        ledgerMinor: "not-money",
        eligibleMinor: "0",
        heldMinor: "0",
      }).success,
    ).toBe(false);
  });
});

function flatRule(overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: id,
    programId: id,
    partnerId: null,
    category: null,
    type: "flat",
    flatAmount: { amountMinor: max, currency: "PHP" },
    basisPoints: null,
    effectiveFrom,
    effectiveTo: null,
    ...overrides,
  };
}

describe("persisted nonnegative minor-unit mutation fields", () => {
  it.each([max, "0", "0001"])("accepts %s", (amount) => {
    expect(
      commissionRuleInput.safeParse({
        type: "flat",
        category: null,
        partnerId: null,
        flatAmountMinor: amount,
        basisPoints: null,
      }).success,
    ).toBe(true);
  });

  it.each([tooLarge, "9".repeat(100), "+1", "1.0", "-1"])("rejects %s", (amount) => {
    expect(
      commissionRuleInput.safeParse({
        type: "flat",
        category: null,
        partnerId: null,
        flatAmountMinor: amount,
        basisPoints: null,
      }).success,
    ).toBe(false);
  });

  it("applies the bound to conversion gross and refund base amounts", () => {
    const conversion = {
      idempotencyKey: "conversion-key",
      externalRef: "order-1",
      programId: id,
      referralCode: "CODE-1",
      currency: "PHP",
      items: [{ externalRef: "line-1", category: "electrical", grossAmountMinor: max }],
    };
    expect(createConversionInput.safeParse(conversion).success).toBe(true);
    expect(
      createConversionInput.safeParse({
        ...conversion,
        items: [{ ...conversion.items[0], grossAmountMinor: tooLarge }],
      }).success,
    ).toBe(false);
    expect(
      refundInput.safeParse({
        reason: "Customer return",
        items: [{ conversionItemId: id, refundedBaseMinor: max }],
      }).success,
    ).toBe(true);
    expect(
      refundInput.safeParse({
        reason: "Customer return",
        items: [{ conversionItemId: id, refundedBaseMinor: tooLarge }],
      }).success,
    ).toBe(false);
  });

  it("requires positive cumulative refund amounts and unique item identities", () => {
    expect(
      refundInput.safeParse({
        reason: "Customer return",
        items: [{ conversionItemId: id, refundedBaseMinor: "0" }],
      }).success,
    ).toBe(false);
    expect(
      refundInput.safeParse({
        reason: "Customer return",
        items: [
          { conversionItemId: id, refundedBaseMinor: "1" },
          { conversionItemId: id.toUpperCase(), refundedBaseMinor: "2" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("commission rule response contract", () => {
  it("accepts valid flat and percentage rules", () => {
    expect(commissionRuleSchema.safeParse(flatRule()).success).toBe(true);
    expect(
      commissionRuleSchema.safeParse(
        flatRule({ type: "percentage", flatAmount: null, basisPoints: 825 }),
      ).success,
    ).toBe(true);
  });

  it.each([
    flatRule({ basisPoints: 100 }),
    flatRule({
      type: "percentage",
      flatAmount: { amountMinor: "100", currency: "PHP" },
      basisPoints: 100,
    }),
    flatRule({ flatAmount: { amountMinor: "-1", currency: "PHP" } }),
    flatRule({ effectiveTo: effectiveFrom }),
    flatRule({ effectiveTo: "2025-12-31T23:59:59.999Z" }),
  ])("rejects invalid response rule %o", (payload) => {
    expect(commissionRuleSchema.safeParse(payload).success).toBe(false);
  });

  it("infers a union that narrows by rule type", () => {
    const parsed: CommissionRule = commissionRuleSchema.parse(flatRule());

    if (parsed.type === "flat") {
      expect(parsed.flatAmount.amountMinor).toBe(max);
      expect(parsed.basisPoints).toBeNull();
    } else {
      expect(parsed.flatAmount).toBeNull();
      expect(parsed.basisPoints).toBeGreaterThanOrEqual(1);
    }
  });
});
