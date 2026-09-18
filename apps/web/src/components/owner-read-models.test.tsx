// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AuditEvent, EarningView } from "@referral-sandbox/contracts";
import { EarningCard } from "./earning-card.js";
import { EventTimeline } from "./event-timeline.js";
import { MetricCard } from "./metric-card.js";
import "../test/setup.js";

const earning: EarningView = {
  id: "11111111-1111-4111-8111-000000000024",
  organizationId: "11111111-1111-4111-8111-000000000001",
  conversionItemId: "11111111-1111-4111-8111-000000000019",
  programId: "11111111-1111-4111-8111-000000000007",
  partnerId: "11111111-1111-4111-8111-000000000005",
  ruleId: "11111111-1111-4111-8111-000000000008",
  amount: { amountMinor: "2500", currency: "USD" },
  reversedAmount: { amountMinor: "0", currency: "USD" },
  status: "eligible",
  statusExplanation: "Available after the service was completed.",
  ruleSnapshot: { type: "flat", category: "plumbing", priority: "category" },
  holds: [],
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
};

describe("owner read-model components", () => {
  it("renders a text-first money metric without losing bigint precision", () => {
    render(
      <MetricCard
        label="Eligible value"
        value={{ amountMinor: "900719925474099312", currency: "USD" }}
        note="Ready for partner claims"
      />,
    );

    expect(screen.getByText("Eligible value")).toBeVisible();
    expect(screen.getByText("$9,007,199,254,740,993.12")).toBeVisible();
    expect(screen.getByText("Ready for partner claims")).toBeVisible();
  });

  it("keeps earning data in a semantic row that can become a phone card", () => {
    render(
      <table>
        <tbody>
          <EarningCard earning={earning} action={<button type="button">Manage earning</button>} />
        </tbody>
      </table>,
    );

    const row = screen.getByRole("row", { name: /plumbing.*eligible.*25\.00/i });
    expect(within(row).getByText("Eligible")).toBeVisible();
    expect(within(row).getByText("Available after the service was completed.")).toBeVisible();
    expect(within(row).getByRole("button", { name: "Manage earning" })).toBeVisible();
    expect(row).toHaveClass("earning-card");
  });

  it("labels operator audit records as server-observed and preserves reasons", () => {
    const event: AuditEvent = {
      id: "77777777-7777-4777-8777-000000000001",
      organizationId: "11111111-1111-4111-8111-000000000001",
      eventKey: "earning.held:test",
      actorId: "11111111-1111-4111-8111-000000000002",
      isSystemEvent: false,
      action: "earning.held",
      reason: "Manual review",
      aggregateType: "earning",
      aggregateId: earning.id,
      metadata: {},
      createdAt: "2026-09-16T00:01:00.000Z",
    };

    render(<EventTimeline events={[event]} />);

    expect(screen.getByRole("list", { name: /server-observed audit history/i })).toBeVisible();
    expect(screen.getByText("Earning held")).toBeVisible();
    expect(screen.getByText("Manual review")).toBeVisible();
    expect(screen.getByText("Server-observed event")).toBeVisible();
    expect(
      screen.getByText(`Operator · 11111111-1111-4111-8111-000000000002`),
    ).toBeVisible();
    expect(screen.getByText(/earning · 11111111-1111-4111-8111-000000000024/i)).toBeVisible();
  });
});
