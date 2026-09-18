// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/owner/workboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

import { SandboxShell } from "./sandbox-shell.js";
import "../test/setup.js";

describe("SandboxShell", () => {
  beforeEach(() => {
    navigation.pathname = "/owner/workboard";
  });

  it("keeps persona switching available without hover", async () => {
    const user = userEvent.setup();
    render(
      <SandboxShell initialRole="owner" displayName="Morgan Lee">
        <p>Dashboard</p>
      </SandboxShell>,
    );

    await user.click(screen.getByRole("button", { name: /current persona.*morgan.*owner/i }));

    expect(screen.getByRole("menuitemradio", { name: /owner view/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: /partner view/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText("Morgan Lee")).toHaveClass("persona-name");
  });

  it("switches personas from the keyboard and announces the new workbench", async () => {
    const user = userEvent.setup();
    const onPersonaChange = vi.fn().mockResolvedValue(undefined);
    render(
      <SandboxShell initialRole="owner" onPersonaChange={onPersonaChange}>
        <p>Dashboard</p>
      </SandboxShell>,
    );

    screen.getByRole("button", { name: /current persona.*morgan.*owner/i }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onPersonaChange).toHaveBeenCalledWith("partner");
    expect(screen.getByRole("status")).toHaveTextContent(/partner workbench/i);
  });

  it("prevents a second persona activation while the first switch is pending", async () => {
    let finishSwitch: (() => void) | undefined;
    const onPersonaChange = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSwitch = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <SandboxShell initialRole="owner" onPersonaChange={onPersonaChange}>
        <p>Dashboard</p>
      </SandboxShell>,
    );

    await user.click(screen.getByRole("button", { name: /current persona.*morgan.*owner/i }));
    const partner = screen.getByRole("menuitemradio", { name: /partner view/i });
    fireEvent.click(partner);
    fireEvent.click(partner);

    expect(onPersonaChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /current persona.*morgan.*owner/i })).toBeDisabled();
    finishSwitch?.();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /current persona.*jamie.*partner/i }),
      ).toBeEnabled(),
    );
  });

  it("keeps the current role and shows a visible alert when persona switching fails", async () => {
    const user = userEvent.setup();
    render(
      <SandboxShell
        initialRole="owner"
        onPersonaChange={vi.fn().mockRejectedValue(new Error("offline"))}
      >
        <p>Dashboard</p>
      </SandboxShell>,
    );

    await user.click(screen.getByRole("button", { name: /current persona.*morgan.*owner/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /partner view/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/persona switch failed/i);
    expect(screen.getByRole("button", { name: /current persona.*morgan.*owner/i })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/current workbench is unchanged/i);
  });

  it("uses one responsive primary navigation with owner concepts and 44px targets", () => {
    render(
      <SandboxShell initialRole="owner">
        <p>Dashboard</p>
      </SandboxShell>,
    );

    const navigations = screen.getAllByRole("navigation", { name: /primary/i });
    expect(navigations).toHaveLength(1);
    const navigation = navigations.at(0);
    if (!navigation) throw new Error("Primary navigation was not rendered");
    expect(within(navigation).getByRole("link", { name: /workboard/i })).toHaveStyle({
      minBlockSize: "44px",
    });
    expect(within(navigation).getByRole("link", { name: /earnings/i })).toBeVisible();
    expect(within(navigation).getByRole("link", { name: /partners/i })).toBeVisible();
    expect(within(navigation).getByRole("link", { name: /workboard/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /northstar sandbox workboard/i })).toHaveStyle({
      minBlockSize: "44px",
      minInlineSize: "44px",
    });
    expect(
      screen
        .getByRole("link", { name: /northstar sandbox workboard/i })
        .querySelector(".brand-wordmark"),
    ).toBeInTheDocument();
  });

  it("renders role-prefixed links, marks the current route, and focuses changed routes", async () => {
    navigation.pathname = "/owner/programs";
    const view = render(<SandboxShell initialRole="owner">Owner route</SandboxShell>);

    expect(screen.getByRole("link", { name: "Programs" })).toHaveAttribute(
      "href",
      "/owner/programs",
    );
    expect(screen.getByRole("link", { name: "Programs" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Workboard" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: /northstar sandbox workboard/i })).toHaveAttribute(
      "href",
      "/owner/workboard",
    );
    expect(view.container.querySelector("main")).not.toHaveFocus();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    navigation.pathname = "/owner/earnings";
    view.rerender(<SandboxShell initialRole="owner">Owner route</SandboxShell>);

    await waitFor(() => expect(view.container.querySelector("main")).toHaveFocus());
    expect(screen.getByRole("link", { name: "Earnings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Programs" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("status")).toHaveTextContent(/earnings page ready/i);
  });

  it("gives partner navigation a real workboard home and marks only the active location", () => {
    navigation.pathname = "/partner/claims";
    render(
      <SandboxShell initialRole="partner">
        <p>Dashboard</p>
      </SandboxShell>,
    );

    const primaryNavigation = screen.getByRole("navigation", { name: /primary/i });
    expect(within(primaryNavigation).getByRole("link", { name: "Workboard" })).toHaveAttribute(
      "href",
      "/partner/workboard",
    );
    expect(within(primaryNavigation).getByRole("link", { name: "Referrals" })).toBeVisible();
    expect(within(primaryNavigation).getByRole("link", { name: "Earnings" })).toBeVisible();
    expect(within(primaryNavigation).getByRole("link", { name: "Claims" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(primaryNavigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("focuses and announces a validated transition on mount only once", () => {
    navigation.pathname = "/partner/workboard";
    const view = render(
      <SandboxShell initialRole="partner" focusOnMount>
        Partner route
      </SandboxShell>,
    );
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("workboard page ready.");

    const link = screen.getByRole("link", { name: "Referrals" });
    link.focus();
    view.rerender(<SandboxShell initialRole="partner">Partner route</SandboxShell>);
    expect(link).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("workboard page ready.");
  });

  it("renders honest reset availability instead of an enabled no-op", () => {
    render(
      <SandboxShell initialRole="owner">
        <p>Dashboard</p>
      </SandboxShell>,
    );

    expect(screen.queryByRole("button", { name: /reset sandbox/i })).not.toBeInTheDocument();
    expect(screen.getByText(/reset unlocks in guided tour/i)).toBeVisible();
  });

  it("shows visible pending and success feedback for a working reset", async () => {
    let finishReset: (() => void) | undefined;
    const onReset = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReset = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <SandboxShell initialRole="owner" onReset={onReset}>
        <p>Dashboard</p>
      </SandboxShell>,
    );

    const reset = screen.getByRole("button", { name: /reset sandbox/i });
    await user.click(reset);
    expect(reset).toBeDisabled();
    expect(document.querySelector(".operation-feedback")).toHaveTextContent(/resetting sandbox/i);
    finishReset?.();
    await waitFor(() =>
      expect(document.querySelector(".operation-feedback")).toHaveTextContent(
        /sandbox reset complete/i,
      ),
    );
  });

  it("shows a visible alert when reset fails", async () => {
    const user = userEvent.setup();
    render(
      <SandboxShell initialRole="owner" onReset={vi.fn().mockRejectedValue(new Error("offline"))}>
        <p>Dashboard</p>
      </SandboxShell>,
    );

    await user.click(screen.getByRole("button", { name: /reset sandbox/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/sandbox reset failed/i);
    expect(screen.getByRole("button", { name: /reset sandbox/i })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/reset failed/i);
  });

  it("orients visitors with a skip link and persistent simulation proof", () => {
    render(
      <SandboxShell initialRole="owner">
        <p>Dashboard</p>
      </SandboxShell>,
    );

    expect(screen.getByRole("link", { name: /skip to work area/i })).toHaveAttribute(
      "href",
      "#sandbox-main",
    );
    expect(screen.getByText(/sms preview · ₱0/i)).toBeVisible();
    expect(screen.getByText(/real ledger rules/i)).toBeVisible();
    expect(screen.getByText(/local sandbox data/i)).toBeVisible();
    expect(screen.getByText(/money and messages are simulated/i)).toBeVisible();
  });
});
