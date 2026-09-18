import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import {
  conversionSchema,
  type ConversionStatus,
  type EarningStatus,
  type RefundInput,
} from "@referral-sandbox/contracts";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { TransactionSql } from "postgres";
import type { Actor } from "../auth/actor.js";
import { AuditService } from "../common/audit.service.js";
import { ClaimReservationsService } from "../common/claim-reservations.service.js";
import { IdempotencyService, mutationIdempotencyKey } from "../common/idempotency.service.js";
import { DATABASE_CLIENT } from "../database/database.module.js";
import { calculateCommission, POSTGRES_BIGINT_MAX } from "../domain/money.js";
import { assertConversionTransition } from "../domain/lifecycle.js";

type ConversionRow = {
  id: string;
  organization_id: string;
  program_id: string;
  partner_id: string;
  referral_code_id: string;
  external_ref: string;
  currency: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ItemRow = {
  id: string;
  organization_id: string;
  conversion_id: string;
  external_ref: string;
  category: string;
  gross_amount_minor: string;
  refunded_base_minor: string;
};

type EarningRow = {
  id: string;
  conversion_item_id: string;
  partner_id: string;
  amount_minor: string;
  reversed_amount_minor: string;
  currency: string;
  status: EarningStatus;
  rule_snapshot: Record<string, unknown>;
};

function snapshotCommission(snapshot: Record<string, unknown>, refundedBase: bigint): bigint {
  if (
    snapshot.type === "percentage" &&
    Number.isInteger(snapshot.basisPoints) &&
    Number(snapshot.basisPoints) >= 1 &&
    Number(snapshot.basisPoints) <= 10_000
  ) {
    return calculateCommission(
      { type: "percentage", basisPoints: Number(snapshot.basisPoints) },
      refundedBase,
    );
  }
  if (
    snapshot.type === "flat" &&
    typeof snapshot.flatAmountMinor === "string" &&
    /^[0-9]+$/.test(snapshot.flatAmountMinor) &&
    BigInt(snapshot.flatAmountMinor) <= POSTGRES_BIGINT_MAX
  ) {
    return calculateCommission(
      { type: "flat", flatAmountMinor: BigInt(snapshot.flatAmountMinor) },
      refundedBase,
    );
  }
  throw new ConflictException({ status: "invalid_rule_snapshot" });
}

const money = (amountMinor: string, currency: string) => ({ amountMinor, currency });

@Injectable()
export class ReversalService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(ClaimReservationsService) private readonly reservations: ClaimReservationsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  async refund(actor: Actor, conversionId: string, input: RefundInput, key: string) {
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
    const parsedKey = mutationIdempotencyKey.safeParse(key);
    if (!parsedKey.success) throw new BadRequestException({ status: "invalid_request" });
    const targets = [...input.items].sort((left, right) =>
      left.conversionItemId.localeCompare(right.conversionItemId),
    );
    const canonicalPayload = {
      conversionId: conversionId.toLowerCase(),
      reason: input.reason,
      items: targets.map((target) => ({
        conversionItemId: target.conversionItemId.toLowerCase(),
        refundedBaseMinor: BigInt(target.refundedBaseMinor).toString(),
      })),
    };
    const scope = `conversion.refund:${conversionId.toLowerCase()}:actor:${actor.actorId}`;
    try {
      return await this.client.sql.begin(async (sql) => {
        await this.reservations.lock(sql, actor.organizationId);
        const existing = await this.idempotency.acquire(
          sql,
          actor.organizationId,
          scope,
          parsedKey.data,
          canonicalPayload,
        );
        if (existing) {
          if (!existing.response)
            throw new ConflictException({ status: "idempotency_in_progress" });
          return conversionSchema.parse(existing.response);
        }
        const [organization] = await sql<
          { currency: string }[]
        >`select currency from organizations where id=${actor.organizationId} for share`;
        const [conversion] = await sql<ConversionRow[]>`select * from conversions
        where organization_id=${actor.organizationId} and id=${conversionId} for update`;
        if (!conversion) throw new NotFoundException({ status: "not_found" });
        if (!["completed", "partially_refunded", "refunded"].includes(conversion.status)) {
          throw new ConflictException({ status: "conversion_transition_conflict" });
        }
        const allItems = await sql<ItemRow[]>`select id,organization_id,conversion_id,external_ref,
        category,gross_amount_minor::text,refunded_base_minor::text
        from conversion_items where organization_id=${actor.organizationId}
        and conversion_id=${conversionId} order by id for update`;
        const itemById = new Map(allItems.map((item) => [item.id, item]));
        if (targets.some((target) => !itemById.has(target.conversionItemId))) {
          throw new NotFoundException({ status: "not_found" });
        }
        const targetIds = targets.map((target) => target.conversionItemId);
        const earnings = await sql<EarningRow[]>`select id,conversion_item_id,partner_id,
        amount_minor::text,reversed_amount_minor::text,currency,status,rule_snapshot
        from earnings where organization_id=${actor.organizationId}
        and conversion_item_id in ${sql(targetIds)} order by id for update`;
        if (earnings.length !== targetIds.length) {
          throw new ConflictException({ status: "earning_unavailable" });
        }
        if (
          !organization ||
          conversion.currency !== organization.currency ||
          earnings.some(
            (earning) =>
              earning.currency !== conversion.currency ||
              earning.partner_id !== conversion.partner_id,
          )
        ) {
          throw new ConflictException({ status: "invalid_currency" });
        }
        await sql`select id from ledger_entries where organization_id=${actor.organizationId}
        and earning_id in ${sql(earnings.map((earning) => earning.id).sort())}
        order by earning_id,id for update`;

        for (const target of targets) {
          const item = itemById.get(target.conversionItemId);
          if (!item) throw new NotFoundException({ status: "not_found" });
          const next = BigInt(target.refundedBaseMinor);
          const current = BigInt(item.refunded_base_minor);
          if (next < current || next > BigInt(item.gross_amount_minor)) {
            throw new ConflictException({ status: "invalid_refund" });
          }
        }

        const unpaid = earnings.filter(
          (earning) => !["settled", "reversed", "voided"].includes(earning.status),
        );
        await this.reservations.failAffected(
          sql,
          actor.organizationId,
          unpaid.map((earning) => earning.id),
        );
        await this.reservations.closeActiveHolds(
          sql,
          actor,
          unpaid.map((earning) => earning.id),
        );

        let changed = false;
        for (const target of targets) {
          const item = itemById.get(target.conversionItemId);
          const earning = earnings.find(
            (candidate) => candidate.conversion_item_id === target.conversionItemId,
          );
          if (!item || !earning) throw new ConflictException({ status: "earning_unavailable" });
          if (target.refundedBaseMinor !== item.refunded_base_minor) {
            await sql`update conversion_items set refunded_base_minor=${target.refundedBaseMinor}
            where organization_id=${actor.organizationId} and id=${item.id}`;
            item.refunded_base_minor = target.refundedBaseMinor;
            changed = true;
          }
          if (!["settled", "reversed", "voided"].includes(earning.status)) {
            await sql`update earnings set status='voided',updated_at=statement_timestamp()
            where organization_id=${actor.organizationId} and id=${earning.id}`;
            earning.status = "voided";
            changed = true;
            continue;
          }
          if (earning.status === "voided") continue;
          const calculated = snapshotCommission(
            earning.rule_snapshot,
            BigInt(target.refundedBaseMinor),
          );
          const amount = BigInt(earning.amount_minor);
          const reversed = BigInt(earning.reversed_amount_minor);
          const desired = calculated > amount ? amount : calculated;
          const delta = desired > reversed ? desired - reversed : 0n;
          if (delta === 0n) continue;
          await sql`insert into ledger_entries
          (organization_id,partner_id,earning_id,entry_type,amount_minor,currency,reason)
          values (${actor.organizationId},${earning.partner_id},${earning.id},'reversal',${(-delta).toString()},${earning.currency},${input.reason})`;
          await sql`update earnings set reversed_amount_minor=${desired.toString()},status='reversed',
          updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${earning.id}`;
          earning.reversed_amount_minor = desired.toString();
          earning.status = "reversed";
          changed = true;
        }

        const nextStatus = allItems.every(
          (item) => BigInt(item.refunded_base_minor) === BigInt(item.gross_amount_minor),
        )
          ? "refunded"
          : "partially_refunded";
        if (
          conversion.status !== nextStatus ||
          (changed && conversion.status === "partially_refunded")
        ) {
          assertConversionTransition(conversion.status as ConversionStatus, nextStatus);
        }
        if (conversion.status !== nextStatus) {
          await sql`update conversions set status=${nextStatus},updated_at=statement_timestamp()
          where organization_id=${actor.organizationId} and id=${conversionId}`;
          conversion.status = nextStatus;
          changed = true;
        }
        if (changed) {
          await this.audit.append(sql, actor, {
            eventKey: `conversion.refunded:${randomUUID()}`,
            action: "conversion.refunded",
            aggregateType: "conversion",
            aggregateId: conversionId,
            reason: input.reason,
            metadata: {
              items: targets.map((target) => ({
                conversionItemId: target.conversionItemId,
                refundedBaseMinor: target.refundedBaseMinor,
              })),
            },
          });
        }
        const response = await this.response(sql, actor.organizationId, conversionId);
        const [record] = await sql<{ id: string }[]>`select id from idempotency_records
          where organization_id=${actor.organizationId} and scope=${scope}
          and idempotency_key=${parsedKey.data}`;
        if (!record) throw new Error("Refund idempotency record unavailable");
        await this.idempotency.complete(
          sql,
          actor.organizationId,
          record.id,
          conversionId,
          response,
        );
        return response;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException({ status: "internal_error" });
    }
  }

  private async response(sql: TransactionSql, organizationId: string, conversionId: string) {
    const [row] = await sql<ConversionRow[]>`select * from conversions
      where organization_id=${organizationId} and id=${conversionId}`;
    if (!row) throw new NotFoundException({ status: "not_found" });
    const items = await sql<ItemRow[]>`select id,organization_id,conversion_id,external_ref,
      category,gross_amount_minor::text,refunded_base_minor::text
      from conversion_items where organization_id=${organizationId}
      and conversion_id=${conversionId} order by position`;
    return conversionSchema.parse({
      id: row.id,
      organizationId: row.organization_id,
      programId: row.program_id,
      partnerId: row.partner_id,
      referralCodeId: row.referral_code_id,
      externalRef: row.external_ref,
      currency: row.currency,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      items: items.map((item) => ({
        id: item.id,
        organizationId: item.organization_id,
        conversionId: item.conversion_id,
        externalRef: item.external_ref,
        category: item.category,
        grossAmount: money(item.gross_amount_minor, row.currency),
        refundedBase: money(item.refunded_base_minor, row.currency),
      })),
    });
  }
}
