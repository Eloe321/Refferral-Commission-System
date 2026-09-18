import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import {
  createDatabaseClient,
  migrateDatabase,
  seedSandbox,
  NORTHSTAR_IDS,
} from "../../../../packages/database/src/index.js";
import {
  conversionSchema,
  programSchema,
  partnerDetailSchema,
  earningListSchema,
  otpChallengeResponseSchema,
  otpChallengeStateSchema,
  claimSchema,
  claimListSchema,
} from "@referral-sandbox/contracts";

// Exercise actual Node/tsx bootstrap in a child process: Vitest's transform emits
// decorator metadata that tsx does not, so in-process Nest tests cannot cover DI here.
it(`serves core operations in the actual ${process.env.API_SMOKE_MODE ?? "source"} runtime`, async () => {
  const base = process.env.DATABASE_URL_TEST;
  if (!base) throw new Error("DATABASE_URL_TEST is required");
  const name = `runtime_smoke_${crypto.randomUUID().replaceAll("-", "")}`;
  const url = new URL(base);
  url.pathname = `/${name}`;
  const admin = createDatabaseClient(base, { max: 1 });
  const db = createDatabaseClient(url.toString(), { max: 4 });
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing smoke port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => {
      if (error) reject(error);
      else resolve();
    }),
  );
  let child: ReturnType<typeof spawn> | undefined;
  let logs = "";
  try {
    await admin.sql.unsafe(`create database "${name}"`);
    await migrateDatabase(db.db);
    await seedSandbox(db.db);
    const built = process.env.API_SMOKE_MODE === "built";
    child = spawn(process.execPath, built ? ["dist/main.js"] : ["--import", "tsx", "src/main.ts"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        APP_MODE: "sandbox",
        PORT: String(port),
        WEB_ORIGIN: "http://localhost:3000",
        DATABASE_URL: url.toString(),
        SESSION_SECRET: "runtime-smoke-session-secret-long-enough",
        OTP_HMAC_SECRET: "runtime-smoke-otp-secret-is-long-enough",
        SMS_DELIVERY_MODE: "preview",
        EMAIL_DELIVERY_MODE: "disabled",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      logs += chunk.toString();
    });
    const origin = `http://127.0.0.1:${String(port)}`;
    const deadline = performance.now() + 15000;
    let ready = false;
    while (performance.now() < deadline && child.exitCode === null) {
      try {
        ready = (await fetch(`${origin}/health`)).ok;
        if (ready) break;
      } catch {
        /* The child has not bound the port yet. */
      }
      await delay(20);
    }
    expect(ready, logs).toBe(true);
    const session = await fetch(`${origin}/demo/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "owner", actorId: NORTHSTAR_IDS.ownerUser }),
    });
    expect(session.status).toBe(201);
    const cookie = session.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing signed owner session");
    const read = async (path: string) => fetch(`${origin}${path}`, { headers: { cookie } });
    const mutate = async (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
      fetch(`${origin}${path}`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const [programs, partners, earnings] = await Promise.all(
      ["/programs", "/partners", "/earnings"].map(read),
    );
    expect([programs?.status, partners?.status, earnings?.status], logs).toEqual([200, 200, 200]);
    if (programs) programSchema.array().parse(await programs.json());
    if (earnings) earningListSchema.parse(await earnings.json());
    const created = await mutate("/conversions", {
      idempotencyKey: "runtime-smoke-create",
      externalRef: "RUNTIME-SMOKE",
      programId: NORTHSTAR_IDS.program,
      referralCode: "JAMIE12",
      currency: "USD",
      items: [{ externalRef: "RUNTIME-ITEM", category: "plumbing", grossAmountMinor: "10000" }],
    });
    expect(created.status, logs).toBe(201);
    const conversion = conversionSchema.parse(await created.json());
    const completed = await mutate(
      `/conversions/${conversion.id}/complete`,
      {},
      { "Idempotency-Key": "runtime-smoke-complete" },
    );
    expect(completed.status, logs).toBe(201);
    const earned = earningListSchema.parse(
      await (await read(`/earnings?conversionId=${conversion.id}`)).json(),
    ).items[0];
    if (!earned) throw new Error("Missing earned item");
    const partnerSession = await fetch(`${origin}/demo/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "partner", actorId: NORTHSTAR_IDS.partnerUsers.jamie }),
    });
    const partnerCookie = partnerSession.headers.get("set-cookie")?.split(";")[0];
    if (!partnerCookie) throw new Error("Missing signed partner session");
    const otp = await fetch(`${origin}/otp/challenges`, {
      method: "POST",
      headers: { cookie: partnerCookie, "content-type": "application/json" },
      body: JSON.stringify({ earningIds: [earned.id], channel: "sms" }),
    });
    expect(otp.status, logs).toBe(201);
    const challenge = otpChallengeResponseSchema.parse(await otp.json());
    if (challenge.delivery.mode !== "preview") throw new Error("Expected sandbox preview");
    const verifiedOtp = await fetch(`${origin}/otp/challenges/${challenge.id}/verify`, {
      method: "POST",
      headers: { cookie: partnerCookie, "content-type": "application/json" },
      body: JSON.stringify({ code: challenge.delivery.preview.code }),
    });
    expect(verifiedOtp.status, logs).toBe(201);
    expect(otpChallengeStateSchema.parse(await verifiedOtp.json()).status).toBe("verified");
    const postClaim = () =>
      fetch(`${origin}/claims`, {
        method: "POST",
        headers: {
          cookie: partnerCookie,
          "content-type": "application/json",
          "Idempotency-Key": "runtime-smoke-claim",
        },
        body: JSON.stringify({ challengeId: challenge.id, earningIds: [earned.id] }),
      });
    const claimResponse = await postClaim();
    expect(claimResponse.status, logs).toBe(201);
    const claim = claimSchema.parse(await claimResponse.json());
    expect(claimSchema.parse(await (await postClaim()).json()).id).toBe(claim.id);
    const claimsResponse = await fetch(`${origin}/claims`, { headers: { cookie: partnerCookie } });
    expect(
      claimListSchema.parse(await claimsResponse.json()).items.some((item) => item.id === claim.id),
    ).toBe(true);
    const claimRead = await fetch(`${origin}/claims/${claim.id}`, {
      headers: { cookie: partnerCookie },
    });
    expect(claimSchema.parse(await claimRead.json())).toEqual(claim);
    const simulated = await fetch(`${origin}/claims/${claim.id}/simulate-failure`, {
      method: "POST",
      headers: { cookie: partnerCookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(simulated.status, logs).toBe(201);
    expect(claimSchema.parse(await simulated.json()).status).toBe("failed");
    expect(
      await db.sql`select dedupe_key,status,content from notification_outbox where organization_id=${NORTHSTAR_IDS.organization} and claim_id=${claim.id} order by dedupe_key`,
    ).toEqual([
      { dedupe_key: `claim:${claim.id}:created`, status: "failed", content: null },
      { dedupe_key: `claim:${claim.id}:failed`, status: "failed", content: null },
    ]);
    for (const route of ["hold", "release", "void"])
      expect(
        (await mutate(`/earnings/${earned.id}/${route}`, { reason: `Runtime smoke ${route}` }))
          .status,
        logs,
      ).toBe(201);
    expect(
      (
        await mutate(`/programs/${NORTHSTAR_IDS.program}/rules`, {
          type: "flat",
          flatAmountMinor: "50",
          basisPoints: null,
          category: "runtime-smoke",
          partnerId: null,
        })
      ).status,
      logs,
    ).toBe(201);
    for (const route of ["pause", "resume"])
      expect(
        (
          await mutate(`/programs/${NORTHSTAR_IDS.program}/${route}`, {
            reason: `Runtime smoke ${route}`,
          })
        ).status,
        logs,
      ).toBe(201);
    for (const route of ["suspend", "reactivate"]) {
      const response = await mutate(`/partners/${NORTHSTAR_IDS.partners.riley}/${route}`, {
        reason: `Runtime smoke ${route}`,
      });
      expect(response.status, logs).toBe(201);
      partnerDetailSchema.parse(await response.json());
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      const force = setTimeout(() => child?.kill("SIGKILL"), 5000);
      try {
        await stopped;
      } finally {
        clearTimeout(force);
      }
    }
    await db.sql.end();
    try {
      await admin.sql.unsafe(`drop database if exists "${name}" with (force)`);
    } finally {
      await admin.sql.end();
    }
  }
}, 30000);
