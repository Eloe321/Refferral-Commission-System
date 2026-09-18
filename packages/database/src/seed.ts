import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { eq, sql } from "drizzle-orm";
import { createDatabaseClient, type Database } from "./client.js";
import { NORTHSTAR_IDS, NORTHSTAR_SEED_DATA } from "./seed-data.js";
import {
  claimItems,
  claims,
  commissionRules,
  conversionItems,
  conversions,
  earningHolds,
  earnings,
  ledgerEntries,
  organizations,
  partners,
  programs,
  referralCodes,
  users,
} from "./schema/index.js";

export type SeedDatabase = Pick<Database, "insert" | "select">;
type UnknownRow = Record<string, unknown>;

const DIVERGENT_SEED_STATE = "Northstar sandbox seed state is divergent";
const seedData = NORTHSTAR_SEED_DATA;

export async function insertCanonicalSeedRows(
  database: SeedDatabase,
  sandboxVersion = 1,
): Promise<void> {
  await database
    .insert(organizations)
    .values({ ...seedData.organization, sandboxVersion })
    .onConflictDoNothing({ target: organizations.id });
  await database
    .insert(users)
    .values([...seedData.users])
    .onConflictDoNothing({ target: users.id });
  await database
    .insert(partners)
    .values([...seedData.partners])
    .onConflictDoNothing({ target: partners.id });
  await database
    .insert(programs)
    .values([...seedData.programs])
    .onConflictDoNothing({ target: programs.id });
  await database
    .insert(commissionRules)
    .values([...seedData.commissionRules])
    .onConflictDoNothing({ target: commissionRules.id });
  await database
    .insert(referralCodes)
    .values([...seedData.referralCodes])
    .onConflictDoNothing({ target: referralCodes.id });
  await database
    .insert(conversions)
    .values([...seedData.conversions])
    .onConflictDoNothing({ target: conversions.id });
  await database
    .insert(conversionItems)
    .values([...seedData.conversionItems])
    .onConflictDoNothing({ target: conversionItems.id });
  await database
    .insert(earnings)
    .values([...seedData.earnings])
    .onConflictDoNothing({ target: earnings.id });
  await database
    .insert(earningHolds)
    .values([...seedData.earningHolds])
    .onConflictDoNothing({ target: earningHolds.id });
  await database
    .insert(claims)
    .values([...seedData.claims])
    .onConflictDoNothing({ target: claims.id });
  await database
    .insert(claimItems)
    .values([...seedData.claimItems])
    .onConflictDoNothing({ target: claimItems.id });
  await database
    .insert(ledgerEntries)
    .values([...seedData.ledgerEntries])
    .onConflictDoNothing({ target: ledgerEntries.id });
}

function normalizeStableValue(value: unknown): unknown {
  if (typeof value === "bigint") return { type: "bigint", value: value.toString() };
  if (value instanceof Date) return { type: "date", value: value.toISOString() };
  if (Array.isArray(value)) return value.map(normalizeStableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeStableValue(nested)]),
    );
  }
  return value;
}

function rowsMatch(
  expectedRows: readonly { id: string }[],
  actualRows: readonly UnknownRow[],
): boolean {
  if (actualRows.length !== expectedRows.length) return false;
  return expectedRows.every((expected) => {
    const actual = actualRows.find((row) => row.id === expected.id);
    if (!actual) return false;
    const expectedRecord = expected as UnknownRow;
    const stableActual = Object.fromEntries(
      Object.keys(expectedRecord).map((key) => [key, actual[key]]),
    );
    return isDeepStrictEqual(
      normalizeStableValue(expectedRecord),
      normalizeStableValue(stableActual),
    );
  });
}

function rowsInclude(
  expectedRows: readonly { id: string }[],
  actualRows: readonly UnknownRow[],
): boolean {
  return expectedRows.every((expected) => {
    const actual = actualRows.find((row) => row.id === expected.id);
    if (!actual) return false;
    const expectedRecord = expected as UnknownRow;
    const stableActual = Object.fromEntries(
      Object.keys(expectedRecord).map((key) => [key, actual[key]]),
    );
    return isDeepStrictEqual(
      normalizeStableValue(expectedRecord),
      normalizeStableValue(stableActual),
    );
  });
}

