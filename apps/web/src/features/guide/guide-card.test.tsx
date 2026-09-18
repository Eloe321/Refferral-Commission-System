// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ActorRole, GuideStage, GuideState } from "@referral-sandbox/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/owner/workboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import { GuideCard } from "./guide-card.js";
import { GuideProvider } from "./guide-provider.js";
import "../../test/setup.js";

const state: GuideState = {
  organizationId: "11111111-1111-4111-8111-000000000001",
  scenarioId: "northstar-referral-lifecycle",
  stage: "review_program",
  sandboxVersion: 1,
  completedStages: [],
  updatedAt: "2026-09-16T00:00:00.000Z",
};

function renderGuide(
  options: {
    stage?: GuideStage;
    advance?: () => Promise<void>;
    switchPersona?: (role: ActorRole) => Promise<void>;
    openDestination?: (role: ActorRole, href: string) => Promise<void>;
    needsWorkspaceRefresh?: boolean;
  } = {},
) {
  const advance = options.advance ?? vi.fn().mockResolvedValue(undefined);
  const switchPersona = options.switchPersona ?? vi.fn().mockResolvedValue(undefined);
  const openDestination = options.openDestination ?? vi.fn().mockResolvedValue(undefined);
  const view = render(
    <GuideProvider
      state={{ ...state, stage: options.stage ?? state.stage }}
      onAdvance={advance}
      onSwitchPersona={switchPersona}
      onOpenDestination={openDestination}
      needsWorkspaceRefresh={options.needsWorkspaceRefresh ?? false}
    >
      <GuideCard />
    </GuideProvider>,
  );
  return { ...view, advance, switchPersona, openDestination };
}

const destinations = [
  ["review_program", "owner", "/owner/programs", "Open programs", "Mark program reviewed"],
  ["create_referral", "partner", "/partner/referrals", "Open referrals", "Create referral"],
  [
    "complete_service",
    "owner",
    "/owner/programs",
    "Open owner programs",
    "Complete fictional service",
  ],
  ["claim_earnings", "partner", "/partner/claims", "Open partner claims", "Check claim progress"],
  ["issue_refund", "owner", "/owner/earnings", "Open earning operations", "Check refund progress"],
  [
    "review_reversal",
    "owner",
    "/owner/earnings",
    "Open reversal history",
    "Mark reversal reviewed",
  ],
] as const;

describe("GuideCard", () => {
  beforeEach(() => {
    navigation.pathname = "/owner/workboard";
  });

  it("shows concrete progress, one action, why it matters, and industry reuse", () => {
    navigation.pathname = "/owner/programs";
    render(
      <GuideProvider state={state} onAdvance={vi.fn()}>
        <GuideCard />
      </GuideProvider>,
    );

    expect(screen.getByText("Step 1 of 8")).toBeVisible();
    expect(screen.getByRole("heading", { name: /review the commission program/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /mark program reviewed/i })).toBeVisible();
    expect(screen.getByText(/why it matters/i)).toBeVisible();
    expect(screen.getByText(/repair shops, agencies, and membership businesses/i)).toBeVisible();
  });

  it("guards rapid duplicate progress checks and exposes validation failures", async () => {
    navigation.pathname = "/partner/claims";
    let resolve!: () => void;
    const onAdvance = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    const view = render(
      <GuideProvider state={{ ...state, stage: "claim_earnings" }} onAdvance={onAdvance}>
        <GuideCard />
      </GuideProvider>,
    );

    const check = screen.getByRole("button", { name: /check claim progress/i });
    fireEvent.click(check);
    fireEvent.click(check);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    resolve();
    await screen.findByText(/progress checked/i);

    view.rerender(
      <GuideProvider
        state={{ ...state, stage: "claim_earnings" }}
        onAdvance={vi.fn(() => Promise.reject(new Error("not ready")))}
      >
        <GuideCard />
      </GuideProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /check claim progress/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/complete the recommended action/i);
  });

  it.each(destinations)(
    "%s opens its required destination before checking progress",
    async (stage, role, href, openLabel) => {
      if (stage === "complete_service") navigation.pathname = "/partner/referrals";
      const { advance, switchPersona, openDestination } = renderGuide({ stage });

      fireEvent.click(screen.getByRole("button", { name: openLabel }));

      expect(openDestination).toHaveBeenCalledExactlyOnceWith(role, href);
      expect(advance).not.toHaveBeenCalled();
      expect(switchPersona).not.toHaveBeenCalled();
      expect(await screen.findByRole("status")).toHaveTextContent(
        `${role === "owner" ? "Owner" : "Partner"} page ready.`,
      );
    },
  );

  it.each(destinations)(
    "%s checks progress when its destination is active",
    async (stage, _role, href, _openLabel, actionLabel) => {
      navigation.pathname = href;
      const { advance, openDestination } = renderGuide({ stage });

      fireEvent.click(screen.getByRole("button", { name: actionLabel }));

      expect(advance).toHaveBeenCalledTimes(1);
      expect(openDestination).not.toHaveBeenCalled();
      expect(await screen.findByRole("status")).toHaveTextContent(/progress checked/i);
    },
  );

  it.each([
    ["switch_to_partner", "partner", "Switch to partner"],
    ["switch_to_owner", "owner", "Switch to owner"],
  ] as const)("%s keeps its explicit persona switch", async (stage, role, label) => {
    const { advance, switchPersona, openDestination } = renderGuide({ stage });

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(switchPersona).toHaveBeenCalledExactlyOnceWith(role);
    expect(openDestination).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(/workbench ready/i);
  });

  it.each(["review_program", "switch_to_partner", "complete"] as const)(
    "%s prioritizes refreshing business records over navigation and stage actions",
    async (stage) => {
      const { advance, switchPersona, openDestination } = renderGuide({
        stage,
        needsWorkspaceRefresh: true,
      });

      fireEvent.click(screen.getByRole("button", { name: "Refresh business records" }));

      expect(advance).toHaveBeenCalledTimes(1);
      expect(openDestination).not.toHaveBeenCalled();
      expect(switchPersona).not.toHaveBeenCalled();
      expect(await screen.findByRole("status")).toHaveTextContent(/progress checked/i);
    },
  );

  it("disables the destination action and guards duplicate clicks while navigation is pending", async () => {
    let resolve!: () => void;
    const openDestination = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    const { advance } = renderGuide({ openDestination });
    const button = screen.getByRole("button", { name: "Open programs" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(openDestination).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Checking progress…" })).toBeDisabled();
    expect(advance).not.toHaveBeenCalled();
    resolve();
    await screen.findByRole("status");
    expect(screen.getByRole("button", { name: "Open programs" })).toBeEnabled();
  });

  it("exposes destination failures through existing error feedback and allows retry", async () => {
    const openDestination = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { advance } = renderGuide({ openDestination });

    fireEvent.click(screen.getByRole("button", { name: "Open programs" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/complete the recommended action/i);
    expect(screen.getByRole("button", { name: "Open programs" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Open programs" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Owner page ready.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it("reports unavailable destination navigation without advancing", async () => {
    const advance = vi.fn().mockResolvedValue(undefined);
    render(
      <GuideProvider state={state} onAdvance={advance}>
        <GuideCard />
      </GuideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open programs" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/complete the recommended action/i);
    expect(advance).not.toHaveBeenCalled();
  });

  it("keeps a completed scenario as a non-interactive status", () => {
    renderGuide({ stage: "complete" });

    expect(screen.getByText("Scenario complete")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
