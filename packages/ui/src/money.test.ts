import { describe, expect, it } from "vitest";

import { formatMoneyMinor } from "./money.js";

describe("formatMoneyMinor locale fidelity", () => {
  it.each([
    { amountMinor: "-1", currency: "USD", locale: "ar-EG", decimal: -0.01 },
    { amountMinor: "-105", currency: "USD", locale: "fa-IR", decimal: -1.05 },
    { amountMinor: "12345", currency: "BHD", locale: "ar-EG", decimal: 12.345 },
  ])("matches Intl sign, ordering and digit shaping for $locale", (example) => {
    const expected = new Intl.NumberFormat(example.locale, {
      style: "currency",
      currency: example.currency,
    }).format(example.decimal);

    expect(formatMoneyMinor(example)).toBe(expected);
  });

  it("formats zero-fraction currencies with Intl", () => {
    expect(
      formatMoneyMinor({ amountMinor: "-900719925474099301", currency: "JPY", locale: "ja-JP" }),
    ).toBe(
      new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(
        -900719925474099301n,
      ),
    );
  });

  it("keeps huge fractional values exact while retaining localized parts", () => {
    const output = formatMoneyMinor({
      amountMinor: "-900719925474099301",
      currency: "BHD",
      locale: "ar-EG",
    });
    const formatter = new Intl.NumberFormat("ar-EG", {
      style: "currency",
      currency: "BHD",
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });
    const localizedFraction = new Intl.NumberFormat("ar-EG", {
      useGrouping: false,
      minimumIntegerDigits: 3,
      maximumFractionDigits: 0,
    }).format(301n);

    expect(output).toContain(localizedFraction);
    expect(output).toContain(
      formatter.formatToParts(-1n).find((part) => part.type === "minusSign")?.value,
    );
    expect(output).not.toMatch(/[0-9]/);
  });
});
