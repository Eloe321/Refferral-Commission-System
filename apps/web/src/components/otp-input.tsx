"use client";

import { forwardRef } from "react";

export type OtpInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

function normalizeOtp(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^0-9]/g, "")
    .slice(0, 6);
}

export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { value, onChange, disabled = false },
  ref,
) {
  return (
    <label className="otp-field">
      <span>Verification code</span>
      <input
        ref={ref}
        aria-label="Verification code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(normalizeOtp(event.target.value));
        }}
      />
      <small>Enter the six digits from the selected delivery channel.</small>
    </label>
  );
});
