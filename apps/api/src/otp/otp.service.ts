import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
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
  createOtpChallengeInput,
  otpChallengeResponseSchema,
  otpChallengeStateSchema,
  verifyOtpInput,
  type CreateOtpChallengeInput,
} from "@referral-sandbox/contracts";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { TransactionSql } from "postgres";
import type { Actor } from "../auth/actor.js";
import type { AppEnv } from "../config/env.js";
import { APP_ENV, DATABASE_CLIENT } from "../database/database.module.js";
import { AuditService } from "../common/audit.service.js";
import { ClaimReservationsService } from "../common/claim-reservations.service.js";
import { ClaimRecoveryService } from "../common/claim-recovery.service.js";
import { createClaimDraftHash, MAX_CLAIM_AMOUNT } from "../domain/claim-draft.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { maskRecipient } from "../notifications/sms-delivery.port.js";

export const OTP_CLOCK = Symbol("OTP_CLOCK");
export const OTP_CODE_GENERATOR = Symbol("OTP_CODE_GENERATOR");
export const generateOtpCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");
export type OtpChallengeRow = {
  id: string;
  organization_id: string;
  actor_id: string;
  partner_id: string;
  claim_draft_hash: string;
  code_digest: string;
  channel: "sms" | "email";
  status: "pending" | "verified" | "used" | "expired" | "blocked";
  attempts: number;
  expires_at: Date;
  resend_after: Date;
};
type PartnerRow = { id: string; phone_e164: string; email: string; status: string };

