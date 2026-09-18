import { describe, expect, it } from "vitest";

import { parseRefundMajorToMinor } from "./refund-money.js";

describe("parseRefundMajorToMinor", () => {
  it.each([
    ["12.34", "USD", "1234"],
    ["12", "JPY", "12"],
    ["12.345", "BHD", "12345"],
    ["9007199254740993.12", "USD", "900719925474099312"],
  ])("converts %s %s exactly without Number", (input, currency, expected) => {
    expect(parseRefundMajorToMinor(input, currency)).toBe(expected);
  });

  it.each(["0", "-1.00", "1.001", "1e3", "abc"])("rejects invalid USD refund %s", (input) => {
    expect(() => parseRefundMajorToMinor(input, "USD")).toThrow();
  });
});
