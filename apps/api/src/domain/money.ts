export const POSTGRES_BIGINT_MAX = 9223372036854775807n;
export const COMMISSION_AMOUNT_OUT_OF_RANGE = "Commission amount exceeds PostgreSQL bigint maximum";

export type FlatCommissionRule = {
  type: "flat";
  flatAmountMinor: bigint;
};

export type PercentageCommissionRule = {
  type: "percentage";
  basisPoints: number;
};

export type CommissionCalculationRule = FlatCommissionRule | PercentageCommissionRule;

function assertNonnegativeBase(baseMinor: bigint): void {
  if (baseMinor < 0n) {
    throw new Error("baseMinor must be nonnegative");
  }
}

function assertBasisPoints(basisPoints: number): void {
  if (!Number.isInteger(basisPoints) || basisPoints < 1 || basisPoints > 10000) {
    throw new Error("basisPoints must be an integer between 1 and 10000");
  }
}

function assertPostgresBigint(value: bigint): void {
  if (value > POSTGRES_BIGINT_MAX) {
    throw new Error(COMMISSION_AMOUNT_OUT_OF_RANGE);
  }
}

export function calculatePercentage(baseMinor: bigint, basisPoints: number): bigint {
  assertNonnegativeBase(baseMinor);
  assertBasisPoints(basisPoints);

  const result = (baseMinor * BigInt(basisPoints) + 5000n) / 10000n;
  assertPostgresBigint(result);
  return result;
}

export function calculateCommission(rule: CommissionCalculationRule, baseMinor: bigint): bigint {
  assertNonnegativeBase(baseMinor);

  if (rule.type === "percentage") {
    return calculatePercentage(baseMinor, rule.basisPoints);
  }

  if (rule.flatAmountMinor < 0n) {
    throw new Error("flatAmountMinor must be nonnegative");
  }

  assertPostgresBigint(rule.flatAmountMinor);
  return rule.flatAmountMinor;
}
