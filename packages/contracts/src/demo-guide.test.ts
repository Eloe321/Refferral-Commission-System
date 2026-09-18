import { describe, expect, it } from "vitest";

import {
  demoWorkspaceSchema,
  guideStages,
  guideStateSchema,
  resetSandboxResponseSchema,
} from "./api.js";

const organizationId = "11111111-1111-4111-8111-000000000001";
const actorId = "11111111-1111-4111-8111-000000000002";

describe("guided sandbox contracts", () => {
  it("locks the supported scenario to the approved stage order", () => {
    expect(guideStages).toEqual([
      "review_program",
      "switch_to_partner",
      "create_referral",
      "complete_service",
      "claim_earnings",
      "switch_to_owner",
      "issue_refund",
      "review_reversal",
      "complete",
    ]);
    expect(
      guideStateSchema.parse({
        organizationId,
        scenarioId: "northstar-referral-lifecycle",
        stage: "review_program",
        sandboxVersion: 1,
        completedStages: [],
        updatedAt: "2026-09-16T00:00:00.000Z",
      }),
    ).toBeTruthy();
  });

  it("discriminates owner and partner workspace authority", () => {
    const owner = demoWorkspaceSchema.parse({
      role: "owner",
      organizationId,
      sandboxVersion: 1,
      conversions: [],
      auditEvents: [],
    });
    expect(owner.role).toBe("owner");

    const partner = demoWorkspaceSchema.parse({
      role: "partner",
      organizationId,
      sandboxVersion: 1,
      partnerId: "11111111-1111-4111-8111-000000000005",
      referral: {
        code: "JAMIE12",
        publicUrl: "https://referrals.example.invalid/r/JAMIE12",
      },
      ledgerEntries: [],
    });
    expect(partner.role).toBe("partner");
    expect(JSON.stringify(partner)).not.toMatch(/cookie|session|phone|email/i);
  });

  it("returns a versioned owner session and reset guide state together", () => {
    expect(
      resetSandboxResponseSchema.parse({
        session: {
          organizationId,
          actorId,
          role: "owner",
          partnerId: null,
          displayName: "Morgan Lee",
          sandboxVersion: 2,
        },
        guide: {
          organizationId,
          scenarioId: "northstar-referral-lifecycle",
          stage: "review_program",
          sandboxVersion: 2,
          completedStages: [],
          updatedAt: "2026-09-16T00:00:00.000Z",
        },
      }),
    ).toBeTruthy();
  });
});
