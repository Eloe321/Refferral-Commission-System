import { z } from "zod";

export const POSTGRES_BIGINT_MAX = "9223372036854775807";
export const POSTGRES_BIGINT_MIN = "-9223372036854775808";

/** PostgreSQL SUM(bigint) returns decimal numeric, which can exceed one bigint row. */
export const unsignedAggregateMinorStringSchema = z.string().regex(/^[0-9]+$/);
export const signedAggregateMinorStringSchema = z.string().regex(/^-?[0-9]+$/);

/** Nonnegative minor units that can be safely persisted in PostgreSQL bigint columns. */
export const nonnegativeMinorStringSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .refine((value) => /^[0-9]+$/.test(value) && BigInt(value) <= BigInt(POSTGRES_BIGINT_MAX), {
    message: "Amount exceeds PostgreSQL bigint maximum",
  });

/** JSON boundary only: authoritative arithmetic uses bigint. */
export const moneyJsonSchema = z.strictObject({
  amountMinor: z.string().regex(/^-?[0-9]+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type MoneyJson = z.infer<typeof moneyJsonSchema>;

/** JSON boundary for persisted amounts that cannot be negative. */
export const nonnegativeMoneyJsonSchema = z.strictObject({
  amountMinor: nonnegativeMinorStringSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type NonnegativeMoneyJson = z.infer<typeof nonnegativeMoneyJsonSchema>;
