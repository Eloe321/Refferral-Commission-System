import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commissionRuleSchema, previewCommissionSchema, programSchema, referralCodeSchema } from "@referral-sandbox/contracts";
import { createDatabaseClient, NORTHSTAR_IDS } from "../../../../packages/database/src/index.js";
import { ProgramsService } from "../../src/programs/programs.service.js";
import { AuditService } from "../../src/common/audit.service.js";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";

const rule = (category: string | null = "windows") => ({
  type: "flat" as const,
  category,
  partnerId: null as string | null,
  flatAmountMinor: "1500",
  basisPoints: null,
  effectiveFrom: "2030-01-01T00:00:00Z",
  effectiveTo: "2030-02-01T00:00:00Z" as string | null,
});

describe("program and rule contracts", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  const foreignOrg = crypto.randomUUID();
  const foreignProgram = crypto.randomUUID();
  const foreignPartner = crypto.randomUUID();
  const foreignOwner = crypto.randomUUID();
  beforeAll(async () => {
    app = await createApiTestApp();
    db = createDatabaseClient(app.databaseUrl, { max: 4 });
    await db.sql`insert into organizations (id,name,currency) values (${foreignOrg},'Euro fixture','EUR')`;
    await db.sql`insert into users (id,organization_id,display_name,role) values (${foreignOwner},${foreignOrg},'Euro owner','owner')`;
    await db.sql`insert into partners (id,organization_id,user_id,display_name,email,phone_e164) values (${foreignPartner},${foreignOrg},${foreignOwner},'Euro partner','fixture@example.com','+12025550199')`;
    await db.sql`insert into programs (id,organization_id,name) values (${foreignProgram},${foreignOrg},'Euro program')`;
  });
  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });

  it("lists complete strict programs and rule responses", async () => {
    const owner = await ownerAgent(app);
    const programs = programSchema.array().parse((await owner.get("/programs").expect(200)).body);
    expect(programs).toHaveLength(1);
    expect(programs[0]?.rules).toHaveLength(3);
    const rules = commissionRuleSchema
      .array()
      .parse((await owner.get(`/programs/${NORTHSTAR_IDS.program}/rules`).expect(200)).body);
    expect(rules).toEqual(programs[0]?.rules);
  });
  it("creates valid dated rules and allows adjacent half-open boundaries", async () => {
    const owner = await ownerAgent(app);
    const path = `/programs/${NORTHSTAR_IDS.program}/rules`;
    const first = commissionRuleSchema
      .array()
      .parse((await owner.post(path).send(rule()).expect(201)).body);
    expect(first.find((r) => r.category === "windows")).toMatchObject({
      flatAmount: { amountMinor: "1500", currency: "USD" },
    });
    await owner
      .post(path)
      .send({
        ...rule(),
        effectiveFrom: "2030-02-01T08:00:00+08:00",
        effectiveTo: "2030-03-01T00:00:00Z",
      })
      .expect(201);
    for (const input of [
      rule(),
      { ...rule(), effectiveFrom: "2029-12-01T00:00:00Z", effectiveTo: "2030-01-15T00:00:00Z" },
      { ...rule(), effectiveFrom: "2030-01-15T00:00:00Z", effectiveTo: null },
    ]) {
      expect((await owner.post(path).send(input).expect(409)).body).toEqual({
        status: "rule_overlap",
      });
    }
    await owner
      .post(path)
      .send({ ...rule(), effectiveFrom: "2030-03-01T00:00:00Z", effectiveTo: null })
      .expect(201);
    await owner
      .post(path)
      .send({ ...rule(), effectiveFrom: "2031-01-01T00:00:00Z", effectiveTo: null })
      .expect(409);
  });
  it("serializes concurrent NULL-scope overlaps but allows independent partner scopes", async () => {
    const a = await ownerAgent(app);
    const b = await ownerAgent(app);
    const program = crypto.randomUUID();
    await db.sql`insert into programs (id,organization_id,name) values (${program},${NORTHSTAR_IDS.organization},'Race program')`;
    const path = `/programs/${program}/rules`;
    const responses = await Promise.all([
      a.post(path).send(rule(null)),
      b.post(path).send(rule(null)),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    await a
      .post(path)
      .send({ ...rule(null), partnerId: NORTHSTAR_IDS.partners.jamie })
      .expect(201);
    await a
      .post(path)
      .send({ ...rule(null), partnerId: NORTHSTAR_IDS.partners.jamie })
      .expect(409);
    const audit =
      await db.sql`select actor_id,reason from audit_events where aggregate_id in (select id from commission_rules where program_id=${program})`;
    expect([...audit]).toEqual(
      Array.from({ length: 2 }, () => ({
        actor_id: NORTHSTAR_IDS.ownerUser,
        reason: "Commission rule created",
      })),
    );
  });
  it.each(["rules", "pause", "resume"])(
    "rejects malformed, missing, and foreign program ids for %s",
    async (route) => {
      const owner = await ownerAgent(app);
      for (const [id, status] of [
        ["invalid", 400],
        [crypto.randomUUID(), 404],
        [foreignProgram, 404],
      ] as const) {
        if (route === "rules") await owner.get(`/programs/${id}/rules`).expect(status);
        const result = await owner
          .post(`/programs/${id}/${route}`)
          .send(route === "rules" ? rule() : { reason: "Test transition" })
          .expect(status);
        expect(result.body).toEqual({ status: status === 400 ? "invalid_request" : "not_found" });
      }
    },
  );
  it("rejects foreign or missing partners and partner mutations", async () => {
    const owner = await ownerAgent(app);
    const partner = await partnerAgent(app);
    for (const partnerId of [foreignPartner, crypto.randomUUID()])
      await owner
        .post(`/programs/${NORTHSTAR_IDS.program}/rules`)
        .send({ ...rule("ownership"), partnerId })
        .expect(404);
    for (const route of ["rules", "pause", "resume"])
      await partner
        .post(`/programs/${NORTHSTAR_IDS.program}/${route}`)
        .send(route === "rules" ? rule() : { reason: "Test transition" })
        .expect(403);
  });
  it.each([
    ["2030-01-01T00:00:00Z", "2030-01-01T00:00:00Z"],
    ["2030-01-02T00:00:00Z", "2030-01-01T00:00:00Z"],
    ["2030-01-01T00:00:00+25:00", null],
    ["2030-01-01T00:00:00Z", "2030-01-01T00:00:00+99:00"],
  ])("rejects invalid effective range %s / %s", async (effectiveFrom, effectiveTo) => {
    const owner = await ownerAgent(app);
    await owner
      .post(`/programs/${NORTHSTAR_IDS.program}/rules`)
      .send({ ...rule("invalid"), effectiveFrom, effectiveTo })
      .expect(400);
  });
  it("uses the actor organization's EUR currency throughout rule and program reads", async () => {
    const service = new ProgramsService(db, new AuditService(db));
    const actor = {
      actorId: foreignOwner,
      organizationId: foreignOrg,
      role: "owner" as const,
      partnerId: null,
      displayName: "Euro owner",
      sandboxVersion: 1,
    };
    const created = commissionRuleSchema
      .array()
      .parse(await service.createRule(actor, foreignProgram, rule()));
    expect(created[0]).toMatchObject({ flatAmount: { amountMinor: "1500", currency: "EUR" } });
    expect(commissionRuleSchema.array().parse(await service.rules(actor, foreignProgram))).toEqual(
      created,
    );
    expect(programSchema.array().parse(await service.list(actor))[0]?.rules).toEqual(created);
    expect(
      programSchema.parse(await service.state(actor, foreignProgram, "paused", "Euro pause")).rules,
    ).toEqual(created);
  });
  it("lets only the owner create a program and assign a unique referral code", async () => {
    const owner = await ownerAgent(app);
    const partner = await partnerAgent(app);
    await partner.post("/programs").send({ name: "New service line" }).expect(403);
    const program = programSchema.parse((await owner.post("/programs").send({ name: "New service line" }).expect(201)).body);
    expect(program).toMatchObject({ name: "New service line", status: "active", rules: [] });
    const path = `/programs/${program.id}/codes`;
    const code = referralCodeSchema.parse((await owner.post(path).send({ partnerId: NORTHSTAR_IDS.partners.jamie, code: "NEWLINE42" }).expect(201)).body);
    expect(code).toMatchObject({ programId: program.id, partnerId: NORTHSTAR_IDS.partners.jamie, code: "NEWLINE42", active: true });
    expect(referralCodeSchema.array().parse((await owner.get(path).expect(200)).body)).toContainEqual(code);
    await owner.post(path).send({ partnerId: NORTHSTAR_IDS.partners.jamie, code: "newline42" }).expect(409);
    await owner.post(path).send({ partnerId: foreignPartner, code: "FOREIGN42" }).expect(404);
    await partner.get(path).expect(403);
  });
  it("previews the server-selected rule and exact amount before a booking", async () => {
    const owner = await ownerAgent(app);
    const partner = await partnerAgent(app);
    const path = `/programs/${NORTHSTAR_IDS.program}/preview`;
    const input = { partnerId: NORTHSTAR_IDS.partners.jamie, category: "electrical", grossAmountMinor: "20000" };
    expect(previewCommissionSchema.parse((await owner.post(path).send(input).expect(201)).body)).toEqual({
      ruleId: NORTHSTAR_IDS.rules.jamieElectrical,
      programStatus: "active",
      scope: "partner_category",
      amount: { amountMinor: "2400", currency: "USD" },
    });
    await partner.post(path).send(input).expect(403);
    await owner.post(path).send({ ...input, partnerId: foreignPartner }).expect(404);
  });
});
