/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateConversionInput, EarningStatus } from "@referral-sandbox/contracts";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { Actor } from "../auth/actor.js";
import { AuditService } from "../common/audit.service.js";
import { ClaimReservationsService } from "../common/claim-reservations.service.js";
import { assertEarningTransition } from "../domain/lifecycle.js";
import { IdempotencyService } from "../common/idempotency.service.js";
import { DATABASE_CLIENT } from "../database/database.module.js";
import { calculateCommission } from "../domain/money.js";
import { selectApplicableRule, type CandidateCommissionRule } from "../domain/rules.js";
import type { TransactionSql } from "postgres";
import postgres from "postgres";

type Sql = TransactionSql;
type ConversionRow = {
  id: string;
  organization_id: string;
  program_id: string;
  partner_id: string;
  referral_code_id: string;
  external_ref: string;
  currency: string;
  status: string;
  created_at: Date;
  updated_at: Date;
};
type ItemRow = {
  id: string;
  conversion_id: string;
  external_ref: string;
  category: string;
  gross_amount_minor: bigint;
  refunded_base_minor: bigint;
};
const money = (amountMinor: bigint, currency: string) => ({
  amountMinor: amountMinor.toString(),
  currency,
});
const asIso = (date: Date | string) => new Date(date).toISOString();

