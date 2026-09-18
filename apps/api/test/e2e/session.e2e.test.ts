import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabaseClient, NORTHSTAR_IDS } from "../../../../packages/database/src/index.js";
import { createApiTestApp, ownerAgent, partnerAgent, type ApiTestApp } from "../support/http.js";

describe("sandbox session", () => {
  let app: ApiTestApp;

  beforeAll(async () => {
    app = await createApiTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates and reads a signed partner session", async () => {
    const agent = await partnerAgent(app);
    const response = await agent.get("/demo/session").expect(200);

    expect(response.body).toMatchObject({
      actorId: NORTHSTAR_IDS.partnerUsers.jamie,
      organizationId: NORTHSTAR_IDS.organization,
      role: "partner",
    });
  });

  it("creates and reads a signed owner session", async () => {
    const agent = await ownerAgent(app);
    const response = await agent.get("/demo/session").expect(200);

    expect(response.body).toMatchObject({
      actorId: NORTHSTAR_IDS.ownerUser,
      organizationId: NORTHSTAR_IDS.organization,
      role: "owner",
    });
  });

  it("sets a secure browser session cookie", async () => {
    const response = await app.request
      .post("/demo/session")
      .send({ role: "partner", actorId: NORTHSTAR_IDS.partnerUsers.jamie })
      .expect(201);

    expect(response.headers["set-cookie"]?.[0]).toMatch(/HttpOnly/i);
    expect(response.headers["set-cookie"]?.[0]).toMatch(/SameSite=Lax/i);
  });

  it("rejects a role mismatch without trusting the caller", async () => {
    const response = await app.request
      .post("/demo/session")
      .send({ role: "owner", actorId: NORTHSTAR_IDS.partnerUsers.jamie })
      .expect(401);

    expect(response.body).toEqual({ status: "unauthorized" });
  });

  it("rejects an actor that is not in the seeded sandbox organization", async () => {
    const response = await app.request
      .post("/demo/session")
      .send({ role: "partner", actorId: crypto.randomUUID() })
      .expect(401);

    expect(response.body).toEqual({ status: "unauthorized" });
  });

  it("rejects malformed and tampered session cookies with a neutral response", async () => {
    const malformed = await app.request.get("/demo/session").set("Cookie", "sandbox_session=nope").expect(401);
    expect(malformed.body).toEqual({ status: "unauthorized" });

    const created = await app.request
      .post("/demo/session")
      .send({ role: "partner", actorId: NORTHSTAR_IDS.partnerUsers.jamie })
      .expect(201);
    const cookie = created.headers["set-cookie"]?.[0];
    expect(cookie).toBeDefined();
    const rawCookie = cookie?.split(";")[0] ?? "";
    const tampered = `${rawCookie.slice(0, -1)}x`;
    const response = await app.request.get("/demo/session").set("Cookie", tampered).expect(401);
    expect(response.body).toEqual({ status: "unauthorized" });
  });

  it("rejects a previously valid cookie when the reloaded partner is suspended", async () => {
    const created = await app.request
      .post("/demo/session")
      .send({ role: "partner", actorId: NORTHSTAR_IDS.partnerUsers.jamie })
      .expect(201);
    const cookie = created.headers["set-cookie"]?.[0]?.split(";")[0];
    const database = createDatabaseClient(app.databaseUrl, { max: 1 });
    try {
      await database.sql`update partners set status = 'suspended' where id = ${NORTHSTAR_IDS.partners.jamie}`;
      const response = await app.request.get("/demo/session").set("Cookie", cookie ?? "").expect(401);
      expect(response.body).toEqual({ status: "unauthorized" });
    } finally {
      await database.sql`update partners set status = 'active' where id = ${NORTHSTAR_IDS.partners.jamie}`;
      await database.sql.end();
    }
  });

  it("allows the exact configured browser origin with credentials and secure headers", async () => {
    const response = await app.request
      .get("/health")
      .set("Origin", "http://localhost:3000")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body).toEqual({ status: "ok" });

    const foreignOrigin = await app.request
      .get("/health")
      .set("Origin", "https://not-the-configured-origin.example")
      .expect(200);
    // The server never reflects a caller-supplied origin; browsers reject this mismatch.
    expect(foreignOrigin.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("returns 404 for sandbox sessions outside sandbox mode", async () => {
    const productionApp = await createApiTestApp({ appMode: "production" });
    try {
      await productionApp.request
        .post("/demo/session")
        .send({ role: "partner", actorId: NORTHSTAR_IDS.partnerUsers.jamie })
        .expect(404);
      await productionApp.request.get("/demo/session").expect(404);
    } finally {
      await productionApp.close();
    }
  });
});
