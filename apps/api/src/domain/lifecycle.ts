import type { ConversionStatus, EarningStatus } from "@referral-sandbox/contracts";

import {
  CONVERSION_TRANSITION_CONFLICT,
  DomainConflictError,
  EARNING_TRANSITION_CONFLICT,
} from "./errors.js";

const conversionTransitions = {
  attributed: ["scheduled"],
  scheduled: ["completed", "cancelled", "no_show"],
  completed: ["partially_refunded", "refunded"],
  cancelled: [],
  no_show: [],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
} as const satisfies Readonly<Record<ConversionStatus, readonly ConversionStatus[]>>;

const earningTransitions = {
  needs_rule: ["pending", "voided"],
  pending: ["eligible", "held", "voided"],
  eligible: ["reserved", "held", "voided"],
  held: ["pending", "eligible", "voided"],
  reserved: ["pending", "eligible", "settled", "held", "voided"],
  settled: ["reversed"],
  voided: [],
  reversed: [],
} as const satisfies Readonly<Record<EarningStatus, readonly EarningStatus[]>>;

export function assertConversionTransition(from: ConversionStatus, to: ConversionStatus): void {
  if (canTransition(conversionTransitions, from, to)) {
    return;
  }

  throw new DomainConflictError({
    code: CONVERSION_TRANSITION_CONFLICT,
    message: `Cannot transition conversion from ${from} to ${to}.`,
    details: { from, to },
  });
}

export function assertEarningTransition(from: EarningStatus, to: EarningStatus): void {
  if (canTransition(earningTransitions, from, to)) {
    return;
  }

  throw new DomainConflictError({
    code: EARNING_TRANSITION_CONFLICT,
    message: `Cannot transition earning from ${from} to ${to}.`,
    details: { from, to },
  });
}

export function statusAfterHoldRelease(
  conversionStatus: ConversionStatus,
): "pending" | "eligible" | "voided" {
  switch (conversionStatus) {
    case "attributed":
    case "scheduled":
      return "pending";
    case "completed":
    case "partially_refunded":
    case "refunded":
      return "eligible";
    case "cancelled":
    case "no_show":
      return "voided";
  }
}

function canTransition<Status extends string>(
  transitions: Readonly<Record<Status, readonly Status[]>>,
  from: Status,
  to: Status,
): boolean {
  return transitions[from].includes(to);
}
