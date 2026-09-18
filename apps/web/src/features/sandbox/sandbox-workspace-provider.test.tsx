// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { demoScenarioId } from "@referral-sandbox/contracts";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SandboxWorkspaceProvider, useSandboxWorkspace } from "./sandbox-workspace-provider.js";
import { server } from "../../test/setup.js";

const navigation = vi.hoisted(() => ({
  pathname: "/owner/workboard",
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
}));

function renderSandbox(child = <section aria-label="Route content">Route content</section>) {
  return render(<SandboxWorkspaceProvider>{child}</SandboxWorkspaceProvider>);
}

beforeEach(() => {
  navigation.pathname = "/owner/workboard";
  navigation.replace.mockReset();
  navigation.replace.mockImplementation((href: string) => {
    navigation.pathname = href;
  });
  navigation.push.mockReset();
});

const organizationId = "11111111-1111-4111-8111-000000000001";
const owner = {
  actorId: "11111111-1111-4111-8111-000000000002",
  organizationId,
  role: "owner",
  partnerId: null,
  displayName: "Morgan Lee",
  sandboxVersion: 1,
} as const;
const partner = {
  actorId: "11111111-1111-4111-8111-000000000003",
  organizationId,
  role: "partner",
  partnerId: "11111111-1111-4111-8111-000000000005",
  displayName: "Jamie Rivera",
  sandboxVersion: 1,
} as const;
const guide = {
  organizationId,
  scenarioId: demoScenarioId,
  stage: "review_program",
  sandboxVersion: 1,
  completedStages: [],
  updatedAt: "2026-09-16T00:00:00.000Z",
} as const;
const partnerWorkspace = {
  role: "partner",
  organizationId,
  sandboxVersion: 1,
  partnerId: partner.partnerId,
  referral: {
    code: "JAMIE25",
    publicUrl: "https://referrals.example.invalid/r/JAMIE25",
  },
  ledgerEntries: [],
} as const;

function workspaceHandlers() {
  return [
    http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(guide)),
    http.get("*/api/demo/workspace", () =>
      HttpResponse.json({
        role: "owner",
        organizationId,
        sandboxVersion: 1,
        conversions: [],
        auditEvents: [],
      }),
    ),
  ];
}

