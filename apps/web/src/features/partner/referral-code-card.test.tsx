// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../test/setup.js";
import { ReferralCodeCard } from "./referral-code-card.js";

describe("ReferralCodeCard", () => {
  it("encodes only the supplied public fictional referral URL and reports copy feedback", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const publicUrl = "https://referrals.example.invalid/r/JAMIE12";
    render(<ReferralCodeCard referral={{ code: "JAMIE12", publicUrl }} />);

    expect(screen.getByRole("img", { name: "QR code for referral JAMIE12" })).toBeVisible();
    expect(screen.getByText(publicUrl)).toBeVisible();
    expect(
      screen.getByRole("img", { name: "QR code for referral JAMIE12" }).parentElement,
    ).toHaveAttribute("data-qr-value", publicUrl);
    expect(publicUrl).not.toMatch(/jamie@example\.com|\+63|session|cookie/i);

    await user.click(screen.getByRole("button", { name: "Copy referral link" }));

    expect(writeText).toHaveBeenCalledWith(publicUrl);
    expect(screen.getByRole("status")).toHaveTextContent("Referral link copied");
    expect(screen.getByRole("region", { name: "Share JAMIE12" })).toHaveAttribute(
      "id",
      "referrals",
    );
  });

  it("refuses to encode credentials, queries, or fragments supplied as a public URL", () => {
    const unsafeUrl =
      "https://jamie@example.invalid/r/JAMIE12?session=signed-secret#jamie@example.invalid";
    render(<ReferralCodeCard referral={{ code: "JAMIE12", publicUrl: unsafeUrl }} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/public referral link is unavailable/i);
    expect(screen.queryByRole("img", { name: /QR code/i })).not.toBeInTheDocument();
    expect(screen.queryByText(unsafeUrl)).not.toBeInTheDocument();
  });
});
