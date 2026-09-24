import { Inject, Injectable } from "@nestjs/common";
import type { Actor } from "../auth/actor.js";
import { DATABASE_CLIENT } from "../database/database.module.js";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { TransactionSql } from "postgres";

type Sql = TransactionSql;
export type AuditInput = {
  eventKey: string;
  action: string;
  aggregateType: string;
  aggregateId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE_CLIENT) private readonly client: DatabaseClient) {}
  async append(sql: Sql, actor: Actor, input: AuditInput): Promise<void> {
    // Metadata is deliberately caller-selected operational context, never a request body or recipient data.
    await sql`insert into audit_events (organization_id,event_key,actor_id,is_system_event,action,reason,aggregate_type,aggregate_id,metadata,created_at)
      values (${actor.organizationId},${input.eventKey},${actor.actorId},false,${input.action},${input.reason ?? null},${input.aggregateType},${input.aggregateId},${JSON.stringify(input.metadata ?? {})}::jsonb,statement_timestamp())
      on conflict (organization_id,event_key) do nothing`;
  }
  async appendSystem(sql: Sql, organizationId: string, input: AuditInput): Promise<void> {
    await sql`insert into audit_events (organization_id,event_key,actor_id,is_system_event,action,reason,aggregate_type,aggregate_id,metadata,created_at)
      values (${organizationId},${input.eventKey},null,true,${input.action},${input.reason ?? null},${input.aggregateType},${input.aggregateId},${JSON.stringify(input.metadata ?? {})}::jsonb,statement_timestamp())
      on conflict (organization_id,event_key) do nothing`;
  }
}
