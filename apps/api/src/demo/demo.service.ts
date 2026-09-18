import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  auditEventSchema,
  conversionSchema,
  demoScenarioId,
  demoSessionSchema,
  demoWorkspaceSchema,
  guideStages,
  guideStateSchema,
  ledgerEntrySchema,
  resetSandboxInput,
  resetSandboxResponseSchema,
  type DemoSessionInput,
  type GuideStage,
  type ResetSandboxInput,
} from "@referral-sandbox/contracts";
import { NORTHSTAR_IDS, reseedSandbox, type DatabaseClient } from "@referral-sandbox/database";
import type { TransactionSql } from "postgres";
import type { Actor } from "../auth/actor.js";
import { SandboxSessionGuard, createSessionCookie } from "../auth/sandbox-session.guard.js";
import { IdempotencyService, mutationIdempotencyKey } from "../common/idempotency.service.js";
import type { AppEnv } from "../config/env.js";
import { APP_ENV, DATABASE_CLIENT } from "../database/database.module.js";
import { calculateCommission } from "../domain/money.js";

const SCENARIO_IDS = Object.freeze({
  conversion: "11111111-1111-4111-8111-000000000032",
  item: "11111111-1111-4111-8111-000000000033",
  earning: "11111111-1111-4111-8111-000000000034",
});

type Sql = TransactionSql;
type SessionResult = { actor: Actor; value: string; expiresAt: number };
type OrganizationRow = { sandbox_version: number; updated_at: Date };
const iso = (value: Date | string) => new Date(value).toISOString();

@Injectable()
export class DemoService {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
    @Inject(SandboxSessionGuard) private readonly sessions: SandboxSessionGuard,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  private assertSandbox(): void {
    if (this.env.APP_MODE !== "sandbox") throw new NotFoundException();
  }

  private signed(actor: Actor): SessionResult {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    return {
      actor,
      expiresAt,
      value: createSessionCookie(
        {
          actorId: actor.actorId,
          organizationId: actor.organizationId,
          role: actor.role,
          sandboxVersion: actor.sandboxVersion,
          expiresAt,
        },
        this.env.SESSION_SECRET,
      ),
    };
  }

  async createSession(input: DemoSessionInput): Promise<SessionResult> {
    this.assertSandbox();
    const actor = await this.sessions.findEligibleActor(input.actorId);
    if (
      !actor ||
      actor.organizationId !== NORTHSTAR_IDS.organization ||
      actor.role !== input.role
    ) {
      throw new UnauthorizedException({ status: "unauthorized" });
    }
    return this.signed(actor);
  }

  readSession(actor: Actor) {
    this.assertSandbox();
    return demoSessionSchema.parse(actor);
  }

  private assertScenario(scenarioId: string): void {
    this.assertSandbox();
    if (scenarioId !== demoScenarioId) throw new NotFoundException({ status: "not_found" });
  }

  private async guideState(sql: Sql, actor: Actor, organization?: OrganizationRow) {
    let org = organization;
    if (!org) {
      const rows = await sql<OrganizationRow[]>`select sandbox_version,updated_at from organizations
        where id=${actor.organizationId}`;
      org = rows.at(0);
    }
    if (!org) throw new NotFoundException({ status: "not_found" });
    const rows = await sql<{ stage: string; updated_at: Date }[]>`select stage,updated_at
      from demo_scenario_runs where organization_id=${actor.organizationId}
      and sandbox_version=${org.sandbox_version} order by updated_at,id`;
    const completed = new Set(rows.map((row) => row.stage));
    const completedStages = guideStages.slice(0, -1).filter((stage) => completed.has(stage));
    const stage =
      guideStages.slice(0, -1).find((candidate) => !completed.has(candidate)) ?? "complete";
    return guideStateSchema.parse({
      organizationId: actor.organizationId,
      scenarioId: demoScenarioId,
      stage,
      sandboxVersion: org.sandbox_version,
      completedStages,
      updatedAt: iso(rows.at(-1)?.updated_at ?? org.updated_at),
    });
  }

