import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDatabaseClient,
  migrateDatabase,
  type DatabaseClient,
} from "@referral-sandbox/database";
import { OutboxRepository } from "../../src/notifications/outbox.repository.js";
import { OutboxWorker } from "../../src/notifications/outbox.worker.js";
import { DeliveryProviderError } from "../../src/notifications/unisms.adapter.js";

const organizationId = crypto.randomUUID();
const databaseName = `outbox_test_${crypto.randomUUID().replaceAll("-", "")}`;
let admin: DatabaseClient;
let database: DatabaseClient;

function databaseUrl(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

beforeAll(async () => {
  const baseUrl = process.env.DATABASE_URL_TEST;
  if (!baseUrl) throw new Error("DATABASE_URL_TEST is required");
  admin = createDatabaseClient(databaseUrl(baseUrl, "postgres"), { max: 1 });
  await admin.sql.unsafe(`create database "${databaseName}"`);
  database = createDatabaseClient(databaseUrl(baseUrl, databaseName), { max: 6 });
  await migrateDatabase(database.db);
  await database.sql`insert into organizations (id,name,currency) values (${organizationId},'Outbox fixture','USD')`;
});

afterAll(async () => {
  await database.sql.end();
  await admin.sql.unsafe(`drop database if exists "${databaseName}" with (force)`);
  await admin.sql.end();
});

beforeEach(async () => {
  await database.sql`delete from notification_webhook_events`;
  await database.sql`delete from notification_outbox`;
});

async function queue(
  overrides: Partial<{
    dedupeKey: string;
    status: "pending" | "processing" | "unknown";
    content: string | null;
    recipient: string;
    attempts: number;
    availableAt: Date;
    leaseExpiresAt: Date;
    providerReference: string;
  }> = {},
) {
  const rows = await database.sql<{ id: string }[]>`insert into notification_outbox
    (organization_id,dedupe_key,channel,provider,status,recipient,content,attempts,available_at,lease_expires_at,provider_reference)
    values (
      ${organizationId},${overrides.dedupeKey ?? crypto.randomUUID()},'sms','unisms',
      ${overrides.status ?? "pending"},${overrides.recipient ?? "+12025550120"},
      ${overrides.content === undefined ? "Your verification code is 123456" : overrides.content},${overrides.attempts ?? 0},
      ${(overrides.availableAt ?? new Date(Date.now() - 1000)).toISOString()},
      ${overrides.leaseExpiresAt?.toISOString() ?? null},${overrides.providerReference ?? null}
    ) returning id`;
  return rows[0]?.id ?? "";
}

function worker(delivery: {
  send: (message: {
    recipient: string;
    content: string;
    dedupeKey?: string;
  }) => Promise<{ referenceId: string; state: "processing" | "sent" | "failed" }>;
  reconcile?: (
    provider: string,
    referenceId: string,
  ) => Promise<{ referenceId: string; state: "processing" | "sent" | "failed" }>;
}) {
  return new OutboxWorker(
    new OutboxRepository(database),
    { ...delivery, reconcile: delivery.reconcile ?? vi.fn() },
    {
      batchSize: 2,
      leaseMs: 5_000,
      maxAttempts: 3,
      baseRetryMs: 1_000,
      maxRetryMs: 4_000,
    },
  );
}

describe("transactional outbox", () => {
  it("uses skip-locked leases so two workers never deliver the same row twice", async () => {
    await queue();
    const send = vi.fn().mockResolvedValue({ referenceId: "sms-concurrent", state: "sent" });
    const first = worker({ send });
    const second = worker({ send });

    await Promise.all([first.runOnce(), second.runOnce()]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await database.sql`select status,attempts,content,provider_reference from notification_outbox`,
    ).toEqual([
      { status: "sent", attempts: 1, content: null, provider_reference: "sms-concurrent" },
    ]);
  });

  it("persists a redacted dispatch intent before network I/O and never resends after accepted-result persistence fails", async () => {
    const id = await queue();
    const repository = new OutboxRepository(database);
    vi.spyOn(repository, "markAccepted").mockRejectedValueOnce(
      new Error("database unavailable after provider acceptance"),
    );
    const send = vi
      .fn()
      .mockResolvedValue({ referenceId: "sms-accepted-once", state: "processing" });
    const delivery = { send, reconcile: vi.fn() };
    const outboxWorker = new OutboxWorker(repository, delivery, {
      batchSize: 2,
      leaseMs: 5_000,
      maxAttempts: 3,
      baseRetryMs: 1_000,
      maxRetryMs: 4_000,
    });

    await outboxWorker.runOnce();
    await outboxWorker.runOnce();

    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await database.sql`select status,attempts,provider_reference,content,recipient,lease_expires_at
        from notification_outbox where id=${id}`,
    ).toEqual([
      {
        status: "unknown",
        attempts: 1,
        provider_reference: null,
        content: null,
        recipient: "***0120",
        lease_expires_at: null,
      },
    ]);
  });

  it("does not call the provider when dispatch-intent persistence fails", async () => {
    await queue();
    const repository = new OutboxRepository(database);
    vi.spyOn(repository, "prepareDispatch").mockRejectedValueOnce(
      new Error("dispatch intent unavailable"),
    );
    const send = vi.fn();
    const outboxWorker = new OutboxWorker(
      repository,
      { send, reconcile: vi.fn() },
      {
        batchSize: 2,
        leaseMs: 5_000,
        maxAttempts: 3,
        baseRetryMs: 1_000,
        maxRetryMs: 4_000,
      },
    );

    await expect(outboxWorker.runOnce()).rejects.toThrow("dispatch intent unavailable");
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps ambiguous timeouts redacted and ineligible for blind resend", async () => {
    const id = await queue();
    const send = vi.fn().mockRejectedValue(new DeliveryProviderError("ambiguous"));
    const outboxWorker = worker({ send });

    await outboxWorker.runOnce();
    await outboxWorker.runOnce();

    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await database.sql`select status,content,recipient,provider_reference from notification_outbox where id=${id}`,
    ).toEqual([
      { status: "unknown", content: null, recipient: "***0120", provider_reference: null },
    ]);
  });

  it("never lease-reclaims a crash after durable dispatch intent", async () => {
    const id = await queue();
    const repository = new OutboxRepository(database);
    const [leased] = await repository.leaseBatch(1, 1);
    if (!leased) throw new Error("Expected a leased outbox row");
    await expect(repository.prepareDispatch(leased)).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const send = vi.fn();

    await worker({ send }).runOnce();

    expect(send).not.toHaveBeenCalled();
    expect(
      await database.sql`select status,content,recipient,lease_expires_at from notification_outbox where id=${id}`,
    ).toEqual([{ status: "unknown", content: null, recipient: "***0120", lease_expires_at: null }]);
  });

  it("schedules bounded exponential retries and redacts after the attempt limit", async () => {
    const id = await queue();
    const send = vi.fn().mockRejectedValue(new DeliveryProviderError("retryable"));
    const retrying = worker({ send });
    const before = Date.now();

    await retrying.runOnce();
    const first = await database.sql<
      { status: string; attempts: number; available_at: string; content: string | null }[]
    >`select status,attempts,available_at,content from notification_outbox where id=${id}`;
    expect(first[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(first[0]?.content).toContain("123456");
    expect(Date.parse(first[0]?.available_at ?? "")).toBeGreaterThanOrEqual(before + 900);
    expect(Date.parse(first[0]?.available_at ?? "")).toBeLessThan(before + 2_000);

    await database.sql`update notification_outbox set available_at=clock_timestamp()-interval '1 second',attempts=2 where id=${id}`;
    await retrying.runOnce();

    expect(
      await database.sql`select status,attempts,content,recipient,lease_expires_at from notification_outbox where id=${id}`,
    ).toEqual([
      {
        status: "failed",
        attempts: 3,
        content: null,
        recipient: "***0120",
        lease_expires_at: null,
      },
    ]);
  });

  it("redacts terminal provider failures immediately", async () => {
    await queue();
    const send = vi.fn().mockRejectedValue(new DeliveryProviderError("terminal"));

    await worker({ send }).runOnce();

    expect(
      await database.sql`select status,attempts,content,recipient from notification_outbox`,
    ).toEqual([{ status: "failed", attempts: 1, content: null, recipient: "***0120" }]);
  });

  it.each(["sent", "failed"] as const)(
    "reconciles an accepted message to %s without a webhook or resend",
    async (state) => {
      const id = await queue({
        status: "processing",
        content: null,
        recipient: "***0120",
        providerReference: `reconcile-${state}`,
        availableAt: new Date(Date.now() - 1_000),
      });
      const send = vi.fn();
      const reconcile = vi.fn().mockResolvedValue({
        referenceId: `reconcile-${state}`,
        state,
      });

      await worker({ send, reconcile }).runOnce();

      expect(send).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledWith("unisms", `reconcile-${state}`);
      expect(
        await database.sql`select status,content,recipient,provider_reference from notification_outbox where id=${id}`,
      ).toEqual([
        {
          status: state,
          content: null,
          recipient: "***0120",
          provider_reference: `reconcile-${state}`,
        },
      ]);
    },
  );

  it("polls accepted pending statuses with a lease and bounded backoff without resending", async () => {
    const id = await queue({
      status: "processing",
      content: null,
      recipient: "***0120",
      providerReference: "reconcile-pending",
      availableAt: new Date(Date.now() - 1_000),
    });
    const before = Date.now();
    const send = vi.fn();
    const reconcile = vi.fn().mockResolvedValue({
      referenceId: "reconcile-pending",
      state: "processing",
    });

    await worker({ send, reconcile }).runOnce();

    expect(send).not.toHaveBeenCalled();
    const [row] = await database.sql<
      {
        status: string;
        content: string | null;
        available_at: string;
        lease_expires_at: string | null;
      }[]
    >`select status,content,available_at,lease_expires_at from notification_outbox where id=${id}`;
    expect(row).toMatchObject({ status: "processing", content: null, lease_expires_at: null });
    expect(Date.parse(row?.available_at ?? "")).toBeGreaterThanOrEqual(before + 900);
  });

  it("reclaims an abandoned lease but never re-sends an accepted provider reference", async () => {
    const abandoned = await queue({
      status: "processing",
      attempts: 1,
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    await queue({
      status: "processing",
      attempts: 1,
      leaseExpiresAt: new Date(Date.now() - 1_000),
      providerReference: "already-accepted",
    });
    const send = vi.fn().mockResolvedValue({ referenceId: "reclaimed", state: "sent" });

    await worker({ send }).runOnce();

    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await database.sql`select status,attempts,provider_reference from notification_outbox where id=${abandoned}`,
    ).toEqual([{ status: "sent", attempts: 2, provider_reference: "reclaimed" }]);
  });

  it("records webhook identity before state change and ignores duplicate deliveries", async () => {
    const id = await queue({
      status: "processing",
      providerReference: "msg-provider-1",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const repository = new OutboxRepository(database);
    const event = {
      provider: "unisms" as const,
      providerEventId: "webhook-delivery-1",
      providerReference: "msg-provider-1",
      eventType: "message.sent" as const,
    };

    await expect(repository.applyWebhook(event)).resolves.toEqual("processed");
    await expect(repository.applyWebhook(event)).resolves.toEqual("duplicate");

    expect(
      await database.sql`select status,content,recipient from notification_outbox where id=${id}`,
    ).toEqual([{ status: "sent", content: null, recipient: "***0120" }]);
    expect(
      await database.sql`select provider,provider_event_id,event_type from notification_webhook_events`,
    ).toEqual([
      {
        provider: "unisms",
        provider_event_id: "webhook-delivery-1",
        event_type: "message.sent",
      },
    ]);
  });

  it("reconciles an early webhook by outbox metadata before the provider reference is persisted", async () => {
    const id = await queue();
    const repository = new OutboxRepository(database);
    const [leased] = await repository.leaseBatch(1, 5_000);
    if (!leased) throw new Error("Expected a leased outbox row");
    await repository.prepareDispatch(leased);
    const event = {
      provider: "unisms" as const,
      providerEventId: "webhook-early",
      providerReference: "provider-early",
      outboxId: id,
      eventType: "message.sent" as const,
    };

    await expect(repository.applyWebhook(event)).resolves.toBe("processed");
    await expect(repository.markAccepted(leased, "provider-early", 1_000)).resolves.toBeUndefined();

    expect(
      await database.sql`select status,provider_reference,content,recipient from notification_outbox where id=${id}`,
    ).toEqual([
      {
        status: "sent",
        provider_reference: "provider-early",
        content: null,
        recipient: "***0120",
      },
    ]);
    await expect(repository.applyWebhook(event)).resolves.toBe("duplicate");
  });

  it("redacts accepted retrying webhooks immediately and retains a pollable reference", async () => {
    const id = await queue({ status: "unknown" });
    const repository = new OutboxRepository(database);

    await expect(
      repository.applyWebhook({
        provider: "unisms",
        providerEventId: "webhook-retrying-redacted",
        providerReference: "provider-retrying",
        outboxId: id,
        eventType: "message.retrying",
      }),
    ).resolves.toBe("processed");

    expect(
      await database.sql`select status,provider_reference,content,recipient from notification_outbox where id=${id}`,
    ).toEqual([
      {
        status: "processing",
        provider_reference: "provider-retrying",
        content: null,
        recipient: "***0120",
      },
    ]);
  });

  it("does not regress a terminal delivery when a late retrying event arrives", async () => {
    const id = await queue({
      status: "processing",
      providerReference: "msg-terminal-1",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const repository = new OutboxRepository(database);
    await repository.applyWebhook({
      provider: "unisms",
      providerEventId: "webhook-sent",
      providerReference: "msg-terminal-1",
      eventType: "message.sent",
    });

    await repository.applyWebhook({
      provider: "unisms",
      providerEventId: "webhook-late-retry",
      providerReference: "msg-terminal-1",
      eventType: "message.retrying",
    });

    expect(
      await database.sql`select status,content from notification_outbox where id=${id}`,
    ).toEqual([{ status: "sent", content: null }]);
    expect(await database.sql`select id from notification_webhook_events`).toHaveLength(2);
  });
});
