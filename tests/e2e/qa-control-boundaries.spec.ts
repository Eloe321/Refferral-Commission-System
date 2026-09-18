import { expect, test, type Page } from "@playwright/test";

async function resetSandbox(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/owner\/workboard$/);
  await page.getByRole("button", { name: "Reset sandbox" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset guided sandbox" });
  const confirmation = dialog.getByRole("textbox", { name: "Type RESET SANDBOX to confirm" });
  await confirmation.fill("reset sandbox");
  await expect(dialog.getByRole("button", { name: "Confirm reset" })).toBeDisabled();
  await confirmation.fill("RESET SANDBOX");
  await dialog.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();
}

async function switchPersona(page: Page, persona: "Owner" | "Partner"): Promise<void> {
  await page.getByRole("button", { name: /Switch persona\. Current persona:/ }).click();
  await page.getByRole("menuitemradio", { name: `${persona} view` }).click();
}

async function createGuideClaim(page: Page): Promise<void> {
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
  await expect(page.getByRole("status").filter({ hasText: "Claim created" })).toBeVisible();
}

test.describe("QA control and input boundaries", () => {
  test("round-trips program, partner, and earning controls with required audit reasons", async ({
    page,
  }) => {
    await resetSandbox(page);

    await page.goto("/owner/programs");
    await page.getByRole("button", { name: "Manage Neighbor Rewards" }).click();
    let dialog = page.getByRole("dialog", { name: "Neighbor Rewards controls" });
    let reason = dialog.getByRole("textbox", { name: "Reason" });
    let action = dialog.getByRole("button", { name: "Pause program" });
    await expect(action).toBeDisabled();
    await reason.fill("  ");
    await expect(action).toBeDisabled();
    await reason.fill("QA program pause");
    await action.click();
    await expect(page.getByRole("status").filter({ hasText: "now paused" })).toBeVisible();

    await page.getByRole("button", { name: "Manage Neighbor Rewards" }).click();
    dialog = page.getByRole("dialog", { name: "Neighbor Rewards controls" });
    await dialog.getByRole("textbox", { name: "Reason" }).fill("QA program resume");
    await dialog.getByRole("button", { name: "Resume program" }).click();
    await expect(page.getByRole("status").filter({ hasText: "now active" })).toBeVisible();

    await page.goto("/owner/partners");
    await page.getByRole("button", { name: "Manage Jamie Cruz" }).click();
    dialog = page.getByRole("dialog", { name: "Jamie Cruz controls" });
    reason = dialog.getByRole("textbox", { name: "Reason" });
    action = dialog.getByRole("button", { name: "Suspend partner" });
    await expect(action).toBeDisabled();
    await reason.fill("QA access review");
    await action.click();
    await expect(page.getByRole("status").filter({ hasText: "now suspended" })).toBeVisible();

    await page.getByRole("button", { name: "Manage Jamie Cruz" }).click();
    dialog = page.getByRole("dialog", { name: "Jamie Cruz controls" });
    await dialog.getByRole("textbox", { name: "Reason" }).fill("QA access restored");
    await dialog.getByRole("button", { name: "Reactivate partner" }).click();
    await expect(page.getByRole("status").filter({ hasText: "now active" })).toBeVisible();

    await page.goto("/owner/earnings");
    await page.getByRole("button", { name: "Manage earning NS-ELIGIBLE-GENERAL" }).click();
    dialog = page.getByRole("dialog", { name: "Earning NS-ELIGIBLE-GENERAL" });
    reason = dialog.getByRole("textbox", { name: "Reason" });
    action = dialog.getByRole("button", { name: "Place hold" });
    await expect(action).toBeDisabled();
    await reason.fill("QA earning review");
    await action.click();
    await expect(page.getByRole("status").filter({ hasText: "Earning placed on hold" })).toBeVisible();

    await page.getByRole("button", { name: "Manage earning NS-ELIGIBLE-GENERAL" }).click();
    dialog = page.getByRole("dialog", { name: "Earning NS-ELIGIBLE-GENERAL" });
    await dialog.getByRole("textbox", { name: "Reason" }).fill("QA review complete");
    await dialog.getByRole("button", { name: "Release hold" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Earning hold released" })).toBeVisible();
  });

  test("requires explanations for terminal service outcomes and removes voided earnings", async ({
    page,
  }) => {
    await resetSandbox(page);
    await page.goto("/owner/programs");
    await page.getByRole("button", { name: "Manage conversion NS-SCHEDULED-001" }).click();
    let dialog = page.getByRole("dialog", { name: "Conversion NS-SCHEDULED-001" });
    const reason = dialog.getByRole("textbox", { name: "Reason" });
    await expect(dialog.getByRole("button", { name: "Complete service" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Cancel service" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Mark no-show" })).toBeDisabled();
    await reason.fill("no");
    await expect(dialog.getByRole("button", { name: "Cancel service" })).toBeDisabled();
    await reason.fill("Customer cancelled");
    await dialog.getByRole("button", { name: "Cancel service" }).click();
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();

    await resetSandbox(page);
    await page.goto("/owner/earnings");
    await page.getByRole("button", { name: "Manage earning NS-SCHEDULED-PLUMBING" }).click();
    dialog = page.getByRole("dialog", { name: "Earning NS-SCHEDULED-PLUMBING" });
    const voidButton = dialog.getByRole("button", { name: "Void earning" });
    await expect(voidButton).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Reason" }).fill("Duplicate attribution");
    await voidButton.click();
    await expect(page.getByRole("status").filter({ hasText: "Earning voided" })).toBeVisible();
    await expect(page.getByText("Voided", { exact: true })).toBeVisible();
  });

  test("copies the public referral link and routes email OTP to Mailpit with bounded input", async ({
    page,
  }) => {
    await resetSandbox(page);
    await switchPersona(page, "Partner");
    await page.goto("/partner/referrals");
    await page.getByRole("button", { name: "Copy referral link" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("https://referrals.example.invalid/r/JAMIE12");

    await switchPersona(page, "Owner");
    await page.goto("/owner/programs");
    await page.getByRole("button", { name: "Manage conversion NS-SCHEDULED-001" }).click();
    await page
      .getByRole("dialog", { name: "Conversion NS-SCHEDULED-001" })
      .getByRole("button", { name: "Complete service" })
      .click();
    await switchPersona(page, "Partner");
    await page.goto("/partner/claims");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("radio", { name: "Email" }).check();
    await page.getByRole("button", { name: "Verify claim" }).click();

    await expect(page.getByRole("dialog", { name: "SMS preview" })).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Verification email queued" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Mailpit inbox" })).toHaveAttribute(
      "href",
      "http://localhost:8025",
    );
    const otp = page.getByRole("textbox", { name: "Verification code" });
    const confirm = page.getByRole("button", { name: "Confirm claim" });
    await otp.fill("letters");
    await expect(otp).toHaveValue("");
    await expect(confirm).toBeDisabled();
    await otp.fill("1234567");
    await expect(otp).toHaveValue("123456");
    await expect(confirm).toBeEnabled();

    await expect
      .poll(async () => {
        const response = await page.request.get("http://localhost:8025/api/v1/messages");
        const body = (await response.json()) as { messages?: Array<{ Subject?: string }> };
        return body.messages?.some((message) => message.Subject === "Your claim verification code");
      })
      .toBe(true);
  });

  test("recovers a failed claim and settles it after retry", async ({ page }) => {
    await resetSandbox(page);
    await createGuideClaim(page);
    await page.getByRole("button", { name: "Check claim progress" }).click();
    await page.getByRole("button", { name: "Switch to owner" }).click();
    await page.getByRole("button", { name: "Open earning operations" }).click();

    const manageClaim = page.getByRole("button", { name: /Manage claim/ }).first();
    const manageLabel = await manageClaim.getAttribute("aria-label");
    const claimReference = manageLabel?.replace("Manage claim ", "");
    if (!claimReference) throw new Error("Created claim did not expose a management reference");
    const claimRecord = page.locator("article.claim-record").filter({ hasText: claimReference });
    await manageClaim.click();
    let dialog = page.getByRole("dialog", { name: /Claim/ });
    await dialog.getByRole("button", { name: "Simulate failure" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Claim settlement simulated" })).toBeVisible();
    const retry = page.getByRole("button", { name: /Retry claim/ });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByRole("status").filter({ hasText: "queued for retry" })).toBeVisible();

    await page.getByRole("button", { name: /Manage claim/ }).click();
    dialog = page.getByRole("dialog", { name: /Claim/ });
    await dialog.getByRole("button", { name: "Simulate success" }).click();
    await expect(claimRecord.getByText("Settled", { exact: true })).toBeVisible();
  });
});
