// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../test/setup.js";
import { SmsPreviewDrawer } from "./sms-preview-drawer.js";

describe("SmsPreviewDrawer", () => {
  it("identifies the no-cost local preview and copies its six-digit code", async () => {
    const user = userEvent.setup();
    const onCopied = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <SmsPreviewDrawer
        open
        serverNowMs={Date.now()}
        receivedAtClientMs={Date.now()}
        onOpenChange={() => undefined}
        onCopied={onCopied}
        preview={{
          recipientMasked: "***0101",
          message: "Your referral claim verification code is 418205.",
          code: "418205",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }}
      />,
    );

    const drawer = screen.getByRole("dialog", { name: "SMS preview" });
    expect(within(drawer).getByText("Local preview — no SMS was sent.")).toBeVisible();
    expect(within(drawer).getByText("***0101")).toBeVisible();
    expect(within(drawer).getByText("418205")).toBeVisible();
    expect(within(drawer).getByText(/expires in/i)).toBeVisible();

    await user.click(within(drawer).getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith("418205");
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  it("has an explicit close control", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <SmsPreviewDrawer
        open
        serverNowMs={Date.now()}
        receivedAtClientMs={Date.now()}
        onOpenChange={onOpenChange}
        onCopied={() => undefined}
        preview={{
          recipientMasked: "***0101",
          message: "Your referral claim verification code is 418205.",
          code: "418205",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Close SMS preview" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the preview open and gives a safe fallback when clipboard access fails", async () => {
    const user = userEvent.setup();
    const onCopied = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(
      <SmsPreviewDrawer
        open
        serverNowMs={Date.now()}
        receivedAtClientMs={Date.now()}
        onOpenChange={() => undefined}
        onCopied={onCopied}
        preview={{
          recipientMasked: "***0101",
          message: "Your referral claim verification code is 418205.",
          code: "418205",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Copy unavailable. Enter the code manually.",
    );
    expect(screen.getByRole("dialog", { name: "SMS preview" })).toBeVisible();
    expect(onCopied).not.toHaveBeenCalled();
  });

  it("counts down from the server clock instead of the client's absolute clock", () => {
    const receivedAtClientMs = Date.now();
    const serverNowMs = receivedAtClientMs - 60 * 60 * 1_000;
    render(
      <SmsPreviewDrawer
        open
        onOpenChange={() => undefined}
        onCopied={() => undefined}
        serverNowMs={serverNowMs}
        receivedAtClientMs={receivedAtClientMs}
        preview={{
          recipientMasked: "***0101",
          message: "Your referral claim verification code is 418205.",
          code: "418205",
          expiresAt: new Date(serverNowMs + 300_000).toISOString(),
        }}
      />,
    );

    expect(screen.getByText("5:00")).toBeVisible();
  });
});
