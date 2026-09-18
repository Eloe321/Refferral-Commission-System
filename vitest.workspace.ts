import { defineConfig } from "vitest/config";

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ?? "postgres://sandbox:sandbox@localhost:5432/referral_sandbox";

export default defineConfig({
  resolve: {
    alias: {
      "@referral-sandbox/contracts": new URL("./packages/contracts/src/index.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["**/*.test.ts", "**/*.test.tsx"],
          exclude: ["**/test/integration/**", "**/test/e2e/**", "**/node_modules/**", "**/dist/**"],
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: "integration",
          include: ["apps/api/test/integration/**/*.test.ts"],
          fileParallelism: false,
          passWithNoTests: true,
          env: {
            DATABASE_URL_TEST: testDatabaseUrl,
          },
        },
      },
    ],
  },
});
