// @vitest-environment jsdom

import {
  claimSchema,
  claimListSchema,
  earningListSchema,
  earningViewSchema,
  ledgerEntrySchema,
  partnerDetailSchema,
} from "@referral-sandbox/contracts";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoWorkspace } from "@referral-sandbox/contracts";
import type { ReactNode } from "react";

import { server } from "../../test/setup.js";
import "../../test/setup.js";
import { PartnerWorkspaceProvider, usePartnerWorkspace } from "./partner-workspace-provider.js";
import { PartnerWorkboardPage } from "./pages/partner-workboard-page.js";
import { PartnerReferralsPage } from "./pages/partner-referrals-page.js";
import { PartnerEarningsPage } from "./pages/partner-earnings-page.js";
import { PartnerClaimsPage } from "./pages/partner-claims-page.js";
import type { PublicReferral } from "./referral-code-card.js";
import type { LedgerEntry } from "@referral-sandbox/contracts";

vi.mock("../sandbox/sandbox-workspace-provider", () => ({
  useSandboxWorkspace: () => ({ workspace: outerWorkspace }),
}));
let outerWorkspace: DemoWorkspace;

function PartnerTestWorkspace({
  partnerId: id,
  referral,
  ledgerEntries,
  children = <PartnerWorkboardPage />,
}: {
  partnerId: string;
  referral: PublicReferral;
  ledgerEntries: LedgerEntry[];
  children?: ReactNode;
}) {
  outerWorkspace = {
    role: "partner",
    organizationId: detail.organizationId,
    sandboxVersion: 1,
    partnerId: id,
    referral,
    ledgerEntries,
  };
  return <PartnerWorkspaceProvider>{children}</PartnerWorkspaceProvider>;
}

const partnerId = "11111111-1111-4111-8111-000000000005";
const timestamp = "2026-09-16T05:00:00.000Z";
const eligible = earningViewSchema.parse({
  id: "11111111-1111-4111-8111-000000000024",
  organizationId: "11111111-1111-4111-8111-000000000001",
  conversionItemId: "11111111-1111-4111-8111-000000000019",
  programId: "11111111-1111-4111-8111-000000000007",
  partnerId,
  ruleId: null,
  amount: { amountMinor: "2500", currency: "USD" },
  reversedAmount: { amountMinor: "0", currency: "USD" },
  status: "eligible",
  statusExplanation: "Available to claim",
  ruleSnapshot: { type: "flat", category: "plumbing", externalRef: "SERVICE-1" },
  holds: [],
  createdAt: timestamp,
  updatedAt: timestamp,
});
const pending = earningViewSchema.parse({
  ...eligible,
  id: "11111111-1111-4111-8111-000000000025",
  conversionItemId: "11111111-1111-4111-8111-000000000020",
  status: "pending",
  amount: { amountMinor: "1250", currency: "USD" },
  statusExplanation: "Waiting for conversion completion",
});
const detail = partnerDetailSchema.parse({
  id: partnerId,
  organizationId: "11111111-1111-4111-8111-000000000001",
  userId: "11111111-1111-4111-8111-000000000003",
  displayName: "Jamie Cruz",
  email: "jamie@example.invalid",
  phoneE164: "+12025550101",
  status: "active",
  balances: [{ currency: "USD", ledgerMinor: "4000", eligibleMinor: "2500", heldMinor: "500" }],
  createdAt: timestamp,
  updatedAt: timestamp,
});
const secondPartnerId = "11111111-1111-4111-8111-000000000006";
const secondDetail = partnerDetailSchema.parse({
  ...detail,
  id: secondPartnerId,
  userId: "11111111-1111-4111-8111-000000000004",
  displayName: "Alex Santos",
});

beforeEach(() => {
  outerWorkspace = {
    role: "partner",
    organizationId: detail.organizationId,
    sandboxVersion: 1,
    partnerId,
    referral: { code: "JAMIE12", publicUrl: "https://referrals.example.invalid/r/JAMIE12" },
    ledgerEntries: [],
  };
});

function RefreshRecords() {
  const { refresh } = usePartnerWorkspace();
  return <button onClick={() => void refresh()}>Refresh records</button>;
}

function overviewHandlers(earnings = [eligible, pending], partner = detail) {
  return [
    http.get("*/api/partners/:id", () => HttpResponse.json(partner)),
    http.get("*/api/earnings", () =>
      HttpResponse.json(earningListSchema.parse({ items: earnings })),
    ),
    http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
  ];
}

