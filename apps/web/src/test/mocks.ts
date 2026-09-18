import {
  claimSchema,
  createClaimInput,
  createOtpChallengeInput,
  earningListSchema,
  earningViewSchema,
  otpChallengeResponseSchema,
  reasonInput,
} from "@referral-sandbox/contracts";
import { http, HttpResponse } from "msw";

const ids = {
  organization: "11111111-1111-4111-8111-000000000001",
  owner: "11111111-1111-4111-8111-000000000002",
  partnerUser: "11111111-1111-4111-8111-000000000003",
  partner: "11111111-1111-4111-8111-000000000005",
  program: "11111111-1111-4111-8111-000000000007",
  item: "11111111-1111-4111-8111-000000000019",
  earning: "11111111-1111-4111-8111-000000000024",
  challenge: "22222222-2222-4222-8222-000000000001",
  claim: "33333333-3333-4333-8333-000000000001",
  claimItem: "33333333-3333-4333-8333-000000000002",
} as const;

const timestamp = "2026-09-16T00:00:00.000Z";

const eligibleEarning = earningViewSchema.parse({
  id: ids.earning,
  organizationId: ids.organization,
  conversionItemId: ids.item,
  programId: ids.program,
  partnerId: ids.partner,
  ruleId: null,
  amount: { amountMinor: "2500", currency: "USD" },
  reversedAmount: { amountMinor: "0", currency: "USD" },
  status: "eligible",
  statusExplanation: "Available to claim",
  ruleSnapshot: { type: "flat", category: "plumbing" },
  holds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
});

export function mockOwnerOverview() {
  const response = earningListSchema.parse({ items: [eligibleEarning] });
  return http.get("*/api/earnings", () => HttpResponse.json(response));
}

export function mockHoldSuccess() {
  return http.post("*/api/earnings/:id/hold", async ({ request, params }) => {
    const input = reasonInput.parse(await request.json());
    const response = earningViewSchema.parse({
      ...eligibleEarning,
      id: params.id,
      status: "held",
      statusExplanation: "Held pending review",
      holds: [
        {
          id: "44444444-4444-4444-8444-000000000001",
          organizationId: ids.organization,
          earningId: params.id,
          previousStatus: "eligible",
          reason: input.reason,
          placedBy: ids.owner,
          releasedBy: null,
          placedAt: timestamp,
          releasedAt: null,
        },
      ],
    });
    return HttpResponse.json(response);
  });
}

export function mockEligibleEarnings() {
  const response = earningListSchema.parse({ items: [eligibleEarning] });
  return http.get("*/api/earnings", () => HttpResponse.json(response));
}

export function mockPreviewChallenge(code = "418205") {
  return http.post("*/api/otp-challenges", async ({ request }) => {
    createOtpChallengeInput.parse(await request.json());
    const response = otpChallengeResponseSchema.parse({
      id: ids.challenge,
      status: "pending",
      channel: "sms",
      maskedRecipient: "***0101",
      attempts: 0,
      attemptsRemaining: 5,
      expiresAt: "2026-09-16T00:05:00.000Z",
      resendAfter: "2026-09-16T00:01:00.000Z",
      delivery: {
        mode: "preview",
        preview: {
          recipientMasked: "***0101",
          message: `Your sandbox verification code is ${code}.`,
          code,
          expiresAt: "2026-09-16T00:05:00.000Z",
        },
      },
    });
    return HttpResponse.json(response, { headers: { Date: new Date(timestamp).toUTCString() } });
  });
}

export function mockClaimSuccess() {
  return http.post("*/api/claims", async ({ request }) => {
    const input = createClaimInput.parse(await request.json());
    const response = claimSchema.parse({
      id: ids.claim,
      organizationId: ids.organization,
      partnerId: ids.partner,
      actorId: ids.partnerUser,
      amount: { amountMinor: "2500", currency: "USD" },
      status: "created",
      idempotencyKey: request.headers.get("Idempotency-Key") ?? "mock-claim-key",
      selectionHash: "mock-selection-hash",
      items: input.earningIds.map((earningId) => ({
        id: ids.claimItem,
        organizationId: ids.organization,
        claimId: ids.claim,
        earningId,
        amount: { amountMinor: "2500", currency: "USD" },
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return HttpResponse.json(response);
  });
}
