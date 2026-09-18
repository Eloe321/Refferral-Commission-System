/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { partnerDetailSchema, partnerSchema } from "@referral-sandbox/contracts";
import { NORTHSTAR_IDS, createDatabaseClient } from "../../../../packages/database/src/index.js";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";

describe("partner detail and state", () => {
  let app: ApiTestApp;
  beforeAll(async () => {
    app = await createApiTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("returns contract-safe balances and protects partner reads", async () => {
    const owner = await ownerAgent(app);
    const partner = await partnerAgent(app);
    const detail = await owner.get(`/partners/${NORTHSTAR_IDS.partners.riley}`).expect(200);
    expect(partnerDetailSchema.parse(detail.body).balances).toEqual([
      { currency: "USD", ledgerMinor: "0", eligibleMinor: "4000", heldMinor: "0" },
    ]);
    const mine = await partner.get(`/partners/${NORTHSTAR_IDS.partners.jamie}`).expect(200);
    expect(partnerDetailSchema.parse(mine.body).id).toBe(NORTHSTAR_IDS.partners.jamie);
    await partner.get(`/partners/${NORTHSTAR_IDS.partners.riley}`).expect(404);
    await owner.get("/partners/not-a-uuid").expect(400);
    const list = await owner.get("/partners").expect(200);
    expect(list.body.map((item: unknown) => partnerSchema.parse(item))).toHaveLength(2);
    expect(list.body[0]).toHaveProperty("displayName");
    expect(list.body[0]).not.toHaveProperty("display_name");
  });

  it("suspends, rejects no-op, and reactivates without releasing holds", async () => {
    const owner = await ownerAgent(app);
    const db = createDatabaseClient(app.databaseUrl, { max: 2 });
    try {
      const suspended = await owner
        .post(`/partners/${NORTHSTAR_IDS.partners.jamie}/suspend`)
        .send({ reason: "Verification review" })
        .expect(201);
      expect(partnerDetailSchema.parse(suspended.body).status).toBe("suspended");
      const held = await db.sql<
        { count: string }[]
      >`select count(*)::text count from earnings where organization_id=${NORTHSTAR_IDS.organization} and partner_id=${NORTHSTAR_IDS.partners.jamie} and status='held'`;
      expect(Number(held[0]?.count)).toBeGreaterThan(0);
      await owner
        .post(`/partners/${NORTHSTAR_IDS.partners.jamie}/suspend`)
        .send({ reason: "Verification review" })
        .expect(409);
      const active = await owner
        .post(`/partners/${NORTHSTAR_IDS.partners.jamie}/reactivate`)
        .send({ reason: "Review complete" })
        .expect(201);
      expect(partnerDetailSchema.parse(active.body).status).toBe("active");
      const stillHeld = await db.sql<
        { count: string }[]
      >`select count(*)::text count from earnings where organization_id=${NORTHSTAR_IDS.organization} and partner_id=${NORTHSTAR_IDS.partners.jamie} and status='held'`;
      expect(stillHeld[0]?.count).toBe(held[0]?.count);
      await owner
        .post(`/partners/${NORTHSTAR_IDS.partners.jamie}/suspend`)
        .send({ reason: "Second review" })
        .expect(201);
      const audits = await db.sql<
        { count: string }[]
      >`select count(*)::text count from audit_events where organization_id=${NORTHSTAR_IDS.organization} and aggregate_id=${NORTHSTAR_IDS.partners.jamie} and action in ('partner.suspended','partner.active')`;
      expect(audits[0]?.count).toBe("3");
    } finally {
      await db.sql.end();
    }
  });
});