describe("PartnerWorkspaceProvider", () => {
  it("persists the overview across sibling pages and allocates controls to their routes", async () => {
    let reads = 0;
    server.use(...overviewHandlers());
    server.use(
      http.get("*/api/partners/:id", () => {
        reads += 1;
        return HttpResponse.json(detail);
      }),
    );
    const view = render(
      <PartnerWorkspaceProvider>
        <PartnerWorkboardPage />
      </PartnerWorkspaceProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Partner workboard · Jamie" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open referral pass" })).toHaveAttribute(
      "href",
      "/partner/referrals",
    );
    expect(screen.getByRole("link", { name: "Open claim controls" })).toHaveAttribute(
      "href",
      "/partner/claims",
    );
    expect(screen.queryByRole("button", { name: "Copy referral link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Available earnings" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Claims and adjustments" }),
    ).not.toBeInTheDocument();

    view.rerender(
      <PartnerWorkspaceProvider>
        <PartnerReferralsPage />
      </PartnerWorkspaceProvider>,
    );
    expect(screen.getByRole("heading", { name: "Referrals" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy referral link" })).toBeVisible();
    expect(
      screen.getByText(
        "The same attribution point can represent a service booking, retail order, attended appointment, or first subscription invoice.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    view.rerender(
      <PartnerWorkspaceProvider>
        <PartnerEarningsPage />
      </PartnerWorkspaceProvider>,
    );
    expect(screen.getByRole("heading", { name: "Earnings" })).toBeVisible();
    expect(screen.getAllByRole("article", { name: "Earning 11111111" })).toHaveLength(2);
    expect(screen.getByText("Available to claim")).toBeVisible();
    expect(screen.getByText("Waiting for conversion completion")).toBeVisible();
    expect(screen.getByRole("link", { name: "Start a claim" })).toHaveAttribute(
      "href",
      "/partner/claims",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy referral link" })).not.toBeInTheDocument();

    view.rerender(
      <PartnerWorkspaceProvider>
        <PartnerClaimsPage />
      </PartnerWorkspaceProvider>,
    );
    expect(screen.getByRole("heading", { name: "Claims" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Available earnings" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Claims and adjustments" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy referral link" })).not.toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
    expect(reads).toBe(1);
  });

  it("shows empty earnings and no claim link when projected availability is zero", async () => {
    server.use(...overviewHandlers([], { ...detail, balances: [] }));
    render(
      <PartnerWorkspaceProvider>
        <PartnerEarningsPage />
      </PartnerWorkspaceProvider>,
    );
    expect(
      await screen.findByText("Create the guided referral to see earning states here."),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Start a claim" })).not.toBeInTheDocument();
  });

  it("reloads earnings when the guide publishes a new referral workspace", async () => {
    let earnings = [eligible];
    let reads = 0;
    server.use(...overviewHandlers());
    server.use(
      http.get("*/api/earnings", () => {
        reads += 1;
        return HttpResponse.json(earningListSchema.parse({ items: earnings }));
      }),
    );
    const view = render(
      <PartnerWorkspaceProvider>
        <PartnerReferralsPage />
      </PartnerWorkspaceProvider>,
    );
    await screen.findByRole("heading", { name: "Referrals" });
    expect(reads).toBe(1);

    earnings = [eligible, { ...pending, statusExplanation: "Guide referral awaits completion." }];
    outerWorkspace = { ...outerWorkspace };
    view.rerender(
      <PartnerWorkspaceProvider>
        <PartnerReferralsPage />
      </PartnerWorkspaceProvider>,
    );
    view.rerender(
      <PartnerWorkspaceProvider>
        <PartnerEarningsPage />
      </PartnerWorkspaceProvider>,
    );

    expect(await screen.findByText("Guide referral awaits completion.")).toBeVisible();
    expect(screen.getAllByRole("article", { name: "Earning 11111111" })).toHaveLength(2);
    expect(reads).toBe(2);
  });

  it.each([undefined, null, 42, { unexpected: "object" }])(
    "uses a safe category fallback for %j and hides the claim link when debt consumes eligibility",
    async (category) => {
      server.use(
        ...overviewHandlers([{ ...eligible, ruleSnapshot: { category } }], {
          ...detail,
          balances: [
            { currency: "USD", ledgerMinor: "-2500", eligibleMinor: "2500", heldMinor: "0" },
          ],
        }),
      );
      render(
        <PartnerWorkspaceProvider>
          <PartnerEarningsPage />
        </PartnerWorkspaceProvider>,
      );
      expect(await screen.findByText("General service")).toBeVisible();
      expect(screen.queryByRole("link", { name: "Start a claim" })).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("retries the initial error boundary and restores a ready page", async () => {
    server.use(...overviewHandlers());
    server.use(http.get("*/api/partners/:id", () => HttpResponse.json({}, { status: 503 })));
    render(
      <PartnerWorkspaceProvider>
        <PartnerWorkboardPage />
      </PartnerWorkspaceProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Partner workboard unavailable" }),
    ).toBeVisible();
    server.use(...overviewHandlers());
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Partner workboard · Jamie" })).toBeVisible();
  });

  it("keeps a stale notice visible when navigating between every partner page", async () => {
    server.use(...overviewHandlers());
    const view = render(
      <PartnerWorkspaceProvider>
        <RefreshRecords />
        <PartnerWorkboardPage />
      </PartnerWorkspaceProvider>,
    );
    await screen.findByRole("heading", { name: "Partner workboard · Jamie" });
    server.use(http.get("*/api/partners/:id", () => HttpResponse.json({}, { status: 503 })));
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh records" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Refresh unavailable. Showing the last successful records.",
    );
    for (const page of [
      <PartnerReferralsPage key="referrals" />,
      <PartnerEarningsPage key="earnings" />,
      <PartnerClaimsPage key="claims" />,
    ]) {
      view.rerender(<PartnerWorkspaceProvider>{page}</PartnerWorkspaceProvider>);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Refresh unavailable. Showing the last successful records.",
      );
    }
  });

  it("clearly rejects hooks outside the provider and owner workspaces", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<RefreshRecords />)).toThrow(
        "usePartnerWorkspace must be used inside PartnerWorkspaceProvider",
      );
      outerWorkspace = {
        role: "owner",
        organizationId: detail.organizationId,
        sandboxVersion: 1,
        conversions: [],
        auditEvents: [],
      };
      expect(() =>
        render(
          <PartnerWorkspaceProvider>
            <PartnerWorkboardPage />
          </PartnerWorkspaceProvider>,
        ),
      ).toThrow("PartnerWorkspaceProvider requires a partner workspace");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("renders the conservative estimate warning for an unreconciled open claim", async () => {
    server.use(...overviewHandlers());
    server.use(
      http.get("*/api/claims", () =>
        HttpResponse.json(
          claimListSchema.parse({
            items: [
              claimSchema.parse({
                id: "33333333-3333-4333-8333-000000000010",
                organizationId: detail.organizationId,
                partnerId,
                actorId: detail.userId,
                amount: { amountMinor: "500", currency: "USD" },
                status: "created",
                idempotencyKey: "empty-claim",
                selectionHash: "empty",
                items: [],
                createdAt: timestamp,
                updatedAt: timestamp,
              }),
            ],
          }),
        ),
      ),
    );
    render(
      <PartnerWorkspaceProvider>
        <PartnerWorkboardPage />
      </PartnerWorkspaceProvider>,
    );
    expect(await screen.findByText(/estimate is conservative/i)).toHaveAttribute("role", "status");
  });

  it("never exposes a loaded prior overview to consumers when the partner id changes", async () => {
    const exposures: { workspaceId: string; overviewId: string }[] = [];
    function Observer() {
      const { overview } = usePartnerWorkspace();
      if (outerWorkspace.role === "partner") {
        exposures.push({ workspaceId: outerWorkspace.partnerId, overviewId: overview.partner.id });
      }
      return <PartnerWorkboardPage />;
    }
    server.use(...overviewHandlers());
    const view = render(
      <PartnerWorkspaceProvider>
        <Observer />
      </PartnerWorkspaceProvider>,
    );
    await screen.findByRole("heading", { name: "Partner workboard · Jamie" });
    let release: (() => void) | undefined;
    server.use(
      http.get("*/api/partners/:id", async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json(secondDetail);
      }),
    );
    if (outerWorkspace.role !== "partner") throw new Error("Expected a partner fixture");
    outerWorkspace = { ...outerWorkspace, partnerId: secondPartnerId };
    view.rerender(
      <PartnerWorkspaceProvider>
        <Observer />
      </PartnerWorkspaceProvider>,
    );
    expect(screen.getByText(/loading the partner workboard/i)).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Partner workboard · Jamie" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(release).toBeDefined();
    });
    await act(async () => {
      release?.();
      await Promise.resolve();
    });
    await screen.findByRole("heading", { name: "Partner workboard · Alex" });
    expect(exposures.every(({ workspaceId, overviewId }) => workspaceId === overviewId)).toBe(true);
  });
  it("loads scoped partner detail, earnings, and claims from their real routes", async () => {
    const reads: string[] = [];
    server.use(
      http.get("*/api/partners/:id", ({ params }) => {
        reads.push(`partner:${String(params.id)}`);
        return HttpResponse.json(detail);
      }),
      http.get("*/api/earnings", () => {
        reads.push("earnings");
        return HttpResponse.json(earningListSchema.parse({ items: [eligible, pending] }));
      }),
      http.get("*/api/claims", () => {
        reads.push("claims");
        return HttpResponse.json(claimListSchema.parse({ items: [] }));
      }),
    );
    render(
      <PartnerTestWorkspace
        partnerId={partnerId}
        referral={{
          code: "JAMIE12",
          publicUrl: "https://referrals.example.invalid/r/JAMIE12",
        }}
        ledgerEntries={[]}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Partner workboard · Jamie" })).toBeVisible();
    await waitFor(() => {
      expect(reads.sort()).toEqual(["claims", "earnings", `partner:${partnerId}`].sort());
    });
    expect(screen.getByText("Available").parentElement).toHaveTextContent("$25.00");
    expect(screen.getByText("Pending").parentElement).toHaveTextContent("$12.50");
    expect(screen.getByText("Held").parentElement).toHaveTextContent("$5.00");
    expect(screen.getByText(/claim available earnings next/i)).toBeVisible();
  });

  it("subtracts negative ledger recovery from availability without precision loss", async () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-500", eligibleMinor: "2500", heldMinor: "500" }],
    });
    server.use(
      http.get("*/api/partners/:id", () => HttpResponse.json(debtDetail)),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [eligible, pending] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
    );
    render(
      <PartnerTestWorkspace
        partnerId={partnerId}
        referral={{
          code: "JAMIE12",
          publicUrl: "https://referrals.example.invalid/r/JAMIE12",
        }}
        ledgerEntries={[]}
      />,
    );

    expect(await screen.findByText("Available")).toBeVisible();
    expect(screen.getByText("Available").parentElement).toHaveTextContent("$20.00");
    expect(screen.getByText("Available").parentElement).toHaveTextContent(
      /\$5\.00 balance recovery/i,
    );
    expect(screen.getByText(/claim \$20\.00 after \$5\.00 balance recovery/i)).toBeVisible();
  });

  it("keeps large recovery arithmetic exact and exposes debt remaining after all eligible earnings", async () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [
        {
          currency: "USD",
          ledgerMinor: "-900719925474099399",
          eligibleMinor: "900719925474099301",
          heldMinor: "0",
        },
      ],
    });
    server.use(
      http.get("*/api/partners/:id", () => HttpResponse.json(debtDetail)),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [eligible] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
    );
    render(
      <PartnerTestWorkspace
        partnerId={partnerId}
        referral={{
          code: "JAMIE12",
          publicUrl: "https://referrals.example.invalid/r/JAMIE12",
        }}
        ledgerEntries={[]}
      />,
    );

    expect(await screen.findByText("Available")).toBeVisible();
    expect(screen.getByText("Available").parentElement).toHaveTextContent("$0.00");
    expect(screen.getByText("Available").parentElement).toHaveTextContent(
      /\$9,007,199,254,740,993\.01 applied/i,
    );
    expect(screen.getByText("Available").parentElement).toHaveTextContent(
      /\$0\.98 recovery remains/i,
    );
    expect(screen.getByText(/\$0\.98 balance recovery remains/i)).toBeVisible();
  });

  it("labels recovery debt even before the partner has eligible earnings", async () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-500", eligibleMinor: "0", heldMinor: "0" }],
    });
    server.use(
      http.get("*/api/partners/:id", () => HttpResponse.json(debtDetail)),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [pending] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
    );
    render(
      <PartnerTestWorkspace
        partnerId={partnerId}
        referral={{
          code: "JAMIE12",
          publicUrl: "https://referrals.example.invalid/r/JAMIE12",
        }}
        ledgerEntries={[]}
      />,
    );

    expect(await screen.findByText("Available")).toBeVisible();
    expect(screen.getByText("Available").parentElement).toHaveTextContent(
      /\$5\.00 recovery balance outstanding/i,
    );
    expect(screen.getByText(/new eligible earnings will first repay \$5\.00/i)).toBeVisible();
    expect(screen.queryByText(/ready for verification/i)).not.toBeInTheDocument();
  });

  it("shows no available payout when recovery exactly equals eligible earnings", async () => {
    const debtDetail = partnerDetailSchema.parse({
      ...detail,
      balances: [{ currency: "USD", ledgerMinor: "-2500", eligibleMinor: "2500", heldMinor: "0" }],
    });
    server.use(
      http.get("*/api/partners/:id", () => HttpResponse.json(debtDetail)),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [eligible] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
    );
    render(
      <PartnerTestWorkspace
        partnerId={partnerId}
        referral={{
          code: "JAMIE12",
          publicUrl: "https://referrals.example.invalid/r/JAMIE12",
        }}
        ledgerEntries={[]}
      />,
    );

    expect(await screen.findByText("Available")).toBeVisible();
    expect(screen.getByText("Available").parentElement).toHaveTextContent("$0.00");
    expect(screen.getByText("Available").parentElement).toHaveTextContent(
      /\$25\.00 balance recovery/i,
    );
    expect(
      screen.getByText(/all eligible earnings are assigned to balance recovery/i),
    ).toBeVisible();
  });

  it("labels supplied ledger activity separately from server-loaded claims", async () => {
    const reversal = ledgerEntrySchema.parse({
      id: "55555555-5555-4555-8555-000000000001",
      organizationId: detail.organizationId,
      partnerId,
      earningId: eligible.id,
      claimId: null,
      entryType: "reversal",
      amount: { amountMinor: "-500", currency: "USD" },
      reason: "Customer refund",
      createdAt: timestamp,
    });
    server.use(
      http.get("*/api/partners/:id", () => HttpResponse.json(detail)),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [eligible] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
    );
    render(
      <PartnerTestWorkspace
        children={<PartnerClaimsPage />}
        partnerId={partnerId}
        referral={{
          code: "JAMIE12",
          publicUrl: "https://referrals.example.invalid/r/JAMIE12",
        }}
        ledgerEntries={[reversal]}
      />,
    );

    expect(await screen.findByText("Supplied ledger record")).toBeVisible();
    expect(screen.getByText(/Claims above come from the API/i)).toBeVisible();
  });

  it("preserves the last successful workboard when post-claim refresh fails", async () => {
    const user = userEvent.setup();
    let detailReads = 0;
    server.use(
      http.get("*/api/partners/:id", () => {
        detailReads += 1;
        return detailReads === 1
          ? HttpResponse.json(detail)
          : HttpResponse.json({ status: "request_failed" }, { status: 503 });
      }),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [eligible] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
      http.post("*/api/otp-challenges", () => {
        const issuedAt = Date.now();
        return HttpResponse.json(
          {
            id: "22222222-2222-4222-8222-000000000001",
            status: "pending",
            channel: "sms",
            maskedRecipient: "***0101",
            attempts: 0,
            attemptsRemaining: 5,
            expiresAt: new Date(issuedAt + 300_000).toISOString(),
            resendAfter: new Date(issuedAt - 1_000).toISOString(),
            delivery: { mode: "provider", status: "queued" },
          },
          { headers: { Date: new Date(issuedAt).toUTCString() } },
        );
      }),
      http.post("*/api/otp-challenges/:id/verify", () => {
        const verifiedAt = Date.now();
        return HttpResponse.json({
          id: "22222222-2222-4222-8222-000000000001",
          status: "verified",
          channel: "sms",
          maskedRecipient: "***0101",
          attempts: 0,
          attemptsRemaining: 5,
          expiresAt: new Date(verifiedAt + 300_000).toISOString(),
          resendAfter: new Date(verifiedAt - 1_000).toISOString(),
        });
      }),
      http.post("*/api/claims", () =>
        HttpResponse.json(
          claimSchema.parse({
            id: "33333333-3333-4333-8333-000000000001",
            organizationId: detail.organizationId,
            partnerId,
            actorId: detail.userId,
            amount: eligible.amount,
            status: "created",
            idempotencyKey: "partner-workspace-claim",
            selectionHash: "selection-hash",
            items: [
              {
                id: "33333333-3333-4333-8333-000000000002",
                organizationId: detail.organizationId,
                claimId: "33333333-3333-4333-8333-000000000001",
                earningId: eligible.id,
                amount: eligible.amount,
              },
            ],
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        ),
      ),
    );
    render(
      <PartnerTestWorkspace
        children={<PartnerClaimsPage />}
        partnerId={partnerId}
        referral={{
          code: "JAMIE12",
          publicUrl: "https://referrals.example.invalid/r/JAMIE12",
        }}
        ledgerEntries={[]}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Claims" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.type(await screen.findByLabelText("Verification code"), "418205");
    await user.click(screen.getByRole("button", { name: "Confirm claim" }));

    expect(await screen.findByText(/claim created/i)).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(/last successful records/i);
    expect(screen.getByRole("heading", { name: "Claims" })).toBeVisible();
  });

  it("hides the previous partner immediately and ignores an older overlapping response", async () => {
    let firstRequested = false;
    let secondRequested = false;
    let resolveFirst: ((value: typeof detail) => void) | undefined;
    let resolveSecond: ((value: typeof secondDetail) => void) | undefined;
    server.use(
      http.get("*/api/partners/:id", async ({ params }) => {
        if (params.id === secondPartnerId) {
          secondRequested = true;
          const value = await new Promise<typeof secondDetail>((resolve) => {
            resolveSecond = resolve;
          });
          return HttpResponse.json(value);
        }
        firstRequested = true;
        const value = await new Promise<typeof detail>((resolve) => {
          resolveFirst = resolve;
        });
        return HttpResponse.json(value);
      }),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [eligible] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
    );
    const view = render(
      <PartnerTestWorkspace
        partnerId={partnerId}
        referral={{ code: "JAMIE12", publicUrl: "https://referrals.example.invalid/r/JAMIE12" }}
        ledgerEntries={[]}
      />,
    );
    await waitFor(() => {
      expect(firstRequested).toBe(true);
    });

    view.rerender(
      <PartnerTestWorkspace
        partnerId={secondPartnerId}
        referral={{ code: "ALEX12", publicUrl: "https://referrals.example.invalid/r/ALEX12" }}
        ledgerEntries={[]}
      />,
    );
    expect(screen.getByText(/loading the partner workboard/i)).toBeVisible();
    expect(screen.queryByText(/Partner workboard · Jamie/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(secondRequested).toBe(true);
    });

    await act(async () => {
      resolveSecond?.(secondDetail);
      await Promise.resolve();
    });
    expect(await screen.findByRole("heading", { name: "Partner workboard · Alex" })).toBeVisible();
    await act(async () => {
      resolveFirst?.(detail);
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Partner workboard · Alex" })).toBeVisible();
    expect(screen.queryByText(/Partner workboard · Jamie/i)).not.toBeInTheDocument();
  });

  it("ignores a previous partner claim refresh after switching partners", async () => {
    const user = userEvent.setup();
    let firstPartnerReads = 0;
    let secondRequested = false;
    let claimRequested = false;
    let resolveSecond: ((value: typeof secondDetail) => void) | undefined;
    let resolveClaim: ((value: ReturnType<typeof claimSchema.parse>) => void) | undefined;
    server.use(
      http.get("*/api/partners/:id", async ({ params }) => {
        if (params.id === secondPartnerId) {
          secondRequested = true;
          const value = await new Promise<typeof secondDetail>((resolve) => {
            resolveSecond = resolve;
          });
          return HttpResponse.json(value);
        }
        firstPartnerReads += 1;
        return HttpResponse.json(detail);
      }),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [eligible] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
      http.post("*/api/otp-challenges", () => {
        const issuedAt = Date.now();
        return HttpResponse.json(
          {
            id: "22222222-2222-4222-8222-000000000001",
            status: "pending",
            channel: "sms",
            maskedRecipient: "***0101",
            attempts: 0,
            attemptsRemaining: 5,
            expiresAt: new Date(issuedAt + 300_000).toISOString(),
            resendAfter: new Date(issuedAt - 1_000).toISOString(),
            delivery: { mode: "provider", status: "queued" },
          },
          { headers: { Date: new Date(issuedAt).toUTCString() } },
        );
      }),
      http.post("*/api/otp-challenges/:id/verify", () => {
        const verifiedAt = Date.now();
        return HttpResponse.json({
          id: "22222222-2222-4222-8222-000000000001",
          status: "verified",
          channel: "sms",
          maskedRecipient: "***0101",
          attempts: 0,
          attemptsRemaining: 5,
          expiresAt: new Date(verifiedAt + 300_000).toISOString(),
          resendAfter: new Date(verifiedAt - 1_000).toISOString(),
        });
      }),
      http.post("*/api/claims", async () => {
        claimRequested = true;
        const value = await new Promise<ReturnType<typeof claimSchema.parse>>((resolve) => {
          resolveClaim = resolve;
        });
        return HttpResponse.json(value);
      }),
    );
    const view = render(
      <PartnerTestWorkspace
        children={<PartnerClaimsPage />}
        partnerId={partnerId}
        referral={{ code: "JAMIE12", publicUrl: "https://referrals.example.invalid/r/JAMIE12" }}
        ledgerEntries={[]}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Claims" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /plumbing referral SERVICE-1/i }));
    await user.click(screen.getByRole("button", { name: "Verify claim" }));
    await user.type(await screen.findByLabelText("Verification code"), "418205");
    await user.click(screen.getByRole("button", { name: "Confirm claim" }));
    await waitFor(() => {
      expect(claimRequested).toBe(true);
    });

    view.rerender(
      <PartnerTestWorkspace
        partnerId={secondPartnerId}
        referral={{ code: "ALEX12", publicUrl: "https://referrals.example.invalid/r/ALEX12" }}
        ledgerEntries={[]}
      />,
    );
    await waitFor(() => {
      expect(secondRequested).toBe(true);
    });

    await act(async () => {
      resolveClaim?.(
        claimSchema.parse({
          id: "33333333-3333-4333-8333-000000000001",
          organizationId: detail.organizationId,
          partnerId,
          actorId: detail.userId,
          amount: eligible.amount,
          status: "created",
          idempotencyKey: "stale-partner-claim",
          selectionHash: "selection-hash",
          items: [
            {
              id: "33333333-3333-4333-8333-000000000002",
              organizationId: detail.organizationId,
              claimId: "33333333-3333-4333-8333-000000000001",
              earningId: eligible.id,
              amount: eligible.amount,
            },
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firstPartnerReads).toBe(1);
    await act(async () => {
      resolveSecond?.(secondDetail);
      await Promise.resolve();
    });

    expect(await screen.findByRole("heading", { name: "Partner workboard · Alex" })).toBeVisible();
    expect(screen.queryByText(/Partner workboard · Jamie/i)).not.toBeInTheDocument();
  });

  it("shows the new partner error instead of falling back to another partner's records", async () => {
    server.use(
      http.get("*/api/partners/:id", ({ params }) =>
        params.id === secondPartnerId
          ? HttpResponse.json({ status: "request_failed" }, { status: 503 })
          : HttpResponse.json(detail),
      ),
      http.get("*/api/earnings", () =>
        HttpResponse.json(earningListSchema.parse({ items: [eligible] })),
      ),
      http.get("*/api/claims", () => HttpResponse.json(claimListSchema.parse({ items: [] }))),
    );
    const view = render(
      <PartnerTestWorkspace
        partnerId={partnerId}
        referral={{ code: "JAMIE12", publicUrl: "https://referrals.example.invalid/r/JAMIE12" }}
        ledgerEntries={[]}
      />,
    );
    expect(await screen.findByRole("heading", { name: "Partner workboard · Jamie" })).toBeVisible();

    view.rerender(
      <PartnerTestWorkspace
        partnerId={secondPartnerId}
        referral={{ code: "ALEX12", publicUrl: "https://referrals.example.invalid/r/ALEX12" }}
        ledgerEntries={[]}
      />,
    );
    expect(screen.getByText(/loading the partner workboard/i)).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "Partner workboard unavailable" }),
    ).toBeVisible();
    expect(screen.queryByText(/Partner workboard · Jamie/i)).not.toBeInTheDocument();
  });
});
