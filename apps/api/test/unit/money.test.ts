import { describe, expect, it } from "vitest";

import {
  COMMISSION_AMOUNT_OUT_OF_RANGE,
  POSTGRES_BIGINT_MAX,
  calculateCommission,
  calculatePercentage,
} from "../../src/domain/money.js";

describe("commission money calculations", () => {
  it("returns a flat commission without using the base amount", () => {
    expect(calculateCommission({ type: "flat", flatAmountMinor: 2500n }, 18000n)).toBe(2500n);
  });

  it("calculates a percentage commission in basis points", () => {
    expect(calculateCommission({ type: "percentage", basisPoints: 825 }, 12346n)).toBe(1019n);
  });

  it.each([
    [4999n, 0n],
    [5000n, 1n],
    [5001n, 1n],
  ])("rounds %in at one basis point half-up", (baseMinor, expected) => {
    expect(calculatePercentage(baseMinor, 1)).toBe(expected);
  });

  it.each([
    [{ type: "flat", flatAmountMinor: 1n } as const],
    [{ type: "percentage", basisPoints: 1 } as const],
  ])("rejects a negative base for %o", (rule) => {
    expect(() => calculateCommission(rule, -1n)).toThrow("baseMinor must be nonnegative");
  });

  it.each([0, 1.5, Number.NaN, 10001])("rejects invalid basis points: %s", (basisPoints) => {
    expect(() => calculatePercentage(100n, basisPoints)).toThrow(
      "basisPoints must be an integer between 1 and 10000",
    );
  });

  it("rejects a negative flat amount", () => {
    expect(() => calculateCommission({ type: "flat", flatAmountMinor: -1n }, 100n)).toThrow(
      "flatAmountMinor must be nonnegative",
    );
  });

  it("accepts the PostgreSQL signed bigint maximum", () => {
    expect(
      calculateCommission({ type: "flat", flatAmountMinor: POSTGRES_BIGINT_MAX }, POSTGRES_BIGINT_MAX),
    ).toBe(POSTGRES_BIGINT_MAX);
  });

  it("rejects commissions above the PostgreSQL signed bigint maximum", () => {
    expect(() =>
      calculateCommission({ type: "flat", flatAmountMinor: POSTGRES_BIGINT_MAX + 1n }, 1n),
    ).toThrow(COMMISSION_AMOUNT_OUT_OF_RANGE);
  });
});