async function verifyCanonicalSeedStructure(database: SeedDatabase): Promise<void> {
  const organizationId = seedData.organization.id;
  const [
    organizationRows,
    userRows,
    partnerRows,
    programRows,
    ruleRows,
    codeRows,
    conversionRows,
    itemRows,
    earningRows,
    holdRows,
    claimRows,
    claimItemRows,
    ledgerRows,
  ] = await Promise.all([
    database.select().from(organizations).where(eq(organizations.id, organizationId)),
    database.select().from(users).where(eq(users.organizationId, organizationId)),
    database.select().from(partners).where(eq(partners.organizationId, organizationId)),
    database.select().from(programs).where(eq(programs.organizationId, organizationId)),
    database
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.organizationId, organizationId)),
    database.select().from(referralCodes).where(eq(referralCodes.organizationId, organizationId)),
    database.select().from(conversions).where(eq(conversions.organizationId, organizationId)),
    database
      .select()
      .from(conversionItems)
      .where(eq(conversionItems.organizationId, organizationId)),
    database.select().from(earnings).where(eq(earnings.organizationId, organizationId)),
    database.select().from(earningHolds).where(eq(earningHolds.organizationId, organizationId)),
    database.select().from(claims).where(eq(claims.organizationId, organizationId)),
    database.select().from(claimItems).where(eq(claimItems.organizationId, organizationId)),
    database.select().from(ledgerEntries).where(eq(ledgerEntries.organizationId, organizationId)),
  ]);
  const structures: Array<[readonly { id: string }[], readonly UnknownRow[]]> = [
    [[{ id: seedData.organization.id }], organizationRows],
    [
      seedData.users.map(({ id, organizationId: tenantId, role }) => ({
        id,
        organizationId: tenantId,
        role,
      })),
      userRows,
    ],
    [
      seedData.partners.map(({ id, organizationId: tenantId, userId }) => ({
        id,
        organizationId: tenantId,
        userId,
      })),
      partnerRows,
    ],
    [
      seedData.programs.map(({ id, organizationId: tenantId }) => ({
        id,
        organizationId: tenantId,
      })),
      programRows,
    ],
    [
      seedData.commissionRules.map(({ id, organizationId: tenantId, programId, partnerId }) => ({
        id,
        organizationId: tenantId,
        programId,
        partnerId,
      })),
      ruleRows,
    ],
    [
      seedData.referralCodes.map(({ id, organizationId: tenantId, programId, partnerId }) => ({
        id,
        organizationId: tenantId,
        programId,
        partnerId,
      })),
      codeRows,
    ],
    [
      seedData.conversions.map(
        ({ id, organizationId: tenantId, programId, partnerId, referralCodeId }) => ({
          id,
          organizationId: tenantId,
          programId,
          partnerId,
          referralCodeId,
        }),
      ),
      conversionRows,
    ],
    [
      seedData.conversionItems.map(({ id, organizationId: tenantId, conversionId }) => ({
        id,
        organizationId: tenantId,
        conversionId,
      })),
      itemRows,
    ],
    [
      seedData.earnings.map(
        ({ id, organizationId: tenantId, conversionItemId, programId, partnerId, ruleId }) => ({
          id,
          organizationId: tenantId,
          conversionItemId,
          programId,
          partnerId,
          ruleId,
        }),
      ),
      earningRows,
    ],
    [
      seedData.earningHolds.map(({ id, organizationId: tenantId, earningId }) => ({
        id,
        organizationId: tenantId,
        earningId,
      })),
      holdRows,
    ],
    [
      seedData.claims.map(({ id, organizationId: tenantId, partnerId, actorId }) => ({
        id,
        organizationId: tenantId,
        partnerId,
        actorId,
      })),
      claimRows,
    ],
    [
      seedData.claimItems.map(({ id, organizationId: tenantId, claimId, earningId }) => ({
        id,
        organizationId: tenantId,
        claimId,
        earningId,
      })),
      claimItemRows,
    ],
    [
      seedData.ledgerEntries.map(
        ({ id, organizationId: tenantId, partnerId, earningId, claimId }) => ({
          id,
          organizationId: tenantId,
          partnerId,
          earningId,
          claimId,
        }),
      ),
      ledgerRows,
    ],
  ];
  if (!structures.every(([expected, actual]) => rowsInclude(expected, actual))) {
    throw new Error("Northstar sandbox seed structure is divergent");
  }
}

