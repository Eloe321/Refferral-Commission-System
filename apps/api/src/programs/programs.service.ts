import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  commissionRuleSchema,
  commissionRuleInput,
  referralCodeSchema,
  previewCommissionSchema,
  programSchema,
  type CommissionRuleInput,
  type CreateProgramInput,
  type CreateReferralCodeInput,
  type PreviewCommissionInput,
} from "@referral-sandbox/contracts";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { TransactionSql } from "postgres";
import type { Actor } from "../auth/actor.js";
import { AuditService } from "../common/audit.service.js";
import { DATABASE_CLIENT } from "../database/database.module.js";
import { calculateCommission } from "../domain/money.js";
import { selectApplicableRule, type CandidateCommissionRule } from "../domain/rules.js";

type Sql = TransactionSql;
type ProgramRow = {
  id: string;
  organization_id: string;
  name: string;
  status: "active" | "paused";
  created_at: Date;
  updated_at: Date;
};
type RuleRow = {
  id: string;
  organization_id: string;
  program_id: string;
  partner_id: string | null;
  category: string | null;
  rule_type: "flat" | "percentage";
  flat_amount_minor: bigint | null;
  basis_points: number | null;
  effective_from: Date;
  effective_to: Date | null;
  currency: string;
};
type ReferralCodeRow = {
  id: string;
  program_id: string;
  partner_id: string;
  code: string;
  active: boolean;
};

