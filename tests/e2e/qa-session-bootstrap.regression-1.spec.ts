import { expect, test } from "@playwright/test";

test("boots a fresh browser session without failed network requests or console errors", async ({
  page,
}) => {
  const failedResponses: string[] = [];
  const consoleErrors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${String(response.status())} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/owner\/workboard$/);
  await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();

  expect(failedResponses).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
