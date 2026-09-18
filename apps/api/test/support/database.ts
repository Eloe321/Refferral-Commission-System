import { createDatabaseClient } from "../../../../packages/database/src/client.js";
import { createClaimDraftHash } from "../../src/domain/claim-draft.js";

export type TestDatabase = ReturnType<typeof createTestDb>;
export type TwoOrganizationFixture = {
  orgA: { id: string; claim: { id: string }; earning: { id: string } };
  orgB: { id: string; claim: { id: string }; earning: { id: string } };
};

export function createTestDb() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is required");
  return createDatabaseClient(url, { max: 1 });
}

export async function seedEligibleClaimFixture(
  database: TestDatabase,
  organizationId: string = crypto.randomUUID(),
) {
  return database.sql.begin(async (sql) => {
    const partnerUserId = crypto.randomUUID();
    const partnerId = crypto.randomUUID();
    const programId = crypto.randomUUID();
    const ruleId = crypto.randomUUID();
    const codeId = crypto.randomUUID();
    const conversionId = crypto.randomUUID();
    const earningIds: [string, string] = [crypto.randomUUID(), crypto.randomUUID()];
    const verifiedChallengeId = crypto.randomUUID();
    await sql`insert into organizations (id,name,currency) values (${organizationId},'Claim fixture','USD') on conflict(id) do nothing`;
    await sql`insert into users (id,organization_id,display_name,role) values (${partnerUserId},${organizationId},'Claim partner','partner')`;
    await sql`insert into partners (id,organization_id,user_id,display_name,email,phone_e164) values (${partnerId},${organizationId},${partnerUserId},'Claim partner','claim@example.invalid','+12025550130')`;
    await sql`insert into programs (id,organization_id,name) values (${programId},${organizationId},'Claim program')`;
    await sql`insert into commission_rules (id,organization_id,program_id,rule_type,flat_amount_minor) values (${ruleId},${organizationId},${programId},'flat',1000)`;
    await sql`insert into referral_codes (id,organization_id,program_id,partner_id,code) values (${codeId},${organizationId},${programId},${partnerId},${codeId})`;
    await sql`insert into conversions (id,organization_id,program_id,partner_id,referral_code_id,external_ref,currency,status) values (${conversionId},${organizationId},${programId},${partnerId},${codeId},${conversionId},'USD','completed')`;
    for (const [position, earningId] of earningIds.entries()) {
      const itemId = crypto.randomUUID();
      await sql`insert into conversion_items (id,organization_id,conversion_id,external_ref,category,position,gross_amount_minor) values (${itemId},${organizationId},${conversionId},${`claim-${String(position)}`},'test',${position},10000)`;
      await sql`insert into earnings (id,organization_id,conversion_item_id,program_id,partner_id,rule_id,amount_minor,currency,status,rule_snapshot) values (${earningId},${organizationId},${itemId},${programId},${partnerId},${ruleId},1000,'USD','eligible','{}')`;
    }
    const authoritative = await sql<
      { id: string; amount_minor: string; currency: string }[]
    >`select id,amount_minor::text,currency from earnings where organization_id=${organizationId} and partner_id=${partnerId} order by id`;
    const hash = createClaimDraftHash({
      organizationId,
      actorId: partnerUserId,
      partnerId,
      earningIds: authoritative.map((earning) => earning.id),
      amountMinor: authoritative
        .reduce((total, earning) => total + BigInt(earning.amount_minor), 0n)
        .toString(),
      currency: authoritative[0]?.currency ?? "",
    });
    await sql`insert into otp_challenges (id,organization_id,actor_id,partner_id,claim_draft_hash,code_digest,channel,status,expires_at,resend_after) values (${verifiedChallengeId},${organizationId},${partnerUserId},${partnerId},${hash},${"a".repeat(64)},'sms','verified',clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '1 minute')`;
    return { organizationId, partnerUserId, partnerId, earningIds, verifiedChallengeId };
  });
}

export async function countClaimsForEarnings(
  database: TestDatabase,
  earningIds: readonly string[],
) {
  if (!earningIds.length) return 0;
  const [row] = await database.sql<
    { count: number }[]
  >`select count(distinct claim_id)::int count from claim_items where earning_id in ${database.sql([...earningIds])}`;
  return row?.count ?? 0;
}

// Despite the conventional helper name, delete only explicitly owned fixtures.
export async function truncateTestDb(database: TestDatabase, organizationIds: string[]) {
  if (organizationIds.length === 0) return;
  await database.sql`delete from organizations where id in ${database.sql(organizationIds)}`;
}

export async function seedTwoOrganizations(
  database: TestDatabase,
): Promise<TwoOrganizationFixture> {
  return database.sql.begin(async (sql) => {
    async function seedOrganization(label: string) {
      const id = crypto.randomUUID();
      const actorId = crypto.randomUUID();
      const partnerId = crypto.randomUUID();
      const programId = crypto.randomUUID();
      const ruleId = crypto.randomUUID();
      const codeId = crypto.randomUUID();
      const conversionId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const earningId = crypto.randomUUID();
      const claimId = crypto.randomUUID();
      await sql`insert into organizations (id, name, currency) values (${id}, ${`Schema test ${label}`}, 'PHP')`;
      await sql`insert into users (id, organization_id, display_name, role) values (${actorId}, ${id}, 'Test partner', 'partner')`;
      await sql`insert into partners (id, organization_id, user_id, display_name, email, phone_e164) values (${partnerId}, ${id}, ${actorId}, 'Test partner', 'test@example.invalid', '+12025550130')`;
      await sql`insert into programs (id, organization_id, name) values (${programId}, ${id}, 'Test program')`;
      await sql`insert into commission_rules (id, organization_id, program_id, rule_type, flat_amount_minor) values (${ruleId}, ${id}, ${programId}, 'flat', 1000)`;
      await sql`insert into referral_codes (id, organization_id, program_id, partner_id, code) values (${codeId}, ${id}, ${programId}, ${partnerId}, 'TEST')`;
      await sql`insert into conversions (id, organization_id, program_id, partner_id, referral_code_id, external_ref, currency) values (${conversionId}, ${id}, ${programId}, ${partnerId}, ${codeId}, 'conversion-1', 'PHP')`;
      await sql`insert into conversion_items (id, organization_id, conversion_id, external_ref, category, position, gross_amount_minor) values (${itemId}, ${id}, ${conversionId}, 'item-1', 'test', 0, 10000)`;
      await sql`insert into earnings (id, organization_id, conversion_item_id, program_id, partner_id, rule_id, amount_minor, currency, status, rule_snapshot) values (${earningId}, ${id}, ${itemId}, ${programId}, ${partnerId}, ${ruleId}, 1000, 'PHP', 'eligible', '{"type":"flat","flatAmount":{"amountMinor":"1000","currency":"PHP"}}')`;
      await sql`insert into claims (id, organization_id, partner_id, actor_id, amount_minor, currency, idempotency_key, selection_hash) values (${claimId}, ${id}, ${partnerId}, ${actorId}, 1000, 'PHP', 'test-claim', 'test-selection')`;
      return { id, claim: { id: claimId }, earning: { id: earningId } };
    }
    return { orgA: await seedOrganization("A"), orgB: await seedOrganization("B") };
  });
}
