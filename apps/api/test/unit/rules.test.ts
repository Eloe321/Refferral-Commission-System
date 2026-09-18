import { describe, expect, it } from "vitest";

import { selectApplicableRule, type CandidateCommissionRule } from "../../src/domain/rules.js";

const at = new Date("2026-09-15T12:00:00.000Z");
const programId = "program-a";
const jamieId = "jamie";
const rileyId = "riley";
type FlatCandidateRule = Extract<CandidateCommissionRule, { type: "flat" }>;

function rule(
  overrides: Partial<Omit<FlatCandidateRule, "type">> & Pick<FlatCandidateRule, "id">,
): FlatCandidateRule {
  return {
    programId,
    partnerId: null,
    category: null,
    active: true,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    type: "flat",
    flatAmountMinor: 100n,
    ...overrides,
  };
}

const rules = [
  rule({ id: "default", flatAmountMinor: 500n }),
  rule({ id: "electrical", category: "electrical", flatAmountMinor: 1000n }),
  rule({ id: "jamie-wide", partnerId: jamieId, flatAmountMinor: 1500n }),
  rule({ id: "jamie-electrical", partnerId: jamieId, category: "electrical", flatAmountMinor: 2500n }),
];

describe("selectApplicableRule", () => {
  it("uses a partner category override before a partner-wide rule", () => {
    expect(selectApplicableRule({ rules, programId, partnerId: jamieId, category: "electrical", at })?.id).toBe(
      "jamie-electrical",
    );
  });

  it("uses the program category rule when no partner override matches", () => {
    expect(selectApplicableRule({ rules, programId, partnerId: rileyId, category: "electrical", at })?.id).toBe(
      "electrical",
    );
  });

  it("uses the program default when no category rule matches", () => {
    expect(selectApplicableRule({ rules, programId, partnerId: rileyId, category: "cleaning", at })?.id).toBe(
      "default",
    );
  });

  it("excludes future, expired, and other-program rules", () => {
    const candidates = [
      rule({ id: "future", effectiveFrom: new Date("2026-10-01T00:00:00.000Z") }),
      rule({ id: "expired", effectiveTo: new Date("2026-09-15T12:00:00.000Z") }),
      rule({ id: "other-program", programId: "program-b" }),
    ];

    expect(selectApplicableRule({ rules: candidates, programId, partnerId: rileyId, category: "cleaning", at })).toBeUndefined();
  });

  it("excludes inactive rules before applying precedence", () => {
    const candidates = [
      rule({ id: "inactive-partner", active: false, partnerId: jamieId, category: "electrical" }),
      rule({ id: "default", flatAmountMinor: 500n }),
    ];

    expect(
      selectApplicableRule({ rules: candidates, programId, partnerId: jamieId, category: "electrical", at })?.id,
    ).toBe("default");
  });

  it("returns undefined when no rule applies", () => {
    expect(selectApplicableRule({ rules: [], programId, partnerId: rileyId, category: "cleaning", at })).toBeUndefined();
  });

  it("never depends on input order, preferring recent effectiveFrom then stable id", () => {
    const candidates = [
      rule({ id: "zeta", effectiveFrom: new Date("2026-08-01T00:00:00.000Z") }),
      rule({ id: "alpha", effectiveFrom: new Date("2026-08-01T00:00:00.000Z") }),
      rule({ id: "older", effectiveFrom: new Date("2026-02-01T00:00:00.000Z") }),
    ];
    const request = { programId, partnerId: rileyId, category: "cleaning", at };

    expect(selectApplicableRule({ rules: candidates, ...request })?.id).toBe("alpha");
    expect(selectApplicableRule({ rules: [...candidates].reverse(), ...request })?.id).toBe("alpha");
  });
});
