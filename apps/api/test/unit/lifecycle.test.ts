import { describe, expect, it } from "vitest";

import {
  DomainConflictError,
  EARNING_TRANSITION_CONFLICT,
  CONVERSION_TRANSITION_CONFLICT,
} from "../../src/domain/errors.js";
import {
  assertConversionTransition,
  assertEarningTransition,
  statusAfterHoldRelease,
} from "../../src/domain/lifecycle.js";

describe("conversion lifecycle", () => {
  it.each([
    ["attributed", "scheduled"],
    ["scheduled", "completed"],
    ["scheduled", "cancelled"],
    ["scheduled", "no_show"],
    ["completed", "partially_refunded"],
    ["completed", "refunded"],
    ["partially_refunded", "partially_refunded"],
    ["partially_refunded", "refunded"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(() => {
      assertConversionTransition(from, to);
    }).not.toThrow();
  });

  it.each([
    ["attributed", "attributed"],
    ["scheduled", "scheduled"],
    ["cancelled", "completed"],
    ["cancelled", "scheduled"],
    ["no_show", "scheduled"],
    ["completed", "scheduled"],
    ["partially_refunded", "completed"],
    ["refunded", "scheduled"],
    ["refunded", "partially_refunded"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(() => {
      assertConversionTransition(from, to);
    }).toThrow(DomainConflictError);
    expect(
      captureConflict(() => {
        assertConversionTransition(from, to);
      }),
    ).toMatchObject({
      code: CONVERSION_TRANSITION_CONFLICT,
      details: { from, to },
    });
  });
});

describe("earning lifecycle", () => {
  it.each([
    ["needs_rule", "pending"],
    ["pending", "eligible"],
    ["eligible", "reserved"],
    ["reserved", "settled"],
    ["reserved", "eligible"],
    ["reserved", "pending"],
    ["pending", "held"],
    ["eligible", "held"],
    ["reserved", "held"],
    ["pending", "voided"],
    ["eligible", "voided"],
    ["held", "pending"],
    ["held", "eligible"],
    ["held", "voided"],
    ["settled", "reversed"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(() => {
      assertEarningTransition(from, to);
    }).not.toThrow();
  });

  it.each([
    ["needs_rule", "eligible"],
    ["needs_rule", "held"],
    ["pending", "pending"],
    ["eligible", "settled"],
    ["held", "settled"],
    ["voided", "pending"],
    ["voided", "reversed"],
    ["reversed", "settled"],
    ["settled", "eligible"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(() => {
      assertEarningTransition(from, to);
    }).toThrow(DomainConflictError);
    expect(
      captureConflict(() => {
        assertEarningTransition(from, to);
      }),
    ).toMatchObject({
      code: EARNING_TRANSITION_CONFLICT,
      details: { from, to },
    });
  });
});

describe("hold release policy", () => {
  it.each([
    ["attributed", "pending"],
    ["scheduled", "pending"],
    ["completed", "eligible"],
    ["partially_refunded", "eligible"],
    ["refunded", "eligible"],
    ["cancelled", "voided"],
    ["no_show", "voided"],
  ] as const)("maps %s conversion to %s earning", (conversionStatus, earningStatus) => {
    expect(statusAfterHoldRelease(conversionStatus)).toBe(earningStatus);
  });
});

describe("DomainConflictError", () => {
  it("is an Error with stable, JSON-safe diagnostics", () => {
    const error = new DomainConflictError({
      code: "example_conflict",
      message: "A safe explanation",
      details: { from: "pending", retryable: false, nested: ["safe", 1, null] },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainConflictError);
    expect(error.name).toBe("DomainConflictError");
    expect(error.code).toBe("example_conflict");
    expect(error.message).toBe("A safe explanation");
    expect(error.details).toEqual({ from: "pending", retryable: false, nested: ["safe", 1, null] });
    expect(JSON.stringify(error.details)).toBe('{"from":"pending","retryable":false,"nested":["safe",1,null]}');
  });

  it("rejects non-JSON persistence values in diagnostic details", () => {
    expect(
      () =>
        new DomainConflictError({
          code: "unsafe_details",
          message: "This should not retain persistence values",
          details: { at: new Date("2026-09-15T00:00:00.000Z") as never },
        }),
    ).toThrow("details must contain only JSON-safe values");
  });

  it("rejects cyclic diagnostic details", () => {
    const details: { self?: unknown } = {};
    details.self = details;

    expect(
      () =>
        new DomainConflictError({
          code: "unsafe_details",
          message: "This should not retain cyclic values",
          details: details as never,
        }),
    ).toThrow("details must contain only JSON-safe values");
  });

  it("independently clones and deep-freezes diagnostic details", () => {
    const source = { nested: { statuses: ["pending"] } };
    const error = new DomainConflictError({
      code: "example_conflict",
      message: "A safe explanation",
      details: source,
    });

    source.nested.statuses.push("eligible");

    expect(error.details).toEqual({ nested: { statuses: ["pending"] } });
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(Object.isFrozen((error.details.nested as object))).toBe(true);
    expect(Object.isFrozen((error.details.nested as { statuses: object }).statuses)).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite diagnostic number %s",
    (unsafeNumber) => {
      expect(
        () =>
          new DomainConflictError({
            code: "unsafe_details",
            message: "This should not retain non-finite values",
            details: { value: unsafeNumber },
          }),
      ).toThrow("details must contain only JSON-safe values");
    },
  );

  it("rejects cyclic diagnostic arrays", () => {
    const values: unknown[] = [];
    values.push(values);

    expect(
      () =>
        new DomainConflictError({
          code: "unsafe_details",
          message: "This should not retain cyclic values",
          details: { values: values as never },
        }),
    ).toThrow("details must contain only JSON-safe values");
  });
});

function captureConflict(action: () => void): DomainConflictError {
  try {
    action();
  } catch (error) {
    if (error instanceof DomainConflictError) {
      return error;
    }
  }

  throw new Error("Expected DomainConflictError");
}
