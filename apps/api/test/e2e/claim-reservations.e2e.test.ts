import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  conversionSchema,
  earningListSchema,
  earningViewSchema,
  partnerDetailSchema,
  type ConversionStatus,
  type EarningStatus,
} from "@referral-sandbox/contracts";
import {
  createDatabaseClient,
  NORTHSTAR_IDS as ids,
} from "../../../../packages/database/src/index.js";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";
import { seedTwoOrganizations } from "../support/database.js";

describe("active claim reservation failure", () => {
  let app: ApiTestApp;
  let db: ReturnType<typeof createDatabaseClient>;
  let owner: Awaited<ReturnType<typeof ownerAgent>>;
  beforeAll(async () => {
    app = await createApiTestApp();
    db = createDatabaseClient(app.databaseUrl, { max: 4 });
    owner = await ownerAgent(app);
  });
  afterAll(async () => {
    await db.sql.end();
    await app.close();
  });

  async function earning(
    options: {
      status?: EarningStatus;
      conversionStatus?: ConversionStatus;
      conversionId?: string;
      position?: number;
      partnerId?: string;
    } = {},
  ) {
    const id = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const conversionId = options.conversionId ?? crypto.randomUUID();
    const partnerId = options.partnerId ?? ids.partners.jamie;
    if (!options.conversionId)
      await db.sql`insert into conversions (id,organization_id,program_id,partner_id,referral_code_id,external_ref,currency,status)
      values (${conversionId},${ids.organization},${ids.program},${partnerId},${ids.referralCodes.jamie},${conversionId},'USD',${options.conversionStatus ?? "completed"})`;
    await db.sql`insert into conversion_items (id,organization_id,conversion_id,external_ref,category,position,gross_amount_minor)
      values (${itemId},${ids.organization},${conversionId},${itemId},'plumbing',${options.position ?? 0},10000)`;
    await db.sql`insert into earnings (id,organization_id,conversion_item_id,program_id,partner_id,rule_id,amount_minor,currency,status,rule_snapshot)
      select ${id},organization_id,${itemId},program_id,${partnerId},rule_id,amount_minor,currency,${options.status ?? "reserved"},rule_snapshot from earnings where organization_id=${ids.organization} and id=${ids.earnings.eligible}`;
    if (options.status === "held") await addHold(id);
    return { id, conversionId };
  }
  async function addHold(earningId: string, previousStatus: "eligible" | "reserved" = "eligible") {
    await db.sql`insert into earning_holds (organization_id,earning_id,previous_status,reason,placed_by) values (${ids.organization},${earningId},${previousStatus},'Existing review',${ids.ownerUser})`;
  }
  async function claim(
    earningIds: string[],
    status: "created" | "processing" | "settled" | "failed",
    partnerId: string = ids.partners.jamie,
  ) {
    const id = crypto.randomUUID();
    await db.sql`insert into claims (id,organization_id,partner_id,actor_id,amount_minor,currency,status,idempotency_key,selection_hash)
      values (${id},${ids.organization},${partnerId},${ids.partnerUsers.jamie},${earningIds.length * 4000},'USD',${status},${id},${id})`;
    // Deliberately reverse insertion order so lock ordering cannot depend on fixtures.
    for (const earningId of [...earningIds].reverse())
      await db.sql`insert into claim_items (organization_id,claim_id,earning_id,earning_amount_minor,amount_minor) values (${ids.organization},${id},${earningId},4000,4000)`;
    return id;
  }
  async function view(id: string) {
    const items = earningListSchema.parse((await owner.get("/earnings").expect(200)).body).items;
    const result = items.find((item) => item.id === id);
    if (!result) throw new Error("Missing fixture earning");
    return result;
  }
  async function ledger() {
    return db.sql`select * from ledger_entries where organization_id=${ids.organization} order by id`;
  }
  async function audits(id: string) {
    return db.sql<
      { action: string; actor_id: string; reason: string }[]
    >`select action,actor_id,reason from audit_events where organization_id=${ids.organization} and aggregate_id=${id} order by id`;
  }
  async function assertFailed(claimId: string) {
    expect(
      await db.sql`select status from claims where organization_id=${ids.organization} and id=${claimId}`,
    ).toEqual([{ status: "failed" }]);
    expect(
      await db.sql`select e.id from claim_items ci join earnings e on e.organization_id=ci.organization_id and e.id=ci.earning_id where ci.organization_id=${ids.organization} and ci.claim_id=${claimId} and e.status='reserved'`,
    ).toHaveLength(0);
  }
  const mappings = [
    ["scheduled", "pending"],
    ["attributed", "pending"],
    ["completed", "eligible"],
    ["partially_refunded", "eligible"],
    ["refunded", "eligible"],
    ["cancelled", "voided"],
    ["no_show", "voided"],
  ] as const;

  it.each([
    ["hold", "created"],
    ["hold", "processing"],
    ["void", "created"],
    ["void", "processing"],
  ] as const)(
    "%s fails a %s claim and restores every other earning using its conversion",
    async (action, claimStatus) => {
      const target = await earning();
      const peers = [];
      for (const [conversionStatus, status] of mappings)
        peers.push({ ...(await earning({ conversionStatus })), status });
      const claimId = await claim([target.id, ...peers.map((peer) => peer.id)], claimStatus);
      if (action === "void") await addHold(target.id, "reserved");
      const beforeLedger = await ledger();
      const response = await owner
        .post(`/earnings/${target.id}/${action}`)
        .send({ reason: "Reservation review" })
        .expect(201);
      const result = earningViewSchema.parse(response.body);
      expect(result.status).toBe(action === "hold" ? "held" : "voided");
      expect(result.holds[0]).toMatchObject(
        action === "hold"
          ? { previousStatus: "reserved", releasedAt: null }
          : { releasedBy: ids.ownerUser },
      );
      if (action === "void") expect(result.holds[0]?.releasedAt).toEqual(expect.any(String));
      expect(await view(target.id)).toEqual(result);
      for (const peer of peers) expect((await view(peer.id)).status).toBe(peer.status);
      await assertFailed(claimId);
      expect(await ledger()).toEqual(beforeLedger);
      expect(await audits(target.id)).toEqual([
        {
          action: action === "hold" ? "earning.held" : "earning.voided",
          actor_id: ids.ownerUser,
          reason: "Reservation review",
        },
      ]);
      await owner
        .post(`/earnings/${target.id}/${action}`)
        .send({ reason: "Reservation review" })
        .expect(409);
      expect(await audits(target.id)).toHaveLength(1);
    },
  );

  it.each(["settled", "failed"] as const)(
    "leaves %s claim records and unrelated earnings unchanged",
    async (status) => {
      const target = await earning({ status: "eligible" });
      const peer = await earning({ status: "eligible" });
      const claimId = await claim([target.id, peer.id], status);
      const before =
        await db.sql`select * from claims where organization_id=${ids.organization} and id=${claimId}`;
      const beforePeer = await view(peer.id);
      await owner
        .post(`/earnings/${target.id}/hold`)
        .send({ reason: "Independent review" })
        .expect(201);
      expect(
        await db.sql`select * from claims where organization_id=${ids.organization} and id=${claimId}`,
      ).toEqual(before);
      expect(await view(peer.id)).toEqual(beforePeer);
    },
  );

  it.each([
    ["cancel", "created", "cancelled"],
    ["cancel", "processing", "cancelled"],
    ["no-show", "created", "no_show"],
    ["no-show", "processing", "no_show"],
  ] as const)(
    "%s voids unpaid earnings and resolves a %s claim",
    async (action, claimStatus, conversionStatus) => {
      const target = await earning({ conversionStatus: "scheduled" });
      const originals: { id: string; status: EarningStatus }[] = [
        { id: target.id, status: "reserved" },
      ];
      for (const [position, status] of (
        [
          "needs_rule",
          "pending",
          "eligible",
          "held",
          "reserved",
          "settled",
          "reversed",
          "voided",
        ] as const
      ).entries()) {
        originals.push({
          ...(await earning({ conversionId: target.conversionId, position: position + 1, status })),
          status,
        });
      }
      const peers = [];
      for (const [sourceStatus, status] of mappings)
        peers.push({ ...(await earning({ conversionStatus: sourceStatus })), status });
      const claimId = await claim(
        [
          ...originals.filter((item) => item.status === "reserved").map((item) => item.id),
          ...peers.map((item) => item.id),
        ],
        claimStatus,
      );
      const beforeLedger = await ledger();
      const responses = await Promise.all(
        [1, 2].map(() =>
          owner
            .post(`/conversions/${target.conversionId}/${action}`)
            .send({ reason: "Service unavailable" }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const result = conversionSchema.parse(
        responses.find((response) => response.status === 201)?.body,
      );
      expect(result.status).toBe(conversionStatus);
      expect(result.items).toHaveLength(originals.length);
      for (const item of originals) {
        const earningView = await view(item.id);
        expect(earningView.status).toBe(
          ["settled", "reversed"].includes(item.status) ? item.status : "voided",
        );
        if (item.status === "held") {
          expect(earningView.holds[0]).toMatchObject({
            releasedBy: ids.ownerUser,
          });
          expect(earningView.holds[0]?.releasedAt).toEqual(expect.any(String));
        }
      }
      for (const peer of peers) expect((await view(peer.id)).status).toBe(peer.status);
      await assertFailed(claimId);
      expect(await ledger()).toEqual(beforeLedger);
      expect(await audits(target.conversionId)).toEqual([
        {
          action: `conversion.${conversionStatus}`,
          actor_id: ids.ownerUser,
          reason: "Service unavailable",
        },
      ]);
    },
  );

  it.each(["created", "processing"] as const)(
    "suspends with original hold statuses and fails a %s claim without orphaning other partners' reservations",
    async (claimStatus) => {
      const partnerId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      await db.sql`insert into users (id,organization_id,display_name,role) values (${userId},${ids.organization},'Reservation partner','partner')`;
      await db.sql`insert into partners (id,organization_id,user_id,display_name,email,phone_e164) values (${partnerId},${ids.organization},${userId},'Reservation partner','reserve@example.invalid','+12025550199')`;
      const targets = [];
      for (const status of [
        "pending",
        "eligible",
        "reserved",
        "held",
        "settled",
        "reversed",
        "voided",
        "needs_rule",
      ] as const)
        targets.push({ ...(await earning({ partnerId, status })), status });
      const reserved = targets.find((item) => item.status === "reserved");
      if (!reserved) throw new Error("Missing reserved fixture");
      const peer = await earning();
      const claimId = await claim([reserved.id, peer.id], claimStatus, partnerId);
      const held = targets.find((item) => item.status === "held");
      if (!held) throw new Error("Missing held fixture");
      const originalHold = await view(held.id);
      const beforeLedger = await ledger();
      const response = await owner
        .post(`/partners/${partnerId}/suspend`)
        .send({ reason: "Account review" })
        .expect(201);
      const result = partnerDetailSchema.parse(response.body);
      expect(result.status).toBe("suspended");
      expect(result.balances).toEqual([
        { currency: "USD", ledgerMinor: "0", eligibleMinor: "0", heldMinor: "16000" },
      ]);
      expect(
        partnerDetailSchema.parse((await owner.get(`/partners/${partnerId}`).expect(200)).body),
      ).toEqual(result);
      for (const target of targets) {
        const item = await view(target.id);
        if (["pending", "eligible", "reserved"].includes(target.status))
          expect(item).toMatchObject({
            status: "held",
            holds: [
              {
                previousStatus: target.status,
                placedBy: ids.ownerUser,
                reason: "Account review",
                releasedAt: null,
              },
            ],
          });
        else expect(item.status).toBe(target.status);
      }
      expect(await view(held.id)).toEqual(originalHold);
      expect((await view(peer.id)).status).toBe("eligible");
      await assertFailed(claimId);
      await owner
        .post(`/partners/${partnerId}/suspend`)
        .send({ reason: "Account review" })
        .expect(409);
      expect(await audits(partnerId)).toEqual([
        { action: "partner.suspended", actor_id: ids.ownerUser, reason: "Account review" },
      ]);
      const beforeReactivation =
        await db.sql`select * from earning_holds where organization_id=${ids.organization} and earning_id in ${db.sql(targets.map((target) => target.id))} order by id`;
      const active = await owner
        .post(`/partners/${partnerId}/reactivate`)
        .send({ reason: "Account approved" })
        .expect(201);
      expect(partnerDetailSchema.parse(active.body).status).toBe("active");
      expect(
        await db.sql`select * from earning_holds where organization_id=${ids.organization} and earning_id in ${db.sql(targets.map((target) => target.id))} order by id`,
      ).toEqual(beforeReactivation);
      expect(await ledger()).toEqual(beforeLedger);
    },
  );

  it("serializes concurrent holds on distinct earnings of the same active claim", async () => {
    const targets = [await earning(), await earning(), await earning()];
    const claimId = await claim(
      targets.map((item) => item.id),
      "processing",
    );
    const secondOwner = await ownerAgent(app);
    const responses = await Promise.all([
      owner.post(`/earnings/${targets[0]?.id ?? ""}/hold`).send({ reason: "Parallel review" }),
      secondOwner
        .post(`/earnings/${targets[1]?.id ?? ""}/hold`)
        .send({ reason: "Parallel review" }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(
      responses
        .map((response) => earningViewSchema.parse(response.body).holds[0]?.previousStatus)
        .sort(),
    ).toEqual(["eligible", "reserved"]);
    await assertFailed(claimId);
    expect((await view(targets[2]?.id ?? "")).status).toBe("eligible");
  });

  it("coordinates hold and cancellation without a deadlock or orphaned reservation", async () => {
    const target = await earning({ conversionStatus: "scheduled" });
    const peer = await earning();
    const claimId = await claim([target.id, peer.id], "created");
    const secondOwner = await ownerAgent(app);
    const [hold, cancelled] = await Promise.all([
      owner.post(`/earnings/${target.id}/hold`).send({ reason: "Parallel review" }),
      secondOwner
        .post(`/conversions/${target.conversionId}/cancel`)
        .send({ reason: "Service cancelled" }),
    ]);
    expect(cancelled.status).toBe(201);
    expect([201, 409]).toContain(hold.status);
    const targetView = await view(target.id);
    expect(targetView.status).toBe("voided");
    expect(
      targetView.holds.every(
        (item) => item.releasedBy === ids.ownerUser && item.releasedAt !== null,
      ),
    ).toBe(true);
    expect((await view(peer.id)).status).toBe("eligible");
    await assertFailed(claimId);
  });

  it("keeps foreign claims and earnings untouched and validates cancellation requests safely", async () => {
    const foreign = await seedTwoOrganizations(db);
    await db.sql`update earnings set status='reserved' where organization_id=${foreign.orgA.id} and id=${foreign.orgA.earning.id}`;
    await db.sql`insert into claim_items (organization_id,claim_id,earning_id,earning_amount_minor,amount_minor) values (${foreign.orgA.id},${foreign.orgA.claim.id},${foreign.orgA.earning.id},1000,1000)`;
    const beforeClaims =
      await db.sql`select * from claims where organization_id=${foreign.orgA.id}`;
    const beforeEarnings =
      await db.sql`select * from earnings where organization_id=${foreign.orgA.id}`;
    const target = await earning({ conversionStatus: "scheduled" });
    const peer = await earning();
    await claim([target.id, peer.id], "created");
    await owner.post(`/earnings/${target.id}/hold`).send({ reason: "Local review" }).expect(201);
    expect(await db.sql`select * from claims where organization_id=${foreign.orgA.id}`).toEqual(
      beforeClaims,
    );
    expect(await db.sql`select * from earnings where organization_id=${foreign.orgA.id}`).toEqual(
      beforeEarnings,
    );
    const foreignConversions = await db.sql<
      { id: string }[]
    >`select id from conversions where organization_id=${foreign.orgA.id}`;
    const partner = await partnerAgent(app);
    for (const action of ["cancel", "no-show"]) {
      expect(
        (
          await partner
            .post(`/conversions/${target.conversionId}/${action}`)
            .send({ reason: "Partner request" })
            .expect(403)
        ).body,
      ).toEqual({ status: "forbidden" });
      for (const id of [crypto.randomUUID(), foreignConversions[0]?.id ?? ""])
        expect(
          (
            await owner
              .post(`/conversions/${id}/${action}`)
              .send({ reason: "Owner request" })
              .expect(404)
          ).body,
        ).toEqual({ status: "not_found" });
      await owner
        .post(`/conversions/not-a-uuid/${action}`)
        .send({ reason: "Owner request" })
        .expect(400);
      for (const body of [
        { reason: "ab" },
        { reason: "   " },
        { reason: "Valid request", extra: true },
      ])
        expect(
          (await owner.post(`/conversions/${target.conversionId}/${action}`).send(body).expect(400))
            .body,
        ).toEqual({ status: "invalid_request" });
    }
    expect(await audits(target.conversionId)).toHaveLength(0);
  });
});