describe("SandboxWorkspaceProvider guided composition", () => {
  it("never renders route children with a session from the previous pathname role", async () => {
    let activeRole: "owner" | "partner" = "owner";
    const renderedRoles: string[] = [];
    function RouteContent() {
      const { session } = useSandboxWorkspace();
      renderedRoles.push(`${navigation.pathname}:${session.role}`);
      return <section aria-label="Route content">{session.role}</section>;
    }
    server.use(
      http.get("*/api/demo/session", () =>
        HttpResponse.json(activeRole === "owner" ? owner : partner),
      ),
      http.post("*/api/demo/session", () => {
        activeRole = "partner";
        return HttpResponse.json(partner);
      }),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(guide)),
      http.get("*/api/demo/workspace", () =>
        HttpResponse.json(
          activeRole === "owner"
            ? {
                role: "owner",
                organizationId,
                sandboxVersion: 1,
                conversions: [],
                auditEvents: [],
              }
            : partnerWorkspace,
        ),
      ),
    );
    const view = renderSandbox(<RouteContent />);
    await screen.findByRole("region", { name: /route content/i });

    expect(screen.getByRole("main")).not.toHaveFocus();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    navigation.pathname = "/partner/claims";
    view.rerender(
      <SandboxWorkspaceProvider>
        <RouteContent />
      </SandboxWorkspaceProvider>,
    );

    expect(await screen.findByRole("region", { name: /route content/i })).toHaveTextContent(
      "partner",
    );
    expect(renderedRoles).not.toContain("/partner/claims:owner");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("claims page ready.");

    const reconciledMain = screen.getByRole("main");
    navigation.pathname = "/partner/earnings";
    view.rerender(
      <SandboxWorkspaceProvider>
        <RouteContent />
      </SandboxWorkspaceProvider>,
    );
    expect(screen.getByRole("main")).toBe(reconciledMain);
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("earnings page ready.");
  });

  it("keeps a successful persona switch behind the boundary until its destination is active", async () => {
    navigation.replace.mockImplementation(() => {});
    let activeRole: "owner" | "partner" = "owner";
    const renderedRoles: string[] = [];
    function RouteContent() {
      const { session } = useSandboxWorkspace();
      renderedRoles.push(`${navigation.pathname}:${session.role}`);
      return <section aria-label="Route content">{session.role}</section>;
    }
    server.use(
      http.get("*/api/demo/session", () =>
        HttpResponse.json(activeRole === "owner" ? owner : partner),
      ),
      http.post("*/api/demo/session", () => {
        activeRole = "partner";
        return HttpResponse.json(partner);
      }),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(guide)),
      http.get("*/api/demo/workspace", () =>
        HttpResponse.json(
          activeRole === "owner"
            ? {
                role: "owner",
                organizationId,
                sandboxVersion: 1,
                conversions: [],
                auditEvents: [],
              }
            : partnerWorkspace,
        ),
      ),
    );
    const user = userEvent.setup();
    const view = renderSandbox(<RouteContent />);
    await screen.findByRole("region", { name: /route content/i });
    await user.click(screen.getByRole("button", { name: /switch persona/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /partner view/i }));
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith("/partner/workboard");
    });

    expect(screen.queryByRole("region", { name: /route content/i })).not.toBeInTheDocument();
    expect(screen.getByText(/switching workbench/i)).toBeVisible();
    expect(renderedRoles).not.toContain("/owner/workboard:partner");

    navigation.pathname = "/partner/workboard";
    view.rerender(
      <SandboxWorkspaceProvider>
        <RouteContent />
      </SandboxWorkspaceProvider>,
    );
    expect(await screen.findByRole("region", { name: /route content/i })).toHaveTextContent(
      "partner",
    );
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("workboard page ready.");
  });

  it.each(["route", "persona", "reset"] as const)(
    "reconciles the signed cookie after a delayed %s operation finishes on a different route",
    async (operation) => {
      const finalRole = operation === "reset" ? "partner" : "owner";
      const delayedRole = operation === "reset" ? "owner" : "partner";
      let activeRole: "owner" | "partner" = finalRole;
      let version = 1;
      let releaseOperation!: () => void;
      const cookieWrites = vi.fn<(role: "owner" | "partner") => void>();
      navigation.pathname = `/${finalRole}/workboard`;
      server.use(
        http.get("*/api/demo/session", () =>
          HttpResponse.json({
            ...(activeRole === "owner" ? owner : partner),
            sandboxVersion: version,
          }),
        ),
        http.post("*/api/demo/session", async ({ request }) => {
          const input = (await request.json()) as { role: "owner" | "partner" };
          cookieWrites(input.role);
          if (input.role === delayedRole) {
            await new Promise<void>((resolve) => {
              releaseOperation = resolve;
            });
          }
          activeRole = input.role;
          return HttpResponse.json({
            ...(activeRole === "owner" ? owner : partner),
            sandboxVersion: version,
          });
        }),
        http.post("*/api/demo/reset", async () => {
          cookieWrites("owner");
          await new Promise<void>((resolve) => {
            releaseOperation = resolve;
          });
          activeRole = "owner";
          version = 2;
          return HttpResponse.json({
            session: { ...owner, sandboxVersion: version },
            guide: { ...guide, sandboxVersion: version },
          });
        }),
        http.get(`*/api/demo/scenarios/${demoScenarioId}`, () =>
          HttpResponse.json({ ...guide, sandboxVersion: version }),
        ),
        http.get("*/api/demo/workspace", () =>
          HttpResponse.json(
            activeRole === "owner"
              ? {
                  role: "owner",
                  organizationId,
                  sandboxVersion: version,
                  conversions: [],
                  auditEvents: [],
                }
              : { ...partnerWorkspace, sandboxVersion: version },
          ),
        ),
      );
      const view = renderSandbox();
      await screen.findByRole("region", { name: /route content/i });
      if (operation === "route") {
        navigation.pathname = "/partner/claims";
        view.rerender(
          <SandboxWorkspaceProvider>
            <section aria-label="Route content">Route content</section>
          </SandboxWorkspaceProvider>,
        );
      } else if (operation === "persona") {
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /switch persona/i }));
        await user.click(screen.getByRole("menuitemradio", { name: /partner view/i }));
      } else {
        fireEvent.click(screen.getByRole("button", { name: /reset sandbox/i }));
        fireEvent.change(screen.getByLabelText(/type reset sandbox/i), {
          target: { value: "RESET SANDBOX" },
        });
        fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
      }
      await waitFor(() => {
        expect(cookieWrites).toHaveBeenCalledWith(delayedRole);
      });

      navigation.pathname = finalRole === "owner" ? "/owner/programs" : "/partner/claims";
      view.rerender(
        <SandboxWorkspaceProvider>
          <section aria-label="Route content">Route content</section>
        </SandboxWorkspaceProvider>,
      );
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        releaseOperation();
      });

      await waitFor(() => {
        expect(cookieWrites).toHaveBeenLastCalledWith(finalRole);
      });
      expect(await screen.findByRole("region", { name: /route content/i })).toBeVisible();
      expect(activeRole).toBe(finalRole);
      expect(cookieWrites.mock.calls.map(([role]) => role)).toEqual([delayedRole, finalRole]);
      expect(
        screen.getByRole("button", {
          name:
            finalRole === "owner"
              ? /current persona.*morgan.*owner/i
              : /current persona.*jamie.*partner/i,
        }),
      ).toBeVisible();
    },
  );

  it("synchronizes a direct partner route with the signed session before rendering children", async () => {
    navigation.pathname = "/partner/claims";
    let activeRole: "owner" | "partner" = "owner";
    const sessionPosts = vi.fn();
    server.use(
      http.get("*/api/demo/session", () =>
        HttpResponse.json(activeRole === "owner" ? owner : partner),
      ),
      http.post("*/api/demo/session", async ({ request }) => {
        sessionPosts(await request.json());
        activeRole = "partner";
        return HttpResponse.json(partner);
      }),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(guide)),
      http.get("*/api/demo/workspace", () => HttpResponse.json(partnerWorkspace)),
      http.get(`*/api/partners/${partner.partnerId}`, () =>
        HttpResponse.json({
          id: partner.partnerId,
          organizationId,
          userId: partner.actorId,
          displayName: partner.displayName,
          email: "jamie@example.invalid",
          phoneE164: "+12025550101",
          status: "active",
          balances: [],
          createdAt: guide.updatedAt,
          updatedAt: guide.updatedAt,
        }),
      ),
      http.get("*/api/earnings", () => HttpResponse.json({ items: [] })),
      http.get("*/api/claims", () => HttpResponse.json({ items: [] })),
    );

    renderSandbox();

    expect(await screen.findByRole("region", { name: /route content/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /current persona.*jamie.*partner/i })).toBeVisible();
    expect(sessionPosts).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ role: "partner", actorId: partner.actorId }),
    );
    expect(screen.getByRole("main")).not.toHaveFocus();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("redirects the root to the existing signed partner workboard without rendering route content", async () => {
    navigation.pathname = "/";
    const sessionPosts = vi.fn();
    server.use(
      http.get("*/api/demo/session", () => HttpResponse.json(partner)),
      http.post("*/api/demo/session", () => {
        sessionPosts();
        return HttpResponse.json(owner);
      }),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(guide)),
      http.get("*/api/demo/workspace", () => HttpResponse.json(partnerWorkspace)),
    );

    renderSandbox();

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith("/partner/workboard");
    });
    expect(sessionPosts).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /route content/i })).not.toBeInTheDocument();
  });

  it("creates a signed demo session and composes route content with the real workspace", async () => {
    server.use(
      http.get("*/api/demo/session", () =>
        HttpResponse.json({ status: "unauthorized" }, { status: 401 }),
      ),
      http.post("*/api/demo/session", () => HttpResponse.json(owner)),
      ...workspaceHandlers(),
    );
    renderSandbox();
    expect(screen.getByRole("status")).toHaveTextContent(/opening the local sandbox/i);
    expect(await screen.findByRole("region", { name: /route content/i })).toHaveTextContent(
      "Route content",
    );
    expect(screen.getByRole("heading", { name: /review the commission program/i })).toBeVisible();
  });

  it("does not flash the old persona while a role switch is loading", async () => {
    let release!: () => void;
    let activeRole: "owner" | "partner" = "owner";
    server.use(
      http.get("*/api/demo/session", () => HttpResponse.json(owner)),
      http.post("*/api/demo/session", async () => {
        await new Promise<void>((resolve) => (release = resolve));
        activeRole = "partner";
        return HttpResponse.json(partner);
      }),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(guide)),
      http.get("*/api/demo/workspace", () =>
        activeRole === "owner"
          ? HttpResponse.json({
              role: "owner",
              organizationId,
              sandboxVersion: 1,
              conversions: [],
              auditEvents: [],
            })
          : HttpResponse.json({
              role: "partner",
              organizationId,
              sandboxVersion: 1,
              partnerId: partner.partnerId,
              referral: {
                code: "JAMIE25",
                publicUrl: "https://referrals.example.invalid/r/JAMIE25",
              },
              ledgerEntries: [],
            }),
      ),
    );
    const user = userEvent.setup();
    renderSandbox();
    await screen.findByRole("region", { name: /route content/i });
    await user.click(screen.getByRole("button", { name: /switch persona/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /partner view/i }));
    expect(screen.queryByRole("region", { name: /route content/i })).not.toBeInTheDocument();
    expect(screen.getByText(/switching workbench/i)).toBeVisible();
    release();
    expect(await screen.findByRole("region", { name: /route content/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /current persona.*jamie.*partner/i })).toBeVisible();
    expect(navigation.replace).toHaveBeenCalledWith("/partner/workboard");
  });

  it("resets to a newly versioned owner workspace and clears the previous state", async () => {
    let version = 1;
    server.use(
      http.get("*/api/demo/session", () => HttpResponse.json(owner)),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () =>
        HttpResponse.json({ ...guide, sandboxVersion: version }),
      ),
      http.get("*/api/demo/workspace", () =>
        HttpResponse.json({
          role: "owner",
          organizationId,
          sandboxVersion: version,
          conversions: [],
          auditEvents: [],
        }),
      ),
      http.post("*/api/demo/reset", () => {
        version = 2;
        return HttpResponse.json({
          session: { ...owner, sandboxVersion: 2 },
          guide: { ...guide, sandboxVersion: 2 },
        });
      }),
    );
    const view = renderSandbox();
    await screen.findByRole("region", { name: /route content/i });
    fireEvent.click(screen.getByRole("button", { name: /reset sandbox/i }));
    fireEvent.change(screen.getByLabelText(/type reset sandbox/i), {
      target: { value: "RESET SANDBOX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    await waitFor(() => expect(screen.getByText(/sandbox reset complete/i)).toBeVisible());
    expect(screen.getByRole("button", { name: /current persona.*morgan.*owner/i })).toBeVisible();
    const resetMain = screen.getByRole("main");
    expect(resetMain).toHaveFocus();

    navigation.pathname = "/owner/programs";
    view.rerender(
      <SandboxWorkspaceProvider>
        <section aria-label="Route content">Programs</section>
      </SandboxWorkspaceProvider>,
    );
    expect(screen.getByRole("main")).toBe(resetMain);
    expect(resetMain).toHaveFocus();
    expect(screen.getByText("programs page ready.")).toHaveAttribute("role", "status");
  });

  it("routes to the authoritative owner workboard after recovering a committed partner reset", async () => {
    navigation.pathname = "/partner/claims";
    let resetCommitted = false;
    let resetWorkspaceReads = 0;
    server.use(
      http.get("*/api/demo/session", () =>
        HttpResponse.json(resetCommitted ? { ...owner, sandboxVersion: 2 } : partner),
      ),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () =>
        HttpResponse.json({ ...guide, sandboxVersion: resetCommitted ? 2 : 1 }),
      ),
      http.get("*/api/demo/workspace", () => {
        if (!resetCommitted) return HttpResponse.json(partnerWorkspace);
        resetWorkspaceReads += 1;
        if (resetWorkspaceReads === 1) {
          return HttpResponse.json({ status: "unavailable" }, { status: 503 });
        }
        return HttpResponse.json({
          role: "owner",
          organizationId,
          sandboxVersion: 2,
          conversions: [],
          auditEvents: [],
        });
      }),
      http.post("*/api/demo/reset", () => {
        resetCommitted = true;
        return HttpResponse.json({
          session: { ...owner, sandboxVersion: 2 },
          guide: { ...guide, sandboxVersion: 2 },
        });
      }),
    );

    renderSandbox();
    await screen.findByRole("region", { name: /route content/i });
    fireEvent.click(screen.getByRole("button", { name: /reset sandbox/i }));
    fireEvent.change(screen.getByLabelText(/type reset sandbox/i), {
      target: { value: "RESET SANDBOX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/signed workspace was reloaded/i);
    expect(screen.getByRole("button", { name: /current persona.*morgan.*owner/i })).toBeVisible();
    expect(navigation.replace).toHaveBeenCalledWith("/owner/workboard");
  });

  it("restores the last-good persona with a visible error when switching fails", async () => {
    server.use(
      http.get("*/api/demo/session", () => HttpResponse.json(owner)),
      http.post("*/api/demo/session", () =>
        HttpResponse.json({ status: "unavailable" }, { status: 503 }),
      ),
      ...workspaceHandlers(),
    );
    const user = userEvent.setup();
    renderSandbox();
    await screen.findByRole("region", { name: /route content/i });
    await user.click(screen.getByRole("button", { name: /switch persona/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /partner view/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/previous workbench is restored/i);
    expect(screen.getByRole("region", { name: /route content/i })).toBeVisible();
  });

  it("never restores old-role records after a session cookie has rotated", async () => {
    let activeRole: "owner" | "partner" = "owner";
    server.use(
      http.get("*/api/demo/session", () =>
        HttpResponse.json(activeRole === "owner" ? owner : partner),
      ),
      http.post("*/api/demo/session", () => {
        activeRole = "partner";
        return HttpResponse.json(partner);
      }),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () =>
        activeRole === "owner"
          ? HttpResponse.json(guide)
          : HttpResponse.json({ status: "unavailable" }, { status: 503 }),
      ),
      http.get("*/api/demo/workspace", () =>
        activeRole === "owner"
          ? HttpResponse.json({
              role: "owner",
              organizationId,
              sandboxVersion: 1,
              conversions: [],
              auditEvents: [],
            })
          : HttpResponse.json({ status: "unavailable" }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    renderSandbox();
    await screen.findByRole("region", { name: /route content/i });
    await user.click(screen.getByRole("button", { name: /switch persona/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /partner view/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not open the local sandbox/i);
    expect(screen.queryByRole("region", { name: /route content/i })).not.toBeInTheDocument();
  });

  it("never restores pre-reset records when the committed reset cannot refresh", async () => {
    let resetCommitted = false;
    server.use(
      http.get("*/api/demo/session", () =>
        HttpResponse.json({ ...owner, sandboxVersion: resetCommitted ? 2 : 1 }),
      ),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () =>
        resetCommitted
          ? HttpResponse.json({ status: "unavailable" }, { status: 503 })
          : HttpResponse.json(guide),
      ),
      http.get("*/api/demo/workspace", () =>
        resetCommitted
          ? HttpResponse.json({ status: "unavailable" }, { status: 503 })
          : HttpResponse.json({
              role: "owner",
              organizationId,
              sandboxVersion: 1,
              conversions: [],
              auditEvents: [],
            }),
      ),
      http.post("*/api/demo/reset", () => {
        resetCommitted = true;
        return HttpResponse.json({
          session: { ...owner, sandboxVersion: 2 },
          guide: { ...guide, sandboxVersion: 2 },
        });
      }),
    );
    renderSandbox();
    await screen.findByRole("region", { name: /route content/i });
    fireEvent.click(screen.getByRole("button", { name: /reset sandbox/i }));
    fireEvent.change(screen.getByLabelText(/type reset sandbox/i), {
      target: { value: "RESET SANDBOX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not open the local sandbox/i);
    expect(screen.queryByRole("region", { name: /route content/i })).not.toBeInTheDocument();
  });

  it("treats an interrupted reset response as uncertain and never restores stale records", async () => {
    let resetStarted = false;
    server.use(
      http.get("*/api/demo/session", () =>
        resetStarted
          ? HttpResponse.json({ status: "unauthorized" }, { status: 401 })
          : HttpResponse.json(owner),
      ),
      http.post("*/api/demo/reset", () => {
        resetStarted = true;
        return HttpResponse.json({ status: "unavailable" }, { status: 503 });
      }),
      ...workspaceHandlers(),
    );
    renderSandbox();
    await screen.findByRole("region", { name: /route content/i });
    fireEvent.click(screen.getByRole("button", { name: /reset sandbox/i }));
    fireEvent.change(screen.getByLabelText(/type reset sandbox/i), {
      target: { value: "RESET SANDBOX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not open the local sandbox/i);
    expect(screen.queryByRole("region", { name: /route content/i })).not.toBeInTheDocument();
  });

  it("keeps an authoritative advanced guide and refreshes records without advancing twice", async () => {
    navigation.pathname = "/owner/programs";
    let workspaceReads = 0;
    let advances = 0;
    server.use(
      http.get("*/api/demo/session", () => HttpResponse.json(owner)),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(guide)),
      http.post(`*/api/demo/scenarios/${demoScenarioId}/advance`, () => {
        advances += 1;
        return HttpResponse.json({
          ...guide,
          stage: "switch_to_partner",
          completedStages: ["review_program"],
        });
      }),
      http.get("*/api/demo/workspace", () => {
        workspaceReads += 1;
        if (workspaceReads === 2) {
          return HttpResponse.json({ status: "unavailable" }, { status: 503 });
        }
        return HttpResponse.json({
          role: "owner",
          organizationId,
          sandboxVersion: 1,
          conversions: [],
          auditEvents: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderSandbox();
    await screen.findByRole("region", { name: /route content/i });

    await user.click(screen.getByRole("button", { name: /mark program reviewed/i }));
    expect(
      await screen.findByRole("heading", { name: /see the partner workbench/i }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /progress was saved.*records could not refresh/i,
    );

    await user.click(screen.getByRole("button", { name: /refresh business records/i }));
    await waitFor(() =>
      expect(screen.queryByText(/records could not refresh/i)).not.toBeInTheDocument(),
    );
    expect(advances).toBe(1);
    expect(workspaceReads).toBe(3);
  });

  it("keeps GET-only recovery available when the committed guide reaches complete", async () => {
    navigation.pathname = "/owner/earnings";
    let workspaceReads = 0;
    let advances = 0;
    const reversalGuide = {
      ...guide,
      stage: "review_reversal",
      completedStages: [
        "review_program",
        "switch_to_partner",
        "create_referral",
        "complete_service",
        "claim_earnings",
        "switch_to_owner",
        "issue_refund",
      ],
    } as const;
    server.use(
      http.get("*/api/demo/session", () => HttpResponse.json(owner)),
      http.get(`*/api/demo/scenarios/${demoScenarioId}`, () => HttpResponse.json(reversalGuide)),
      http.post(`*/api/demo/scenarios/${demoScenarioId}/advance`, () => {
        advances += 1;
        return HttpResponse.json({
          ...reversalGuide,
          stage: "complete",
          completedStages: [...reversalGuide.completedStages, "review_reversal"],
        });
      }),
      http.get("*/api/demo/workspace", () => {
        workspaceReads += 1;
        if (workspaceReads === 2) {
          return HttpResponse.json({ status: "unavailable" }, { status: 503 });
        }
        return HttpResponse.json({
          role: "owner",
          organizationId,
          sandboxVersion: 1,
          conversions: [],
          auditEvents: [],
        });
      }),
    );
    const user = userEvent.setup();
    renderSandbox();
    await screen.findByRole("heading", { name: /review the reversal/i });
    await user.click(screen.getByRole("button", { name: /mark reversal reviewed/i }));

    expect(
      await screen.findByRole("heading", { name: /lifecycle inspection complete/i }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /refresh business records/i }));
    await waitFor(() =>
      expect(screen.queryByText(/records could not refresh/i)).not.toBeInTheDocument(),
    );
    expect(advances).toBe(1);
    expect(workspaceReads).toBe(3);
  });

  it("shows a useful alert when the local API cannot open a session", async () => {
    server.use(
      http.get("*/api/demo/session", () =>
        HttpResponse.json({ status: "unavailable" }, { status: 503 }),
      ),
    );
    renderSandbox();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not open the local sandbox/i);
  });
});
