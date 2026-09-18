import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { z } from "zod";

type Sql = TransactionSql;
export const mutationIdempotencyKey = z.string().trim().min(8).max(120);
export type IdempotencyRecord = { id: string; request_hash: string; response: Record<string, unknown> | null; resource_id: string | null };

export function mutationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

@Injectable()
export class IdempotencyService {
  async acquire(sql: Sql, organizationId: string, scope: string, key: string, payload: unknown): Promise<IdempotencyRecord | null> {
    const hash = mutationHash(payload);
    const inserted = await sql<IdempotencyRecord[]>`insert into idempotency_records (organization_id,scope,idempotency_key,request_hash)
      values (${organizationId},${scope},${key},${hash}) on conflict (organization_id,scope,idempotency_key) do nothing returning id,request_hash,response,resource_id`;
    if (inserted[0]) return null;
    const existing = await sql<IdempotencyRecord[]>`select id,request_hash,response,resource_id from idempotency_records where organization_id=${organizationId} and scope=${scope} and idempotency_key=${key} for update`;
    if (!existing[0]) throw new ConflictException({ status: "idempotency_in_progress" });
    if (existing[0].request_hash !== hash) throw new ConflictException({ status: "idempotency_conflict" });
    return existing[0];
  }
  async complete(sql: Sql, organizationId: string, id: string, resourceId: string, response: Record<string, unknown>): Promise<void> {
    await sql`update idempotency_records set resource_id=${resourceId}, conversion_id=${resourceId}, response=${JSON.stringify(response)}::jsonb where organization_id=${organizationId} and id=${id}`;
  }
  async completeResource(
    sql: Sql,
    organizationId: string,
    id: string,
    resourceId: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    await sql`update idempotency_records set resource_id=${resourceId}, response=${JSON.stringify(response)}::jsonb
      where organization_id=${organizationId} and id=${id}`;
  }
}
