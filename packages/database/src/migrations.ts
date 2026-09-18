import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client.js";

/** Applies this package's committed migrations to an explicitly-provided database. */
export async function migrateDatabase(database: Database): Promise<void> {
  await migrate(database, {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
}
