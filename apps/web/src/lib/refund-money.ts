export function currencyFractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export function parseRefundMajorToMinor(input: string, currency: string): string {
  const fractionDigits = currencyFractionDigits(currency);
  const normalized = input.trim();
  const pattern =
    fractionDigits === 0
      ? /^[0-9]+$/
      : new RegExp(`^[0-9]+(?:\\.[0-9]{1,${String(fractionDigits)}})?$`);
  if (!pattern.test(normalized)) throw new TypeError("Enter a positive currency amount");
  const [major = "", fraction = ""] = normalized.split(".");
  const amountMinor = BigInt(`${major}${fraction.padEnd(fractionDigits, "0")}`);
  if (amountMinor <= 0n) throw new TypeError("Refund amount must be positive");
  return amountMinor.toString();
}
