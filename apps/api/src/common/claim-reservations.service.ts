import { Injectable } from "@nestjs/common";
import type { ConversionStatus, EarningStatus } from "@referral-sandbox/contracts";
import type { TransactionSql } from "postgres";
import type { Actor } from "../auth/actor.js";
import { assertEarningTransition, statusAfterHoldRelease } from "../domain/lifecycle.js";

@Injectable()
export class ClaimReservationsService {
  /**
   * Acquire before any partner, conversion, earning, or claim row lock. Operations
   * enter through different aggregate roots, so ordered claim locks alone cannot
   * prevent cycles. Future reservation/settlement writers must use this lock too.
   * PostgreSQL releases it automatically when this transaction commits or rolls back.
   */
  async lock(sql: TransactionSql, organizationId: string): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`claim-reservations:${organizationId}`},0))`;
  }

  /** Targets retain their original status until their caller applies hold/void. */
  async failAffected(
    sql: TransactionSql,
    organizationId: string,
    targetIds: string[],
  ): Promise<void> {
    if (targetIds.length === 0) return;
    const targets = [...new Set(targetIds)].sort();
    const claims = await sql<{ id: string }[]>`select c.id from claims c
      where c.organization_id=${organizationId} and c.status in ('created','processing')
      and exists (select 1 from claim_items ci where ci.organization_id=c.organization_id
        and ci.claim_id=c.id and ci.earning_id in ${sql(targets)})
      order by c.id for update of c`;
    if (claims.length === 0) return;
    const claimIds = claims.map((claim) => claim.id);
    const items = await sql<{ earning_id: string }[]>`select earning_id from claim_items
      where organization_id=${organizationId} and claim_id in ${sql(claimIds)}
      order by claim_id,earning_id,id for update`;
    const earningIds = [...new Set(items.map((item) => item.earning_id))].sort();
    const earnings = await sql<
      { id: string; status: EarningStatus; conversion_status: ConversionStatus }[]
    >`select e.id,e.status,c.status conversion_status
      from earnings e join conversion_items ci on ci.organization_id=e.organization_id and ci.id=e.conversion_item_id
      join conversions c on c.organization_id=ci.organization_id and c.id=ci.conversion_id
      where e.organization_id=${organizationId} and e.id in ${sql(earningIds)}
      order by e.id for update of e`;
    await sql`update claims set status='failed',updated_at=statement_timestamp()
      where organization_id=${organizationId} and id in ${sql(claimIds)} and status in ('created','processing')`;
    const targetSet = new Set(targets);
    for (const earning of earnings) {
      if (earning.status !== "reserved" || targetSet.has(earning.id)) continue;
      const status = statusAfterHoldRelease(earning.conversion_status);
      assertEarningTransition(earning.status, status);
      await sql`update earnings set status=${status},updated_at=statement_timestamp()
        where organization_id=${organizationId} and id=${earning.id} and status='reserved'`;
    }
  }

  async closeActiveHolds(sql: TransactionSql, actor: Actor, targetIds: string[]): Promise<void> {
    if (targetIds.length === 0) return;
    const holds = await sql<{ id: string }[]>`select id from earning_holds
      where organization_id=${actor.organizationId} and earning_id in ${sql([...new Set(targetIds)].sort())} and released_at is null
      order by earning_id,id for update`;
    if (holds.length === 0) return;
    // This transaction may predate a hold committed while it waited for the lock.
    await sql`update earning_holds set released_at=statement_timestamp(),released_by=${actor.actorId}
      where organization_id=${actor.organizationId} and id in ${sql(holds.map((hold) => hold.id))} and released_at is null`;
  }
}
