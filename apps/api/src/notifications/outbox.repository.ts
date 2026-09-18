import { Inject, Injectable } from "@nestjs/common";
import type { DatabaseClient } from "@referral-sandbox/database";
import { DATABASE_CLIENT } from "../database/database.module.js";
import { maskRecipient } from "./sms-delivery.port.js";

export type OutboxRow = {
  id: string;
  organizationId: string;
  dedupeKey: string;
  channel: "sms" | "email";
  provider: string;
  recipient: string;
  content: string;
  attempts: number;
  leaseExpiresAt: string;
};

export type OutboxReconciliationRow = {
  id: string;
  organizationId: string;
  provider: string;
  providerReference: string;
  reconciliationAttempts: number;
  leaseExpiresAt: string;
};

export type UniSmsWebhookEvent = Readonly<{
  provider: "unisms";
  providerEventId: string;
  providerReference: string;
  outboxId?: string;
  eventType: "message.sent" | "message.failed" | "message.retrying";
}>;

@Injectable()
export class OutboxRepository {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}

  leaseBatch(limit: number, leaseMs: number): Promise<OutboxRow[]> {
    return this.client.sql.begin(async (sql) => {
      const rows = await sql<
        {
          id: string;
          organization_id: string;
          dedupe_key: string;
          channel: "sms" | "email";
          provider: string;
          recipient: string;
          content: string;
          attempts: number;
          lease_expires_at: string;
        }[]
      >`with eligible as (
          select id from notification_outbox
          where (
            status='pending' and available_at<=clock_timestamp()
          ) or (
            status='processing' and provider_reference is null
            and lease_expires_at<=clock_timestamp()
          )
          order by available_at,id
          for update skip locked
          limit ${limit}
        )
        update notification_outbox n
        set status='processing',attempts=n.attempts+1,
            lease_expires_at=clock_timestamp()+(${leaseMs.toString()} || ' milliseconds')::interval,
            updated_at=statement_timestamp()
        from eligible
        where n.id=eligible.id and n.content is not null
        returning n.id,n.organization_id,n.dedupe_key,n.channel,n.provider,n.recipient,n.content,
                  n.attempts,n.lease_expires_at`;
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        dedupeKey: row.dedupe_key,
        channel: row.channel,
        provider: row.provider,
        recipient: row.recipient,
        content: row.content,
        attempts: row.attempts,
        leaseExpiresAt: row.lease_expires_at,
      }));
    });
  }

  async prepareDispatch(row: OutboxRow): Promise<boolean> {
    const updated = await this.client.sql<{ id: string }[]>`update notification_outbox
      set status='unknown',recipient=${maskRecipient(row.recipient, row.channel)},content=null,
          lease_expires_at=null,updated_at=statement_timestamp()
      where organization_id=${row.organizationId} and id=${row.id} and status='processing'
        and provider_reference is null and lease_expires_at=${row.leaseExpiresAt}
      returning id`;
    return updated.length === 1;
  }

  async markAccepted(row: OutboxRow, referenceId: string, reconcileDelayMs: number): Promise<void> {
    await this.client.sql`update notification_outbox
      set status='processing',provider_reference=${referenceId},
          available_at=clock_timestamp()+(${reconcileDelayMs.toString()} || ' milliseconds')::interval,
          lease_expires_at=null,updated_at=statement_timestamp()
      where organization_id=${row.organizationId} and id=${row.id} and status='unknown'
        and provider_reference is null`;
  }

  async markTerminal(
    row: OutboxRow,
    status: "sent" | "failed",
    referenceId: string | null,
  ): Promise<void> {
    await this.client.sql`update notification_outbox
      set status=${status},provider_reference=coalesce(${referenceId},provider_reference),
          recipient=${maskRecipient(row.recipient, row.channel)},content=null,lease_expires_at=null,
          updated_at=statement_timestamp()
      where organization_id=${row.organizationId} and id=${row.id} and status='unknown'
        and provider_reference is null`;
  }

  async retry(row: OutboxRow, delayMs: number): Promise<void> {
    await this.client.sql`update notification_outbox
      set status='pending',available_at=clock_timestamp()+(${delayMs.toString()} || ' milliseconds')::interval,
          recipient=${row.recipient},content=${row.content},lease_expires_at=null,
          updated_at=statement_timestamp()
      where organization_id=${row.organizationId} and id=${row.id} and status='unknown'
        and provider_reference is null`;
  }

  leaseReconciliationBatch(
    limit: number,
    leaseMs: number,
  ): Promise<OutboxReconciliationRow[]> {
    return this.client.sql.begin(async (sql) => {
      const rows = await sql<
        {
          id: string;
          organization_id: string;
          provider: string;
          provider_reference: string;
          reconciliation_attempts: number;
          lease_expires_at: string;
        }[]
      >`with eligible as (
          select id from notification_outbox
          where status='processing' and provider_reference is not null
            and available_at<=clock_timestamp()
            and (lease_expires_at is null or lease_expires_at<=clock_timestamp())
          order by available_at,id
          for update skip locked
          limit ${limit}
        )
        update notification_outbox n
        set reconciliation_attempts=n.reconciliation_attempts+1,
            lease_expires_at=clock_timestamp()+(${leaseMs.toString()} || ' milliseconds')::interval,
            updated_at=statement_timestamp()
        from eligible where n.id=eligible.id
        returning n.id,n.organization_id,n.provider,n.provider_reference,
                  n.reconciliation_attempts,n.lease_expires_at`;
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        provider: row.provider,
        providerReference: row.provider_reference,
        reconciliationAttempts: row.reconciliation_attempts,
        leaseExpiresAt: row.lease_expires_at,
      }));
    });
  }

  async scheduleReconciliation(
    row: OutboxReconciliationRow,
    delayMs: number,
  ): Promise<void> {
    await this.client.sql`update notification_outbox
      set available_at=clock_timestamp()+(${delayMs.toString()} || ' milliseconds')::interval,
          lease_expires_at=null,updated_at=statement_timestamp()
      where organization_id=${row.organizationId} and id=${row.id} and status='processing'
        and provider_reference=${row.providerReference} and lease_expires_at=${row.leaseExpiresAt}`;
  }

  async markReconciledTerminal(
    row: OutboxReconciliationRow,
    status: "sent" | "failed",
  ): Promise<void> {
    await this.client.sql`update notification_outbox
      set status=${status},content=null,lease_expires_at=null,updated_at=statement_timestamp()
      where organization_id=${row.organizationId} and id=${row.id} and status='processing'
        and provider_reference=${row.providerReference} and lease_expires_at=${row.leaseExpiresAt}`;
  }

  applyWebhook(event: UniSmsWebhookEvent): Promise<"processed" | "duplicate" | "not_found"> {
    return this.client.sql.begin(async (sql) => {
      const rows = await sql<
        {
          id: string;
          organization_id: string;
          channel: "sms" | "email";
          recipient: string;
          provider_reference: string | null;
        }[]
      >`select id,organization_id,channel,recipient,provider_reference from notification_outbox
        where provider=${event.provider} and (
          provider_reference=${event.providerReference}
          ${event.outboxId ? sql`or id=${event.outboxId}` : sql``}
        )
        order by id for update`;
      const row = rows[0];
      if (!row || rows.length !== 1) return "not_found";
      if (row.provider_reference && row.provider_reference !== event.providerReference)
        return "not_found";
      const inserted = await sql<{ id: string }[]>`insert into notification_webhook_events
        (organization_id,provider,provider_event_id,event_type)
        values (${row.organization_id},${event.provider},${event.providerEventId},${event.eventType})
        on conflict (provider,provider_event_id) do nothing returning id`;
      if (!inserted[0]) return "duplicate";
      const target =
        event.eventType === "message.sent"
          ? "sent"
          : event.eventType === "message.failed"
            ? "failed"
            : "processing";
      const terminal = target !== "processing";
      await sql`update notification_outbox set
        status=case when status in ('sent','failed') then status else ${target}::outbox_status end,
        provider_reference=coalesce(provider_reference,${event.providerReference}),
        content=null,recipient=${maskRecipient(row.recipient, row.channel)},
        available_at=case when ${terminal} then available_at else clock_timestamp() end,
        lease_expires_at=null,updated_at=statement_timestamp()
        where organization_id=${row.organization_id} and id=${row.id}`;
      return "processed";
    });
  }
}
