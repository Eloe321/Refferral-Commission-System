import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { DeliveryProviderError, type NeutralDeliveryState } from "./unisms.adapter.js";
import {
  OutboxRepository,
  type OutboxReconciliationRow,
  type OutboxRow,
} from "./outbox.repository.js";

export const OUTBOX_DELIVERY = Symbol("OUTBOX_DELIVERY");
export const OUTBOX_WORKER_OPTIONS = Symbol("OUTBOX_WORKER_OPTIONS");

export type OutboxDelivery = {
  send(message: {
    outboxId: string;
    recipient: string;
    content: string;
    dedupeKey: string;
    channel: "sms" | "email";
    provider: string;
  }): Promise<{ referenceId: string; state: NeutralDeliveryState }>;
  reconcile(
    provider: string,
    referenceId: string,
  ): Promise<{ referenceId: string; state: NeutralDeliveryState }>;
};

export type OutboxWorkerOptions = Readonly<{
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  baseRetryMs: number;
  maxRetryMs: number;
  pollMs?: number;
}>;

@Injectable()
export class OutboxWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    @Inject(OutboxRepository) private readonly repository: OutboxRepository,
    @Inject(OUTBOX_DELIVERY) private readonly delivery: OutboxDelivery,
    @Inject(OUTBOX_WORKER_OPTIONS) private readonly options: OutboxWorkerOptions,
  ) {}

  onModuleInit(): void {
    if (!this.options.pollMs) return;
    this.timer = setInterval(
      () => {
        void this.poll().catch(() => {
          this.logger.warn("Outbox poll failed");
        });
      },
      this.options.pollMs,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } finally {
      this.running = false;
    }
  }

  async runOnce(): Promise<number> {
    const rows = await this.repository.leaseBatch(this.options.batchSize, this.options.leaseMs);
    await Promise.all(rows.map((row) => this.deliver(row)));
    const reconciliation = await this.repository.leaseReconciliationBatch(
      this.options.batchSize,
      this.options.leaseMs,
    );
    await Promise.all(reconciliation.map((row) => this.reconcile(row)));
    return rows.length + reconciliation.length;
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const prepared = await this.repository.prepareDispatch(row);
    if (!prepared) return;
    let result: { referenceId: string; state: NeutralDeliveryState };
    try {
      result = await this.delivery.send({
        outboxId: row.id,
        recipient: row.recipient,
        content: row.content,
        dedupeKey: row.dedupeKey,
        channel: row.channel,
        provider: row.provider,
      });
    } catch (error) {
      const disposition =
        error instanceof DeliveryProviderError ? error.disposition : "ambiguous";
      if (disposition === "retryable" && row.attempts < this.options.maxAttempts) {
        const delay = Math.min(
          this.options.baseRetryMs * 2 ** (row.attempts - 1),
          this.options.maxRetryMs,
        );
        await this.repository.retry(row, delay);
      } else if (disposition !== "ambiguous") {
        await this.repository.markTerminal(row, "failed", null);
      }
      return;
    }
    try {
      if (result.state === "processing") {
        await this.repository.markAccepted(row, result.referenceId, this.options.baseRetryMs);
      } else {
        await this.repository.markTerminal(row, result.state, result.referenceId);
      }
    } catch {
      // Provider acceptance is irreversible and UniSMS has no idempotency key.
      // The durable unknown intent is intentionally non-resending.
      this.logger.warn("Provider result persistence failed; delivery remains unknown");
    }
  }

  private async reconcile(row: OutboxReconciliationRow): Promise<void> {
    const delay = Math.min(
      this.options.baseRetryMs * 2 ** Math.max(0, row.reconciliationAttempts - 1),
      this.options.maxRetryMs,
    );
    try {
      const result = await this.delivery.reconcile(row.provider, row.providerReference);
      if (result.referenceId !== row.providerReference || result.state === "processing") {
        await this.repository.scheduleReconciliation(row, delay);
        return;
      }
      await this.repository.markReconciledTerminal(row, result.state);
    } catch {
      await this.repository.scheduleReconciliation(row, delay);
    }
  }
}
