// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button, Money, Sheet, StatusBadge } from "./index.js";

let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
});

describe("shared UI", () => {
  it("labels the SMS sheet and returns focus when closed", async () => {
    const user = userEvent.setup();
    render(
      <Sheet title="SMS preview" trigger={<button>Open preview</button>}>
        Code 123456
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: "Open preview" });

    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "SMS preview" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Close SMS preview" }));
    expect(trigger).toHaveFocus();
  });

  it("closes with Escape and restores the trigger", async () => {
    const user = userEvent.setup();
    render(
      <Sheet title="Earning details" trigger={<button>Manage earning</button>}>
        Details
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: "Manage earning" });
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Earning details" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("marks the reduced-motion rendering path", async () => {
    reducedMotion = true;
    const user = userEvent.setup();
    render(
      <Sheet title="SMS preview" trigger={<button>Open preview</button>}>
        Code 123456
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Open preview" }));

    expect(screen.getByRole("dialog", { name: "SMS preview" })).toHaveAttribute(
      "data-motion",
      "reduced",
    );
  });

  it("provides a 44px button target with native disabled semantics", () => {
    render(<Button disabled>Place hold</Button>);
    expect(screen.getByRole("button", { name: "Place hold" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Place hold" })).toHaveStyle({
      minBlockSize: "44px",
    });
  });

  it("renders status with both an icon and readable text", () => {
    render(<StatusBadge status="held" label="Held" />);
    const badge = screen.getByText("Held").parentElement;
    expect(badge).toHaveTextContent("Held");
    expect(badge?.querySelector("svg")).toBeInTheDocument();
  });

  it("formats minor units beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    render(<Money amountMinor="900719925474099301" currency="USD" locale="en-US" />);
    expect(screen.getByText("$9,007,199,254,740,993.01")).toBeVisible();
  });
});
