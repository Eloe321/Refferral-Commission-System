import { expect, test, type Page } from "@playwright/test";

async function resetSandbox(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/owner\/workboard$/);
  await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();
  await page.getByRole("button", { name: "Reset sandbox" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset guided sandbox" });
  await dialog
    .getByRole("textbox", { name: "Type RESET SANDBOX to confirm" })
    .fill("RESET SANDBOX");
  await dialog.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page).toHaveURL(/\/owner\/workboard$/);
  await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Guide progress" })).toHaveAttribute(
    "value",
    "0",
  );
}

async function switchPersonaFromHeader(page: Page, persona: "Owner" | "Partner"): Promise<void> {
  await page.getByRole("button", { name: /Switch persona\. Current persona:/ }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`${persona} view`, "i") }).click();
}

test("completes the guided referral, verified claim, settlement, and refund lifecycle", async ({
  page,
}) => {
  await resetSandbox(page);
  await page.getByRole("button", { name: "Open programs", exact: true }).click();
  await expect(page).toHaveURL(/\/owner\/programs$/);

  const rules = page.getByRole("region", { name: "Programs and rule priority" });
  await expect(rules.getByRole("list", { name: "Neighbor Rewards rule priority" })).toContainText(
    "Partner override",
  );
  await expect(rules.getByRole("list", { name: "Neighbor Rewards rule priority" })).toContainText(
    "plumbing category",
  );
  await expect(rules.getByRole("list", { name: "Neighbor Rewards rule priority" })).toContainText(
    "Program fallback",
  );

  await page.getByRole("button", { name: "Mark program reviewed" }).click();
  await expect(page.getByRole("heading", { name: "See the partner workbench" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to partner" }).click();
  await expect(page).toHaveURL(/\/partner\/workboard$/);
  await expect(page.getByRole("heading", { name: "Partner workboard · Jamie" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create the fictional referral" })).toBeVisible();
  await expect(page.getByRole("main")).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "workboard page ready." })).toHaveCount(
    1,
  );

  await page.getByRole("button", { name: "Open referrals" }).click();
  await expect(page).toHaveURL(/\/partner\/referrals$/);
  await page.getByRole("button", { name: "Create referral" }).click();
  await expect(page.getByRole("heading", { name: "Complete the service" })).toBeVisible();
  await page.getByRole("button", { name: "Open owner programs" }).click();
  await expect(page).toHaveURL(/\/owner\/programs$/);
  await page.getByRole("button", { name: "Complete fictional service" }).click();
  await expect(page.getByRole("heading", { name: "Claim the eligible earning" })).toBeVisible();
  await page.getByRole("button", { name: "Open partner claims" }).click();
  await expect(page).toHaveURL(/\/partner\/claims$/);
  await expect(page.getByRole("button", { name: "Check claim progress" })).toBeVisible();

  const earning = page.getByRole("checkbox", {
    name: /Select plumbing referral GUIDE-REFERRAL-/,
  });
  await earning.check();
  await page.getByRole("button", { name: "Verify claim" }).click();

  const preview = page.getByRole("dialog", { name: "SMS preview" });
  await expect(preview).toContainText("Local preview — no SMS was sent.");
  await preview.getByRole("button", { name: "Copy code" }).click();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code).toMatch(/^\d{6}$/);
  const otp = page.getByRole("textbox", { name: "Verification code" });
  await expect(otp).toBeFocused();
  await otp.fill(code);
  await page.getByRole("button", { name: "Confirm claim" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Claim created" })).toBeVisible();

  await page.getByRole("button", { name: "Check claim progress" }).click();
  await expect(page.getByRole("heading", { name: "Return to owner controls" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to owner" }).click();
  await expect(page).toHaveURL(/\/owner\/workboard$/);
  await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Settle the claim, then issue a refund" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open earning operations" }).click();
  await expect(page).toHaveURL(/\/owner\/earnings$/);

  await page.getByRole("button", { name: /Manage claim/ }).click();
  const claimDialog = page.getByRole("dialog", { name: /Claim/ });
  await claimDialog.getByRole("button", { name: "Simulate success" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Claim settlement simulated" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Manage conversion GUIDE-REFERRAL-/ }).click();
  const refund = page.getByRole("dialog", { name: /Refund GUIDE-REFERRAL-/ });
  await refund.getByRole("checkbox", { name: /Refund plumbing GUIDE-REFERRAL-/ }).check();
  await refund.getByRole("textbox", { name: /Refund amount for GUIDE-REFERRAL-/ }).fill("0.01");
  await refund.getByRole("textbox", { name: "Refund reason" }).fill("Partial service refund");
  await refund.getByRole("button", { name: "Submit refund" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /marked partially refunded/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check refund progress" }).click();
  await expect(page.getByRole("heading", { name: "Review the reversal" })).toBeVisible();
  await expect(page).toHaveURL(/\/owner\/earnings$/);

  await switchPersonaFromHeader(page, "Partner");
  await expect(page.getByRole("heading", { name: "Partner workboard · Jamie" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Claims" })
    .click();
  await expect(page).toHaveURL(/\/partner\/claims$/);
  const settledClaim = page
    .getByRole("article", { name: /Claim/ })
    .filter({ hasText: "$25.00" })
    .filter({ hasText: "Settled" });
  await expect(settledClaim).toHaveCount(1);
  const reversal = page.getByRole("article", { name: /reversal/i });
  await expect(reversal).toContainText("-$25.00");
  await expect(reversal).toContainText("Partial service refund");

  await switchPersonaFromHeader(page, "Owner");
  await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();
  await page.getByRole("button", { name: "Open reversal history" }).click();
  await expect(page).toHaveURL(/\/owner\/earnings$/);
  await page.getByRole("button", { name: "Mark reversal reviewed" }).click();
  await expect(page.getByRole("heading", { name: "Lifecycle inspection complete" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Lifecycle inspection complete" })).toContainText(
    "Scenario complete",
  );
});