  async readGuide(actor: Actor, scenarioId: string) {
    this.assertScenario(scenarioId);
    return this.client.sql.begin((sql) => this.guideState(sql, actor));
  }

  private invalid(stage: GuideStage): never {
    throw new ConflictException({ status: "guide_validation_failed", stage });
  }

  private async ensureReferral(sql: Sql, actor: Actor, version: number): Promise<void> {
    if (actor.role !== "partner" || actor.partnerId !== NORTHSTAR_IDS.partners.jamie) {
      this.invalid("create_referral");
    }
    const existing = await sql<{ id: string }[]>`select id from conversions
      where organization_id=${actor.organizationId} and id=${SCENARIO_IDS.conversion}`;
    if (existing[0]) return;
    const [rule] = await sql<
      {
        id: string;
        rule_type: "flat" | "percentage";
        flat_amount_minor: string | null;
        basis_points: number | null;
      }[]
    >`select id,rule_type,flat_amount_minor::text,basis_points from commission_rules
      where organization_id=${actor.organizationId} and program_id=${NORTHSTAR_IDS.program}
      and (partner_id is null or partner_id=${NORTHSTAR_IDS.partners.jamie})
      and (category is null or category='plumbing')
      and effective_from<=statement_timestamp()
      and (effective_to is null or effective_to>statement_timestamp())
      order by (partner_id is not null) desc,(category is not null) desc,effective_from desc,id limit 1`;
    if (!rule) this.invalid("create_referral");
    const gross = 20_000n;
    const amount =
      rule.rule_type === "flat"
        ? calculateCommission(
            { type: "flat", flatAmountMinor: BigInt(rule.flat_amount_minor ?? "-1") },
            gross,
          )
        : calculateCommission({ type: "percentage", basisPoints: rule.basis_points ?? 0 }, gross);
    const externalRef = `GUIDE-REFERRAL-${String(version)}`;
    await sql`insert into conversions
      (id,organization_id,program_id,partner_id,referral_code_id,external_ref,currency,status)
      values (${SCENARIO_IDS.conversion},${actor.organizationId},${NORTHSTAR_IDS.program},
      ${NORTHSTAR_IDS.partners.jamie},${NORTHSTAR_IDS.referralCodes.jamie},${externalRef},'USD','scheduled')`;
    await sql`insert into conversion_items
      (id,organization_id,conversion_id,external_ref,category,position,gross_amount_minor)
      values (${SCENARIO_IDS.item},${actor.organizationId},${SCENARIO_IDS.conversion},
      ${`${externalRef}-PLUMBING`},'plumbing',0,${gross.toString()})`;
    const snapshot = {
      scenarioId: demoScenarioId,
      externalRef,
      type: rule.rule_type,
      flatAmountMinor: rule.flat_amount_minor,
      basisPoints: rule.basis_points,
      category: "plumbing",
      resultAmountMinor: amount.toString(),
    };
    await sql`insert into earnings
      (id,organization_id,conversion_item_id,program_id,partner_id,rule_id,amount_minor,currency,status,rule_snapshot)
      values (${SCENARIO_IDS.earning},${actor.organizationId},${SCENARIO_IDS.item},
      ${NORTHSTAR_IDS.program},${NORTHSTAR_IDS.partners.jamie},${rule.id},${amount.toString()},
      'USD','pending',${JSON.stringify(snapshot)}::jsonb)`;
    await sql`insert into audit_events
      (organization_id,event_key,actor_id,is_system_event,action,reason,aggregate_type,aggregate_id,metadata)
      values (${actor.organizationId},${`demo.referral_created:v${String(version)}`},null,true,
      'demo.referral_created','Guided sandbox created a fictional referral','conversion',
      ${SCENARIO_IDS.conversion},${JSON.stringify({ scenarioId: demoScenarioId })}::jsonb)`;
  }

