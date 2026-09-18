import { createDatabaseClient } from "./client.js";
import { migrateDatabase } from "./migrations.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for migrations");
const client = createDatabaseClient(url, { max: 1 });
try {
  await migrateDatabase(client.db);
} finally {
  await client.sql.end();
}
