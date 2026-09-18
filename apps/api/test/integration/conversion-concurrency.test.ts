/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NORTHSTAR_IDS } from "../../../../packages/database/src/index.js";
import { createApiTestApp, ownerAgent, type ApiTestApp } from "../support/http.js";

describe("durable conversion idempotency", () => {
  let app: ApiTestApp;
  beforeAll(async () => {
    app = await createApiTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  it("serializes concurrent requests from independent HTTP transactions", async () => {
    const one = await ownerAgent(app);
    const two = await ownerAgent(app);
    const body = {
      idempotencyKey: "concurrent-demo-1",
      externalRef: "CONCURRENT-1",
      programId: NORTHSTAR_IDS.program,
      referralCode: "JAMIE12",
      currency: "USD",
      items: [
        { externalRef: "CONCURRENT-A", category: "plumbing", grossAmountMinor: "10000" },
        { externalRef: "CONCURRENT-B", category: "cleaning", grossAmountMinor: "10000" },
      ],
    };
    const [left, right] = await Promise.all([
      one.post("/conversions").send(body),
      two.post("/conversions").send(body),
    ]);
    expect([left.status, right.status]).toEqual([201, 201]);
    expect(left.body.id).toBe(right.body.id);
    const db = (await import("../../../../packages/database/src/index.js")).createDatabaseClient(
      app.databaseUrl,
      { max: 4 },
    );
    try {
      const count = await db.sql<
        { conversions: string; items: string; earnings: string }[]
      >`select (select count(*)::text from conversions where external_ref='CONCURRENT-1') conversions,(select count(*)::text from conversion_items where external_ref in ('CONCURRENT-A','CONCURRENT-B')) items,(select count(*)::text from earnings e join conversion_items i on i.id=e.conversion_item_id where i.external_ref in ('CONCURRENT-A','CONCURRENT-B')) earnings`;
      expect(count[0]).toEqual({ conversions: "1", items: "2", earnings: "2" });
    } finally {
      await db.sql.end();
    }
  });
  it("rejects same-key changed payload and rolls back duplicate external references completely", async () => {
    const one = await ownerAgent(app);
    const two = await ownerAgent(app);
    const body = {
      idempotencyKey: "rollback-original",
      externalRef: "ROLLBACK-1",
      programId: NORTHSTAR_IDS.program,
      referralCode: "JAMIE12",
      currency: "USD",
      items: [{ externalRef: "ROLLBACK-A", category: "plumbing", grossAmountMinor: "10000" }],
    };
    const original = await one.post("/conversions").send(body).expect(201);
    const db = (await import("../../../../packages/database/src/index.js")).createDatabaseClient(
      app.databaseUrl,
      { max: 4 },
    );
    const counts = async () =>
      (
        await db.sql`select (select count(*)::int from conversions) conversions,(select count(*)::int from conversion_items) items,(select count(*)::int from earnings) earnings,(select count(*)::int from idempotency_records) idempotency,(select count(*)::int from audit_events) audit`
      )[0];
    try {
      const before = await counts();
      await two
        .post("/conversions")
        .send({ ...body, externalRef: "CHANGED" })
        .expect(409);
      const duplicate = await two
        .post("/conversions")
        .send({
          ...body,
          idempotencyKey: "rollback-duplicate",
          items: [{ ...body.items[0], externalRef: "ROLLBACK-EXTRA" }],
        })
        .expect(409);
      expect(duplicate.body).toEqual({ status: "conversion_reference_conflict" });
      expect(await counts()).toEqual(before);
      expect((await one.post("/conversions").send(body).expect(201)).body).toEqual(original.body);
      const [left, right] = await Promise.all([
        one
          .post("/conversions")
          .send({ ...body, idempotencyKey: "race-payload", externalRef: "RACE-PAYLOAD-A" }),
        two
          .post("/conversions")
          .send({ ...body, idempotencyKey: "race-payload", externalRef: "RACE-PAYLOAD-B" }),
      ]);
      expect([left.status, right.status].sort()).toEqual([201, 409]);
      const [a, b] = await Promise.all([
        one
          .post("/conversions")
          .send({ ...body, idempotencyKey: "race-reference-a", externalRef: "RACE-REF" }),
        two
          .post("/conversions")
          .send({ ...body, idempotencyKey: "race-reference-b", externalRef: "RACE-REF" }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const after = await counts();
      expect(after).toEqual(
        Object.fromEntries(
          Object.entries(before ?? {}).map(([key, value]) => [key, Number(value) + 2]),
        ),
      );
    } finally {
      await db.sql.end();
    }
  });
});