  private async ensureServiceCompleted(sql: Sql, actor: Actor, version: number): Promise<void> {
    if (actor.role !== "owner") {
      this.invalid("complete_service");
    }
    const [conversion] = await sql<{ status: string }[]>`select status from conversions
      where organization_id=${actor.organizationId} and id=${SCENARIO_IDS.conversion} for update`;
    const [earning] = await sql<{ status: string }[]>`select status from earnings
      where organization_id=${actor.organizationId} and id=${SCENARIO_IDS.earning} for update`;
    if (!conversion || !earning) this.invalid("complete_service");
    if (conversion.status === "scheduled" && earning.status === "pending") {
      await sql`update conversions set status='completed',updated_at=statement_timestamp()
        where organization_id=${actor.organizationId} and id=${SCENARIO_IDS.conversion}`;
      await sql`update earnings set status='eligible',updated_at=statement_timestamp()
        where organization_id=${actor.organizationId} and id=${SCENARIO_IDS.earning}`;
      await sql`insert into audit_events
        (organization_id,event_key,actor_id,is_system_event,action,reason,aggregate_type,aggregate_id,metadata)
        values (${actor.organizationId},${`demo.service_completed:v${String(version)}`},null,true,
        'demo.service_completed','Guided sandbox completed the fictional service','conversion',
        ${SCENARIO_IDS.conversion},${JSON.stringify({ scenarioId: demoScenarioId })}::jsonb)`;
      return;
    }
    if (conversion.status !== "completed" || earning.status !== "eligible") {
      this.invalid("complete_service");
    }
  }

  private async validateStage(
    sql: Sql,
    actor: Actor,
    stage: GuideStage,
    version: number,
  ): Promise<void> {
    if (stage === "review_program") {
      if (actor.role !== "owner") this.invalid(stage);
      const [program] = await sql<{ valid: boolean }[]>`select exists(
        select 1 from programs p join commission_rules r
        on r.organization_id=p.organization_id and r.program_id=p.id
        where p.organization_id=${actor.organizationId} and p.id=${NORTHSTAR_IDS.program}
        and p.status='active') valid`;
      if (!program?.valid) this.invalid(stage);
      return;
    }
    if (stage === "switch_to_partner") {
      if (actor.role !== "partner" || actor.partnerId !== NORTHSTAR_IDS.partners.jamie)
        this.invalid(stage);
      return;
    }
    if (stage === "create_referral") return this.ensureReferral(sql, actor, version);
    if (stage === "complete_service") return this.ensureServiceCompleted(sql, actor, version);
    if (stage === "claim_earnings") {
      if (actor.role !== "partner" || actor.partnerId !== NORTHSTAR_IDS.partners.jamie)
        this.invalid(stage);
      const [claim] = await sql<{ valid: boolean }[]>`select exists(
        select 1 from claim_items ci join claims c
        on c.organization_id=ci.organization_id and c.id=ci.claim_id
        join audit_events a on a.organization_id=c.organization_id
        and a.aggregate_id=c.id and a.action='claim.created'
        where ci.organization_id=${actor.organizationId}
        and ci.earning_id=${SCENARIO_IDS.earning} and c.actor_id=${actor.actorId}) valid`;
      if (!claim?.valid) this.invalid(stage);
      return;
    }
    if (stage === "switch_to_owner") {
      if (actor.role !== "owner") this.invalid(stage);
      return;
    }
    if (stage === "issue_refund") {
      if (actor.role !== "owner") this.invalid(stage);
      const [refund] = await sql<{ valid: boolean }[]>`select exists(
        select 1 from audit_events where organization_id=${actor.organizationId}
        and aggregate_id=${SCENARIO_IDS.conversion} and action='conversion.refunded') valid`;
      if (!refund?.valid) this.invalid(stage);
      return;
    }
    if (stage === "review_reversal") {
      if (actor.role !== "owner") this.invalid(stage);
      const [reversal] = await sql<{ valid: boolean }[]>`select exists(
        select 1 from ledger_entries where organization_id=${actor.organizationId}
        and earning_id=${SCENARIO_IDS.earning} and entry_type='reversal') valid`;
      if (!reversal?.valid) this.invalid(stage);
    }
  }

