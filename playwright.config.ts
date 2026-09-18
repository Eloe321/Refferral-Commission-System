import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3000",
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "docker compose down && docker compose up --build",
    env: {
      SMS_DELIVERY_MODE: "preview",
      UNISMS_API_KEY: "replace_me",
      UNISMS_SENDER_ID: "replace_me",
      UNISMS_WEBHOOK_SECRET: "replace_me",
      EMAIL_DELIVERY_MODE: "mailpit",
    },
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
