// @vitest-environment jsdom

import {
  auditEventSchema,
  conversionSchema,
  earningListSchema,
  earningViewSchema,
  ownerClaimListSchema,
  ownerClaimSchema,
  partnerDetailSchema,
  partnerSchema,
  programSchema,
  reasonInput,
  type Conversion,
  type AuditEvent,
  type DemoWorkspace,
  type EarningView,
  type OwnerClaim,
  type PartnerDetail,
  type Program,
} from "@referral-sandbox/contracts";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { server } from "../../test/setup.js";
import "../../test/setup.js";
import { ActionSheet } from "./action-sheet.js";
import { OwnerWorkspaceProvider, useOwnerWorkspace } from "./owner-workspace-provider.js";
import { OwnerWorkboardPage } from "./pages/owner-workboard-page.js";
import { OwnerProgramsPage } from "./pages/owner-programs-page.js";
import { OwnerEarningsPage } from "./pages/owner-earnings-page.js";
import { OwnerPartnersPage } from "./pages/owner-partners-page.js";
import { ConversionControls } from "./conversion-controls.js";

vi.mock("../sandbox/sandbox-workspace-provider", () => ({
  useSandboxWorkspace: () => ({ workspace: outerWorkspace }),
}));

let outerWorkspace: DemoWorkspace;

const ids = {
  organization: "11111111-1111-4111-8111-000000000001",
  owner: "11111111-1111-4111-8111-000000000002",
  program: "11111111-1111-4111-8111-000000000007",
  rule: "11111111-1111-4111-8111-000000000008",
  partner: "11111111-1111-4111-8111-000000000005",
  partnerUser: "11111111-1111-4111-8111-000000000003",
  conversion: "11111111-1111-4111-8111-000000000017",
  item: "11111111-1111-4111-8111-000000000019",
  earning: "11111111-1111-4111-8111-000000000024",
  earningTwo: "11111111-1111-4111-8111-000000000025",
  claim: "33333333-3333-4333-8333-000000000001",
} as const;
const timestamp = "2026-09-16T00:00:00.000Z";

