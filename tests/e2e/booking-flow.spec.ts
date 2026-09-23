import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("owner creates a fictional booking and delivers a signed completion event", async ({ page }) => {
  const reference = `BOOKING-BROWSER-${Date.now()}`;
  await page.goto("/owner/bookings");
  await expect(page.getByRole("heading", { name: "Bookings and events" })).toBeVisible();

  await page.getByLabel("Booking reference").fill(reference);
  await page.getByLabel("Referral code").fill("JAMIE12");
  await page.getByLabel("Service category").fill("plumbing");
  await page.getByLabel("Service value").fill("180.00");
  await page.getByRole("button", { name: "Create fictional booking" }).click();
  await expect(page.getByText(reference, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Deliver completion event for ${reference}` }).click();
  await expect(page.getByText(`Event processed for ${reference}.`)).toBeVisible();
  await expect(page.getByText("processed", { exact: true }).first()).toBeVisible();
});

test("owner configures a program and exports an operational report", async ({ page }) => {
  const suffix = String(Date.now());
  const name = `Service line ${suffix}`;
  const code = `SVC${suffix}`;
  await page.goto("/owner/programs");
  await page.getByLabel("New program name").fill(name);
  await page.getByRole("button", { name: "Create program" }).click();
  await expect(page.getByText(`Program ${name} created. Add a rule and partner code to use it.`)).toBeVisible();
  await page.getByLabel("Referral code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Assign referral code" }).click();
  await expect(page.getByText(`Referral code ${code} assigned to a partner.`)).toBeVisible();
  await page.getByRole("textbox", { name: "Service category" }).fill("installation");
  await page.getByLabel("Percent of service value").fill("12.5");
  await page.getByRole("button", { name: "Create rule" }).click();
  await expect(page.getByText("Commission rule created for future bookings.")).toBeVisible();
  await page.getByLabel("Preview category").fill("installation");
  await page.getByRole("button", { name: "Preview commission" }).click();
  await expect(page.getByText(/category rule selected\. Estimated commission:/i)).toBeVisible();
  const bookingRef = `CONFIGURED-${suffix}`;
  await page.goto("/owner/bookings");
  await page.getByRole("combobox", { name: "Commission program" }).selectOption({ label: name });
  await page.getByLabel("Booking reference").fill(bookingRef);
  await page.getByLabel("Referral code", { exact: true }).fill(code);
  await page.getByRole("textbox", { name: "Service category" }).fill("installation");
  await page.getByLabel("Service value").fill("200.00");
  await page.getByRole("button", { name: "Create fictional booking" }).click();
  await expect(page.getByText(bookingRef, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Deliver completion event for ${bookingRef}` }).click();
  await expect(page.getByText(`Event processed for ${bookingRef}.`)).toBeVisible();
  await page.goto("/owner/reports");
  await expect(page.getByRole("heading", { name: "Commission exposure" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("northstar-commission-report.csv");
  const csvPath = await download.path();
  if (!csvPath) throw new Error("Downloaded report has no local path");
  expect(await readFile(csvPath, "utf8")).toContain(`"${bookingRef}","installation","Jamie Cruz","eligible","2500"`);
});
