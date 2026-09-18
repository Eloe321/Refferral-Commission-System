import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboxRepository } from "../../src/notifications/outbox.repository.js";
import { OutboxWorker } from "../../src/notifications/outbox.worker.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("OutboxWorker scheduling", () => {
  it("never retries a provider success when result persistence fails", async () => {
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      dedupeKey: "otp:challenge-1",
      channel: "sms" as const,
      provider: "unisms",
      recipient: "+12025550120",
      content: "Code 123456",
      attempts: 1,
      leaseExpiresAt: "2026-09-16T00:00:30.000Z",
    };
    const retry = vi.fn();
    const prepareDispatch = vi.fn().mockResolvedValue(true);
    const repository = {
      leaseBatch: vi.fn().mockResolvedValueOnce([row]).mockResolvedValue([]),
      prepareDispatch,
      markAccepted: vi.fn().mockRejectedValue(new Error("database unavailable")),
      markTerminal: vi.fn(),
      retry,
      leaseReconciliationBatch: vi.fn().mockResolvedValue([]),
    } as unknown as OutboxRepository;
    const send = vi.fn().mockResolvedValue({ referenceId: "sms-accepted", state: "processing" });
    const worker = new OutboxWorker(
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

    await worker.runOnce();
    await worker.runOnce();

    expect(send).toHaveBeenCalledTimes(1);
    expect(prepareDispatch).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("contains a failed poll and continues polling without an unhandled rejection", async () => {
    vi.useFakeTimers();
    const leaseBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("database failure with private context"))
      .mockResolvedValue([]);
    const repository = { leaseBatch } as unknown as OutboxRepository;
    const delivery = { send: vi.fn(), reconcile: vi.fn() };
    const worker = new OutboxWorker(repository, delivery, {
      batchSize: 2,
      leaseMs: 5_000,
      maxAttempts: 3,
      baseRetryMs: 1_000,
      maxRetryMs: 4_000,
      pollMs: 10,
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      worker.onModuleInit();
      await vi.advanceTimersByTimeAsync(25);
      worker.onApplicationShutdown();
      await Promise.resolve();

      expect(leaseBatch).toHaveBeenCalledTimes(2);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      worker.onApplicationShutdown();
    }
  });
});
