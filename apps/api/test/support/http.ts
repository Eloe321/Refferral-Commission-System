import supertest from "supertest";
import {
  createDatabaseClient,
  migrateDatabase,
  NORTHSTAR_IDS,
  seedSandbox,
} from "../../../../packages/database/src/index.js";
import { createApiApp } from "../../src/main.js";
import type { AppEnv } from "../../src/config/env.js";
import { OutboxWorker } from "../../src/notifications/outbox.worker.js";

const defaultDatabaseUrl = "postgres://sandbox:sandbox@localhost:5432/referral_sandbox";

export type ApiTestApp = {
  app: Awaited<ReturnType<typeof createApiApp>>;
  request: ReturnType<typeof supertest>;
  server: Parameters<typeof supertest>[0];
  databaseUrl: string;
  close(): Promise<void>;
};

function testDatabaseUrl(): string {
  return process.env.DATABASE_URL_TEST ?? defaultDatabaseUrl;
}

function temporaryDatabaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * Starts each E2E app against a disposable, migrated and fictional-data-only
 * database. The generated identifier is internal, so the DDL never uses caller input.
 */
export async function createApiTestApp(
  options: {
    appMode?: "sandbox" | "production";
    deliveryEnv?: Partial<
      Pick<
        AppEnv,
        | "SMS_DELIVERY_MODE"
        | "EMAIL_DELIVERY_MODE"
        | "SMTP_HOST"
        | "SMTP_PORT"
        | "SMTP_SECURE"
        | "UNISMS_API_KEY"
        | "UNISMS_SENDER_ID"
        | "UNISMS_WEBHOOK_SECRET"
        | "UNISMS_WEBHOOK_BODY_LIMIT_BYTES"
        | "BOOKING_WEBHOOK_SECRET"
      >
    >;
  } = {},
): Promise<ApiTestApp> {
  const databaseName = `api_e2e_${crypto.randomUUID().replaceAll("-", "")}`;
  const baseUrl = testDatabaseUrl();
  const admin = createDatabaseClient(temporaryDatabaseUrl(baseUrl, "postgres"), { max: 1 });
  const databaseUrl = temporaryDatabaseUrl(baseUrl, databaseName);
  let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
  try {
    await admin.sql.unsafe(`create database "${databaseName}"`);
    const seedClient = createDatabaseClient(databaseUrl, { max: 1 });
    try {
      await migrateDatabase(seedClient.db);
      await seedSandbox(seedClient.db);
    } finally {
      await seedClient.sql.end();
    }
    app = await createApiApp({
      APP_MODE: options.appMode ?? "sandbox",
      PORT: 0,
      WEB_ORIGIN: "http://localhost:3000",
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: "a-session-secret-that-is-long-enough-for-the-e2e-suite",
      OTP_HMAC_SECRET: "an-otp-secret-that-is-long-enough-for-the-e2e-suite",
      SMS_DELIVERY_MODE: "preview",
      EMAIL_DELIVERY_MODE: "disabled",
      UNISMS_WEBHOOK_BODY_LIMIT_BYTES: 16_384,
      ...options.deliveryEnv,
    });
    await app.init();
    app.get(OutboxWorker).onApplicationShutdown();
    const server = app.getHttpServer();
    const request = supertest(server);
    return {
      app,
      request,
      server,
      databaseUrl,
      async close(): Promise<void> {
        try {
          await app?.close();
        } finally {
          try {
            await admin.sql.unsafe(`drop database if exists "${databaseName}" with (force)`);
          } finally {
            await admin.sql.end();
          }
        }
      },
    };
  } catch (error) {
    try {
      await app?.close();
    } catch {
      // Preserve the initialization failure while still cleaning up every resource below.
    } finally {
      try {
        await admin.sql.unsafe(`drop database if exists "${databaseName}" with (force)`);
      } catch {
        // An unsuccessful initialization may not have created the database.
      } finally {
        await admin.sql.end().catch(() => undefined);
      }
    }
    throw error;
  }
}

async function personaAgent(
  app: ApiTestApp,
  role: "owner" | "partner",
  actorId: string,
): Promise<ReturnType<typeof supertest.agent>> {
  const agent = supertest.agent(app.server);
  await agent.post("/demo/session").send({ role, actorId }).expect(201);
  return agent;
}

export async function ownerAgent(app: ApiTestApp): Promise<ReturnType<typeof supertest.agent>> {
  return personaAgent(app, "owner", NORTHSTAR_IDS.ownerUser);
}

export async function partnerAgent(app: ApiTestApp): Promise<ReturnType<typeof supertest.agent>> {
  return personaAgent(app, "partner", NORTHSTAR_IDS.partnerUsers.jamie);
}
