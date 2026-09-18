import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import {
  claimListSchema,
  createClaimInput,
  ownerClaimListSchema,
  ownerClaimSchema,
  simulateClaimInput,
  type CreateClaimInput,
  type ClaimStatus,
} from "@referral-sandbox/contracts";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import type { Actor } from "../auth/actor.js";
import { AuditService } from "../common/audit.service.js";
import { ClaimReservationsService } from "../common/claim-reservations.service.js";
import { ClaimRecoveryService } from "../common/claim-recovery.service.js";
import { IdempotencyService, mutationIdempotencyKey } from "../common/idempotency.service.js";
import type { AppEnv } from "../config/env.js";
import { APP_ENV, DATABASE_CLIENT } from "../database/database.module.js";
import { createClaimDraftHash, MAX_CLAIM_AMOUNT } from "../domain/claim-draft.js";
import { assertEarningTransition } from "../domain/lifecycle.js";
import { maskRecipient } from "../notifications/sms-delivery.port.js";
import { ClaimRepository, type ClaimRow } from "./claim.repository.js";

export const claimIdempotencyKey = z.string().trim().min(8).max(120);
function sameHash(left: string, right: string) {
  const valid = /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right);
  return (
    timingSafeEqual(
      valid ? Buffer.from(left, "hex") : Buffer.alloc(32),
      valid ? Buffer.from(right, "hex") : Buffer.alloc(32),
    ) && valid
  );
}

