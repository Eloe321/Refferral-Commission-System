import { eq, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { NORTHSTAR_IDS } from "./seed-data.js";
import { organizations } from "./schema/index.js";
import { insertCanonicalSeedRows, verifyCanonicalSeedState } from "./seed.js";

export type ResetSandboxOptions = {
  appMode: string | undefined;
};

/** Removes only the deterministic fictional organization and its cascading children. */
export async function resetSandbox(
  database: Database,
  options: ResetSandboxOptions,
): Promise<void> {
  if (options.appMode !== "sandbox") {
    throw new Error("resetSandbox requires APP_MODE=sandbox");
  }

  await database.transaction(async (tx) => {
    await tx.delete(organizations).where(eq(organizations.id, NORTHSTAR_IDS.organization));
  });
}

/** Atomically replaces only Northstar's tenant tree with a versioned canonical seed. */
export async function reseedSandbox(
  database: Database,
  options: ResetSandboxOptions,
): Promise<number> {
  if (options.appMode !== "sandbox") {
    throw new Error("reseedSandbox requires APP_MODE=sandbox");
  }
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${NORTHSTAR_IDS.organization}))`);
    const current = await tx
      .select({ sandboxVersion: organizations.sandboxVersion })
      .from(organizations)
      .where(eq(organizations.id, NORTHSTAR_IDS.organization));
    const version = current[0]?.sandboxVersion;
    if (version === undefined) throw new Error("Northstar sandbox organization is unavailable");
    const nextVersion = version + 1;
    await tx.delete(organizations).where(eq(organizations.id, NORTHSTAR_IDS.organization));
    await insertCanonicalSeedRows(tx, nextVersion);
    await verifyCanonicalSeedState(tx, nextVersion);
    return nextVersion;
  });
}