@Injectable()
export class ProgramsService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private owner(actor: Actor) {
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
  }

  private async loadRules(sql: Sql, organizationId: string, programId: string) {
    const rows = await sql<RuleRow[]>`select r.*,o.currency from commission_rules r
      join organizations o on o.id=r.organization_id
      where r.organization_id=${organizationId} and r.program_id=${programId} order by r.effective_from,r.id`;
    return rows.map((row) =>
      commissionRuleSchema.parse({
        id: row.id,
        organizationId: row.organization_id,
        programId: row.program_id,
        partnerId: row.partner_id,
        category: row.category,
        type: row.rule_type,
        flatAmount:
          row.flat_amount_minor === null
            ? null
            : { amountMinor: row.flat_amount_minor.toString(), currency: row.currency },
        basisPoints: row.basis_points,
        effectiveFrom: new Date(row.effective_from).toISOString(),
        effectiveTo: row.effective_to === null ? null : new Date(row.effective_to).toISOString(),
      }),
    );
  }

  private async serialize(sql: Sql, row: ProgramRow) {
    return programSchema.parse({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      rules: await this.loadRules(sql, row.organization_id, row.id),
    });
  }

  async list(actor: Actor) {
    return this.client.sql.begin(async (sql) => {
      const rows = await sql<
        ProgramRow[]
      >`select * from programs where organization_id=${actor.organizationId} order by created_at,id`;
      const programs = [];
      for (const row of rows) programs.push(await this.serialize(sql, row));
      return programs;
    });
  }

  async createProgram(actor: Actor, input: CreateProgramInput) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      const [created] = await sql<ProgramRow[]>`insert into programs (organization_id,name)
        values (${actor.organizationId},${input.name}) returning *`;
      if (!created) throw new Error("Program insert returned no row");
      await this.audit.append(sql, actor, {
        eventKey: `program.created:${created.id}`,
        action: "program.created",
        aggregateType: "program",
        aggregateId: created.id,
        reason: "Commission program created",
      });
      return this.serialize(sql, created);
    });
  }

  async codes(actor: Actor, programId: string) {
    this.owner(actor);
    const programs = await this.client.sql`select id from programs where organization_id=${actor.organizationId} and id=${programId}`;
    if (!programs[0]) throw new NotFoundException({ status: "not_found" });
    const rows = await this.client.sql<ReferralCodeRow[]>`select id,program_id,partner_id,code,active
      from referral_codes where organization_id=${actor.organizationId} and program_id=${programId} order by code`;
    return rows.map((row) => referralCodeSchema.parse({
      id: row.id, programId: row.program_id, partnerId: row.partner_id, code: row.code, active: row.active,
    }));
  }

  async createCode(actor: Actor, programId: string, input: CreateReferralCodeInput) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      const programs = await sql`select id from programs where organization_id=${actor.organizationId} and id=${programId} for key share`;
      if (!programs[0]) throw new NotFoundException({ status: "not_found" });
      const partners = await sql`select id from partners where organization_id=${actor.organizationId} and id=${input.partnerId} for key share`;
      if (!partners[0]) throw new NotFoundException({ status: "not_found" });
      const [created] = await sql<ReferralCodeRow[]>`insert into referral_codes
        (organization_id,program_id,partner_id,code) values (${actor.organizationId},${programId},${input.partnerId},${input.code})
        on conflict (organization_id,code) do nothing returning id,program_id,partner_id,code,active`;
      if (!created) throw new ConflictException({ status: "referral_code_exists" });
      await this.audit.append(sql, actor, {
        eventKey: `referral_code.created:${created.id}`,
        action: "referral_code.created",
        aggregateType: "referral_code",
        aggregateId: created.id,
        reason: "Referral code assigned to partner",
      });
      return referralCodeSchema.parse({
        id: created.id, programId: created.program_id, partnerId: created.partner_id,
        code: created.code, active: created.active,
      });
    });
  }

  async preview(actor: Actor, programId: string, input: PreviewCommissionInput) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      const [program] = await sql<{ currency: string; status: "active" | "paused" }[]>`select o.currency,p.status from programs p
        join organizations o on o.id=p.organization_id
        where p.organization_id=${actor.organizationId} and p.id=${programId}`;
      if (!program) throw new NotFoundException({ status: "not_found" });
      const partners = await sql`select id from partners where organization_id=${actor.organizationId} and id=${input.partnerId}`;
      if (!partners[0]) throw new NotFoundException({ status: "not_found" });
      const rows = await sql<RuleRow[]>`select r.*,${program.currency}::text as currency from commission_rules r
        where r.organization_id=${actor.organizationId} and r.program_id=${programId}`;
      const rules: CandidateCommissionRule[] = rows.map((row) => ({
        id: row.id,
        programId: row.program_id,
        partnerId: row.partner_id,
        category: row.category,
        active: true,
        effectiveFrom: new Date(row.effective_from),
        effectiveTo: row.effective_to ? new Date(row.effective_to) : null,
        ...(row.rule_type === "flat"
          ? { type: "flat" as const, flatAmountMinor: row.flat_amount_minor ?? 0n }
          : { type: "percentage" as const, basisPoints: row.basis_points ?? 0 }),
      }));
      const selected = selectApplicableRule({
        rules, programId, partnerId: input.partnerId, category: input.category, at: new Date(),
      });
      const scope = !selected ? "none"
        : selected.partnerId && selected.category ? "partner_category"
          : selected.partnerId ? "partner"
            : selected.category ? "category" : "fallback";
      const amount = selected ? calculateCommission(selected, BigInt(input.grossAmountMinor)) : 0n;
      return previewCommissionSchema.parse({
        ruleId: selected?.id ?? null,
        programStatus: program.status,
        scope,
        amount: { amountMinor: amount.toString(), currency: program.currency },
      });
    });
  }

  async rules(actor: Actor, id: string) {
    return this.client.sql.begin(async (sql) => {
      const rows =
        await sql`select id from programs where organization_id=${actor.organizationId} and id=${id}`;
      if (!rows[0]) throw new NotFoundException({ status: "not_found" });
      return this.loadRules(sql, actor.organizationId, id);
    });
  }

  async createRule(actor: Actor, programId: string, input: CommissionRuleInput) {
    this.owner(actor);
    // Freeze the default before any lock wait and validate against that exact instant.
    const effectiveFrom = input.effectiveFrom ?? new Date(Date.now()).toISOString();
    const validated = commissionRuleInput.safeParse({ ...input, effectiveFrom });
    if (!validated.success) throw new BadRequestException({ status: "invalid_request" });
    const from = new Date(effectiveFrom).toISOString();
    const to = validated.data.effectiveTo
      ? new Date(validated.data.effectiveTo).toISOString()
      : null;
    return this.client.sql.begin(async (sql) => {
      // Serialize every rule write for this program before checking the half-open interval.
      const programs =
        await sql`select id from programs where organization_id=${actor.organizationId} and id=${programId} for update`;
      if (!programs[0]) throw new NotFoundException({ status: "not_found" });
      if (input.partnerId !== null) {
        const partners =
          await sql`select id from partners where organization_id=${actor.organizationId} and id=${input.partnerId} for key share`;
        if (!partners[0]) throw new NotFoundException({ status: "not_found" });
      }
      const overlaps =
        await sql`select id from commission_rules where organization_id=${actor.organizationId} and program_id=${programId}
        and partner_id is not distinct from ${input.partnerId}::uuid and category is not distinct from ${input.category}::text
        and (effective_to is null or effective_to > ${from}::timestamptz)
        and (${to}::timestamptz is null or effective_from < ${to}::timestamptz)`;
      if (overlaps[0]) throw new ConflictException({ status: "rule_overlap" });
      const [created] = await sql<{ id: string }[]>`insert into commission_rules
        (organization_id,program_id,partner_id,category,rule_type,flat_amount_minor,basis_points,effective_from,effective_to)
        values (${actor.organizationId},${programId},${input.partnerId},${input.category},${input.type},${input.type === "flat" ? input.flatAmountMinor : null},${input.type === "percentage" ? input.basisPoints : null},${from},${to}) returning id`;
      if (!created) throw new Error("Rule insert returned no row");
      await this.audit.append(sql, actor, {
        eventKey: `rule.created:${created.id}`,
        action: "rule.created",
        aggregateType: "commission_rule",
        aggregateId: created.id,
        reason: "Commission rule created",
      });
      return this.loadRules(sql, actor.organizationId, programId);
    });
  }

  async state(actor: Actor, id: string, status: "active" | "paused", reason: string) {
    this.owner(actor);
    return this.client.sql.begin(async (sql) => {
      const [row] = await sql<
        ProgramRow[]
      >`select * from programs where organization_id=${actor.organizationId} and id=${id} for update`;
      if (!row) throw new NotFoundException({ status: "not_found" });
      if (row.status === status) throw new ConflictException({ status: "program_state_conflict" });
      const [updated] = await sql<
        ProgramRow[]
      >`update programs set status=${status},updated_at=statement_timestamp() where organization_id=${actor.organizationId} and id=${id} returning *`;
      if (!updated) throw new Error("Program update returned no row");
      await this.audit.append(sql, actor, {
        eventKey: `program.${status}:${id}:${crypto.randomUUID()}`,
        action: `program.${status}`,
        aggregateType: "program",
        aggregateId: id,
        reason,
      });
      return this.serialize(sql, updated);
    });
  }
}
