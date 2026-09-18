// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import "../test/setup.js";
import { OtpInput } from "./otp-input.js";

describe("OtpInput", () => {
  it("uses one accessible mobile OTP field and normalizes pasted digits", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState("");
      return <OtpInput value={value} onChange={setValue} />;
    }
    render(<Harness />);

    const input = screen.getByLabelText("Verification code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("maxlength", "6");

    await user.type(input, "１2a 34-567");

    expect(input).toHaveValue("123456");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });
});