@Injectable()
export class OtpPolicy {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(OTP_CLOCK) readonly now: () => Date,
    @Inject(OTP_CODE_GENERATOR) private readonly generate: () => string,
  ) {}
  /** Five-minute lifetime; every issuance starts a 60-second resend cooldown. */
  issue(id: string, previousDigest?: string) {
    const now = this.now();
    // A resend must invalidate the old code even if the random draw repeats it.
    for (let i = 0; i < 10; i++) {
      const code = this.generate();
      if (!/^\d{6}$/.test(code)) throw new Error("OTP generation unavailable");
      const codeDigest = this.digest(id, code);
      if (codeDigest !== previousDigest)
        return {
          code,
          codeDigest,
          now,
          expiresAt: new Date(now.getTime() + 300_000),
          resendAfter: new Date(now.getTime() + 60_000),
        };
    }
    throw new Error("OTP generation unavailable");
  }
  private digest(id: string, code: string) {
    return createHmac("sha256", this.env.OTP_HMAC_SECRET).update(`${id}:${code}`).digest("hex");
  }
  matches(id: string, code: string, digest: string): boolean {
    const expected = Buffer.from(this.digest(id, code), "hex");
    // Always compare equal-length buffers; malformed stored data cannot bypass comparison.
    const valid = /^[a-f0-9]{64}$/.test(digest);
    const stored = valid ? Buffer.from(digest, "hex") : Buffer.alloc(32);
    return timingSafeEqual(expected, stored) && valid;
  }
  assertBinding(row: OtpChallengeRow, actor: Actor, expectedClaimDraftHash?: string): void {
    if (
      row.organization_id !== actor.organizationId ||
      row.actor_id !== actor.actorId ||
      row.partner_id !== actor.partnerId
    )
      throw new NotFoundException({ status: "not_found" });
    if (expectedClaimDraftHash !== undefined && row.claim_draft_hash !== expectedClaimDraftHash)
      throw new ConflictException({ status: "claim_draft_changed" });
  }
  assertPending(row: OtpChallengeRow): void {
    if (row.status === "expired" || new Date(row.expires_at).getTime() <= this.now().getTime())
      throw new GoneException({ status: "challenge_expired" });
    if (row.status !== "pending")
      throw new ConflictException({
        status: "challenge_unavailable",
        attemptsRemaining: Math.max(0, 5 - row.attempts),
      });
  }
  assertResendAllowed(row: OtpChallengeRow): void {
    this.assertPending(row);
    if (new Date(row.resend_after).getTime() > this.now().getTime())
      throw new HttpException(
        { status: "resend_cooldown", resendAfter: new Date(row.resend_after).toISOString() },
        429,
      );
  }
  verificationResult(
    attempts: number,
    correct: boolean,
  ): Pick<OtpChallengeRow, "attempts" | "status"> {
    return correct
      ? { attempts, status: "verified" }
      : { attempts: attempts + 1, status: attempts >= 4 ? "blocked" : "pending" };
  }
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(OtpPolicy) private readonly policy: OtpPolicy,
    @Inject(ClaimReservationsService) private readonly reservations: ClaimReservationsService,
    @Inject(ClaimRecoveryService) private readonly recovery: ClaimRecoveryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}
  private async safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException({ status: "internal_error" });
    }
  }
  private async partner(sql: TransactionSql, actor: Actor): Promise<PartnerRow> {
    if (actor.role !== "partner" || !actor.partnerId)
      throw new ForbiddenException({ status: "forbidden" });
    await this.reservations.lock(sql, actor.organizationId);
    const [row] = await sql<
      PartnerRow[]
    >`select p.id,p.phone_e164,p.email,p.status from partners p join users u on u.organization_id=p.organization_id and u.id=p.user_id where p.organization_id=${actor.organizationId} and p.id=${actor.partnerId} and p.user_id=${actor.actorId} and u.role='partner' for update of p,u`;
    if (!row || row.status !== "active")
      throw new ForbiddenException({ status: "partner_unavailable" });
    return row;
  }
  private recipient(partner: PartnerRow, channel: "sms" | "email"): string {
    const recipient = channel === "sms" ? partner.phone_e164 : partner.email;
    if (
      channel === "sms"
        ? !/^\+[1-9]\d{7,14}$/.test(recipient)
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)
    )
      throw new ConflictException({ status: "recipient_unavailable" });
    return recipient;
  }
  private async assertIssuanceAllowed(
    sql: TransactionSql,
    actor: Actor,
    partnerId: string,
  ): Promise<Date | null> {
    // One index seek per enum status, each limited to one deadline. This includes
    // blocked/verified/used history without scanning all prior partner challenges.
    const [latest] = await sql<
      { resend_after: Date | null }[]
    >`select max(recent.resend_after) resend_after
      from unnest(enum_range(null::otp_status)) states(status)
      cross join lateral (select resend_after from otp_challenges
        where organization_id=${actor.organizationId} and partner_id=${partnerId} and status=states.status
        order by resend_after desc limit 1) recent`;
    if (
      latest?.resend_after &&
      new Date(latest.resend_after).getTime() > this.policy.now().getTime()
    )
      throw new HttpException(
        { status: "issuance_cooldown", resendAfter: new Date(latest.resend_after).toISOString() },
        429,
      );
    return latest?.resend_after ? new Date(latest.resend_after) : null;
  }
  private async supersedePending(
    sql: TransactionSql,
    actor: Actor,
    partnerId: string,
    keepId: string,
  ): Promise<void> {
    // The caller owns the tenant advisory lock and active partner row lock.
    await sql`update otp_challenges set status='expired',updated_at=${this.policy.now().toISOString()}
      where organization_id=${actor.organizationId} and partner_id=${partnerId} and status='pending' and id<>${keepId}`;
    const stale = await sql<
      { id: string; channel: "sms" | "email"; recipient: string }[]
    >`select o.id,o.channel,o.recipient from notification_outbox o
      join otp_challenges c on c.organization_id=o.organization_id and c.id=o.otp_challenge_id
      where o.organization_id=${actor.organizationId}
        and o.status in ('pending','processing','unknown')
        and c.partner_id=${partnerId} and c.id<>${keepId}
      order by o.id for update of o`;
    await this.terminalizeOutbox(sql, actor.organizationId, stale);
  }

  private async terminalizeOutbox(
    sql: TransactionSql,
    organizationId: string,
    rows: readonly { id: string; channel: "sms" | "email"; recipient: string }[],
  ): Promise<void> {
    for (const row of rows)
      await sql`update notification_outbox set status='failed',
        recipient=${maskRecipient(row.recipient, row.channel)},content=null,lease_expires_at=null,
        updated_at=${this.policy.now().toISOString()}
        where organization_id=${organizationId} and id=${row.id}
          and status in ('pending','processing','unknown')`;
  }
  private state(row: OtpChallengeRow, recipient: string) {
    return otpChallengeStateSchema.parse({
      id: row.id,
      status: row.status,
      channel: row.channel,
      maskedRecipient: maskRecipient(recipient, row.channel),
      attempts: row.attempts,
      attemptsRemaining: Math.max(0, 5 - row.attempts),
      expiresAt: new Date(row.expires_at).toISOString(),
      resendAfter: new Date(row.resend_after).toISOString(),
    });
  }
  private async challenge(sql: TransactionSql, actor: Actor, id: string, expectedHash?: string) {
    const [row] = await sql<
      OtpChallengeRow[]
    >`select * from otp_challenges where organization_id=${actor.organizationId} and id=${id} for update`;
    if (!row) throw new NotFoundException({ status: "not_found" });
    this.policy.assertBinding(row, actor, expectedHash);
    this.policy.assertPending(row);
    return row;
  }
  async create(actor: Actor, input: CreateOtpChallengeInput) {
    if (!createOtpChallengeInput.safeParse(input).success)
      throw new BadRequestException({ status: "invalid_request" });
    return this.safe(() =>
      this.client.sql.begin(async (transaction) => {
        const sql = transaction;
        const partner = await this.partner(sql, actor);
        await this.assertIssuanceAllowed(sql, actor, partner.id);
        this.notifications.assertAvailable(input.channel);
        const recipient = this.recipient(partner, input.channel);
        const earnings = await sql<
          {
            id: string;
            partner_id: string;
            amount_minor: string;
            currency: string;
            status: string;
            held: boolean;
          }[]
        >`select e.id,e.partner_id,e.amount_minor::text,e.currency,e.status,exists(select 1 from earning_holds h where h.organization_id=e.organization_id and h.earning_id=e.id and h.released_at is null) held from earnings e where e.organization_id=${actor.organizationId} and e.id in ${sql([...input.earningIds].sort())} order by e.id for update of e`;
        if (
          earnings.length !== input.earningIds.length ||
          earnings.some((e) => e.partner_id !== partner.id)
        )
          throw new NotFoundException({ status: "not_found" });
        const currency = earnings[0]?.currency ?? "";
        if (earnings.some((e) => e.status !== "eligible" || e.held || e.currency !== currency))
          throw new ConflictException({ status: "selection_unavailable" });
        const allocations = await this.recovery.allocate(sql, {
          organizationId: actor.organizationId,
          partnerId: partner.id,
          currency,
          earnings,
        });
        const total = allocations.reduce(
          (sum, allocation) => sum + BigInt(allocation.payoutAmountMinor),
          0n,
        );
        if (total < 0n || total > MAX_CLAIM_AMOUNT)
          throw new ConflictException({ status: "invalid_claim_total" });
        const hash = createClaimDraftHash({
          organizationId: actor.organizationId,
          actorId: actor.actorId,
          partnerId: partner.id,
          earningIds: earnings.map((earning) => earning.id),
          amountMinor: total.toString(),
          currency,
        });
        const id = randomUUID();
        const issued = this.policy.issue(id);
        const [row] = await sql<
          OtpChallengeRow[]
        >`insert into otp_challenges (id,organization_id,actor_id,partner_id,claim_draft_hash,code_digest,channel,status,attempts,expires_at,resend_after,created_at,updated_at) values (${id},${actor.organizationId},${actor.actorId},${partner.id},${hash},${issued.codeDigest},${input.channel},'pending',0,${issued.expiresAt.toISOString()},${issued.resendAfter.toISOString()},${issued.now.toISOString()},${issued.now.toISOString()}) returning *`;
        if (!row) throw new Error("Challenge unavailable");
        await this.supersedePending(sql, actor, partner.id, row.id);
        const delivery = await this.notifications.queue(sql, {
          organizationId: actor.organizationId,
          challengeId: row.id,
          generation: randomUUID(),
          channel: input.channel,
          recipient,
          code: issued.code,
          expiresAt: issued.expiresAt,
        });
        await this.record(sql, actor, row, "created");
        return otpChallengeResponseSchema.parse({ ...this.state(row, recipient), delivery });
      }),
    );
  }
  /** Task 10 passes its recomputed authoritative draft hash here to bind verification. */
  async verify(actor: Actor, id: string, code: string, expectedClaimDraftHash?: string) {
    if (!verifyOtpInput.safeParse({ code }).success)
      throw new BadRequestException({ status: "invalid_request" });
    const result = await this.safe(() =>
      this.client.sql.begin(async (transaction) => {
        const sql = transaction;
        const partner = await this.partner(sql, actor);
        const row = await this.challenge(sql, actor, id, expectedClaimDraftHash);
        const correct = this.policy.matches(row.id, code, row.code_digest);
        Object.assign(row, this.policy.verificationResult(row.attempts, correct));
        await sql`update otp_challenges set status=${row.status},attempts=${row.attempts},updated_at=${this.policy.now().toISOString()} where organization_id=${actor.organizationId} and id=${row.id}`;
        if (correct || row.status === "blocked")
          await this.record(sql, actor, row, correct ? "verified" : "blocked");
        return { correct, state: this.state(row, this.recipient(partner, row.channel)) };
      }),
    );
    // Throw only after commit: failed attempts must survive their HTTP error response.
    if (!result.correct)
      throw new BadRequestException({
        status: result.state.status === "blocked" ? "challenge_blocked" : "invalid_code",
        attemptsRemaining: result.state.attemptsRemaining,
      });
    return result.state;
  }
  async resend(actor: Actor, id: string) {
    return this.safe(() =>
      this.client.sql.begin(async (transaction) => {
        const sql = transaction;
        const partner = await this.partner(sql, actor);
        const latestDeadline = await this.assertIssuanceAllowed(sql, actor, partner.id);
        const row = await this.challenge(sql, actor, id);
        if (latestDeadline && new Date(row.resend_after).getTime() < latestDeadline.getTime())
          throw new ConflictException({ status: "challenge_superseded" });
        this.notifications.assertAvailable(row.channel);
        this.policy.assertResendAllowed(row);
        const issued = this.policy.issue(row.id, row.code_digest);
        const recipient = this.recipient(partner, row.channel);
        await sql`update otp_challenges set code_digest=${issued.codeDigest},attempts=0,expires_at=${issued.expiresAt.toISOString()},resend_after=${issued.resendAfter.toISOString()},updated_at=${issued.now.toISOString()} where organization_id=${actor.organizationId} and id=${row.id}`;
        // Retire queued or in-flight older generations. A provider might still
        // physically deliver after dispatch, but no worker result may resurrect it.
        const stale = await sql<
          { id: string; channel: "sms" | "email"; recipient: string }[]
        >`select id,channel,recipient from notification_outbox
          where organization_id=${actor.organizationId} and otp_challenge_id=${row.id}
            and status in ('pending','processing','unknown') order by id for update`;
        await this.terminalizeOutbox(sql, actor.organizationId, stale);
        await this.supersedePending(sql, actor, partner.id, row.id);
        const delivery = await this.notifications.queue(sql, {
          organizationId: actor.organizationId,
          challengeId: row.id,
          generation: randomUUID(),
          channel: row.channel,
          recipient,
          code: issued.code,
          expiresAt: issued.expiresAt,
        });
        await this.record(sql, actor, row, "resent");
        return otpChallengeResponseSchema.parse({
          ...this.state(
            { ...row, attempts: 0, expires_at: issued.expiresAt, resend_after: issued.resendAfter },
            recipient,
          ),
          delivery,
        });
      }),
    );
  }
  private record(sql: TransactionSql, actor: Actor, row: OtpChallengeRow, action: string) {
    return this.audit.append(sql, actor, {
      eventKey: `otp.${action}:${randomUUID()}`,
      action: `otp.${action}`,
      aggregateType: "otp_challenge",
      aggregateId: row.id,
      metadata: { channel: row.channel, challengeId: row.id },
    });
  }
}
