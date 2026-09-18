import { describe, expect, it } from "vitest";
import { createClaimDraftHash } from "../../src/domain/claim-draft.js";

const draft = {
  organizationId: "org",
  actorId: "actor",
  partnerId: "partner",
  earningIds: ["b", "a"],
  amountMinor: "9223372036854775807",
  currency: "USD",
};
describe("claim draft binding", () => {
  it("canonicalizes UUID casing for every identity without mutating inputs", () => {
    const uuid = "abcdef01-abcd-4abc-8abc-abcdef012345";
    const canonical = {
      ...draft,
      organizationId: uuid,
      actorId: uuid,
      partnerId: uuid,
      earningIds: [uuid],
    };
    const uppercase = {
      ...canonical,
      organizationId: uuid.toUpperCase(),
      actorId: uuid.toUpperCase(),
      partnerId: uuid.toUpperCase(),
      earningIds: [uuid.toUpperCase()],
    };
    expect(createClaimDraftHash(uppercase)).toBe(createClaimDraftHash(canonical));
    expect(uppercase.earningIds).toEqual([uuid.toUpperCase()]);
  });
  it("rejects one UUID repeated with different text casing", () => {
    const uuid = "abcdef01-abcd-4abc-8abc-abcdef012345";
    expect(() =>
      createClaimDraftHash({ ...draft, earningIds: [uuid, uuid.toUpperCase()] }),
    ).toThrow("Invalid claim draft");
  });
  it("canonicalizes selection without mutation and binds every authoritative field", () => {
    const hash = createClaimDraftHash(draft);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(createClaimDraftHash({ ...draft, earningIds: ["a", "b"] })).toBe(hash);
    expect(draft.earningIds).toEqual(["b", "a"]);
    for (const field of [
      "actorId",
      "partnerId",
      "organizationId",
      "amountMinor",
      "currency",
    ] as const) {
      expect(
        createClaimDraftHash({
          ...draft,
          [field]: field === "amountMinor" ? "1" : field === "currency" ? "PHP" : "other",
        }),
      ).not.toBe(hash);
    }
    expect(createClaimDraftHash({ ...draft, actorId: "a:b", partnerId: "c" })).not.toBe(
      createClaimDraftHash({ ...draft, actorId: "a", partnerId: "b:c" }),
    );
  });
  it("rejects empty, duplicate, ambiguous money and invalid selections", () => {
    for (const change of [
      { earningIds: [] },
      { earningIds: ["a", "a"] },
      { amountMinor: "-1" },
      { amountMinor: "9223372036854775808" },
      { amountMinor: "01" },
      { currency: "usd" },
    ])
      expect(() => createClaimDraftHash({ ...draft, ...change })).toThrow();
  });
});
