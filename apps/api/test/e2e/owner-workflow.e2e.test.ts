/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, NORTHSTAR_IDS } from "../../../../packages/database/src/index.js";
import { earningListSchema, programSchema } from "@referral-sandbox/contracts";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";
import { seedTwoOrganizations } from "../support/database.js";

describe("owner referral workflow", () => {
  let app: ApiTestApp;
  beforeAll(async () => {
    app = await createApiTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("creates, completes, and safely replays a referral conversion", async () => {
    const owner = await ownerAgent(app);
    const body = {
      idempotencyKey: "conversion-demo-1",
      externalRef: "SERVICE-DEMO-1",
      programId: NORTHSTAR_IDS.program,
      referralCode: "JAMIE12",
      currency: "USD",
      items: [
        { externalRef: "SERVICE-DEMO-PLUMBING", category: "plumbing", grossAmountMinor: "18000" },
        { externalRef: "SERVICE-DEMO-CLEANING", category: "cleaning", grossAmountMinor: "8000" },
      ],
    };
    const created = await owner.post("/conversions").send(body).expect(201);
    expect(created.body).toMatchObject({ status: "scheduled", currency: "USD" });
    expect(
      created.body.items.map(
        (item: { grossAmount: { amountMinor: string } }) => item.grossAmount.amountMinor,
      ),
    ).toEqual(["18000", "8000"]);
    const replay = await owner.post("/conversions").send(body).expect(201);
    expect(replay.body.id).toBe(created.body.id);
    const completed = await owner
      .post(`/conversions/${created.body.id}/complete`)
      .set("Idempotency-Key", "complete-demo-1")
      .send({})
      .expect(201);
    const completionReplay = await owner
      .post(`/conversions/${created.body.id}/complete`)
      .set("Idempotency-Key", "complete-demo-1")
      .send({})
      .expect(201);
    expect(completionReplay.body).toEqual(completed.body);
    await owner
      .post(`/conversions/${created.body.id}/complete`)
      .set("Idempotency-Key", "complete-other-key")
      .send({})
      .expect(409);
    const earnings = await owner.get(`/earnings?conversionId=${created.body.id}`).expect(200);
    const items = earningListSchema.parse(earnings.body).items;
    expect(items.map((earning) => earning.status)).toEqual(["eligible", "eligible"]);
    expect(items.map((earning) => earning.amount.amountMinor)).toEqual(["2500", "640"]);
    for (const [route, status, reason] of [
      ["pause", "paused", "Pause for review"],
      ["resume", "active", "Resume after review"],
      ["pause", "paused", "Pause for holiday"],
    ] as const) {
      const response = await owner
        .post(`/programs/${NORTHSTAR_IDS.program}/${route}`)
        .send({ reason })
        .expect(201);
      expect(programSchema.parse(response.body).status).toBe(status);
      await owner.post(`/programs/${NORTHSTAR_IDS.program}/${route}`).send({ reason }).expect(409);
      if (status === "paused")
        expect(
          (
            await owner
              .post("/conversions")
              .send({ ...body, idempotencyKey: `paused-${route}-${reason}`, externalRef: reason })
              .expect(409)
          ).body,
        ).toEqual({ status: "program_paused" });
    }
    const db = createDatabaseClient(app.databaseUrl, { max: 4 });
    try {
      const events =
        await db.sql`select action,actor_id,reason from audit_events where aggregate_id in (${created.body.id as string},${NORTHSTAR_IDS.program}) order by created_at,id`;
      expect([...events]).toEqual([
        {
          action: "conversion.created",
          actor_id: NORTHSTAR_IDS.ownerUser,
          reason: "Referral conversion created",
        },
        {
          action: "conversion.completed",
          actor_id: NORTHSTAR_IDS.ownerUser,
          reason: "Conversion completed",
        },
        { action: "program.paused", actor_id: NORTHSTAR_IDS.ownerUser, reason: "Pause for review" },
        {
          action: "program.active",
          actor_id: NORTHSTAR_IDS.ownerUser,
          reason: "Resume after review",
        },
        {
          action: "program.paused",
          actor_id: NORTHSTAR_IDS.ownerUser,
          reason: "Pause for holiday",
        },
      ]);
      const records = await db.sql`select scope from idempotency_records order by scope`;
      expect([...records]).toEqual([
        { scope: `conversion.complete:${created.body.id}` },
        { scope: "conversion.create" },
      ]);
    } finally {
      await db.sql.end();
    }
  });
  it("hides foreign conversions from owner mutations and attribution", async () => {
    const owner = await ownerAgent(app);
    const db = createDatabaseClient(app.databaseUrl, { max: 4 });
    try {
      const foreign = await seedTwoOrganizations(db);
      const [conversion] = await db.sql<
        { id: string; program_id: string }[]
      >`select id,program_id from conversions where organization_id=${foreign.orgA.id}`;
      if (!conversion) throw new Error("Missing foreign fixture");
      for (const route of ["complete", "cancel", "no-show"]) {
        expect(
          (
            await owner
              .post(`/conversions/${conversion.id}/${route}`)
              .set("Idempotency-Key", "foreign-conversion")
              .send({ reason: "Foreign attempt" })
              .expect(404)
          ).body,
        ).toEqual({ status: "not_found" });
      }
      await owner
        .post("/conversions")
        .send({
          idempotencyKey: "foreign-attribution",
          externalRef: "FOREIGN",
          programId: conversion.program_id,
          referralCode: "TEST",
          currency: "USD",
          items: [{ externalRef: "FOREIGN-A", category: "test", grossAmountMinor: "100" }],
        })
        .expect(404);
      expect(
        earningListSchema.parse(
          (await owner.get(`/earnings?conversionId=${conversion.id}`).expect(200)).body,
        ).items,
      ).toEqual([]);
      const state = await db.sql`select status from conversions where id=${conversion.id}`;
      expect([...state]).toEqual([{ status: "attributed" }]);
      expect(
        await db.sql`select id from idempotency_records where idempotency_key in ('foreign-conversion','foreign-attribution')`,
      ).toHaveLength(0);
      expect(
        await db.sql`select id from audit_events where organization_id=${foreign.orgA.id}`,
      ).toHaveLength(0);
    } finally {
      await db.sql.end();
    }
  });
  it("rejects duplicate item references, malformed inputs, and partner mutations", async () => {
    const owner = await ownerAgent(app);
    const partner = await partnerAgent(app);
    const body = {
      idempotencyKey: "invalid-items",
      externalRef: "INVALID",
      programId: NORTHSTAR_IDS.program,
      referralCode: "JAMIE12",
      currency: "USD",
      items: [{ externalRef: "DUP", category: "plumbing", grossAmountMinor: "100" }],
    };
    await owner
      .post("/conversions")
      .send({ ...body, items: [...body.items, ...body.items] })
      .expect(400);
    await owner
      .post("/conversions")
      .send({ ...body, programId: "invalid" })
      .expect(400);
    await partner.post("/conversions").send(body).expect(403);
    for (const route of ["complete", "cancel", "no-show"]) {
      await owner
        .post(`/conversions/invalid/${route}`)
        .set("Idempotency-Key", "valid-test-key")
        .send({ reason: "Test invalid" })
        .expect(400);
      await owner
        .post(`/conversions/${crypto.randomUUID()}/${route}`)
        .set("Idempotency-Key", "valid-test-key")
        .send({ reason: "Test missing" })
        .expect(404);
      await partner
        .post(`/conversions/${NORTHSTAR_IDS.conversions.scheduled}/${route}`)
        .set("Idempotency-Key", "valid-test-key")
        .send({ reason: "Test forbidden" })
        .expect(403);
    }
    for (const key of ["", "short", "x".repeat(121)])
      await owner
        .post(`/conversions/${NORTHSTAR_IDS.conversions.scheduled}/complete`)
        .set("Idempotency-Key", key)
        .send({})
        .expect(400);
    await owner.get("/earnings?conversionId=invalid").expect(400);
    await owner.get("/earnings?unexpected=true").expect(400);
  });
});
