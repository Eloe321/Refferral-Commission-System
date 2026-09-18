/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { Actor } from "../auth/actor.js";
import { ClaimReservationsService } from "../common/claim-reservations.service.js";
import { AuditService } from "../common/audit.service.js";
import { DATABASE_CLIENT } from "../database/database.module.js";

@Injectable()
export class PartnersService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ClaimReservationsService) private readonly reservations: ClaimReservationsService,
  ) {}
  private owner(actor: Actor) {
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
  }
  async list(actor: Actor) {
    const rows = await this.client.sql<
      {
        id: string;
        organizationId: string;
        userId: string;
        displayName: string;
        email: string;
        phoneE164: string;
        status: string;
        createdAt: Date | string;
        updatedAt: Date | string;
      }[]
    >`select id, organization_id "organizationId", user_id "userId", display_name "displayName", email, phone_e164 "phoneE164", status, created_at "createdAt", updated_at "updatedAt" from partners where organization_id=${actor.organizationId}${actor.role === "partner" ? this.client.sql` and id=${actor.partnerId}` : this.client.sql``} order by display_name,id`;
    return rows.map((partner) => ({
      ...partner,
      createdAt: new Date(partner.createdAt).toISOString(),
      updatedAt: new Date(partner.updatedAt).toISOString(),
    }));
  }
  async one(actor: Actor, id: string) {
    const rows = await this.client.sql<
      {
        id: string;
        organization_id: string;
        user_id: string;
        display_name: string;
        email: string;
        phone_e164: string;
        status: string;
        created_at: Date;
        updated_at: Date;
      }[]
    >`select * from partners where organization_id=${actor.organizationId} and id=${id}${actor.role === "partner" ? this.client.sql` and id=${actor.partnerId}` : this.client.sql``}`;
    const p = rows[0];
    if (!p) throw new NotFoundException({ status: "not_found" });
    const bs = await this.client.sql<
      { currency: string; ledger_minor: string; eligible_minor: string; held_minor: string }[]
    >`with c as (select currency from ledger_entries where organization_id=${actor.organizationId} and partner_id=${id} union select currency from earnings where organization_id=${actor.organizationId} and partner_id=${id}) select currency,coalesce((select sum(amount_minor) from ledger_entries where organization_id=${actor.organizationId} and partner_id=${id} and currency=c.currency),0)::text ledger_minor,coalesce((select sum(amount_minor) from earnings where organization_id=${actor.organizationId} and partner_id=${id} and currency=c.currency and status='eligible'),0)::text eligible_minor,coalesce((select sum(amount_minor) from earnings where organization_id=${actor.organizationId} and partner_id=${id} and currency=c.currency and status='held'),0)::text held_minor from c order by currency`;
    return {
      id: p.id,
      organizationId: p.organization_id,
      userId: p.user_id,
      displayName: p.display_name,
      email: p.email,
      phoneE164: p.phone_e164,
      status: p.status,
      createdAt: new Date(p.created_at).toISOString(),
      updatedAt: new Date(p.updated_at).toISOString(),
      balances: bs.map((b) => ({
        currency: b.currency,
        ledgerMinor: b.ledger_minor,
        eligibleMinor: b.eligible_minor,
        heldMinor: b.held_minor,
      })),
    };
  }
  async state(actor: Actor, id: string, status: "active" | "suspended", reason: string) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      await this.reservations.lock(sql as never, actor.organizationId);
      const p = await sql<
        { status: string }[]
      >`select status from partners where organization_id=${actor.organizationId} and id=${id} for update`;
      if (!p[0]) throw new NotFoundException({ status: "not_found" });
      if (p[0].status === status) throw new ConflictException({ status: "partner_state_conflict" });
      await sql`update partners set status=${status},updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${id}`;
      if (status === "suspended") {
        const es = await sql<
          { id: string; status: string }[]
        >`select id,status from earnings where organization_id=${actor.organizationId} and partner_id=${id} and status in ('pending','eligible','reserved') order by id for update`;
        await this.reservations.failAffected(
          sql as never,
          actor.organizationId,
          es.map((e) => e.id),
        );
        for (const e of es)
          await sql`insert into earning_holds (organization_id,earning_id,previous_status,reason,placed_by,placed_at) values (${actor.organizationId},${e.id},${e.status},${reason},${actor.actorId},statement_timestamp()) on conflict do nothing`;
        await sql`update earnings set status='held',updated_at=statement_timestamp() where organization_id=${actor.organizationId} and partner_id=${id} and status in ('pending','eligible','reserved')`;
      }
      await this.audit.append(sql as never, actor, {
        eventKey: `partner.${status}:${id}:${crypto.randomUUID()}`,
        action: `partner.${status}`,
        aggregateType: "partner",
        aggregateId: id,
        reason,
      });
      const detail = await sql<
        {
          id: string;
          organization_id: string;
          user_id: string;
          display_name: string;
          email: string;
          phone_e164: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }[]
      >`select * from partners where organization_id=${actor.organizationId} and id=${id}`;
      const d = detail[0]!;
      const bs = await sql<
        { currency: string; ledger_minor: string; eligible_minor: string; held_minor: string }[]
      >`with c as (select currency from ledger_entries where organization_id=${actor.organizationId} and partner_id=${id} union select currency from earnings where organization_id=${actor.organizationId} and partner_id=${id}) select currency,coalesce((select sum(amount_minor) from ledger_entries where organization_id=${actor.organizationId} and partner_id=${id} and currency=c.currency),0)::text ledger_minor,coalesce((select sum(amount_minor) from earnings where organization_id=${actor.organizationId} and partner_id=${id} and currency=c.currency and status='eligible'),0)::text eligible_minor,coalesce((select sum(amount_minor) from earnings where organization_id=${actor.organizationId} and partner_id=${id} and currency=c.currency and status='held'),0)::text held_minor from c order by currency`;
      return {
        id: d.id,
        organizationId: d.organization_id,
        userId: d.user_id,
        displayName: d.display_name,
        email: d.email,
        phoneE164: d.phone_e164,
        status: d.status,
        createdAt: new Date(d.created_at).toISOString(),
        updatedAt: new Date(d.updated_at).toISOString(),
        balances: bs.map((b) => ({
          currency: b.currency,
          ledgerMinor: b.ledger_minor,
          eligibleMinor: b.eligible_minor,
          heldMinor: b.held_minor,
        })),
      };
    });
  }
}
