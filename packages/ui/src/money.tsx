export type FormatMoneyOptions = {
  amountMinor: string;
  currency: string;
  locale?: string;
};

export function formatMoneyMinor({
  amountMinor,
  currency,
  locale = "en-US",
}: FormatMoneyOptions): string {
  if (!/^-?[0-9]+$/.test(amountMinor))
    throw new TypeError("Money amount must use integer minor units");

  const amount = BigInt(amountMinor);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const currencyOptions = new Intl.NumberFormat(locale, { style: "currency", currency });
  const fractionDigits = currencyOptions.resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = 10n ** BigInt(fractionDigits);
  const major = fractionDigits === 0 ? absolute : absolute / divisor;
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const localizedFraction =
    fractionDigits === 0
      ? ""
      : new Intl.NumberFormat(locale, {
          useGrouping: false,
          minimumIntegerDigits: fractionDigits,
          maximumFractionDigits: 0,
        }).format(absolute % divisor);
  const signedMajor: bigint | number = negative ? (major === 0n ? -0 : -major) : major;

  return formatter
    .formatToParts(signedMajor)
    .map((part) => (part.type === "fraction" ? localizedFraction : part.value))
    .join("");
}

export type MoneyProps = FormatMoneyOptions & {
  className?: string;
};

export function Money({ className, ...money }: MoneyProps) {
  return (
    <data
      className={className}
      value={`${money.currency} ${money.amountMinor}`}
      data-amount-minor={money.amountMinor}
      data-currency={money.currency}
    >
      {formatMoneyMinor(money)}
    </data>
  );
}
