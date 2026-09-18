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
  programSchema,
  type CommissionRuleInput,
} from "@referral-sandbox/contracts";
import type { DatabaseClient } from "@referral-sandbox/database";
import type { TransactionSql } from "postgres";
import type { Actor } from "../auth/actor.js";
import { AuditService } from "../common/audit.service.js";
import { DATABASE_CLIENT } from "../database/database.module.js";

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