@Injectable()
export class ConversionsService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ClaimReservationsService) private readonly reservations: ClaimReservationsService,
  ) {}
  private owner(actor: Actor): void {
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
  }
  private serialize(row: ConversionRow, items: ItemRow[]) {
    return {
      id: row.id,
      organizationId: row.organization_id,
      programId: row.program_id,
      partnerId: row.partner_id,
      referralCodeId: row.referral_code_id,
      externalRef: row.external_ref,
      currency: row.currency,
      status: row.status,
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
      items: items.map((item) => ({
        id: item.id,
        organizationId: row.organization_id,
        conversionId: row.id,
        externalRef: item.external_ref,
        category: item.category,
        grossAmount: money(item.gross_amount_minor, row.currency),
        refundedBase: money(item.refunded_base_minor, row.currency),
      })),
    };
  }
  private async load(sql: Sql, organizationId: string, id: string) {
    const rows = await sql<
      ConversionRow[]
    >`select * from conversions where organization_id=${organizationId} and id=${id}`;
    if (!rows[0]) throw new NotFoundException({ status: "not_found" });
    const items = await sql<
      ItemRow[]
    >`select id,conversion_id,external_ref,category,gross_amount_minor,refunded_base_minor from conversion_items where organization_id=${organizationId} and conversion_id=${id} order by position`;
    return this.serialize(rows[0], items);
  }
  async create(actor: Actor, input: CreateConversionInput) {
    this.owner(actor);
    if (new Set(input.items.map((item) => item.externalRef)).size !== input.items.length)
      throw new BadRequestException({ status: "invalid_request" });
    return this.client.sql
      .begin(async (sql) => {
        const existing = await this.idempotency.acquire(
          sql as never,
          actor.organizationId,
          "conversion.create",
          input.idempotencyKey,
          input,
        );
        if (existing?.response) return existing.response;
        const org = await sql<
          { currency: string }[]
        >`select currency from organizations where id=${actor.organizationId} for share`;
        if (!org[0] || org[0].currency !== input.currency)
          throw new BadRequestException({ status: "invalid_currency" });
        const resolved = await sql<
          {
            code_id: string;
            partner_id: string;
            program_id: string;
            program_status: string;
            partner_status: string;
          }[]
        >`select c.id code_id,c.partner_id,c.program_id,p.status program_status,pa.status partner_status from referral_codes c join programs p on p.id=c.program_id and p.organization_id=c.organization_id join partners pa on pa.id=c.partner_id and pa.organization_id=c.organization_id where c.organization_id=${actor.organizationId} and upper(c.code)=upper(${input.referralCode}) and c.active=true and c.program_id=${input.programId} for update`;
        const code = resolved[0];
        if (!code) throw new NotFoundException({ status: "referral_not_found" });
        if (code.program_status !== "active")
          throw new ConflictException({ status: "program_paused" });
        if (code.partner_status !== "active")
          throw new ConflictException({ status: "partner_suspended" });
        const created = await sql<
          ConversionRow[]
        >`insert into conversions (organization_id,program_id,partner_id,referral_code_id,external_ref,currency,status) values (${actor.organizationId},${code.program_id},${code.partner_id},${code.code_id},${input.externalRef},${input.currency},'scheduled') returning *`;
        const conversion = created[0]!;
        for (const [position, item] of input.items.entries()) {
          const itemRows = await sql<
            ItemRow[]
          >`insert into conversion_items (organization_id,conversion_id,external_ref,category,position,gross_amount_minor) values (${actor.organizationId},${conversion.id},${item.externalRef},${item.category},${position},${item.grossAmountMinor}) returning id,conversion_id,external_ref,category,gross_amount_minor,refunded_base_minor`;
          const rules = await sql<
            {
              id: string;
              program_id: string;
              partner_id: string | null;
              category: string | null;
              rule_type: "flat" | "percentage";
              flat_amount_minor: bigint | null;
              basis_points: number | null;
              effective_from: Date;
              effective_to: Date | null;
            }[]
          >`select id,program_id,partner_id,category,rule_type,flat_amount_minor,basis_points,effective_from,effective_to from commission_rules where organization_id=${actor.organizationId} and program_id=${code.program_id}`;
          const candidate = selectApplicableRule({
            rules: rules.map((r): CandidateCommissionRule => ({
              id: r.id,
              programId: r.program_id,
              partnerId: r.partner_id,
              category: r.category,
              active: true,
              effectiveFrom: new Date(r.effective_from),
              effectiveTo: r.effective_to ? new Date(r.effective_to) : null,
              ...(r.rule_type === "flat"
                ? { type: "flat", flatAmountMinor: r.flat_amount_minor! }
                : { type: "percentage", basisPoints: r.basis_points! }),
            })),
            programId: code.program_id,
            partnerId: code.partner_id,
            category: item.category,
            at: new Date(),
          });
          const amount = candidate
            ? calculateCommission(candidate, BigInt(item.grossAmountMinor))
            : 0n;
          const snapshot = candidate
            ? {
                ruleId: candidate.id,
                type: candidate.type,
                flatAmountMinor:
                  candidate.type === "flat" ? candidate.flatAmountMinor.toString() : null,
                basisPoints: candidate.type === "percentage" ? candidate.basisPoints : null,
                programId: candidate.programId,
                partnerId: candidate.partnerId,
                category: candidate.category,
                effectiveFrom: candidate.effectiveFrom.toISOString(),
                effectiveTo: candidate.effectiveTo?.toISOString() ?? null,
                calculationBaseMinor: item.grossAmountMinor,
                resultAmountMinor: amount.toString(),
              }
            : {};
          await sql`insert into earnings (organization_id,conversion_item_id,program_id,partner_id,rule_id,amount_minor,currency,status,rule_snapshot) values (${actor.organizationId},${itemRows[0]!.id},${code.program_id},${code.partner_id},${candidate?.id ?? null},${amount.toString()},${input.currency},${candidate ? "pending" : "needs_rule"},${JSON.stringify(snapshot)}::jsonb)`;
        }
        const response = await this.load(sql as never, actor.organizationId, conversion.id);
        await this.audit.append(sql as never, actor, {
          eventKey: `conversion.created:${conversion.id}`,
          action: "conversion.created",
          aggregateType: "conversion",
          aggregateId: conversion.id,
          reason: "Referral conversion created",
          metadata: { externalRef: conversion.external_ref },
        });
        const row = await sql<
          { id: string }[]
        >`select id from idempotency_records where organization_id=${actor.organizationId} and scope='conversion.create' and idempotency_key=${input.idempotencyKey}`;
        await this.idempotency.complete(
          sql as never,
          actor.organizationId,
          row[0]!.id,
          conversion.id,
          response,
        );
        return response;
      })
      .catch((error: unknown) => {
        // Translate only the known external-reference constraint after the transaction rolls back.
        if (
          error instanceof postgres.PostgresError &&
          error.code === "23505" &&
          error.constraint_name === "conversions_org_program_external_ref_unique"
        ) {
          throw new ConflictException({ status: "conversion_reference_conflict" });
        }
        throw error;
      });
  }
  async complete(actor: Actor, id: string, key: string) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      await this.reservations.lock(sql as never, actor.organizationId);
      const existing = await this.idempotency.acquire(
        sql as never,
        actor.organizationId,
        `conversion.complete:${id}`,
        key,
        { id },
      );
      if (existing?.response) return existing.response;
      const row = await sql<
        ConversionRow[]
      >`select * from conversions where organization_id=${actor.organizationId} and id=${id} for update`;
      if (!row[0]) throw new NotFoundException({ status: "not_found" });
      if (row[0].status !== "scheduled")
        throw new ConflictException({ status: "conversion_transition_conflict" });
      await sql`update conversions set status='completed',updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${id}`;
      await sql`update earnings set status='eligible',updated_at=statement_timestamp() where organization_id=${actor.organizationId} and conversion_item_id in (select id from conversion_items where organization_id=${actor.organizationId} and conversion_id=${id}) and status='pending'`;
      const response = await this.load(sql as never, actor.organizationId, id);
      await this.audit.append(sql as never, actor, {
        eventKey: `conversion.completed:${id}`,
        action: "conversion.completed",
        aggregateType: "conversion",
        aggregateId: id,
        reason: "Conversion completed",
      });
      const record = await sql<
        { id: string }[]
      >`select id from idempotency_records where organization_id=${actor.organizationId} and scope=${`conversion.complete:${id}`} and idempotency_key=${key}`;
      await this.idempotency.complete(
        sql as never,
        actor.organizationId,
        record[0]!.id,
        id,
        response,
      );
      return response;
    });
  }
  async cancel(actor: Actor, id: string, status: "cancelled" | "no_show", reason: string) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      await this.reservations.lock(sql as never, actor.organizationId);
      const row = await sql<
        ConversionRow[]
      >`select * from conversions where organization_id=${actor.organizationId} and id=${id} for update`;
      if (!row[0]) throw new NotFoundException({ status: "not_found" });
      if (row[0].status !== "scheduled")
        throw new ConflictException({ status: "conversion_transition_conflict" });
      const earnings = await sql<
        { id: string; status: EarningStatus }[]
      >`select e.id,e.status from earnings e
        join conversion_items ci on ci.organization_id=e.organization_id and ci.id=e.conversion_item_id
        where e.organization_id=${actor.organizationId} and ci.conversion_id=${id}
        and e.status in ('needs_rule','pending','eligible','held','reserved') order by e.id for update of e`;
      const targetIds = earnings.map((earning) => earning.id);
      await this.reservations.failAffected(sql as never, actor.organizationId, targetIds);
      await this.reservations.closeActiveHolds(sql as never, actor, targetIds);
      for (const earning of earnings) assertEarningTransition(earning.status, "voided");
      await sql`update conversions set status=${status},updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${id}`;
      await sql`update earnings set status='voided',updated_at=statement_timestamp() where organization_id=${actor.organizationId} and conversion_item_id in (select id from conversion_items where organization_id=${actor.organizationId} and conversion_id=${id}) and status in ('needs_rule','pending','eligible','held','reserved')`;
      await this.audit.append(sql as never, actor, {
        eventKey: `conversion.${status}:${id}`,
        action: `conversion.${status}`,
        aggregateType: "conversion",
        aggregateId: id,
        reason,
      });
      return this.load(sql as never, actor.organizationId, id);
    });
  }
}
