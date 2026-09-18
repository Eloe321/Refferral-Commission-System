import type { CommissionCalculationRule } from "./money.js";

export type CandidateCommissionRule = CommissionCalculationRule & {
  id: string;
  programId: string;
  partnerId: string | null;
  category: string | null;
  active: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type SelectApplicableRuleInput = {
  rules: readonly CandidateCommissionRule[];
  programId: string;
  partnerId: string;
  category: string;
  at: Date;
};

function isEffectiveAt(rule: CandidateCommissionRule, at: Date): boolean {
  return rule.effectiveFrom <= at && (rule.effectiveTo === null || at < rule.effectiveTo);
}

function mostRecentThenStableId(left: CandidateCommissionRule, right: CandidateCommissionRule): number {
  const effectiveFromDifference = right.effectiveFrom.getTime() - left.effectiveFrom.getTime();
  if (effectiveFromDifference !== 0) {
    return effectiveFromDifference;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function selectBest(rules: CandidateCommissionRule[]): CandidateCommissionRule | undefined {
  return rules.sort(mostRecentThenStableId)[0];
}

export function selectApplicableRule(
  input: SelectApplicableRuleInput,
): CandidateCommissionRule | undefined {
  const effective = input.rules.filter(
    (rule) =>
      rule.active && rule.programId === input.programId && isEffectiveAt(rule, input.at),
  );

  const partnerCategory = effective.filter(
    (rule) => rule.partnerId === input.partnerId && rule.category === input.category,
  );
  const partnerWide = effective.filter(
    (rule) => rule.partnerId === input.partnerId && rule.category === null,
  );
  const programCategory = effective.filter(
    (rule) => rule.partnerId === null && rule.category === input.category,
  );
  const programDefault = effective.filter(
    (rule) => rule.partnerId === null && rule.category === null,
  );

  return (
    selectBest(partnerCategory) ??
    selectBest(partnerWide) ??
    selectBest(programCategory) ??
    selectBest(programDefault)
  );
}
