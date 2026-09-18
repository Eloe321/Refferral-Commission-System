// @vitest-environment node

import { describe, expect, it } from "vitest";

import { getEligibleEarnings } from "./api-client.js";

describe("browser API client boundary", () => {
  it("fails clearly before fetching when called during server rendering", async () => {
    await expect(getEligibleEarnings()).rejects.toThrow(/browser-only/i);
  });
});