  async advance(actor: Actor, scenarioId: string, key: string) {
    this.assertScenario(scenarioId);
    const parsedKey = mutationIdempotencyKey.safeParse(key);
    if (!parsedKey.success) throw new ConflictException({ status: "invalid_request" });
    return this.client.sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtext(${actor.organizationId}))`;
      const [organization] = await sql<OrganizationRow[]>`select sandbox_version,updated_at
        from organizations where id=${actor.organizationId} for update`;
      if (!organization || organization.sandbox_version !== actor.sandboxVersion)
        throw new UnauthorizedException({ status: "unauthorized" });
      const scope = `demo.guide.advance:${scenarioId}:actor:${actor.actorId}`;
      const existing = await this.idempotency.acquire(
        sql,
        actor.organizationId,
        scope,
        parsedKey.data,
        { scenarioId, sandboxVersion: organization.sandbox_version },
      );
      if (existing) {
        if (!existing.response) throw new ConflictException({ status: "idempotency_in_progress" });
        return guideStateSchema.parse(existing.response);
      }
      const before = await this.guideState(sql, actor, organization);
      if (before.stage !== "complete") {
        await this.validateStage(sql, actor, before.stage, organization.sandbox_version);
        await sql`insert into demo_scenario_runs (organization_id,stage,sandbox_version)
          values (${actor.organizationId},${before.stage},${organization.sandbox_version})
          on conflict (organization_id,stage,sandbox_version) do nothing`;
      }
      const response = await this.guideState(sql, actor, organization);
      const [record] = await sql<{ id: string }[]>`select id from idempotency_records
        where organization_id=${actor.organizationId} and scope=${scope}
        and idempotency_key=${parsedKey.data}`;
      if (!record) throw new Error("Guide idempotency record unavailable");
      await this.idempotency.completeResource(
        sql,
        actor.organizationId,
        record.id,
        actor.organizationId,
        response,
      );
      return response;
    });
  }

  async workspace(actor: Actor) {
    this.assertSandbox();
    return this.client.sql.begin(async (sql) => {
      const [organization] = await sql<OrganizationRow[]>`select sandbox_version,updated_at
        from organizations where id=${actor.organizationId} for share`;
      if (!organization || organization.sandbox_version !== actor.sandboxVersion) {
        throw new UnauthorizedException({ status: "unauthorized" });
      }
      if (actor.role === "owner") return this.ownerWorkspace(sql, actor, organization);
      return this.partnerWorkspace(sql, actor, organization);
    });
  }

  private async ownerWorkspace(sql: Sql, actor: Actor, organization: OrganizationRow) {
    const conversions = await sql<
      {
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
      }[]
    >`select * from conversions where organization_id=${actor.organizationId}
      order by created_at,id`;
    const items = await sql<
      {
        id: string;
        organization_id: string;
        conversion_id: string;
        external_ref: string;
        category: string;
        gross_amount_minor: string;
        refunded_base_minor: string;
      }[]
    >`select id,organization_id,conversion_id,external_ref,category,
      gross_amount_minor::text,refunded_base_minor::text from conversion_items
      where organization_id=${actor.organizationId} order by position,id`;
    const serializedConversions = conversions.map((conversion) =>
      conversionSchema.parse({
        id: conversion.id,
        organizationId: conversion.organization_id,
        programId: conversion.program_id,
        partnerId: conversion.partner_id,
        referralCodeId: conversion.referral_code_id,
        externalRef: conversion.external_ref,
        currency: conversion.currency,
        status: conversion.status,
        createdAt: iso(conversion.created_at),
        updatedAt: iso(conversion.updated_at),
        items: items
          .filter((item) => item.conversion_id === conversion.id)
          .map((item) => ({
            id: item.id,
            organizationId: item.organization_id,
            conversionId: item.conversion_id,
            externalRef: item.external_ref,
            category: item.category,
            grossAmount: { amountMinor: item.gross_amount_minor, currency: conversion.currency },
            refundedBase: {
              amountMinor: item.refunded_base_minor,
              currency: conversion.currency,
            },
          })),
      }),
    );
    const auditRows = await sql<
      {
        id: string;
        organization_id: string;
        event_key: string;
        actor_id: string | null;
        is_system_event: boolean;
        action: string;
        reason: string | null;
        aggregate_type: string;
        aggregate_id: string;
        metadata: Record<string, unknown>;
        created_at: Date;
      }[]
    >`select * from audit_events where organization_id=${actor.organizationId}
      order by created_at desc,id desc`;
    return demoWorkspaceSchema.parse({
      role: "owner",
      organizationId: actor.organizationId,
      sandboxVersion: organization.sandbox_version,
      conversions: serializedConversions,
      auditEvents: auditRows.map((event) =>
        auditEventSchema.parse({
          id: event.id,
          organizationId: event.organization_id,
          eventKey: event.event_key,
          actorId: event.actor_id,
          isSystemEvent: event.is_system_event,
          action: event.action,
          reason: event.reason,
          aggregateType: event.aggregate_type,
          aggregateId: event.aggregate_id,
          metadata: event.metadata,
          createdAt: iso(event.created_at),
        }),
      ),
    });
  }

  private async partnerWorkspace(sql: Sql, actor: Actor, organization: OrganizationRow) {
    if (!actor.partnerId) throw new ForbiddenException({ status: "forbidden" });
    const [referral] = await sql<{ code: string }[]>`select code from referral_codes
      where organization_id=${actor.organizationId} and partner_id=${actor.partnerId}
      and active=true order by code limit 1`;
    if (!referral) throw new NotFoundException({ status: "not_found" });
    const ledger = await sql<
      {
        id: string;
        organization_id: string;
        partner_id: string;
        earning_id: string | null;
        claim_id: string | null;
        entry_type: string;
        amount_minor: string;
        currency: string;
        reason: string | null;
        created_at: Date;
      }[]
    >`select id,organization_id,partner_id,earning_id,claim_id,entry_type,
      amount_minor::text,currency,reason,created_at from ledger_entries
      where organization_id=${actor.organizationId} and partner_id=${actor.partnerId}
      order by created_at desc,id desc`;
    return demoWorkspaceSchema.parse({
      role: "partner",
      organizationId: actor.organizationId,
      sandboxVersion: organization.sandbox_version,
      partnerId: actor.partnerId,
      referral: {
        code: referral.code,
        publicUrl: `https://referrals.example.invalid/r/${encodeURIComponent(referral.code)}`,
      },
      ledgerEntries: ledger.map((entry) =>
        ledgerEntrySchema.parse({
          id: entry.id,
          organizationId: entry.organization_id,
          partnerId: entry.partner_id,
          earningId: entry.earning_id,
          claimId: entry.claim_id,
          entryType: entry.entry_type,
          amount: { amountMinor: entry.amount_minor, currency: entry.currency },
          reason: entry.reason,
          createdAt: iso(entry.created_at),
        }),
      ),
    });
  }

  async reset(actor: Actor, input: ResetSandboxInput) {
    this.assertSandbox();
    resetSandboxInput.parse(input);
    if (actor.role !== "owner") throw new ForbiddenException({ status: "forbidden" });
    const version = await reseedSandbox(this.client.db, { appMode: this.env.APP_MODE });
    const owner = await this.sessions.findEligibleActor(NORTHSTAR_IDS.ownerUser);
    if (!owner || owner.sandboxVersion !== version) throw new Error("Reset owner unavailable");
    const session = this.signed(owner);
    const guide = await this.readGuide(owner, demoScenarioId);
    return {
      ...session,
      response: resetSandboxResponseSchema.parse({ session: session.actor, guide }),
    };
  }
}
