// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResetSandbox } from "./reset-sandbox.js";
import "../../test/setup.js";

describe("ResetSandbox", () => {
  it("requires the exact confirmation and warns that only fictional local data is affected", async () => {
    const onReset = vi.fn(() => Promise.resolve());
    render(<ResetSandbox onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /reset sandbox/i }));
    expect(screen.getByRole("dialog", { name: /reset guided sandbox/i })).toHaveTextContent(
      /only fictional local northstar data/i,
    );
    const confirm = screen.getByLabelText(/type reset sandbox/i);
    const submit = screen.getByRole("button", { name: /confirm reset/i });
    expect(submit).toBeDisabled();
    fireEvent.change(confirm, { target: { value: "RESET" } });
    expect(submit).toBeDisabled();
    fireEvent.change(confirm, { target: { value: "RESET SANDBOX" } });
    fireEvent.click(submit);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/sandbox reset complete/i)).toBeVisible();
  });

  it("does not claim records are unchanged when reset outcome cannot be confirmed", async () => {
    render(<ResetSandbox onReset={() => Promise.reject(new Error("refresh failed"))} />);
    fireEvent.click(screen.getByRole("button", { name: /reset sandbox/i }));
    fireEvent.change(screen.getByLabelText(/type reset sandbox/i), {
      target: { value: "RESET SANDBOX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be confirmed/i);
    expect(alert).not.toHaveTextContent(/unchanged/i);
  });
});
