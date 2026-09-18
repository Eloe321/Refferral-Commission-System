import { UnauthorizedException } from "@nestjs/common";
import type { Actor } from "../../src/auth/actor.js";
import { DemoService } from "../../src/demo/demo.service.js";
import { describe, expect, it, vi } from "vitest";

const actor: Actor = {
  actorId: "11111111-1111-4111-8111-000000000002",
  organizationId: "11111111-1111-4111-8111-000000000001",
  role: "owner",
  partnerId: null,
  displayName: "Morgan Lee",
  sandboxVersion: 1,
};

function serviceWithTransaction(version: number) {
  const tx = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("from organizations")) {
      return Promise.resolve([{ sandbox_version: version, updated_at: new Date() }]);
    }
    return Promise.resolve([]);
  });
  const begin = vi.fn(async (operation: (sql: typeof tx) => Promise<unknown>) => operation(tx));
  const service = new DemoService(
    { APP_MODE: "sandbox" } as never,
    { sql: { begin } } as never,
    {} as never,
    {} as never,
  );
  return { begin, service, tx };
}

describe("demo workspace snapshot", () => {
  it("serializes all owner workspace reads through one transaction", async () => {
    const { begin, service, tx } = serviceWithTransaction(1);
    const workspace = await service.workspace(actor);
    expect(workspace).toMatchObject({ role: "owner", sandboxVersion: 1 });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(tx).toHaveBeenCalledTimes(4);
  });

  it("rejects an actor whose sandbox version changed before the workspace snapshot", async () => {
    const { service, tx } = serviceWithTransaction(2);
    await expect(service.workspace(actor)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx).toHaveBeenCalledTimes(1);
  });
});
