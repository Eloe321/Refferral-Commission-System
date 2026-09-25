import { describe, expect, it, vi } from "vitest";

import type { Actor } from "../../src/auth/actor.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/actor.js";
import { DemoController } from "../../src/demo/demo.controller.js";
import type { DemoService } from "../../src/demo/demo.service.js";

const actor: Actor = {
  actorId: "11111111-1111-4111-8111-000000000002",
  organizationId: "11111111-1111-4111-8111-000000000001",
  role: "partner",
  partnerId: "11111111-1111-4111-8111-000000000003",
  displayName: "Jamie Park",
  sandboxVersion: 1,
};

describe("demo session cookie", () => {
  it("sets a Secure cookie when the original request is HTTPS", async () => {
    const demo = {
      createSession: vi.fn().mockResolvedValue({
        actor,
        value: "signed-session-cookie",
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
      readSession: vi.fn().mockReturnValue(actor),
    } as unknown as DemoService;
    const response = { cookie: vi.fn() };
    const controller = new DemoController(demo);

    await controller.create(
      { role: "partner", actorId: actor.actorId },
      response,
      { secure: true },
    );

    expect(response.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      "signed-session-cookie",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", secure: true }),
    );
  });
});