const program: Program = programSchema.parse({
  id: ids.program,
  organizationId: ids.organization,
  name: "Neighbor Rewards",
  status: "active",
  rules: [
    {
      id: ids.rule,
      organizationId: ids.organization,
      programId: ids.program,
      partnerId: null,
      category: "plumbing",
      type: "flat",
      flatAmount: { amountMinor: "2500", currency: "USD" },
      basisPoints: null,
      effectiveFrom: timestamp,
      effectiveTo: null,
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
});
const partner = partnerSchema.parse({
  id: ids.partner,
  organizationId: ids.organization,
  userId: ids.partnerUser,
  displayName: "Jamie Rivera",
  email: "jamie@example.test",
  phoneE164: "+12025550101",
  status: "active",
  createdAt: timestamp,
  updatedAt: timestamp,
});
const partnerDetail: PartnerDetail = partnerDetailSchema.parse({
  ...partner,
  balances: [{ currency: "USD", ledgerMinor: "-2500", eligibleMinor: "2500", heldMinor: "500" }],
});
const conversion: Conversion = conversionSchema.parse({
  id: ids.conversion,
  organizationId: ids.organization,
  programId: ids.program,
  partnerId: ids.partner,
  referralCodeId: "11111111-1111-4111-8111-000000000012",
  externalRef: "JOB-1042",
  currency: "USD",
  status: "attributed",
  items: [
    {
      id: ids.item,
      organizationId: ids.organization,
      conversionId: ids.conversion,
      externalRef: "SERVICE-1",
      category: "plumbing",
      grossAmount: { amountMinor: "10000", currency: "USD" },
      refundedBase: { amountMinor: "0", currency: "USD" },
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
});
const earning: EarningView = earningViewSchema.parse({
  id: ids.earning,
  organizationId: ids.organization,
  conversionItemId: ids.item,
  programId: ids.program,
  partnerId: ids.partner,
  ruleId: ids.rule,
  amount: { amountMinor: "2500", currency: "USD" },
  reversedAmount: { amountMinor: "0", currency: "USD" },
  status: "eligible",
  statusExplanation: "Available to claim.",
  ruleSnapshot: { type: "flat", category: "plumbing", priority: "category" },
  holds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
});
const noRuleEarning: EarningView = earningViewSchema.parse({
  ...earning,
  id: ids.earningTwo,
  conversionItemId: "11111111-1111-4111-8111-000000000020",
  ruleId: null,
  amount: { amountMinor: "0", currency: "USD" },
  status: "needs_rule",
  statusExplanation: "No matching rule. Add a category or fallback rule.",
  ruleSnapshot: { reason: "no_rule" },
});
const claim: OwnerClaim = ownerClaimSchema.parse({
  id: ids.claim,
  organizationId: ids.organization,
  partnerId: ids.partner,
  actorId: ids.partnerUser,
  amount: { amountMinor: "2500", currency: "USD" },
  status: "created",
  idempotencyKey: "claim-demo-key",
  selectionHash: "selection-hash",
  items: [],
  otpAudit: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

type FixtureState = {
  program: Program;
  partner: PartnerDetail;
  earnings: EarningView[];
  claims: OwnerClaim[];
};

function installOverview(state: FixtureState, earningReads?: { count: number }) {
  const partnerSummary = {
    id: state.partner.id,
    organizationId: state.partner.organizationId,
    userId: state.partner.userId,
    displayName: state.partner.displayName,
    email: state.partner.email,
    phoneE164: state.partner.phoneE164,
    status: state.partner.status,
    createdAt: state.partner.createdAt,
    updatedAt: state.partner.updatedAt,
  };
  server.use(
    http.get("*/api/programs", () => HttpResponse.json([state.program])),
    http.get("*/api/earnings", () => {
      if (earningReads) earningReads.count += 1;
      return HttpResponse.json(earningListSchema.parse({ items: state.earnings }));
    }),
    http.get("*/api/partners", () => HttpResponse.json([partnerSummary])),
    http.get("*/api/partners/:id", () => HttpResponse.json(state.partner)),
    http.get("*/api/claims", () =>
      HttpResponse.json(ownerClaimListSchema.parse({ items: state.claims })),
    ),
  );
}

function defaultState(): FixtureState {
  return { program, partner: partnerDetail, earnings: [earning, noRuleEarning], claims: [claim] };
}

beforeEach(() => {
  outerWorkspace = {
    role: "owner",
    organizationId: ids.organization,
    sandboxVersion: 0,
    conversions: [conversion],
    auditEvents: [],
  };
});

function renderOwner(
  page: ReactNode = <OwnerEarningsPage />,
  conversions: Conversion[] = [conversion],
  auditEvents: AuditEvent[] = [],
) {
  outerWorkspace = {
    role: "owner",
    organizationId: ids.organization,
    sandboxVersion: 0,
    conversions,
    auditEvents,
  };
  const result = render(<OwnerWorkspaceProvider>{page}</OwnerWorkspaceProvider>);
  return {
    ...result,
    showPage: (next: ReactNode) => {
      result.rerender(<OwnerWorkspaceProvider>{next}</OwnerWorkspaceProvider>);
    },
  };
}

function RefreshRecords() {
  const { refresh } = useOwnerWorkspace();
  return <button onClick={() => void refresh()}>Refresh records</button>;
}

describe("OwnerWorkspaceProvider and owner pages", () => {
  it("loads the overview once while navigating between owner pages", async () => {
    const reads = { count: 0 };
    installOverview(defaultState(), reads);
    const view = renderOwner(<OwnerWorkboardPage />);
    expect(await screen.findByRole("heading", { name: "Owner workboard" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Review program controls" })).toHaveAttribute(
      "href",
      "/owner/programs",
    );
    expect(screen.getByRole("link", { name: "Open earning operations" })).toHaveAttribute(
      "href",
      "/owner/earnings",
    );
    view.showPage(<OwnerProgramsPage />);
    expect(screen.getByRole("heading", { name: "Programs and attribution" })).toBeVisible();
    expect(reads.count).toBe(1);
  });

  it("preserves program records after a failed refresh", async () => {
    installOverview(defaultState());
    renderOwner(
      <>
        <OwnerProgramsPage />
        <RefreshRecords />
      </>,
    );
    expect(await screen.findByText("Neighbor Rewards")).toBeVisible();
    server.use(http.get("*/api/earnings", () => HttpResponse.json({}, { status: 503 })));
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh records" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/last successful records/i);
    expect(screen.getByText("Neighbor Rewards")).toBeVisible();
  });

  it("reloads earnings after the guide publishes a completed-service workspace", async () => {
    const state = defaultState();
    state.earnings = [{ ...earning, status: "pending", statusExplanation: "Waiting for service." }];
    const reads = { count: 0 };
    installOverview(state, reads);
    const view = renderOwner(<OwnerProgramsPage />);
    await screen.findByText("Neighbor Rewards");
    expect(reads.count).toBe(1);

    state.earnings = [earning];
    if (outerWorkspace.role !== "owner") throw new Error("Expected an owner fixture");
    outerWorkspace = {
      ...outerWorkspace,
      conversions: [conversionSchema.parse({ ...conversion, status: "completed" })],
    };
    view.showPage(<OwnerProgramsPage />);
    view.showPage(<OwnerEarningsPage />);

    expect(await screen.findByText("Available to claim.")).toBeVisible();
    expect(screen.getAllByText("Eligible").length).toBeGreaterThan(0);
    expect(screen.queryByText("Waiting for service.")).not.toBeInTheDocument();
    expect(reads.count).toBe(2);
  });

  it("keeps operational sections on their assigned pages", async () => {
    installOverview(defaultState());
    renderOwner(<OwnerWorkboardPage />);
    await screen.findByRole("heading", { name: "Owner workboard" });
    expect(
      screen.queryByRole("heading", { name: "Programs and rule priority" }),
    ).not.toBeInTheDocument();
    cleanup();
    renderOwner(<OwnerProgramsPage />);
    expect(
      await screen.findByRole("heading", { name: "Programs and rule priority" }),
    ).toBeVisible();
    cleanup();
    renderOwner(<OwnerEarningsPage />);
    expect(await screen.findByRole("heading", { name: "Earnings" })).toBeVisible();
    cleanup();
    renderOwner(<OwnerPartnersPage />);
    expect(await screen.findByRole("heading", { name: "Partner access", level: 1 })).toBeVisible();
  });

  it("restricts completed conversion management to refund mode", () => {
    const completed = conversionSchema.parse({ ...conversion, status: "completed" });
    const props = { conversions: [completed], onChanged: vi.fn(), onNotice: vi.fn() };
    const view = render(<ConversionControls {...props} mode="lifecycle" />);
    expect(screen.queryByRole("button", { name: /manage conversion/i })).not.toBeInTheDocument();
    expect(screen.getByText("Open Earnings to review refund adjustments.")).toBeVisible();
    view.rerender(<ConversionControls {...props} mode="refund" />);
    expect(screen.getByRole("button", { name: /manage conversion JOB-1042/i })).toBeVisible();
  });

  it.each([
    [
      "attributed",
      "This attributed record awaits scheduling before service actions are available.",
    ],
    ["scheduled", null],
    ["completed", "Open Earnings to review refund adjustments."],
    ["partially_refunded", "Open Earnings to review refund adjustments."],
    ["cancelled", "No further actions available."],
    ["no_show", "No further actions available."],
    ["refunded", "No further actions available."],
  ] as const)("shows valid lifecycle guidance for %s records", async (status, guidance) => {
    render(
      <ConversionControls
        conversions={[conversionSchema.parse({ ...conversion, status })]}
        onChanged={vi.fn()}
        onNotice={vi.fn()}
      />,
    );
    if (guidance) {
      expect(screen.getByText(guidance)).toBeVisible();
      expect(screen.queryByRole("button", { name: /manage conversion/i })).not.toBeInTheDocument();
    } else {
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: /manage conversion JOB-1042/i }));
      for (const name of ["Complete service", "Cancel service", "Mark no-show"]) {
        expect(screen.getByRole("button", { name })).toBeVisible();
      }
    }
    if (status !== "completed" && status !== "partially_refunded") {
      expect(
        screen.queryByText("Open Earnings to review refund adjustments."),
      ).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Submit refund" })).not.toBeInTheDocument();
  });

  it("synchronizes conversion and item references when the outer workspace changes", async () => {
    const reads = { count: 0 };
    installOverview(defaultState(), reads);
    const view = renderOwner(<OwnerEarningsPage />);
    expect(await screen.findByRole("button", { name: /manage earning SERVICE-1/i })).toBeVisible();
    expect(screen.getByText("No refundable conversion records are available.")).toBeVisible();
    outerWorkspace = {
      role: "owner",
      organizationId: ids.organization,
      sandboxVersion: 0,
      conversions: [
        conversionSchema.parse({
          ...conversion,
          externalRef: "JOB-REPLACEMENT",
          status: "completed",
          items: conversion.items.map((item) => ({ ...item, externalRef: "SERVICE-REPLACEMENT" })),
        }),
      ],
      auditEvents: [],
    };
    view.showPage(<OwnerEarningsPage />);
    expect(
      screen.getByRole("button", { name: /manage earning SERVICE-REPLACEMENT/i }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /manage earning SERVICE-1/i }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Refund adjustments" })).getByRole("button", {
        name: "Manage conversion JOB-REPLACEMENT",
      }),
    ).toBeVisible();
    await waitFor(() => {
      expect(reads.count).toBe(2);
    });
  });

  it.each([
    {
      mode: "lifecycle" as const,
      title: "Attributed work",
      headingId: "conversions-title",
      description: "Complete, cancel, or record a no-show before commission becomes claimable.",
    },
    {
      mode: "refund" as const,
      title: "Refund adjustments",
      headingId: "refunds-title",
      description: "Adjust settled source work without rewriting the original commission history.",
    },
  ])(
    "labels the $mode section with its own heading and approved description",
    ({ mode, title, headingId, description }) => {
      render(
        <ConversionControls conversions={[]} mode={mode} onChanged={vi.fn()} onNotice={vi.fn()} />,
      );
      const section = screen.getByRole("region", { name: title });
      expect(section).toHaveAttribute("aria-labelledby", headingId);
      expect(within(section).getByRole("heading", { name: title, level: 2 })).toHaveAttribute(
        "id",
        headingId,
      );
      expect(within(section).getByText(description)).toBeVisible();
    },
  );

  it("excludes unfinished records from the refund queue", () => {
    render(
      <ConversionControls
        conversions={[conversion]}
        mode="refund"
        onChanged={vi.fn()}
        onNotice={vi.fn()}
      />,
    );
    expect(screen.getByText("No refundable conversion records are available.")).toBeVisible();
    expect(screen.queryByText("JOB-1042")).not.toBeInTheDocument();
  });

  it("rejects hook usage outside the provider", () => {
    expect(() => render(<RefreshRecords />)).toThrow(/useOwnerWorkspace.*OwnerWorkspaceProvider/);
  });

  it("rejects a non-owner outer workspace", () => {
    outerWorkspace = { ...outerWorkspace, role: "partner" } as DemoWorkspace;
    expect(() =>
      render(
        <OwnerWorkspaceProvider>
          <OwnerWorkboardPage />
        </OwnerWorkspaceProvider>,
      ),
    ).toThrow(/owner workspace/i);
  });

  it("shows loading and retries an unavailable initial overview", async () => {
    installOverview(defaultState());
    server.use(http.get("*/api/earnings", () => HttpResponse.json({}, { status: 503 })));
    renderOwner(<OwnerWorkboardPage />);
    expect(screen.getByText("Loading the owner workboard…")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Owner workboard unavailable");
    installOverview(defaultState());
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh owner records" }));
    expect(await screen.findByRole("heading", { name: "Owner workboard" })).toBeVisible();
  });
  it("loads six operational totals and explains rule priority and no-rule exceptions", async () => {
    installOverview(defaultState());
    const view = renderOwner(<OwnerWorkboardPage />);

    expect(await screen.findByRole("heading", { name: "Owner workboard" })).toBeVisible();
    const metrics = screen.getByRole("region", { name: "Commission totals" });
    expect(within(metrics).getByText("Attributed")).toBeVisible();
    expect(within(metrics).getByText("Pending")).toBeVisible();
    expect(within(metrics).getByText("Eligible")).toBeVisible();
    expect(within(metrics).getByText("Held")).toBeVisible();
    expect(within(metrics).getByText("Settled")).toBeVisible();
    expect(within(metrics).getByText("Reversed")).toBeVisible();
    view.showPage(<OwnerProgramsPage />);
    expect(screen.getByText(/category rule wins before the program fallback/i)).toBeVisible();
    view.showPage(<OwnerEarningsPage />);
    expect(screen.getByText(/No matching rule\. Add a category or fallback rule/i)).toBeVisible();
    expect(screen.getByRole("table", { name: /earnings work queue/i })).toBeVisible();
  });

  it("applies a hold, shows its reason, and revalidates earnings", async () => {
    const user = userEvent.setup();
    const state = defaultState();
    const reads = { count: 0 };
    installOverview(state, reads);
    server.use(
      http.post("*/api/earnings/:id/hold", async ({ request }) => {
        const input = reasonInput.parse(await request.json());
        const held = earningViewSchema.parse({
          ...earning,
          status: "held",
          statusExplanation: "Held pending review.",
          holds: [
            {
              id: "44444444-4444-4444-8444-000000000001",
              organizationId: ids.organization,
              earningId: ids.earning,
              previousStatus: "eligible",
              reason: input.reason,
              placedBy: ids.owner,
              releasedBy: null,
              placedAt: timestamp,
              releasedAt: null,
            },
          ],
        });
        state.earnings = [held, noRuleEarning];
        return HttpResponse.json(held);
      }),
    );
    renderOwner();

    await user.click(await screen.findByRole("button", { name: /manage earning.*SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Place hold" }));
    await user.type(screen.getByLabelText("Reason"), "Manual review");
    await user.click(screen.getByRole("button", { name: /^place hold$/i }));

    expect(await screen.findByText("Held pending review.")).toBeVisible();
    expect(screen.getByText(/Manual review/)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(/earning placed on hold/i);
    expect(reads.count).toBeGreaterThan(1);
  });

  it("rolls back on a safe domain error and leaves the visible record eligible", async () => {
    const user = userEvent.setup();
    installOverview(defaultState());
    server.use(
      http.post("*/api/earnings/:id/hold", () =>
        HttpResponse.json({ status: "earning_not_holdable" }, { status: 409 }),
      ),
    );
    renderOwner();

    await user.click(await screen.findByRole("button", { name: /manage earning.*SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Place hold" }));
    await user.type(screen.getByLabelText("Reason"), "Manual review");
    await user.click(screen.getByRole("button", { name: /^place hold$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/earning not holdable/i);
    expect(screen.getAllByText("Eligible").length).toBeGreaterThan(0);
    expect(screen.queryByText("Held pending review.")).not.toBeInTheDocument();
  });

  it("disables only the submitted action while its request is pending", async () => {
    const user = userEvent.setup();
    installOverview(defaultState());
    let releaseRequest: (() => void) | undefined;
    server.use(
      http.post("*/api/earnings/:id/hold", async () => {
        await new Promise<void>((resolve) => {
          releaseRequest = resolve;
        });
        return HttpResponse.json(earning);
      }),
    );
    renderOwner();

    await user.click(await screen.findByRole("button", { name: /manage earning SERVICE-1/i }));
    await user.type(screen.getByLabelText("Reason"), "Manual review");
    await user.click(screen.getByRole("button", { name: "Place hold" }));

    const pendingButton = screen.getByRole("button", { name: "Place hold" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveTextContent("Place hold…");
    expect(screen.getByRole("button", { name: "Void earning" })).toBeEnabled();
    releaseRequest?.();
    expect(await screen.findByText(/earning placed on hold/i)).toBeVisible();
  });

  it("guards competing action-sheet activations before React pending state commits", async () => {
    const user = userEvent.setup();
    let releaseRequest: (() => void) | undefined;
    const actions: string[] = [];
    render(
      <ActionSheet
        title="Manage earning"
        triggerLabel="Manage earning SERVICE-1"
        actions={[
          { id: "hold", label: "Place hold", description: "Review the earning." },
          { id: "void", label: "Void earning", description: "Remove the earning." },
        ]}
        onAction={async (action) => {
          actions.push(action);
          await new Promise<void>((resolve) => {
            releaseRequest = resolve;
          });
          return true;
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /manage earning SERVICE-1/i }));
    const hold = screen.getByRole("button", { name: "Place hold" });
    const voidEarning = screen.getByRole("button", { name: "Void earning" });
    act(() => {
      hold.click();
      voidEarning.click();
    });

    expect(actions).toEqual(["hold"]);
    expect(hold).toBeDisabled();
    expect(voidEarning).toBeEnabled();
    releaseRequest?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /manage earning SERVICE-1/i })).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
  });

  it("pauses the program and suspends the partner with confirmation reasons", async () => {
    const user = userEvent.setup();
    const state = defaultState();
    installOverview(state);
    server.use(
      http.post("*/api/programs/:id/pause", async ({ request }) => {
        reasonInput.parse(await request.json());
        state.program = programSchema.parse({ ...state.program, status: "paused" });
        return HttpResponse.json(state.program);
      }),
      http.post("*/api/partners/:id/suspend", async ({ request }) => {
        reasonInput.parse(await request.json());
        state.partner = partnerDetailSchema.parse({ ...state.partner, status: "suspended" });
        return HttpResponse.json(state.partner);
      }),
    );
    const view = renderOwner(<OwnerProgramsPage />);

    await user.click(await screen.findByRole("button", { name: /manage Neighbor Rewards/i }));
    await user.type(screen.getByLabelText("Reason"), "Seasonal pause");
    await user.click(screen.getByRole("button", { name: "Pause program" }));
    expect(await screen.findByText(/Neighbor Rewards is now paused/i)).toBeVisible();

    view.showPage(<OwnerPartnersPage />);
    await user.click(screen.getByRole("button", { name: /manage Jamie Rivera/i }));
    await user.type(screen.getByLabelText("Reason"), "Partner requested a review");
    await user.click(screen.getByRole("button", { name: "Suspend partner" }));
    expect(await screen.findByText(/Jamie Rivera is now suspended/i)).toBeVisible();
  });

  it("runs a conversion completion and claim settlement simulation through real routes", async () => {
    const user = userEvent.setup();
    const state = defaultState();
    const reads = { count: 0 };
    installOverview(state, reads);
    server.use(
      http.post("*/api/conversions/:id/complete", ({ request }) => {
        expect(request.headers.get("Idempotency-Key")).toBeTruthy();
        return HttpResponse.json(conversionSchema.parse({ ...conversion, status: "completed" }));
      }),
      http.post("*/api/claims/:id/simulate-success", () => {
        state.claims = [ownerClaimSchema.parse({ ...claim, status: "settled" })];
        return HttpResponse.json(state.claims[0]);
      }),
    );
    const scheduled = conversionSchema.parse({ ...conversion, status: "scheduled" });
    const view = renderOwner(<OwnerProgramsPage />, [scheduled]);

    await user.click(await screen.findByRole("button", { name: /manage conversion JOB-1042/i }));
    expect(screen.getByRole("button", { name: "Cancel service" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Mark no-show" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Complete service" }));
    expect(await screen.findByText(/JOB-1042 marked completed/i)).toBeVisible();

    const readsBeforeNavigation = reads.count;
    view.showPage(<OwnerEarningsPage />);
    const refunds = screen.getByRole("region", { name: "Refund adjustments" });
    expect(
      within(refunds).getByRole("button", { name: "Manage conversion JOB-1042" }),
    ).toBeVisible();
    expect(within(refunds).getByText("Completed")).toBeVisible();
    expect(reads.count).toBe(readsBeforeNavigation);
    await user.click(screen.getByRole("button", { name: /manage claim/i }));
    expect(screen.getByRole("button", { name: "Simulate failure" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Simulate success" }));
    expect(await screen.findByText(/claim settlement simulated/i)).toBeVisible();
  });

  it("explains that attributed work awaits scheduling instead of offering invalid actions", async () => {
    installOverview(defaultState());
    renderOwner(<OwnerProgramsPage />);

    expect(await screen.findByText(/awaits scheduling before service actions/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /manage conversion JOB-1042/i }),
    ).not.toBeInTheDocument();
  });

  it("shows authoritative partner balances and settled claims", async () => {
    installOverview({
      ...defaultState(),
      claims: [ownerClaimSchema.parse({ ...claim, status: "settled" })],
    });
    renderOwner(<OwnerPartnersPage />, []);

    expect(await screen.findByText("Available balance")).toBeVisible();
    expect(screen.getByText("Held balance")).toBeVisible();
    expect(screen.getByText("Settled claims")).toBeVisible();
    expect(screen.getAllByText("$25.00").length).toBeGreaterThan(0);
  });

  it("retries a failed claim through the real retry route", async () => {
    const user = userEvent.setup();
    const state = {
      ...defaultState(),
      claims: [ownerClaimSchema.parse({ ...claim, status: "failed" })],
    };
    installOverview(state);
    let retryKey = "";
    server.use(
      http.post("*/api/claims/:id/retry", ({ request }) => {
        retryKey = request.headers.get("Idempotency-Key") ?? "";
        state.claims = [ownerClaimSchema.parse({ ...claim, status: "created" })];
        return HttpResponse.json(state.claims[0]);
      }),
    );
    renderOwner(<OwnerEarningsPage />, []);

    await user.click(await screen.findByRole("button", { name: /retry claim/i }));
    expect(await screen.findByText(/claim payout queued for retry/i)).toBeVisible();
    expect(retryKey).toBeTruthy();
  });

  it("keeps retry pending state isolated to each failed claim", async () => {
    const user = userEvent.setup();
    const secondClaim = ownerClaimSchema.parse({
      ...claim,
      id: "44444444-4444-4444-8444-000000000002",
      idempotencyKey: "claim-demo-key-two",
      status: "failed",
    });
    const firstClaim = ownerClaimSchema.parse({ ...claim, status: "failed" });
    installOverview({ ...defaultState(), claims: [firstClaim, secondClaim] });
    const releases = new Map<string, () => void>();
    server.use(
      http.post("*/api/claims/:id/retry", async ({ params }) => {
        const id = String(params.id);
        await new Promise<void>((resolve) => releases.set(id, resolve));
        const source = id === firstClaim.id ? firstClaim : secondClaim;
        return HttpResponse.json(ownerClaimSchema.parse({ ...source, status: "created" }));
      }),
    );
    renderOwner(<OwnerEarningsPage />, []);

    const firstButton = await screen.findByRole("button", {
      name: `Retry claim ${firstClaim.id.slice(0, 8)}`,
    });
    const secondButton = screen.getByRole("button", {
      name: `Retry claim ${secondClaim.id.slice(0, 8)}`,
    });
    await user.click(firstButton);

    expect(firstButton).toBeDisabled();
    expect(firstButton).toHaveTextContent("Retry payout…");
    expect(secondButton).toBeEnabled();

    await user.click(secondButton);
    expect(secondButton).toBeDisabled();
    expect(releases.has(firstClaim.id)).toBe(true);
    expect(releases.has(secondClaim.id)).toBe(true);
    releases.get(firstClaim.id)?.();
    releases.get(secondClaim.id)?.();
    await waitFor(() => {
      expect(firstButton).toBeEnabled();
      expect(secondButton).toBeEnabled();
    });
  });

  it("submits only selected refund items using cumulative exact minor units", async () => {
    const user = userEvent.setup();
    installOverview(defaultState());
    const completed = conversionSchema.parse({
      ...conversion,
      status: "partially_refunded",
      items: conversion.items.map((item) => ({
        ...item,
        refundedBase: { ...item.refundedBase, amountMinor: "1000" },
      })),
    });
    let refundBody: unknown;
    server.use(
      http.post("*/api/conversions/:id/refund", async ({ request }) => {
        refundBody = await request.json();
        return HttpResponse.json(
          conversionSchema.parse({
            ...completed,
            status: "partially_refunded",
            items: completed.items.map((item) => ({
              ...item,
              refundedBase: { ...item.refundedBase, amountMinor: "3550" },
            })),
          }),
        );
      }),
    );
    renderOwner(<OwnerEarningsPage />, [completed]);

    await user.click(await screen.findByRole("button", { name: /manage conversion JOB-1042/i }));
    await user.click(screen.getByRole("checkbox", { name: /refund plumbing SERVICE-1/i }));
    await user.type(screen.getByLabelText(/refund amount for SERVICE-1/i), "25.50");
    await user.type(screen.getByLabelText("Refund reason"), "Customer adjustment");
    await user.click(screen.getByRole("button", { name: "Submit refund" }));

    expect(await screen.findByText(/marked partially refunded/i)).toBeVisible();
    expect(refundBody).toEqual({
      reason: "Customer adjustment",
      items: [{ conversionItemId: ids.item, refundedBaseMinor: "3550" }],
    });
  });

  it("guards rapid refund submits and clears the successful draft before reopening", async () => {
    const user = userEvent.setup();
    installOverview(defaultState());
    const completed = conversionSchema.parse({ ...conversion, status: "completed" });
    let requests = 0;
    let releaseRequest: (() => void) | undefined;
    server.use(
      http.post("*/api/conversions/:id/refund", async () => {
        requests += 1;
        await new Promise<void>((resolve) => {
          releaseRequest = resolve;
        });
        return HttpResponse.json(
          conversionSchema.parse({ ...completed, status: "partially_refunded" }),
        );
      }),
    );
    renderOwner(<OwnerEarningsPage />, [completed]);

    await user.click(await screen.findByRole("button", { name: /manage conversion JOB-1042/i }));
    const selected = screen.getByRole("checkbox", { name: /refund plumbing SERVICE-1/i });
    await user.click(selected);
    const amount = screen.getByLabelText(/refund amount for SERVICE-1/i);
    const reason = screen.getByLabelText("Refund reason");
    expect(reason).toHaveAttribute("minlength", "3");
    expect(reason).toHaveAttribute("maxlength", "240");
    await user.type(amount, "10.00");
    await user.type(reason, "Customer adjustment");
    const submit = screen.getByRole("button", { name: "Submit refund" });
    act(() => {
      submit.click();
      submit.click();
    });

    await waitFor(() => {
      expect(requests).toBe(1);
    });
    releaseRequest?.();
    expect(await screen.findByText(/marked partially refunded/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /manage conversion JOB-1042/i }));
    expect(screen.getByRole("checkbox", { name: /refund plumbing SERVICE-1/i })).not.toBeChecked();
    expect(screen.getByLabelText(/refund amount for SERVICE-1/i)).toHaveValue("");
    expect(screen.getByLabelText(/refund amount for SERVICE-1/i)).toBeDisabled();
    expect(screen.getByLabelText("Refund reason")).toHaveValue("");
  });

  it("summarizes invalid refund input without exposing parser diagnostics", async () => {
    const user = userEvent.setup();
    installOverview(defaultState());
    const completed = conversionSchema.parse({ ...conversion, status: "completed" });
    let requested = false;
    server.use(
      http.post("*/api/conversions/:id/refund", () => {
        requested = true;
        return HttpResponse.json(completed);
      }),
    );
    renderOwner(<OwnerEarningsPage />, [completed]);

    await user.click(await screen.findByRole("button", { name: /manage conversion JOB-1042/i }));
    await user.click(screen.getByRole("checkbox", { name: /refund plumbing SERVICE-1/i }));
    await user.type(screen.getByLabelText(/refund amount for SERVICE-1/i), "1.001");
    await user.type(screen.getByLabelText("Refund reason"), "Customer adjustment");
    await user.click(screen.getByRole("button", { name: "Submit refund" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a positive refund amount using the currency's normal decimal places.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/type|zod|invalid/i);
    expect(requested).toBe(false);
  });

  it("does not mislabel an invalid API response as a refund amount error", async () => {
    const user = userEvent.setup();
    installOverview(defaultState());
    const completed = conversionSchema.parse({ ...conversion, status: "completed" });
    server.use(
      http.post("*/api/conversions/:id/refund", () =>
        HttpResponse.json({ status: "malformed_success" }),
      ),
    );
    renderOwner(<OwnerEarningsPage />, [completed]);

    await user.click(await screen.findByRole("button", { name: /manage conversion JOB-1042/i }));
    await user.click(screen.getByRole("checkbox", { name: /refund plumbing SERVICE-1/i }));
    await user.type(screen.getByLabelText(/refund amount for SERVICE-1/i), "10.00");
    await user.type(screen.getByLabelText("Refund reason"), "Customer adjustment");
    await user.click(screen.getByRole("button", { name: "Submit refund" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check the selected items, refund amounts, and reason.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/decimal places/i);
  });

  it("keeps the last successful overview and reports stale data when revalidation fails", async () => {
    const user = userEvent.setup();
    const state = defaultState();
    installOverview(state);
    let earningReads = 0;
    server.use(
      http.get("*/api/earnings", () => {
        earningReads += 1;
        return earningReads === 1
          ? HttpResponse.json(earningListSchema.parse({ items: state.earnings }))
          : HttpResponse.json({ status: "refresh_unavailable" }, { status: 503 });
      }),
      http.post("*/api/earnings/:id/hold", () => HttpResponse.json(earning)),
    );
    renderOwner();

    await user.click(await screen.findByRole("button", { name: /manage earning SERVICE-1/i }));
    await user.type(screen.getByLabelText("Reason"), "Manual review");
    await user.click(screen.getByRole("button", { name: "Place hold" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/earning placed on hold/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/showing the last successful records/i);
    expect(screen.getByRole("heading", { name: "Earnings and settlement" })).toBeVisible();
    expect(screen.getAllByText("Eligible").length).toBeGreaterThan(0);
  });

  it("ignores an older overlapping overview response after a newer refresh succeeds", async () => {
    const user = userEvent.setup();
    const firstClaim = ownerClaimSchema.parse({ ...claim, status: "failed" });
    const secondClaim = ownerClaimSchema.parse({
      ...claim,
      id: "44444444-4444-4444-8444-000000000002",
      idempotencyKey: "claim-demo-key-two",
      status: "failed",
    });
    const state = { ...defaultState(), claims: [firstClaim, secondClaim] };
    installOverview(state);
    const oldEarning = earningViewSchema.parse({
      ...earning,
      statusExplanation: "Older refresh record.",
    });
    const newestEarning = earningViewSchema.parse({
      ...earning,
      status: "held",
      statusExplanation: "Newest refresh record.",
    });
    let earningReads = 0;
    let releaseOlder: (() => void) | undefined;
    server.use(
      http.get("*/api/earnings", async () => {
        earningReads += 1;
        const read = earningReads;
        if (read === 2)
          await new Promise<void>((resolve) => {
            releaseOlder = resolve;
          });
        const items = read === 1 ? state.earnings : read === 2 ? [oldEarning] : [newestEarning];
        return HttpResponse.json(earningListSchema.parse({ items }));
      }),
      http.post("*/api/claims/:id/retry", ({ params }) => {
        const source = String(params.id) === firstClaim.id ? firstClaim : secondClaim;
        return HttpResponse.json(ownerClaimSchema.parse({ ...source, status: "created" }));
      }),
    );
    renderOwner(<OwnerEarningsPage />, []);

    const firstRetry = await screen.findByRole("button", {
      name: `Retry claim ${firstClaim.id.slice(0, 8)}`,
    });
    await user.click(firstRetry);
    await waitFor(() => {
      expect(releaseOlder).toBeTypeOf("function");
    });
    await user.click(
      screen.getByRole("button", { name: `Retry claim ${secondClaim.id.slice(0, 8)}` }),
    );
    expect(await screen.findByText("Newest refresh record.")).toBeVisible();
    releaseOlder?.();
    await waitFor(() => {
      expect(firstRetry).toBeEnabled();
    });
    expect(screen.queryByText("Older refresh record.")).not.toBeInTheDocument();
    expect(screen.getByText("Newest refresh record.")).toBeVisible();
  });

  it("blocks a partial refund that exceeds the item's remaining refundable base", async () => {
    const user = userEvent.setup();
    installOverview(defaultState());
    const completed = conversionSchema.parse({ ...conversion, status: "completed" });
    let requested = false;
    server.use(
      http.post("*/api/conversions/:id/refund", () => {
        requested = true;
        return HttpResponse.json(completed);
      }),
    );
    renderOwner(<OwnerEarningsPage />, [completed]);

    await user.click(await screen.findByRole("button", { name: /manage conversion JOB-1042/i }));
    await user.click(screen.getByRole("checkbox", { name: /refund plumbing SERVICE-1/i }));
    await user.type(screen.getByLabelText(/refund amount for SERVICE-1/i), "100.01");
    await user.type(screen.getByLabelText("Refund reason"), "Customer adjustment");
    await user.click(screen.getByRole("button", { name: "Submit refund" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/exceeds the remaining item value/i);
    expect(requested).toBe(false);
  });

  it("offers release, void, resume, reactivate, and refund recovery paths", async () => {
    const user = userEvent.setup();
    const held = earningViewSchema.parse({
      ...earning,
      status: "held",
      statusExplanation: "Held pending review.",
      holds: [
        {
          id: "44444444-4444-4444-8444-000000000001",
          organizationId: ids.organization,
          earningId: ids.earning,
          previousStatus: "eligible",
          reason: "Manual review",
          placedBy: ids.owner,
          releasedBy: null,
          placedAt: timestamp,
          releasedAt: null,
        },
      ],
    });
    installOverview({
      program: programSchema.parse({ ...program, status: "paused" }),
      partner: partnerDetailSchema.parse({ ...partnerDetail, status: "suspended" }),
      earnings: [held],
      claims: [],
    });
    const view = renderOwner(<OwnerEarningsPage />, [
      conversionSchema.parse({ ...conversion, status: "completed" }),
    ]);

    await user.click(await screen.findByRole("button", { name: /manage earning SERVICE-1/i }));
    expect(screen.getByRole("button", { name: "Release hold" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Void earning" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close earning SERVICE-1/i }));

    view.showPage(<OwnerProgramsPage />);
    await user.click(screen.getByRole("button", { name: /manage Neighbor Rewards/i }));
    expect(screen.getByRole("button", { name: "Resume program" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close Neighbor Rewards controls/i }));

    view.showPage(<OwnerPartnersPage />);
    await user.click(screen.getByRole("button", { name: /manage Jamie Rivera/i }));
    expect(screen.getByRole("button", { name: "Reactivate partner" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close Jamie Rivera controls/i }));

    view.showPage(<OwnerEarningsPage />);
    await user.click(screen.getByRole("button", { name: /manage conversion JOB-1042/i }));
    expect(screen.getByRole("button", { name: "Submit refund" })).toBeVisible();
  });

  it("renders supplied audit history separately from local operation explanations", async () => {
    installOverview(defaultState());
    const auditEvent = auditEventSchema.parse({
      id: "77777777-7777-4777-8777-000000000001",
      organizationId: ids.organization,
      eventKey: "earning.held:test",
      actorId: ids.owner,
      isSystemEvent: false,
      action: "earning.held",
      reason: "Manual review",
      aggregateType: "earning",
      aggregateId: ids.earning,
      metadata: {},
      createdAt: timestamp,
    });
    renderOwner(<OwnerEarningsPage />, [conversion], [auditEvent]);

    expect(await screen.findByText("Server-observed audit history")).toBeVisible();
    expect(screen.getByText("Manual review")).toBeVisible();
    expect(screen.getByText(/local confirmations below are interface feedback/i)).toBeVisible();
  });
});
