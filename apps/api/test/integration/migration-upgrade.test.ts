import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabaseClient } from "../../../../packages/database/src/index.js";

const baseUrl = process.env.DATABASE_URL_TEST;
if (!baseUrl) throw new Error("DATABASE_URL_TEST is required");
const name = `migration_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
const url = new URL(baseUrl);
url.pathname = `/${name}`;
const admin = createDatabaseClient(baseUrl, { max: 1 });
const database = createDatabaseClient(url.toString(), { max: 4 });
const org = crypto.randomUUID();
const otherOrg = crypto.randomUUID();
const partner = crypto.randomUUID();
const program = crypto.randomUUID();
const code = crypto.randomUUID();
const conversions = [crypto.randomUUID(), crypto.randomUUID()] as const;
const unrelatedResource = crypto.randomUUID();
const items = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort();
async function applyMigration(filename: string) {
  const contents = await readFile(
    new URL(`../../../../packages/database/drizzle/${filename}`, import.meta.url),
    "utf8",
  );
  await database.sql.begin(async (sql) => {
    for (const statement of contents.split("--> statement-breakpoint"))
      if (statement.trim()) await sql.unsafe(statement);
  });
}
beforeAll(async () => {
  await admin.sql.unsafe(`create database "${name}"`);
  await applyMigration("0000_natural_gamma_corps.sql");
  await applyMigration("0001_conscious_katie_power.sql");
  await database.sql`insert into organizations (id,name,currency) values (${org},'Upgrade fixture','USD'),(${otherOrg},'Other tenant','EUR')`;
  await database.sql`insert into users (id,organization_id,display_name,role) values (${partner},${org},'Upgrade partner','partner')`;
  await database.sql`insert into partners (id,organization_id,user_id,display_name,email,phone_e164) values (${partner},${org},${partner},'Upgrade partner','upgrade@example.com','+12025550199')`;
  await database.sql`insert into programs (id,organization_id,name) values (${program},${org},'Upgrade program')`;
  await database.sql`insert into referral_codes (id,organization_id,program_id,partner_id,code) values (${code},${org},${program},${partner},'UPGRADE')`;
  for (const conversion of conversions)
    await database.sql`insert into conversions (id,organization_id,program_id,partner_id,referral_code_id,external_ref,currency) values (${conversion},${org},${program},${partner},${code},${conversion},'USD')`;
  // Pre-0002 items have neither position nor created_at; UUID order is the stable fallback.
  for (const [index, item] of [...items].reverse().entries())
    await database.sql`insert into conversion_items (id,organization_id,conversion_id,external_ref,category,gross_amount_minor) values (${item},${org},${conversions[index === 0 ? 1 : 0]},${item},'test',1000)`;
  await database.sql`insert into idempotency_records (organization_id,scope,idempotency_key,request_hash,resource_id,response) values
    (${org},'conversion.create','upgrade-create','hash',${conversions[0]},'{"status":"scheduled"}'),
    (${org},${`conversion.complete:${conversions[1]}`},'upgrade-complete','hash',${conversions[1]},'{"status":"completed"}'),
    (${org},'conversion.create','upgrade-progress','hash',null,null),
    (${org},'conversion.create','upgrade-resource','hash',${conversions[0]},null),
    (${org},'unrelated.scope','upgrade-unrelated','hash',${unrelatedResource},null)`;
});
afterAll(async () => {
  await database.sql.end();
  try {
    await admin.sql.unsafe(`drop database if exists "${name}" with (force)`);
  } finally {
    await admin.sql.end();
  }
});
it("upgrades populated 0001 data with deterministic positions and tenant conversion references", async () => {
  await expect(applyMigration("0002_illegal_silvermane.sql")).resolves.toBeUndefined();
  const positions =
    await database.sql`select id,position,gross_amount_minor::text as amount from conversion_items order by id`;
  expect([...positions]).toEqual(
    items.map((id, index) => ({ id, position: index === 2 ? 0 : index, amount: "1000" })),
  );
  const records =
    await database.sql`select idempotency_key,resource_id,conversion_id,response from idempotency_records order by idempotency_key`;
  expect([...records]).toEqual([
    {
      idempotency_key: "upgrade-complete",
      resource_id: conversions[1],
      conversion_id: conversions[1],
      response: { status: "completed" },
    },
    {
      idempotency_key: "upgrade-create",
      resource_id: conversions[0],
      conversion_id: conversions[0],
      response: { status: "scheduled" },
    },
    { idempotency_key: "upgrade-progress", resource_id: null, conversion_id: null, response: null },
    {
      idempotency_key: "upgrade-resource",
      resource_id: conversions[0],
      conversion_id: conversions[0],
      response: null,
    },
    {
      idempotency_key: "upgrade-unrelated",
      resource_id: unrelatedResource,
      conversion_id: null,
      response: null,
    },
  ]);
  await expect(
    database.sql`update conversion_items set position=null where id=${items[0] ?? null}`,
  ).rejects.toMatchObject({ code: "23502" });
  await expect(
    database.sql`update conversion_items set position=-1 where id=${items[0] ?? null}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    database.sql`update conversion_items set position=0 where id=${items[1] ?? null}`,
  ).rejects.toMatchObject({ code: "23505" });
  await expect(
    database.sql`insert into idempotency_records (organization_id,scope,idempotency_key,request_hash,conversion_id) values (${otherOrg},'conversion.create','cross-tenant','hash',${conversions[0]})`,
  ).rejects.toMatchObject({
    code: "23503",
    constraint_name: "idempotency_records_org_conversion_fk",
  });
});
it("adds the partner issuance index without changing existing OTP history", async () => {
  const challengeId = crypto.randomUUID();
  await database.sql`insert into otp_challenges (id,organization_id,actor_id,partner_id,claim_draft_hash,code_digest,channel,status,attempts,expires_at,resend_after)
    values (${challengeId},${org},${partner},${partner},'fixture-draft','fixture-digest','sms','blocked',5,now()+interval '5 minutes',now()+interval '1 minute')`;
  const before = await database.sql`select * from otp_challenges where id=${challengeId}`;
  await applyMigration("0003_magenta_mordo.sql");
  expect(await database.sql`select * from otp_challenges where id=${challengeId}`).toEqual(before);
  const [index] = await database.sql<
    { indexdef: string }[]
  >`select indexdef from pg_indexes where indexname='otp_partner_status_resend_idx'`;
  expect(index?.indexdef).toContain("(organization_id, partner_id, status, resend_after)");
});
