import { describe, expect, it } from "vitest";

import {
  activeWorkbenchDestination,
  roleFromPathname,
  workbenchRoutes,
  workboardPath,
} from "./workbench-routes";

describe("workbench routes", () => {
  it("defines four concrete destinations for each persona", () => {
    expect(workbenchRoutes.owner).toEqual([
      { label: "Workboard", href: "/owner/workboard", section: "workboard" },
      { label: "Programs", href: "/owner/programs", section: "programs" },
      { label: "Earnings", href: "/owner/earnings", section: "earnings" },
      { label: "Partners", href: "/owner/partners", section: "partners" },
    ]);
    expect(workbenchRoutes.partner).toEqual([
      { label: "Workboard", href: "/partner/workboard", section: "workboard" },
      { label: "Referrals", href: "/partner/referrals", section: "referrals" },
      { label: "Earnings", href: "/partner/earnings", section: "earnings" },
      { label: "Claims", href: "/partner/claims", section: "claims" },
    ]);
  });

  it("derives the requested role only from a role-prefixed pathname", () => {
    expect(roleFromPathname("/owner/programs")).toBe("owner");
    expect(roleFromPathname("/partner/claims")).toBe("partner");
    expect(roleFromPathname("/")).toBeNull();
    expect(roleFromPathname("/ownership/workboard")).toBeNull();
  });

  it("marks an exact destination current and rejects sibling prefixes", () => {
    expect(activeWorkbenchDestination("owner", "/owner/earnings")).toBe("/owner/earnings");
    expect(activeWorkbenchDestination("owner", "/owner/earnings/example")).toBe(
      "/owner/earnings",
    );
    expect(activeWorkbenchDestination("owner", "/owner/earningsextra")).toBeNull();
    expect(activeWorkbenchDestination("owner", "/owner/partners/example")).toBe(
      "/owner/partners",
    );
    expect(activeWorkbenchDestination("owner", "/partner/earnings")).toBeNull();
  });

  it("returns each persona workboard", () => {
    expect(workboardPath("owner")).toBe("/owner/workboard");
    expect(workboardPath("partner")).toBe("/partner/workboard");
  });
});
