import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  claimSchema,
  ownerClaimSchema,
  type ClaimStatus,
  type EarningStatus,
  type OtpStatus,
} from "@referral-sandbox/contracts";
import type { TransactionSql } from "postgres";
import type { Actor } from "../auth/actor.js";

export type ClaimRow = {
  id: string;
  organization_id: string;
  partner_id: string;
  actor_id: string;
  amount_minor: string;
  currency: string;
  status: ClaimStatus;
  idempotency_key: string;
  selection_hash: string;
  otp_challenge_id: string | null;
  created_at: Date;
  updated_at: Date;
};
export type ClaimOtpAuditRow = {
  id: string;
  channel: "sms" | "email";
  status: OtpStatus;
  attempts: number;
  created_at: Date;
  updated_at: Date;
};
export type ClaimItemRow = {
  id: string;
  organization_id: string;
  claim_id: string;
  earning_id: string;
  earning_amount_minor: string;
  amount_minor: string;
};
export type ClaimEarningRow = {
  id: string;
  partner_id: string;
  amount_minor: string;
  currency: string;
  status: EarningStatus;
  held: boolean;
};

@Injectable()
export class ClaimRepository {
  async itemsByClaim(sql: TransactionSql, organizationId: string, claimIds: readonly string[]) {
    const grouped = new Map<string, ClaimItemRow[]>();
    if (!claimIds.length) return grouped;
    const rows = await sql<
      ClaimItemRow[]
    >`select id,organization_id,claim_id,earning_id,earning_amount_minor::text,amount_minor::text from claim_items where organization_id=${organizationId} and claim_id in ${sql([...claimIds].sort())} order by claim_id,earning_id,id for update`;
    for (const row of rows) {
      const items = grouped.get(row.claim_id) ?? [];
      items.push(row);
      grouped.set(row.claim_id, items);
    }
    return grouped;
  }
  async items(sql: TransactionSql, organizationId: string, claimId: string) {
    return sql<
      ClaimItemRow[]
    >`select id,organization_id,claim_id,earning_id,earning_amount_minor::text,amount_minor::text from claim_items where organization_id=${organizationId} and claim_id=${claimId} order by earning_id,id for update`;
  }
  async lockEarnings(sql: TransactionSql, actor: Actor, earningIds: readonly string[]) {
    return sql<ClaimEarningRow[]>`select e.id,e.partner_id,e.amount_minor::text,e.currency,e.status,
      exists(select 1 from earning_holds h where h.organization_id=e.organization_id and h.earning_id=e.id and h.released_at is null) held
      from earnings e where e.organization_id=${actor.organizationId} and e.id in ${sql([...earningIds].sort())} order by e.id for update of e`;
  }
  async lockEligibleEarnings(sql: TransactionSql, actor: Actor, earningIds: readonly string[]) {
    const rows = await this.lockEarnings(sql, actor, earningIds);
    if (rows.length !== earningIds.length || rows.some((e) => e.partner_id !== actor.partnerId))
      throw new NotFoundException({ status: "not_found" });
    if (rows.some((e) => e.status !== "eligible" || e.held || e.currency !== rows[0]?.currency))
      throw new ConflictException({ status: "selection_unavailable" });
    return rows;
  }
  async otpAudit(
    sql: TransactionSql,
    organizationId: string,
    challengeId: string | null,
  ): Promise<ClaimOtpAuditRow | null> {
    if (!challengeId) return null;
    const [row] = await sql<ClaimOtpAuditRow[]>`select id,channel,status,attempts,created_at,updated_at
      from otp_challenges where organization_id=${organizationId} and id=${challengeId}`;
    return row ?? null;
  }
  response(row: ClaimRow, items: ClaimItemRow[]) {
    return claimSchema.parse({
      id: row.id,
      organizationId: row.organization_id,
      partnerId: row.partner_id,
      actorId: row.actor_id,
      amount: { amountMinor: row.amount_minor, currency: row.currency },
      status: row.status,
      idempotencyKey: row.idempotency_key,
      selectionHash: row.selection_hash,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      items: items.map((i) => ({
        id: i.id,
        organizationId: i.organization_id,
        claimId: i.claim_id,
        earningId: i.earning_id,
        amount: { amountMinor: i.amount_minor, currency: row.currency },
      })),
    });
  }
  ownerResponse(row: ClaimRow, items: ClaimItemRow[], otp: ClaimOtpAuditRow | null) {
    return ownerClaimSchema.parse({
      ...this.response(row, items),
      otpAudit: otp
        ? {
            challengeId: otp.id,
            channel: otp.channel,
            status: otp.status,
            attempts: otp.attempts,
            createdAt: new Date(otp.created_at).toISOString(),
            updatedAt: new Date(otp.updated_at).toISOString(),
          }
        : null,
    });
  }
}