export async function verifyCanonicalSeedState(
  database: SeedDatabase,
  sandboxVersion = 1,
): Promise<void> {
  const organizationId = seedData.organization.id;
  const [
    organizationRows,
    userRows,
    partnerRows,
    programRows,
    ruleRows,
    codeRows,
    conversionRows,
    itemRows,
    earningRows,
    holdRows,
    claimRows,
    claimItemRows,
    ledgerRows,
  ] = await Promise.all([
    database.select().from(organizations).where(eq(organizations.id, organizationId)),
    database.select().from(users).where(eq(users.organizationId, organizationId)),
    database.select().from(partners).where(eq(partners.organizationId, organizationId)),
    database.select().from(programs).where(eq(programs.organizationId, organizationId)),
    database
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.organizationId, organizationId)),
    database.select().from(referralCodes).where(eq(referralCodes.organizationId, organizationId)),
    database.select().from(conversions).where(eq(conversions.organizationId, organizationId)),
    database
      .select()
      .from(conversionItems)
      .where(eq(conversionItems.organizationId, organizationId)),
    database.select().from(earnings).where(eq(earnings.organizationId, organizationId)),
    database.select().from(earningHolds).where(eq(earningHolds.organizationId, organizationId)),
    database.select().from(claims).where(eq(claims.organizationId, organizationId)),
    database.select().from(claimItems).where(eq(claimItems.organizationId, organizationId)),
    database.select().from(ledgerEntries).where(eq(ledgerEntries.organizationId, organizationId)),
  ]);
  const organizationExpectation = [{ ...seedData.organization, sandboxVersion }];
  const canonicalCollections: Array<[readonly { id: string }[], readonly UnknownRow[]]> = [
    [organizationExpectation, organizationRows],
    [seedData.users, userRows],
    [seedData.partners, partnerRows],
    [seedData.programs, programRows],
    [seedData.commissionRules, ruleRows],
    [seedData.referralCodes, codeRows],
    [seedData.conversions, conversionRows],
    [seedData.conversionItems, itemRows],
    [seedData.earnings, earningRows],
    [seedData.earningHolds, holdRows],
    [seedData.claims, claimRows],
    [seedData.claimItems, claimItemRows],
    [seedData.ledgerEntries, ledgerRows],
  ];
  if (!canonicalCollections.every(([expected, actual]) => rowsMatch(expected, actual))) {
    throw new Error(DIVERGENT_SEED_STATE);
  }
}

/** Seeds a complete deterministic fictional organization in one transaction. */
export async function seedSandbox(database: Database): Promise<void> {
  await database.transaction(async (tx) => {
    await insertCanonicalSeedRows(tx);
    await verifyCanonicalSeedState(tx);
  });
}

/** Adds any missing deterministic rows on boot without resetting mutable demo progress. */
export async function ensureSandboxSeeded(database: Database): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${NORTHSTAR_IDS.organization}))`);
    const current = await tx
      .select({ sandboxVersion: organizations.sandboxVersion })
      .from(organizations)
      .where(eq(organizations.id, NORTHSTAR_IDS.organization));
    await insertCanonicalSeedRows(tx, current[0]?.sandboxVersion ?? 1);
    await verifyCanonicalSeedStructure(tx);
  });
}

export type SeedCliDependencies = {
  databaseUrl: string | undefined;
  createClient: typeof createDatabaseClient;
  seed: typeof seedSandbox;
  writeStdout: (line: string) => void;
  writeStderr: (line: string) => void;
  setExitCode: (code: number) => void;
};

const defaultSeedCliDependencies = (): SeedCliDependencies => ({
  databaseUrl: process.env.DATABASE_URL,
  createClient: createDatabaseClient,
  seed: seedSandbox,
  writeStdout: (line) => process.stdout.write(line),
  writeStderr: (line) => process.stderr.write(line),
  setExitCode: (code) => {
    process.exitCode = code;
  },
});

/** Executes the package CLI while keeping operational errors out of its output. */
export async function runSeedCli(
  dependencies: SeedCliDependencies = defaultSeedCliDependencies(),
): Promise<void> {
  let succeeded: boolean;
  let client: ReturnType<typeof createDatabaseClient> | undefined;
  try {
    if (!dependencies.databaseUrl) throw new Error("DATABASE_URL is required");
    client = dependencies.createClient(dependencies.databaseUrl);
    await dependencies.seed(client.db);
    succeeded = true;
  } catch {
    succeeded = false;
  } finally {
    try {
      await client?.sql.end();
    } catch {
      succeeded = false;
    }
  }
  if (succeeded) {
    dependencies.writeStdout(
      `Seeded fictional sandbox organization ${NORTHSTAR_IDS.organization}\n`,
    );
    dependencies.setExitCode(0);
    return;
  }
  dependencies.writeStderr("Sandbox seed failed.\n");
  dependencies.setExitCode(1);
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  void runSeedCli().catch(() => {
    process.stderr.write("Sandbox seed failed.\n");
    process.exitCode = 1;
  });
}
