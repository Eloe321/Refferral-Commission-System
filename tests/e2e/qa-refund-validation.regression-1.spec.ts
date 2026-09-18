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

test("validates refund amount and reason before enabling submission", async ({ page }) => {
  await resetSandbox(page);
  await page.goto("/owner/earnings");
  await page.getByRole("button", { name: "Manage conversion NS-ELIGIBLE-001" }).click();

  const refund = page.getByRole("dialog", { name: "Refund NS-ELIGIBLE-001" });
  await refund.getByRole("checkbox", { name: "Refund maintenance NS-ELIGIBLE-GENERAL" }).check();
  const amount = refund.getByRole("textbox", {
    name: "Refund amount for NS-ELIGIBLE-GENERAL",
  });
  const reason = refund.getByRole("textbox", { name: "Refund reason" });
  const submit = refund.getByRole("button", { name: "Submit refund" });

  await expect(submit).toBeDisabled();
  await reason.fill("QA boundary check");

  await amount.fill("abc");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(refund.getByRole("alert")).toContainText("positive refund amount");
  await expect(submit).toBeDisabled();

  await amount.fill("500.01");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(refund.getByRole("alert")).toContainText("Remaining amount is $500.00");
  await expect(submit).toBeDisabled();

  await amount.fill("500.00");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await expect(refund.getByRole("alert")).toHaveCount(0);
  await expect(submit).toBeEnabled();
});
