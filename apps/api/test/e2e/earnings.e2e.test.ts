import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  earningListSchema,
  earningViewSchema,
  type ConversionStatus,
  type EarningStatus,
} from "@referral-sandbox/contracts";
import {
  NORTHSTAR_IDS as ids,
  createDatabaseClient,
} from "../../../../packages/database/src/index.js";
import { seedTwoOrganizations } from "../support/database.js";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";

describe("earning mutations", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  let owner: Awaited<ReturnType<typeof ownerAgent>>;
  beforeAll(async () => {
    app = await createApiTestApp();
    db = createDatabaseClient(app.databaseUrl, { max: 2 });
    owner = await ownerAgent(app);
  });
  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });

  async function fixture(
    conversionStatus: ConversionStatus = "completed",
    status: EarningStatus = "eligible",
  ) {
    const conversionId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const id = crypto.randomUUID();
    await db.sql`insert into conversions (id,organization_id,program_id,partner_id,referral_code_id,external_ref,currency,status)
      values (${conversionId},${ids.organization},${ids.program},${ids.partners.jamie},${ids.referralCodes.jamie},${conversionId},'USD',${conversionStatus})`;
    await db.sql`insert into conversion_items (id,organization_id,conversion_id,external_ref,category,position,gross_amount_minor)
      values (${itemId},${ids.organization},${conversionId},${itemId},'plumbing',0,10000)`;
    await db.sql`insert into earnings (id,organization_id,conversion_item_id,program_id,partner_id,rule_id,amount_minor,currency,status,rule_snapshot)
      select ${id},organization_id,${itemId},program_id,${ids.partners.jamie},rule_id,amount_minor,currency,${status},rule_snapshot from earnings where organization_id=${ids.organization} and id=${ids.earnings.eligible}`;
    if (status === "held")
      await db.sql`insert into earning_holds (organization_id,earning_id,previous_status,reason,placed_by) values (${ids.organization},${id},'eligible','Fixture review',${ids.ownerUser})`;
    return { id, conversionId };
  }

  async function audit(id: string) {
    return db.sql<
      { action: string; actor_id: string; reason: string; event_key: string }[]
    >`select action,actor_id,reason,event_key from audit_events where organization_id=${ids.organization} and aggregate_id=${id} order by created_at,id`;
  }
  async function committed(id: string) {
    const response = await owner.get("/earnings").expect(200);
    return earningListSchema.parse(response.body).items.find((item) => item.id === id);
  }
  async function ledger() {
    return db.sql`select * from ledger_entries where organization_id=${ids.organization} order by id`;
  }

  it("holds exactly one earning and commits one actor/reason audit even under duplicate requests", async () => {
    const { id } = await fixture();
    const responses = await Promise.all(
      [1, 2].map(() => owner.post(`/earnings/${id}/hold`).send({ reason: "Review needed" })),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const held = earningViewSchema.parse(
      responses.find((response) => response.status === 201)?.body,
    );
    expect(held).toMatchObject({
      id,
      status: "held",
      holds: [
        {
          previousStatus: "eligible",
          reason: "Review needed",
          placedBy: ids.ownerUser,
          releasedAt: null,
          releasedBy: null,
        },
      ],
    });
    expect(await committed(id)).toEqual(held);
    expect(await audit(id)).toMatchObject([
      { action: "earning.held", actor_id: ids.ownerUser, reason: "Review needed" },
    ]);
    const holds =
      await db.sql`select id from earning_holds where organization_id=${ids.organization} and earning_id=${id}`;
    expect(holds).toHaveLength(1);
  });

  it("releases a completed earning, closes its hold, and rejects duplicate release", async () => {
    const { id } = await fixture("completed", "held");
    const response = await owner
      .post(`/earnings/${id}/release`)
      .send({ reason: "Review cleared" })
      .expect(201);
    const released = earningViewSchema.parse(response.body);
    expect(released).toMatchObject({
      id,
      status: "eligible",
      holds: [{ releasedBy: ids.ownerUser }],
    });
    expect(released.holds[0]?.releasedAt).toEqual(expect.any(String));
    expect(await committed(id)).toEqual(released);
    await owner.post(`/earnings/${id}/release`).send({ reason: "Review cleared" }).expect(409);
    expect(await audit(id)).toMatchObject([
      { action: "earning.released", actor_id: ids.ownerUser, reason: "Review cleared" },
    ]);
  });

  it.each([
    ["scheduled", "pending"],
    ["attributed", "pending"],
    ["completed", "eligible"],
    ["partially_refunded", "eligible"],
    ["refunded", "eligible"],
    ["cancelled", "voided"],
    ["no_show", "voided"],
  ] as const)(
    "maps hold release for %s to %s through the database",
    async (conversionStatus, status) => {
      const { id } = await fixture(conversionStatus, "held");
      const response = await owner
        .post(`/earnings/${id}/release`)
        .send({ reason: "Review cleared" })
        .expect(201);
      const released = earningViewSchema.parse(response.body);
      expect(released.status).toBe(status);
      expect(released.holds[0]?.releasedBy).toBe(ids.ownerUser);
      expect(await committed(id)).toEqual(released);
    },
  );

  it("closes an active hold when voiding without changing ledger entries", async () => {
    const { id } = await fixture("completed", "held");
    const before = await ledger();
    const response = await owner
      .post(`/earnings/${id}/void`)
      .send({ reason: "Invalid referral" })
      .expect(201);
    const voided = earningViewSchema.parse(response.body);
    expect(voided).toMatchObject({ id, status: "voided", holds: [{ releasedBy: ids.ownerUser }] });
    expect(voided.holds[0]?.releasedAt).toEqual(expect.any(String));
    expect(await committed(id)).toEqual(voided);
    await owner.post(`/earnings/${id}/void`).send({ reason: "Invalid referral" }).expect(409);
    expect(await audit(id)).toMatchObject([
      { action: "earning.voided", actor_id: ids.ownerUser, reason: "Invalid referral" },
    ]);
    expect(await ledger()).toEqual(before);
  });

  it.each(["settled", "reversed"] as const)(
    "rejects void of %s with a safe reversal-required conflict",
    async (status) => {
      const { id } = await fixture("completed", status);
      const before =
        await db.sql`select * from earnings where organization_id=${ids.organization} and id=${id}`;
      const beforeLedger = await ledger();
      const response = await owner
        .post(`/earnings/${id}/void`)
        .send({ reason: "Invalid referral" })
        .expect(409);
      expect(response.body).toEqual({ status: "reversal_required" });
      expect(
        await db.sql`select * from earnings where organization_id=${ids.organization} and id=${id}`,
      ).toEqual(before);
      expect(await audit(id)).toHaveLength(0);
      expect(await ledger()).toEqual(beforeLedger);
    },
  );

  it("creates distinct audits for repeated genuine hold/release cycles", async () => {
    const { id } = await fixture();
    for (const action of ["hold", "release", "hold", "release"]) {
      const response = await owner
        .post(`/earnings/${id}/${action}`)
        .send({ reason: "Review cycle" })
        .expect(201);
      earningViewSchema.parse(response.body);
    }
    const audits = await audit(id);
    expect(audits).toHaveLength(4);
    expect(new Set(audits.map((row) => row.event_key)).size).toBe(4);
  });

  it("protects owner mutations, validates strict reason bodies, and hides other tenants", async () => {
    const partner = await partnerAgent(app);
    const { id } = await fixture();
    const foreign = await seedTwoOrganizations(db);
    const before =
      await db.sql`select * from earnings where organization_id=${foreign.orgA.id} and id=${foreign.orgA.earning.id}`;
    for (const action of ["hold", "release", "void"]) {
      const forbidden = await partner
        .post(`/earnings/${id}/${action}`)
        .send({ reason: "Review reason" })
        .expect(403);
      expect(forbidden.body).toEqual({ status: "forbidden" });
      for (const target of [crypto.randomUUID(), foreign.orgA.earning.id]) {
        const missing = await owner
          .post(`/earnings/${target}/${action}`)
          .send({ reason: "Review reason" })
          .expect(404);
        expect(missing.body).toEqual({ status: "not_found" });
      }
      await owner
        .post(`/earnings/not-a-uuid/${action}`)
        .send({ reason: "Review reason" })
        .expect(400);
      for (const body of [
        { reason: "ab" },
        { reason: "   " },
        { reason: "Valid reason", extra: true },
        {},
      ]) {
        const invalid = await owner.post(`/earnings/${id}/${action}`).send(body).expect(400);
        expect(invalid.body).toEqual({ status: "invalid_request" });
      }
    }
    expect(
      await db.sql`select * from earnings where organization_id=${foreign.orgA.id} and id=${foreign.orgA.earning.id}`,
    ).toEqual(before);
    expect(await audit(id)).toHaveLength(0);
    expect(
      await db.sql`select id from audit_events where organization_id=${foreign.orgA.id}`,
    ).toHaveLength(0);
  });

  it("returns a strict list in stable item-position/id order and limits partners to their own earnings", async () => {
    const response = await owner
      .get(`/earnings?conversionId=${ids.conversions.scheduled}`)
      .expect(200);
    expect(earningListSchema.parse(response.body).items.map((item) => item.id)).toEqual([
      ids.earnings.scheduledPlumbing,
      ids.earnings.scheduledElectrical,
    ]);
    const all = earningListSchema.parse((await owner.get("/earnings").expect(200)).body).items;
    const ordered = await db.sql<
      { id: string }[]
    >`select e.id from earnings e join conversion_items ci on ci.organization_id=e.organization_id and ci.id=e.conversion_item_id where e.organization_id=${ids.organization} order by ci.position,e.id`;
    expect(all.map((item) => item.id)).toEqual(ordered.map((row) => row.id));
    const partner = await partnerAgent(app);
    const mine = earningListSchema.parse((await partner.get("/earnings").expect(200)).body).items;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((item) => item.partnerId === ids.partners.jamie)).toBe(true);
    await owner.get("/earnings?conversionId=not-a-uuid").expect(400);
  });
});
