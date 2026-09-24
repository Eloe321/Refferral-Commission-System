import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { NORTHSTAR_IDS, type DatabaseClient } from "@referral-sandbox/database";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import type { Actor } from "../auth/actor.js";
import { AuditService } from "../common/audit.service.js";
import { ClaimReservationsService } from "../common/claim-reservations.service.js";
import type { AppEnv } from "../config/env.js";
import { APP_ENV, DATABASE_CLIENT } from "../database/database.module.js";

type Sql = TransactionSql;
type EventStatus = "pending" | "processed" | "failed" | "ignored";
type ReceiptStatus = "processed" | "duplicate" | "failed" | "ignored";
type EventRow = {
  id: string;
  organization_id: string;
  provider_event_id: string;
  program_id: string;
  booking_ref: string;
  event_type: string;
  occurred_at: Date;
  request_hash: string;
  status: EventStatus;
  failure_code: string | null;
  attempts: number;
  created_at: Date;
  last_attempt_at: Date | null;
  processed_at: Date | null;
  confirmation_status?: "pending" | "processing" | "unknown" | "sent" | "failed" | "previewed" | null;
};

const bookingEvent = z.strictObject({
  id: z.string().trim().min(1).max(120),
  type: z.literal("service.completed"),
  programId: z.uuid(),
  bookingRef: z.string().trim().min(1).max(120),
  occurredAt: z.iso.datetime({ offset: true }),
});

function asIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

