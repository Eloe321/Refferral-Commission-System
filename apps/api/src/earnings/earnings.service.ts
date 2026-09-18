import { randomUUID } from "node:crypto";
import type { ConversionStatus, EarningStatus } from "@referral-sandbox/contracts";
import { DomainConflictError } from "../domain/errors.js";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { Actor } from "../auth/actor.js";
import { AuditService } from "../common/audit.service.js";
import { ClaimReservationsService } from "../common/claim-reservations.service.js";
import { DATABASE_CLIENT } from "../database/database.module.js";
import { assertEarningTransition, statusAfterHoldRelease } from "../domain/lifecycle.js";
import type { TransactionSql } from "postgres";
type Sql = TransactionSql;
type EarningRow = {
  id: string;
  organization_id: string;
  conversion_item_id: string;
  program_id: string;
  partner_id: string;
  rule_id: string | null;
  amount_minor: bigint;
  reversed_amount_minor: bigint;
  currency: string;
  status: EarningStatus;
  rule_snapshot: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  conversion_id: string;
  conversion_status: ConversionStatus;
};
const iso = (date: Date | string) => new Date(date).toISOString();

@Injectable()
export class EarningsService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ClaimReservationsService) private readonly reservations: ClaimReservationsService,
  ) {}
  private owner(actor: Actor) {
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
  }
  private transition(from: EarningStatus, to: EarningStatus) {
    try {
      assertEarningTransition(from, to);
    } catch (error) {
      if (error instanceof DomainConflictError) throw new ConflictException({ status: error.code });
      throw error;
    }
  }
  private async activeHold(sql: Sql, actor: Actor, id: string) {
    const holds = await sql<
      { id: string }[]
    >`select id from earning_holds where organization_id=${actor.organizationId} and earning_id=${id} and released_at is null order by placed_at,id for update`;
    return holds[0];
  }
  private async closeHold(sql: Sql, actor: Actor, earningId: string, holdId: string) {
    await sql`update earning_holds set released_at=statement_timestamp(),released_by=${actor.actorId} where organization_id=${actor.organizationId} and earning_id=${earningId} and id=${holdId} and released_at is null`;
  }
  private serialize(
    row: EarningRow,
    holds: {
      id: string;
      previous_status: string;
      reason: string;
      placed_by: string;
      released_by: string | null;
      placed_at: Date;
      released_at: Date | null;
    }[],
  ) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      conversionItemId: row.conversion_item_id,
      programId: row.program_id,
      partnerId: row.partner_id,
      ruleId: row.rule_id,
      amount: { amountMinor: row.amount_minor.toString(), currency: row.currency },
      reversedAmount: { amountMinor: row.reversed_amount_minor.toString(), currency: row.currency },
      status: row.status,
      statusExplanation:
        row.status === "held"
          ? "Held pending review"
          : row.status === "eligible"
            ? "Available to claim"
            : row.status === "pending"
              ? "Waiting for conversion completion"
              : row.status === "voided"
                ? "Voided and not claimable"
                : row.status,
      ruleSnapshot: row.rule_snapshot,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      holds: holds.map((h) => ({
        id: h.id,
        organizationId: row.organization_id,
        earningId: row.id,
        previousStatus: h.previous_status,
        reason: h.reason,
        placedBy: h.placed_by,
        releasedBy: h.released_by,
        placedAt: iso(h.placed_at),
        releasedAt: h.released_at ? iso(h.released_at) : null,
      })),
    };
  }
  private async one(sql: Sql, actor: Actor, id: string, lock = false) {
    const rows = await sql<
      EarningRow[]
    >`select e.*,ci.conversion_id,c.status conversion_status from earnings e join conversion_items ci on ci.id=e.conversion_item_id and ci.organization_id=e.organization_id join conversions c on c.id=ci.conversion_id and c.organization_id=e.organization_id where e.organization_id=${actor.organizationId} and e.id=${id}${lock ? sql` for update` : sql``}`;
    if (!rows[0] || (actor.role === "partner" && rows[0].partner_id !== actor.partnerId))
      throw new NotFoundException({ status: "not_found" });
    return rows[0];
  }
  private async view(sql: Sql, actor: Actor, id: string) {
    const row = await this.one(sql, actor, id);
    const holds = await sql<
      {
        id: string;
        previous_status: string;
        reason: string;
        placed_by: string;
        released_by: string | null;
        placed_at: Date;
        released_at: Date | null;
      }[]
    >`select id,previous_status,reason,placed_by,released_by,placed_at,released_at from earning_holds where organization_id=${actor.organizationId} and earning_id=${id} order by placed_at,id`;
    return this.serialize(row, holds);
  }
  async list(actor: Actor, conversionId?: string) {
    const rows = await this.client.sql<
      EarningRow[]
    >`select e.*,ci.conversion_id,c.status conversion_status from earnings e join conversion_items ci on ci.id=e.conversion_item_id and ci.organization_id=e.organization_id join conversions c on c.id=ci.conversion_id and c.organization_id=e.organization_id where e.organization_id=${actor.organizationId}${conversionId ? this.client.sql` and ci.conversion_id=${conversionId}` : this.client.sql``}${actor.role === "partner" ? this.client.sql` and e.partner_id=${actor.partnerId}` : this.client.sql``} order by ci.position,e.id`;
    const result = [];
    for (const row of rows) {
      const holds = await this.client.sql<
        {
          id: string;
          previous_status: string;
          reason: string;
          placed_by: string;
          released_by: string | null;
          placed_at: Date;
          released_at: Date | null;
        }[]
      >`select id,previous_status,reason,placed_by,released_by,placed_at,released_at from earning_holds where organization_id=${actor.organizationId} and earning_id=${row.id} order by placed_at,id`;
      result.push(this.serialize(row, holds));
    }
    return { items: result };
  }
  async hold(actor: Actor, id: string, reason: string) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      await this.reservations.lock(sql as never, actor.organizationId);
      const earning = await this.one(sql as never, actor, id, true);
      this.transition(earning.status, "held");
      if (await this.activeHold(sql as never, actor, id))
        throw new ConflictException({ status: "earning_transition_conflict" });
      await this.reservations.failAffected(sql as never, actor.organizationId, [id]);
      await sql`update earnings set status='held',updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${id}`;
      await sql`insert into earning_holds (organization_id,earning_id,previous_status,reason,placed_by,placed_at) values (${actor.organizationId},${id},${earning.status},${reason},${actor.actorId},statement_timestamp())`;
      await this.audit.append(sql as never, actor, {
        eventKey: `earning.held:${randomUUID()}`,
        action: "earning.held",
        aggregateType: "earning",
        aggregateId: id,
        reason,
      });
      return this.view(sql as never, actor, id);
    });
  }
  async release(actor: Actor, id: string, reason: string) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      await this.reservations.lock(sql as never, actor.organizationId);
      const earning = await this.one(sql as never, actor, id, true);
      if (earning.status !== "held")
        throw new ConflictException({ status: "earning_transition_conflict" });
      const hold = await this.activeHold(sql as never, actor, id);
      if (!hold) throw new ConflictException({ status: "hold_not_active" });
      const status = statusAfterHoldRelease(earning.conversion_status);
      this.transition(earning.status, status);
      await sql`update earnings set status=${status},updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${id}`;
      await this.closeHold(sql as never, actor, id, hold.id);
      await this.audit.append(sql as never, actor, {
        eventKey: `earning.released:${hold.id}`,
        action: "earning.released",
        aggregateType: "earning",
        aggregateId: id,
        reason,
      });
      return this.view(sql as never, actor, id);
    });
  }
  async void(actor: Actor, id: string, reason: string) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      await this.reservations.lock(sql as never, actor.organizationId);
      const earning = await this.one(sql as never, actor, id, true);
      if (earning.status === "settled" || earning.status === "reversed")
        throw new ConflictException({ status: "reversal_required" });
      this.transition(earning.status, "voided");
      await this.reservations.failAffected(sql as never, actor.organizationId, [id]);
      const hold = await this.activeHold(sql as never, actor, id);
      if (hold) await this.closeHold(sql as never, actor, id, hold.id);
      await sql`update earnings set status='voided',updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${id}`;
      await this.audit.append(sql as never, actor, {
        eventKey: `earning.voided:${id}`,
        action: "earning.voided",
        aggregateType: "earning",
        aggregateId: id,
        reason,
      });
      return this.view(sql as never, actor, id);
    });
  }
}
