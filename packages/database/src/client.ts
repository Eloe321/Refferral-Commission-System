import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

/** Creates a lazy client; importing this module never opens a connection. */
export function createDatabaseClient(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10 });
  const db = drizzle(sql, { schema });
  return { sql, db };
}

export type Database = ReturnType<typeof createDatabaseClient>["db"];
export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