@Injectable()
export class BookingWebhookService {
  private readonly secret: string;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ClaimReservationsService) private readonly reservations: ClaimReservationsService,
  ) {
    // An ephemeral key supports the local owner demo. External providers need an explicit secret.
    this.secret = env.BOOKING_WEBHOOK_SECRET ?? randomBytes(32).toString("hex");
  }

  private requireSandbox(): void {
    if (this.env.APP_MODE !== "sandbox") throw new NotFoundException();
  }

  private requireOwner(actor: Actor): void {
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
  }

  private verify(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined): void {
    const timestampSeconds = Number(timestamp);
    if (
      !timestamp ||
      !/^[0-9]{10}$/.test(timestamp) ||
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > 300 ||
      !signature ||
      !/^sha256=[a-f0-9]{64}$/.test(signature)
    ) {
      throw new UnauthorizedException({ status: "unauthorized" });
    }
    const expected = createHmac("sha256", this.secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
      .digest();
    const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new UnauthorizedException({ status: "unauthorized" });
    }
  }

  async receiveSigned(
    body: unknown,
    timestamp: string | undefined,
    signature: string | undefined,
  ): Promise<{ status: ReceiptStatus }> {
    this.requireSandbox();
    if (!Buffer.isBuffer(body)) throw new BadRequestException({ status: "invalid_request" });
    this.verify(body, timestamp, signature);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      throw new BadRequestException({ status: "invalid_request" });
    }
    const parsed = bookingEvent.safeParse(parsedBody);
    if (!parsed.success) throw new BadRequestException({ status: "invalid_request" });
    const event = parsed.data;
    const requestHash = createHash("sha256").update(body).digest("hex");
    const status = await this.client.sql.begin(async (sql) => {
      const programs = await sql`select id from programs where organization_id=${NORTHSTAR_IDS.organization}
        and id=${event.programId} for key share`;
      if (!programs[0]) throw new NotFoundException({ status: "not_found" });
      await sql`insert into booking_webhook_events
        (organization_id,provider_event_id,program_id,booking_ref,event_type,occurred_at,request_hash,status)
        values (${NORTHSTAR_IDS.organization},${event.id},${event.programId},${event.bookingRef},${event.type},${event.occurredAt},${requestHash},'pending')
        on conflict (organization_id,provider_event_id) do nothing`;
      const [row] = await sql<EventRow[]>`select * from booking_webhook_events
        where organization_id=${NORTHSTAR_IDS.organization} and provider_event_id=${event.id} for update`;
      if (!row) throw new Error("Booking webhook event insert returned no row");
      if (row.request_hash !== requestHash) {
        throw new ConflictException({ status: "event_identity_conflict" });
      }
      if (row.status === "processed" || row.status === "ignored") return "duplicate";
      return this.applyEvent(sql as never, row);
    });
    return { status };
  }

  private async applyEvent(sql: Sql, event: EventRow): Promise<ReceiptStatus> {
    await this.reservations.lock(sql, event.organization_id);
    const [conversion] = await sql<{ id: string; status: string; partner_email: string }[]>`select c.id,c.status,p.email as partner_email from conversions c
      join partners p on p.id=c.partner_id and p.organization_id=c.organization_id
      where c.organization_id=${event.organization_id} and c.program_id=${event.program_id}
      and c.external_ref=${event.booking_ref} for update of c`;
    if (!conversion) {
      await sql`update booking_webhook_events set status='failed',failure_code='booking_not_found',
        attempts=attempts+1,last_attempt_at=statement_timestamp(),processed_at=null
        where organization_id=${event.organization_id} and id=${event.id}`;
      return "failed";
    }
    if (conversion.status !== "scheduled") {
      await sql`update booking_webhook_events set status='ignored',failure_code=null,
        attempts=attempts+1,last_attempt_at=statement_timestamp(),processed_at=statement_timestamp()
        where organization_id=${event.organization_id} and id=${event.id}`;
      return "ignored";
    }
    await sql`update conversions set status='completed',updated_at=statement_timestamp()
      where organization_id=${event.organization_id} and id=${conversion.id}`;
    await sql`update earnings set status='eligible',updated_at=statement_timestamp()
      where organization_id=${event.organization_id} and status='pending'
      and conversion_item_id in (select id from conversion_items
        where organization_id=${event.organization_id} and conversion_id=${conversion.id})`;
    await this.audit.appendSystem(sql, event.organization_id, {
      eventKey: `booking-webhook.completed:${event.id}`,
      action: "conversion.completed",
      aggregateType: "conversion",
      aggregateId: conversion.id,
      reason: "Signed service completion event accepted",
      metadata: { providerEventId: event.provider_event_id, bookingRef: event.booking_ref },
    });
    if (this.env.EMAIL_DELIVERY_MODE === "mailpit") {
      await sql`insert into notification_outbox
        (organization_id,dedupe_key,channel,provider,status,recipient,content)
        values (${event.organization_id},${`booking-completed:${event.id}`},'email','mailpit','pending',
          ${conversion.partner_email},${`Northstar sandbox: fictional booking ${event.booking_ref} is complete. Your referral commission is now eligible.`})
        on conflict (organization_id,dedupe_key) do nothing`;
      await this.audit.appendSystem(sql, event.organization_id, {
        eventKey: `booking-confirmation.queued:${event.id}`,
        action: "partner.confirmation.queued",
        aggregateType: "conversion",
        aggregateId: conversion.id,
        reason: "Fictional booking completion queued for local email delivery",
        metadata: { providerEventId: event.provider_event_id },
      });
    }
    await sql`update booking_webhook_events set status='processed',failure_code=null,
      attempts=attempts+1,last_attempt_at=statement_timestamp(),processed_at=statement_timestamp()
      where organization_id=${event.organization_id} and id=${event.id}`;
    return "processed";
  }

  async list(actor: Actor) {
    this.requireOwner(actor);
    const rows = await this.client.sql<EventRow[]>`select e.*,n.status as confirmation_status from booking_webhook_events e
      left join notification_outbox n on n.organization_id=e.organization_id
        and n.dedupe_key='booking-completed:' || e.id::text
      where e.organization_id=${actor.organizationId} order by e.created_at desc,e.id desc limit 100`;
    return {
      items: rows.map((row) => ({
        id: row.id,
        providerEventId: row.provider_event_id,
        programId: row.program_id,
        bookingRef: row.booking_ref,
        eventType: row.event_type,
        occurredAt: asIso(row.occurred_at),
        status: row.status,
        failureCode: row.failure_code,
        attempts: row.attempts,
        createdAt: asIso(row.created_at),
        lastAttemptAt: asIso(row.last_attempt_at),
        processedAt: asIso(row.processed_at),
        confirmationStatus: row.confirmation_status ?? null,
      })),
    };
  }

  async retry(actor: Actor, providerEventId: string): Promise<{ status: ReceiptStatus }> {
    this.requireSandbox();
    this.requireOwner(actor);
    const status = await this.client.sql.begin(async (sql) => {
      const [row] = await sql<EventRow[]>`select * from booking_webhook_events
        where organization_id=${actor.organizationId} and provider_event_id=${providerEventId} for update`;
      if (!row) throw new NotFoundException({ status: "not_found" });
      if (row.status !== "failed") throw new ConflictException({ status: "event_not_retryable" });
      return this.applyEvent(sql as never, row);
    });
    return { status };
  }

  async deliverDemoCompletion(actor: Actor, conversionId: string): Promise<{ status: ReceiptStatus }> {
    this.requireSandbox();
    this.requireOwner(actor);
    const [conversion] = await this.client.sql<
      { program_id: string; external_ref: string }[]
    >`select program_id,external_ref from conversions
      where organization_id=${actor.organizationId} and id=${conversionId}`;
    if (!conversion) throw new NotFoundException({ status: "not_found" });
    const payload = bookingEvent.parse({
      id: randomUUID(),
      type: "service.completed",
      programId: conversion.program_id,
      bookingRef: conversion.external_ref,
      occurredAt: new Date().toISOString(),
    });
    const rawBody = Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", this.secret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
      .digest("hex");
    return this.receiveSigned(rawBody, timestamp, `sha256=${signature}`);
  }
}
