/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  demoSessionSchema,
  demoWorkspaceSchema,
  guideStateSchema,
  resetSandboxResponseSchema,
} from "@referral-sandbox/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, NORTHSTAR_IDS } from "../../../../packages/database/src/index.js";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";
import { seedTwoOrganizations } from "../support/database.js";

const scenario = "northstar-referral-lifecycle";
const key = (label: string) => `guide-${label}-12345678`;

describe("guided business sandbox", () => {
  let app: ApiTestApp;

  beforeAll(async () => {
    app = await createApiTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires the signed owner to complete the guided service and rejects the partner", async () => {
    const serviceApp = await createApiTestApp();
    try {
      const owner = await ownerAgent(serviceApp);
      const partner = await partnerAgent(serviceApp);
      for (const [agent, stage] of [
        [owner, "review"],
        [partner, "switch"],
        [partner, "referral"],
      ] as const) {
        await agent
          .post(`/demo/scenarios/${scenario}/advance`)
          .set("Idempotency-Key", key(`service-role-${stage}`))
          .send({})
          .expect(201);
      }

      const rejected = await partner
        .post(`/demo/scenarios/${scenario}/advance`)
        .set("Idempotency-Key", key("service-role-partner"))
        .send({})
        .expect(409);
      expect(rejected.body).toMatchObject({
        status: "guide_validation_failed",
        stage: "complete_service",
      });
      expect(
        guideStateSchema.parse((await owner.get(`/demo/scenarios/${scenario}`).expect(200)).body)
          .stage,
      ).toBe("complete_service");

      const completed = await owner
        .post(`/demo/scenarios/${scenario}/advance`)
        .set("Idempotency-Key", key("service-role-owner"))
        .send({})
        .expect(201);
      expect(guideStateSchema.parse(completed.body).stage).toBe("claim_earnings");
      const workspace = demoWorkspaceSchema.parse(
        (await owner.get("/demo/workspace").expect(200)).body,
      );
      if (workspace.role !== "owner") throw new Error("Expected owner workspace");
      expect(
        workspace.conversions.find((item) => item.externalRef.startsWith("GUIDE-REFERRAL-")),
      ).toMatchObject({ status: "completed" });
      const earnings = (await partner.get("/earnings").expect(200)).body.items as Array<{
        status: string;
        ruleSnapshot: Record<string, unknown>;
      }>;
      expect(
        earnings.find((earning) => earning.ruleSnapshot.scenarioId === scenario),
      ).toMatchObject({
        status: "eligible",
      });
    } finally {
      await serviceApp.close();
    }
  });

  it("advances one server-observed stage without skips and replays idempotently", async () => {
    const owner = await ownerAgent(app);
    const initialSession = demoSessionSchema.parse(
      (await owner.get("/demo/session").expect(200)).body,
    );
    expect(initialSession.sandboxVersion).toBe(1);

    const initial = guideStateSchema.parse(
      (await owner.get(`/demo/scenarios/${scenario}`).expect(200)).body,
    );
    expect(initial).toMatchObject({ stage: "review_program", completedStages: [] });

    const reviewed = guideStateSchema.parse(
      (
        await owner
          .post(`/demo/scenarios/${scenario}/advance`)
          .set("Idempotency-Key", key("review"))
          .send({})
          .expect(201)
      ).body,
    );
    expect(reviewed.stage).toBe("switch_to_partner");
    const replay = guideStateSchema.parse(
      (
        await owner
          .post(`/demo/scenarios/${scenario}/advance`)
          .set("Idempotency-Key", key("review"))
          .send({})
          .expect(201)
      ).body,
    );
    expect(replay).toEqual(reviewed);
    await owner
      .post(`/demo/scenarios/${scenario}/advance`)
      .set("Idempotency-Key", key("wrong-role"))
      .send({})
      .expect(409);

    const partner = await partnerAgent(app);
    expect(
      guideStateSchema.parse(
        (
          await partner
            .post(`/demo/scenarios/${scenario}/advance`)
            .set("Idempotency-Key", key("partner"))
            .send({})
            .expect(201)
        ).body,
      ).stage,
    ).toBe("create_referral");
    expect(
      guideStateSchema.parse(
        (
          await partner
            .post(`/demo/scenarios/${scenario}/advance`)
            .set("Idempotency-Key", key("referral"))
            .send({})
            .expect(201)
        ).body,
      ).stage,
    ).toBe("complete_service");
    expect(
      guideStateSchema.parse(
        (
          await owner
            .post(`/demo/scenarios/${scenario}/advance`)
            .set("Idempotency-Key", key("service"))
            .send({})
            .expect(201)
        ).body,
      ).stage,
    ).toBe("claim_earnings");

    const earnings = (await partner.get("/earnings").expect(200)).body.items as Array<{
      id: string;
      status: string;
      ruleSnapshot: Record<string, unknown>;
    }>;
    const scenarioEarning = earnings.find(
      (earning) => earning.ruleSnapshot.scenarioId === scenario,
    );
    expect(scenarioEarning).toMatchObject({ status: "eligible" });
    const challenge = await partner
      .post("/otp-challenges")
      .send({ earningIds: [scenarioEarning?.id], channel: "sms" })
      .expect(201);
    const code = challenge.body.delivery.preview.code as string;
    await partner
      .post(`/otp-challenges/${String(challenge.body.id)}/verify`)
      .send({ code })
      .expect(201);
    const claim = await partner
      .post("/claims")
      .set("Idempotency-Key", key("claim"))
      .send({ challengeId: challenge.body.id, earningIds: [scenarioEarning?.id] })
      .expect(201);
    expect(
      guideStateSchema.parse(
        (
          await partner
            .post(`/demo/scenarios/${scenario}/advance`)
            .set("Idempotency-Key", key("claimed"))
            .send({})
            .expect(201)
        ).body,
      ).stage,
    ).toBe("switch_to_owner");

    const ownerAgain = await ownerAgent(app);
    expect(
      guideStateSchema.parse(
        (
          await ownerAgain
            .post(`/demo/scenarios/${scenario}/advance`)
            .set("Idempotency-Key", key("owner"))
            .send({})
            .expect(201)
        ).body,
      ).stage,
    ).toBe("issue_refund");
    await ownerAgain
      .post(`/claims/${String(claim.body.id)}/simulate`)
      .set("Idempotency-Key", key("settle-claim"))
      .send({ outcome: "success" })
      .expect(201);
    const workspace = demoWorkspaceSchema.parse(
      (await ownerAgain.get("/demo/workspace").expect(200)).body,
    );
    if (workspace.role !== "owner") throw new Error("Expected owner workspace");
    const conversion = workspace.conversions.find((item) =>
      item.externalRef.startsWith("GUIDE-REFERRAL-"),
    );
    const conversionItem = conversion?.items[0];
    expect(conversionItem).toBeDefined();
    await ownerAgain
      .post(`/conversions/${String(conversion?.id)}/refund`)
      .set("Idempotency-Key", key("refund"))
      .send({
        reason: "Guided customer refund",
        items: [{ conversionItemId: conversionItem?.id, refundedBaseMinor: "1000" }],
      })
      .expect(201);
    expect(
      guideStateSchema.parse(
        (
          await ownerAgain
            .post(`/demo/scenarios/${scenario}/advance`)
            .set("Idempotency-Key", key("refund-check"))
            .send({})
            .expect(201)
        ).body,
      ).stage,
    ).toBe("review_reversal");
    const completed = guideStateSchema.parse(
      (
        await ownerAgain
          .post(`/demo/scenarios/${scenario}/advance`)
          .set("Idempotency-Key", key("reversal"))
          .send({})
          .expect(201)
      ).body,
    );
    expect(completed.stage).toBe("complete");
    expect(completed.completedStages).toHaveLength(8);
  });

  it("returns role-scoped serialized workspaces without private referral data", async () => {
    const database = createDatabaseClient(app.databaseUrl, { max: 1 });
    try {
      const foreign = await seedTwoOrganizations(database);
      const owner = demoWorkspaceSchema.parse(
        (await (await ownerAgent(app)).get("/demo/workspace").expect(200)).body,
      );
      expect(owner.role).toBe("owner");
      expect(JSON.stringify(owner)).not.toContain(foreign.orgA.id);

      const partner = demoWorkspaceSchema.parse(
        (await (await partnerAgent(app)).get("/demo/workspace").expect(200)).body,
      );
      expect(partner.role).toBe("partner");
      expect(JSON.stringify(partner)).not.toMatch(/sandbox_session|phoneE164|email/i);
      if (partner.role === "partner") {
        expect(partner.referral.publicUrl).toBe("https://referrals.example.invalid/r/JAMIE12");
        expect(partner.ledgerEntries.every((entry) => entry.partnerId === partner.partnerId)).toBe(
          true,
        );
      }
    } finally {
      await database.sql.end();
    }
  });

  it("resets atomically, increments version, rotates owner session, and preserves foreign tenants", async () => {
    const owner = await ownerAgent(app);
    const partner = await partnerAgent(app);
    await partner.post("/demo/reset").send({ confirmation: "RESET SANDBOX" }).expect(403);
    await owner.post("/demo/reset").send({ confirmation: "wrong" }).expect(400);

    const oldSession = await app.request
      .post("/demo/session")
      .send({ role: "owner", actorId: NORTHSTAR_IDS.ownerUser })
      .expect(201);
    const oldCookie = oldSession.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
    const database = createDatabaseClient(app.databaseUrl, { max: 1 });
    try {
      const foreign = await seedTwoOrganizations(database);
      const reset = await owner
        .post("/demo/reset")
        .send({ confirmation: "RESET SANDBOX" })
        .expect(201);
      const parsed = resetSandboxResponseSchema.parse(reset.body);
      expect(parsed.session).toMatchObject({ role: "owner", sandboxVersion: 2 });
      expect(parsed.guide).toMatchObject({ stage: "review_program", completedStages: [] });
      expect(reset.headers["set-cookie"]?.[0]).toMatch(/sandbox_session=/);
      await app.request.get("/demo/session").set("Cookie", oldCookie).expect(401);

      const [counts] = await database.sql<
        { conversions: number; earnings: number; version: number }[]
      >`select
          (select count(*)::int from conversions where organization_id=${NORTHSTAR_IDS.organization}) conversions,
          (select count(*)::int from earnings where organization_id=${NORTHSTAR_IDS.organization}) earnings,
          (select sandbox_version from organizations where id=${NORTHSTAR_IDS.organization}) version`;
      expect(counts).toEqual({ conversions: 4, earnings: 5, version: 2 });
      expect(
        await database.sql`select id from organizations where id in (${foreign.orgA.id},${foreign.orgB.id}) order by id`,
      ).toHaveLength(2);

      await database.sql`create or replace function fail_northstar_seed() returns trigger language plpgsql as $$ begin raise exception 'forced seed failure'; end $$`;
      await database.sql`create trigger fail_northstar_seed before insert on organizations for each row execute function fail_northstar_seed()`;
      await owner.post("/demo/reset").send({ confirmation: "RESET SANDBOX" }).expect(500);
      const [afterFailure] = await database.sql<
        { version: number; conversions: number }[]
      >`select sandbox_version version,
          (select count(*)::int from conversions where organization_id=${NORTHSTAR_IDS.organization}) conversions
          from organizations where id=${NORTHSTAR_IDS.organization}`;
      expect(afterFailure).toEqual({ version: 2, conversions: 4 });
      await database.sql`drop trigger fail_northstar_seed on organizations`;
      await database.sql`drop function fail_northstar_seed()`;
    } finally {
      await database.sql.end();
    }
  });

  it("hides every demo route outside sandbox mode", async () => {
    const production = await createApiTestApp({ appMode: "production" });
    try {
      await production.request.get("/demo/workspace").expect(404);
      await production.request
        .post("/demo/reset")
        .send({ confirmation: "RESET SANDBOX" })
        .expect(404);
    } finally {
      await production.close();
    }
  });
});
