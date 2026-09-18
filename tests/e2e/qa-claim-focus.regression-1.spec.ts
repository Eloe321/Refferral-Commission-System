import { expect, test, type Page } from "@playwright/test";

async function resetSandbox(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/owner\/workboard$/);
  await page.getByRole("button", { name: "Reset sandbox" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset guided sandbox" });
  await dialog
    .getByRole("textbox", { name: "Type RESET SANDBOX to confirm" })
    .fill("RESET SANDBOX");
  await dialog.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();
}

test("moves focus to the successful claim result after confirmation", async ({ page }) => {
  await resetSandbox(page);
  await page.getByRole("button", { name: "Open programs", exact: true }).click();
  await page.getByRole("button", { name: "Mark program reviewed" }).click();
  await page.getByRole("button", { name: "Switch to partner" }).click();
  await page.getByRole("button", { name: "Open referrals" }).click();
  await page.getByRole("button", { name: "Create referral" }).click();
  await page.getByRole("button", { name: "Open owner programs" }).click();
  await page.getByRole("button", { name: "Complete fictional service" }).click();
  await page.getByRole("button", { name: "Open partner claims" }).click();

  await page.getByRole("checkbox", { name: /Select plumbing referral GUIDE-REFERRAL-/ }).check();
  await page.getByRole("button", { name: "Verify claim" }).click();
  const preview = page.getByRole("dialog", { name: "SMS preview" });
  await preview.getByRole("button", { name: "Copy code" }).click();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole("textbox", { name: "Verification code" }).fill(code);
  await page.getByRole("button", { name: "Confirm claim" }).click();

  const success = page.getByRole("status").filter({ hasText: "Claim created" });
  await expect(success).toBeVisible();
  await expect(success).toBeFocused();
});
