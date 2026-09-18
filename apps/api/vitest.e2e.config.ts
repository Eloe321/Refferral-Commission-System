import { defineConfig } from "vitest/config";

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ?? "postgres://sandbox:sandbox@localhost:5432/referral_sandbox";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL_TEST: testDatabaseUrl,
    },
  },
});
