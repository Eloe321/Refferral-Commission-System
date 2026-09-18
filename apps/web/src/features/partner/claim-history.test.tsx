// @vitest-environment jsdom

import { claimSchema, ledgerEntrySchema } from "@referral-sandbox/contracts";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "../../test/setup.js";
import { ClaimHistory } from "./claim-history.js";

const timestamp = "2026-09-16T05:00:00.000Z";
const claim = claimSchema.parse({
  id: "33333333-3333-4333-8333-000000000001",
  organizationId: "11111111-1111-4111-8111-000000000001",
  partnerId: "11111111-1111-4111-8111-000000000005",
  actorId: "11111111-1111-4111-8111-000000000003",
  amount: { amountMinor: "2500", currency: "USD" },
  status: "failed",
  idempotencyKey: "claim-history-key",
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
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("ClaimHistory", () => {
  it("shows a failed payout and its server-returned claim contents", () => {
    render(<ClaimHistory claims={[claim]} ledgerEntries={[]} />);

    const record = screen.getByRole("article", { name: /claim 33333333/i });
    expect(within(record).getByText(/payout failed/i)).toBeVisible();
    expect(within(record).getByText("11111111-1111-4111-8111-000000000024")).toBeVisible();
    expect(within(record).getAllByText("$25.00")).toHaveLength(2);
  });

  it("renders supplied reversal ledger history with honest provenance", () => {
    const reversal = ledgerEntrySchema.parse({
      id: "55555555-5555-4555-8555-000000000001",
      organizationId: "11111111-1111-4111-8111-000000000001",
      partnerId: "11111111-1111-4111-8111-000000000005",
      earningId: "11111111-1111-4111-8111-000000000024",
      claimId: claim.id,
      entryType: "reversal",
      amount: { amountMinor: "-500", currency: "USD" },
      reason: "Partial service refund",
      createdAt: "2026-09-16T06:00:00.000Z",
    });
    render(<ClaimHistory claims={[]} ledgerEntries={[reversal]} />);

    const record = screen.getByRole("article", { name: /reversal 55555555/i });
    expect(within(record).getByText("Supplied ledger record")).toBeVisible();
    expect(within(record).getByText("Partial service refund")).toBeVisible();
    expect(within(record).getByText("-$5.00")).toBeVisible();
    expect(within(record).getByText(claim.id)).toBeVisible();
  });
});
