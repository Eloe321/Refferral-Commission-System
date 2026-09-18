import { describe, expect, it } from "vitest";

import { ownerClaimSchema } from "./api.js";

const claim = {
  id: "33333333-3333-4333-8333-000000000001",
  organizationId: "11111111-1111-4111-8111-000000000001",
  partnerId: "11111111-1111-4111-8111-000000000005",
  actorId: "11111111-1111-4111-8111-000000000003",
  amount: { amountMinor: "2500", currency: "USD" },
  status: "created",
  idempotencyKey: "claim-demo-key",
  selectionHash: "selection-hash",
  items: [
    {
      id: "33333333-3333-4333-8333-000000000002",
      organizationId: "11111111-1111-4111-8111-000000000001",
      claimId: "33333333-3333-4333-8333-000000000001",
      earningId: "11111111-1111-4111-8111-000000000024",
      amount: { amountMinor: "2500", currency: "USD" },
    },
  ],
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
};

describe("owner claim read contract", () => {
  it("includes claim contents and linked OTP audit metadata", () => {
    const parsed = ownerClaimSchema.parse({
      ...claim,
      otpAudit: {
        challengeId: "22222222-2222-4222-8222-000000000001",
        channel: "sms",
        status: "used",
        attempts: 1,
        createdAt: "2026-09-15T23:55:00.000Z",
        updatedAt: "2026-09-16T00:00:00.000Z",
      },
    });

    expect(parsed.items[0]?.earningId).toBe("11111111-1111-4111-8111-000000000024");
    expect(parsed.otpAudit?.channel).toBe("sms");
  });

  it("represents seeded legacy claims with audit metadata unavailable", () => {
    expect(ownerClaimSchema.parse({ ...claim, otpAudit: null }).otpAudit).toBeNull();
  });
});