@Injectable()
export class ClaimsService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(ClaimReservationsService) private readonly reservations: ClaimReservationsService,
    @Inject(ClaimRecoveryService) private readonly recovery: ClaimRecoveryService,
    @Inject(ClaimRepository) private readonly repository: ClaimRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}
  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException({ status: "internal_error" });
    }
  }
  private async partner(sql: TransactionSql, actor: Actor) {
    if (actor.role !== "partner" || !actor.partnerId)
      throw new ForbiddenException({ status: "forbidden" });
    await this.reservations.lock(sql, actor.organizationId);
    const [partner] = await sql<
      { id: string; email: string; status: string }[]
    >`select p.id,p.email,p.status from partners p join users u on u.organization_id=p.organization_id and u.id=p.user_id where p.organization_id=${actor.organizationId} and p.id=${actor.partnerId} and p.user_id=${actor.actorId} and u.role='partner' for update of p,u`;
    if (!partner || partner.status !== "active")
      throw new ForbiddenException({ status: "partner_unavailable" });
    return partner;
  }
  private hash(actor: Actor, earningIds: readonly string[], amountMinor: string, currency: string) {
    return createClaimDraftHash({
      organizationId: actor.organizationId,
      actorId: actor.actorId,
      partnerId: actor.partnerId ?? "",
      earningIds,
      amountMinor,
      currency,
    });
  }
  private async claim(sql: TransactionSql, actor: Actor, id: string) {
    const [row] = await sql<
      ClaimRow[]
    >`select *,amount_minor::text from claims where organization_id=${actor.organizationId} and partner_id=${actor.partnerId ?? null} and actor_id=${actor.actorId} and id=${id} for update`;
    if (!row) throw new NotFoundException({ status: "not_found" });
    return row;
  }
  private async ownerClaim(sql: TransactionSql, actor: Actor, id: string) {
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
    const [row] = await sql<ClaimRow[]>`select *,amount_minor::text from claims
      where organization_id=${actor.organizationId} and id=${id} for update`;
    if (!row) throw new NotFoundException({ status: "not_found" });
    return row;
  }
  private async ownerResponse(sql: TransactionSql, actor: Actor, row: ClaimRow) {
    return this.repository.ownerResponse(
      row,
      await this.repository.items(sql, actor.organizationId, row.id),
      await this.repository.otpAudit(sql, actor.organizationId, row.otp_challenge_id),
    );
  }
  async create(actor: Actor, input: CreateClaimInput, key: string) {
    const parsed = createClaimInput.safeParse(input),
      parsedKey = claimIdempotencyKey.safeParse(key);
    if (!parsed.success || !parsedKey.success)
      throw new BadRequestException({ status: "invalid_request" });
    const earningIds = parsed.data.earningIds.map((id) => id.toLowerCase()).sort();
    return this.safe(() =>
      this.client.sql.begin(async (sql) => {
        const partner = await this.partner(sql, actor);
        // Match the durable key's organization + partner scope before consuming a challenge.
        const existing = await sql<
          ClaimRow[]
        >`select *,amount_minor::text from claims where organization_id=${actor.organizationId} and partner_id=${partner.id} and idempotency_key=${parsedKey.data} for update`;
        if (existing.length) {
          const row = existing[0];
          if (
            !row ||
            existing.length !== 1 ||
            row.partner_id !== partner.id ||
            row.actor_id !== actor.actorId
          )
            throw new ConflictException({ status: "idempotency_conflict" });
          const items = await this.repository.items(sql, actor.organizationId, row.id);
          const earnings = await this.repository.lockEarnings(sql, actor, earningIds);
          const total = items.reduce((sum, item) => sum + BigInt(item.amount_minor), 0n);
          if (
            items.length !== earningIds.length ||
            items.some((i, n) => i.earning_id !== earningIds[n]) ||
            earnings.length !== items.length ||
            total.toString() !== row.amount_minor ||
            earnings.some((e, n) => {
              const item = items.at(n);
              return (
                item === undefined ||
                e.partner_id !== partner.id ||
                e.currency !== row.currency ||
                e.amount_minor !== item.earning_amount_minor ||
                BigInt(item.amount_minor) < 0n ||
                BigInt(item.amount_minor) > BigInt(e.amount_minor)
              );
            }) ||
            !sameHash(
              row.selection_hash,
              this.hash(actor, earningIds, row.amount_minor, row.currency),
            )
          )
            throw new ConflictException({ status: "idempotency_conflict" });
          return this.repository.response(row, items);
        }
        const [challenge] = await sql<
          {
            id: string;
            actor_id: string;
            partner_id: string;
            status: string;
            expired: boolean;
            claim_draft_hash: string;
          }[]
        >`select id,actor_id,partner_id,status,expires_at<=clock_timestamp() expired,claim_draft_hash from otp_challenges where organization_id=${actor.organizationId} and id=${input.challengeId} for update`;
        if (
          !challenge ||
          challenge.actor_id !== actor.actorId ||
          challenge.partner_id !== partner.id
        )
          throw new NotFoundException({ status: "not_found" });
        if (challenge.expired || challenge.status === "expired")
          throw new GoneException({ status: "challenge_expired" });
        if (challenge.status !== "verified")
          throw new ConflictException({ status: "challenge_unavailable" });
        const earnings = await this.repository.lockEligibleEarnings(sql, actor, earningIds);
        const currency = earnings[0]?.currency ?? "";
        const allocations = await this.recovery.allocate(sql, {
          organizationId: actor.organizationId,
          partnerId: partner.id,
          currency,
          earnings,
        });
        const amount = allocations.reduce(
          (sum, allocation) => sum + BigInt(allocation.payoutAmountMinor),
          0n,
        );
        if (amount < 0n || amount > MAX_CLAIM_AMOUNT)
          throw new ConflictException({ status: "invalid_claim_total" });
        const hash = this.hash(
          actor,
          earnings.map((e) => e.id),
          amount.toString(),
          currency,
        );
        if (!sameHash(challenge.claim_draft_hash, hash))
          throw new ConflictException({ status: "claim_draft_changed" });
        // Recheck wall time after any row-lock wait, immediately before mutation.
        const [fresh] = await sql<
          { valid: boolean }[]
        >`select expires_at>clock_timestamp() valid from otp_challenges where organization_id=${actor.organizationId} and id=${challenge.id}`;
        if (!fresh?.valid) throw new GoneException({ status: "challenge_expired" });
        const id = randomUUID();
        const [row] = await sql<
          ClaimRow[]
        >`insert into claims (id,organization_id,partner_id,actor_id,amount_minor,currency,idempotency_key,selection_hash,otp_challenge_id,created_at,updated_at) values (${id},${actor.organizationId},${partner.id},${actor.actorId},${amount.toString()},${currency},${parsedKey.data},${hash},${challenge.id},statement_timestamp(),statement_timestamp()) returning *,amount_minor::text`;
        if (!row) throw new Error("Claim unavailable");
        for (const earning of earnings) {
          const allocation = allocations.find((candidate) => candidate.earningId === earning.id);
          if (!allocation) throw new Error("Claim recovery allocation unavailable");
          await sql`insert into claim_items (organization_id,claim_id,earning_id,earning_amount_minor,amount_minor) values (${actor.organizationId},${id},${earning.id},${allocation.earningAmountMinor},${allocation.payoutAmountMinor})`;
          assertEarningTransition(earning.status, "reserved");
          await sql`update earnings set status='reserved',updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${earning.id} and status='eligible'`;
        }
        await sql`update otp_challenges set status='used',updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${challenge.id} and status='verified'`;
        await this.record(sql, actor, id, "created");
        await this.queueNotification(sql, actor, row, partner.email, "created");
        return this.repository.response(
          row,
          await this.repository.items(sql, actor.organizationId, id),
        );
      }),
    );
  }
  async list(actor: Actor) {
    return this.safe(() =>
      this.client.sql.begin(async (sql) => {
        if (actor.role === "owner") {
          const rows = await sql<ClaimRow[]>`select *,amount_minor::text from claims
            where organization_id=${actor.organizationId} order by created_at desc,id desc`;
          const items = await Promise.all(
            rows.map(async (row) => this.ownerResponse(sql, actor, row)),
          );
          return ownerClaimListSchema.parse({ items });
        }
        await this.partner(sql, actor);
        const rows = await sql<
          ClaimRow[]
        >`select *,amount_minor::text from claims where organization_id=${actor.organizationId} and partner_id=${actor.partnerId ?? null} and actor_id=${actor.actorId} order by created_at desc,id desc for update`;
        const grouped = await this.repository.itemsByClaim(
          sql,
          actor.organizationId,
          rows.map((row) => row.id),
        );
        const items = rows.map((row) => this.repository.response(row, grouped.get(row.id) ?? []));
        return claimListSchema.parse({ items });
      }),
    );
  }
  async get(actor: Actor, id: string) {
    return this.safe(() =>
      this.client.sql.begin(async (sql) => {
        if (actor.role === "owner") {
          return this.ownerResponse(sql, actor, await this.ownerClaim(sql, actor, id));
        }
        await this.partner(sql, actor);
        const row = await this.claim(sql, actor, id);
        return this.repository.response(
          row,
          await this.repository.items(sql, actor.organizationId, row.id),
        );
      }),
    );
  }
  async simulate(actor: Actor, id: string, outcome: "success" | "failure") {
    if (!simulateClaimInput.safeParse({ outcome }).success)
      throw new BadRequestException({ status: "invalid_request" });
    if (this.env.APP_MODE !== "sandbox") throw new ForbiddenException({ status: "sandbox_only" });
    return this.safe(() =>
      this.client.sql.begin(async (sql) => {
        await this.reservations.lock(sql, actor.organizationId);
        const row =
          actor.role === "owner"
            ? await this.ownerClaim(sql, actor, id)
            : await this.claim(sql, actor, id);
        if (actor.role !== "owner") await this.partner(sql, actor);
        const [partner] = await sql<{ id: string; email: string; status: string }[]>`select id,email,status
          from partners where organization_id=${actor.organizationId} and id=${row.partner_id} for update`;
        if (!partner || partner.status !== "active")
          throw new ForbiddenException({ status: "partner_unavailable" });
        const items = await this.repository.items(sql, actor.organizationId, id);
        const target = outcome === "success" ? "settled" : "failed";
        if (row.status === target)
          return actor.role === "owner"
            ? this.ownerResponse(sql, actor, row)
            : this.repository.response(row, items);
        if (row.status !== "created" || !items.length)
          throw new ConflictException({ status: "claim_unavailable" });
        const earnings = await this.repository.lockEarnings(
          sql,
          actor,
          items.map((i) => i.earning_id),
        );
        if (
          earnings.length !== items.length ||
          earnings.some((e, n) => {
            const item = items.at(n);
            return (
              item === undefined ||
              e.partner_id !== row.partner_id ||
              e.status !== "reserved" ||
              e.held ||
              e.currency !== row.currency ||
              e.amount_minor !== item.earning_amount_minor ||
              BigInt(item.amount_minor) < 0n ||
              BigInt(item.amount_minor) > BigInt(e.amount_minor)
            );
          }) ||
          items.reduce((sum, i) => sum + BigInt(i.amount_minor), 0n).toString() !== row.amount_minor
        )
          throw new ConflictException({ status: "claim_unavailable" });
        await this.transition(sql, actor, row, "processing");
        for (const earning of earnings) {
          const status = outcome === "success" ? "settled" : "eligible";
          assertEarningTransition(earning.status, status);
          if (outcome === "success") {
            await sql`insert into ledger_entries (organization_id,partner_id,earning_id,claim_id,entry_type,amount_minor,currency,reason) select ${actor.organizationId},${row.partner_id},${earning.id},${id},'accrual',${earning.amount_minor},${row.currency},'Sandbox claim accrual' where not exists(select 1 from ledger_entries where organization_id=${actor.organizationId} and earning_id=${earning.id} and entry_type='accrual')`;
            const payout = BigInt(
              items.find((item) => item.earning_id === earning.id)?.amount_minor ?? "-1",
            );
            if (payout < 0n || payout > BigInt(earning.amount_minor))
              throw new ConflictException({ status: "claim_unavailable" });
            if (payout > 0n)
              await sql`insert into ledger_entries (organization_id,partner_id,earning_id,claim_id,entry_type,amount_minor,currency,reason) values (${actor.organizationId},${row.partner_id},${earning.id},${id},'payout',${(-payout).toString()},${row.currency},'Sandbox claim payout')`;
          }
          await sql`update earnings set status=${status},updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${earning.id} and status='reserved'`;
        }
        await this.transition(sql, actor, row, target);
        await this.queueNotification(sql, actor, row, partner.email, target);
        const updated =
          actor.role === "owner"
            ? await this.ownerClaim(sql, actor, id)
            : await this.claim(sql, actor, id);
        return actor.role === "owner"
          ? this.ownerResponse(sql, actor, updated)
          : this.repository.response(updated, items);
      }),
    );
  }
  async retry(actor: Actor, id: string, key: string) {
    const parsedKey = mutationIdempotencyKey.safeParse(key);
    if (!parsedKey.success) throw new BadRequestException({ status: "invalid_request" });
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
    if (this.env.APP_MODE !== "sandbox") throw new ForbiddenException({ status: "sandbox_only" });
    const scope = `claim.retry:${id.toLowerCase()}:actor:${actor.actorId}`;
    return this.safe(() =>
      this.client.sql.begin(async (sql) => {
        await this.reservations.lock(sql, actor.organizationId);
        const row = await this.ownerClaim(sql, actor, id);
        const existing = await this.idempotency.acquire(
          sql,
          actor.organizationId,
          scope,
          parsedKey.data,
          { claimId: id.toLowerCase() },
        );
        if (existing) {
          if (!existing.response)
            throw new ConflictException({ status: "idempotency_in_progress" });
          return ownerClaimSchema.parse(existing.response);
        }
        if (row.status !== "failed")
          throw new ConflictException({ status: "claim_unavailable" });
        const [partner] = await sql<{ id: string; status: string }[]>`select id,status from partners
          where organization_id=${actor.organizationId} and id=${row.partner_id} for update`;
        if (!partner || partner.status !== "active")
          throw new ConflictException({ status: "partner_unavailable" });
        const items = await this.repository.items(sql, actor.organizationId, row.id);
        if (!items.length) throw new ConflictException({ status: "claim_unavailable" });
        const earnings = await this.repository.lockEarnings(
          sql,
          actor,
          items.map((item) => item.earning_id),
        );
        if (
          earnings.length !== items.length ||
          earnings.some((earning, index) => {
            const item = items.at(index);
            return (
              !item ||
              earning.partner_id !== row.partner_id ||
              earning.status !== "eligible" ||
              earning.held ||
              earning.currency !== row.currency ||
              earning.amount_minor !== item.earning_amount_minor ||
              BigInt(item.amount_minor) < 0n ||
              BigInt(item.amount_minor) > BigInt(earning.amount_minor)
            );
          }) ||
          items.reduce((sum, item) => sum + BigInt(item.amount_minor), 0n).toString() !==
            row.amount_minor
        )
          throw new ConflictException({ status: "claim_unavailable" });
        for (const earning of earnings) {
          assertEarningTransition(earning.status, "reserved");
          await sql`update earnings set status='reserved',updated_at=statement_timestamp()
            where organization_id=${actor.organizationId} and id=${earning.id} and status='eligible'`;
        }
        await sql`update claims set status='created',updated_at=statement_timestamp()
          where organization_id=${actor.organizationId} and id=${row.id} and status='failed'`;
        await this.audit.append(sql, actor, {
          eventKey: `claim.retried:${row.id}:${parsedKey.data}`,
          action: "claim.retried",
          aggregateType: "claim",
          aggregateId: row.id,
          reason: "Owner retried sandbox payout",
          metadata: { claimId: row.id },
        });
        const updated = await this.ownerClaim(sql, actor, row.id);
        const response = await this.ownerResponse(sql, actor, updated);
        const [record] = await sql<{ id: string }[]>`select id from idempotency_records
          where organization_id=${actor.organizationId} and scope=${scope}
          and idempotency_key=${parsedKey.data}`;
        if (!record) throw new Error("Claim retry idempotency record unavailable");
        await this.idempotency.completeResource(
          sql,
          actor.organizationId,
          record.id,
          row.id,
          response,
        );
        return response;
      }),
    );
  }
  private async queueNotification(
    sql: TransactionSql,
    actor: Actor,
    row: ClaimRow,
    email: string,
    status: "created" | "settled" | "failed",
  ) {
    const disabled = this.env.EMAIL_DELIVERY_MODE === "disabled";
    const description = status === "created" ? "received" : status;
    // Provider-neutral content is durable before any delivery worker runs.
    const content = `Claim ${row.id} ${description} for ${row.amount_minor} ${row.currency} minor units.`;
    await sql`insert into notification_outbox (organization_id,dedupe_key,channel,provider,status,recipient,content,claim_id) values (${actor.organizationId},${`claim:${row.id}:${status}`},'email',${this.env.EMAIL_DELIVERY_MODE},${disabled ? "failed" : "pending"},${disabled ? maskRecipient(email, "email") : email},${disabled ? null : content},${row.id}) on conflict (organization_id,dedupe_key) do nothing`;
  }
  private async transition(sql: TransactionSql, actor: Actor, row: ClaimRow, target: ClaimStatus) {
    if (!(
      (row.status === "created" && target === "processing") ||
      (row.status === "processing" && (target === "settled" || target === "failed"))
    ))
      throw new ConflictException({ status: "claim_unavailable" });
    await sql`update claims set status=${target},updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${row.id} and status=${row.status}`;
    row.status = target;
    await this.record(sql, actor, row.id, target);
  }
  private record(sql: TransactionSql, actor: Actor, id: string, status: string) {
    return this.audit.append(sql, actor, {
      eventKey: `claim.${status}:${id}`,
      action: `claim.${status}`,
      aggregateType: "claim",
      aggregateId: id,
      reason: status === "created" ? "Partner confirmed claim" : "Sandbox payout simulation",
      metadata: { claimId: id },
    });
  }
}
