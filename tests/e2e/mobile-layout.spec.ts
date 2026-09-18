import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

async function expectVisibleTargetsAtLeast(locator: Locator, minimum = 44): Promise<void> {
  for (const target of await locator.all()) {
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    expect(
      box,
      `visible target ${(await target.getAttribute("aria-label")) ?? "without explicit label"}`,
    ).not.toBeNull();
    expect(box?.height).toBeGreaterThanOrEqual(minimum);
    expect(box?.width).toBeGreaterThanOrEqual(minimum);
  }
}

async function expectLabeledInputTargetsAtLeast(locator: Locator, minimum = 44): Promise<void> {
  for (const input of await locator.all()) {
    if (!(await input.isVisible())) continue;
    const target = await input.evaluate((node) => {
      const box = node.closest("label")?.getBoundingClientRect() ?? node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    expect(target.height).toBeGreaterThanOrEqual(minimum);
    expect(target.width).toBeGreaterThanOrEqual(minimum);
  }
}

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => document.fonts.ready);
}

test.describe("mobile workboard accessibility", () => {
  test.use({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true });

  test("owner pages are distinct and follow browser back and forward history", async ({ page }) => {
    await resetSandbox(page);
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    const programs = navigation.getByRole("link", { name: "Programs", exact: true });
    await programs.click();
    await expect(page).toHaveURL(/\/owner\/programs$/);
    await expect(page.getByRole("heading", { name: "Programs and attribution" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Partner access" })).toHaveCount(0);

    await navigation.getByRole("link", { name: "Partners", exact: true }).click();
    await expect(page).toHaveURL(/\/owner\/partners$/);
    await expect(page.getByRole("heading", { name: "Partner access", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Programs and rule priority" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Programs and attribution" })).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/owner\/programs$/);
    await expect(page.getByRole("heading", { name: "Programs and attribution" })).toBeVisible();
    await expect(programs).toHaveAttribute("aria-current", "page");
    await page.goForward();
    await expect(page).toHaveURL(/\/owner\/partners$/);
    await expect(page.getByRole("heading", { name: "Partner access", level: 1 })).toBeVisible();
  });

  test("all eight deep links fit 320 pixels and representative owner and partner pages survive refresh", async ({
    page,
  }) => {
    await resetSandbox(page);
    const routes = [
      ["/owner/workboard", "Owner workboard"],
      ["/owner/programs", "Programs and attribution"],
      ["/owner/earnings", "Earnings and settlement"],
      ["/owner/partners", "Partner access"],
      ["/partner/workboard", "Partner workboard · Jamie"],
      ["/partner/referrals", "Referrals"],
      ["/partner/earnings", "Earnings"],
      ["/partner/claims", "Claims"],
    ] as const;

    for (const [route, heading] of routes) {
      await test.step(route, async () => {
        await page.goto(route);
        await expect(page).toHaveURL(route);
        await expect(
          page.getByRole("main").getByRole("heading", { name: heading, exact: true, level: 1 }),
        ).toBeVisible();
        await expect(page.getByRole("main")).toBeVisible();
        const role = route.startsWith("/owner/") ? "owner" : "partner";
        await expect(
          page.getByRole("button", {
            name: new RegExp(`Switch persona\\. Current persona: .*${role}$`),
          }),
        ).toBeEnabled();
        const current = page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("link")
          .and(page.locator('[aria-current="page"]'));
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAttribute("href", route);
        await waitForFonts(page);
        await expectNoHorizontalOverflow(page);
        await expectVisibleTargetsAtLeast(page.getByRole("button"));
        await expectVisibleTargetsAtLeast(page.getByRole("link"));
      });
    }

    await page.reload();
    await expect(page).toHaveURL(/\/partner\/claims$/);
    await expect(
      page.getByRole("heading", { name: "Claims", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Switch persona\. Current persona: .*partner$/ }),
    ).toBeEnabled();
    await page.goto("/owner/programs");
    await expect(page.getByRole("heading", { name: "Programs and attribution" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/owner\/programs$/);
    await expect(page.getByRole("heading", { name: "Programs and attribution" })).toBeVisible();
  });

  test("preserves owner records and focus after returning from another persona through history", async ({
    page,
  }) => {
    await resetSandbox(page);
    let ownerOverviewReads = 0;
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        /^\/(?:api\/)?programs$/.test(new URL(request.url()).pathname)
      ) {
        ownerOverviewReads += 1;
      }
    });
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    await navigation.getByRole("link", { name: "Programs", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Programs and attribution" })).toBeVisible();
    await page.getByRole("button", { name: /Switch persona\. Current persona:/ }).click();
    await page.getByRole("menuitemradio", { name: "Partner view" }).click();
    await expect(page).toHaveURL(/\/partner\/workboard$/);
    await expect(page.getByRole("heading", { name: "Partner workboard · Jamie" })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/owner\/workboard$/);
    await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();
    await expect(page.getByRole("main")).toBeFocused();
    const readsAfterBack = ownerOverviewReads;
    expect(readsAfterBack).toBeGreaterThan(0);

    await navigation.getByRole("link", { name: "Earnings", exact: true }).click();
    await expect(page).toHaveURL(/\/owner\/earnings$/);
    await expect(page.getByRole("heading", { name: "Earnings and settlement" })).toBeVisible();
    expect(ownerOverviewReads).toBe(readsAfterBack);
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "earnings page ready." })).toHaveCount(
      1,
    );
  });

  test("preserves the ready shell and records when leaving a reset workboard", async ({ page }) => {
    let ownerOverviewReads = 0;
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        /^\/(?:api\/)?programs$/.test(new URL(request.url()).pathname)
      ) {
        ownerOverviewReads += 1;
      }
    });
    await resetSandbox(page);
    const readsAfterReset = ownerOverviewReads;
    expect(readsAfterReset).toBeGreaterThan(0);
    const resetMain = await page.getByRole("main").elementHandle();
    expect(resetMain).not.toBeNull();
    await expect(page.getByRole("main")).toBeFocused();

    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Programs", exact: true })
      .click();
    await expect(page).toHaveURL(/\/owner\/programs$/);
    await expect(page.getByRole("heading", { name: "Programs and attribution" })).toBeVisible();
    expect(ownerOverviewReads).toBe(readsAfterReset);
    expect(await resetMain?.evaluate((node) => node.isConnected)).toBe(true);
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "programs page ready." })).toHaveCount(
      1,
    );
  });

  test("fits the narrow viewport, exposes real location state, and preserves dialog focus", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Owner workboard" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectVisibleTargetsAtLeast(page.getByRole("button"));
    await expectVisibleTargetsAtLeast(page.getByRole("link"));

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to work area" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Northstar sandbox workboard" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: /Switch persona\. Current persona:/ }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();

    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    const programsLink = navigation.getByRole("link", { name: "Programs" });
    await programsLink.click();
    await expect(page).toHaveURL(/\/owner\/programs$/);
    await expect(programsLink).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Workboard", exact: true })).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    const resetTrigger = page.getByRole("button", { name: "Reset sandbox" });
    await resetTrigger.click();
    const dialog = page.getByRole("dialog", { name: "Reset guided sandbox" });
    await expect(dialog).toHaveAttribute("data-motion", "reduced");
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(resetTrigger).toBeFocused();

    await resetTrigger.click();
    await dialog
      .getByRole("textbox", { name: "Type RESET SANDBOX to confirm" })
      .fill("RESET SANDBOX");
    await dialog.getByRole("button", { name: "Confirm reset" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Sandbox reset complete." }),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "Sandbox reset complete." }),
    ).toHaveCount(0);

    await expect(page).toHaveURL(/\/owner\/workboard$/);
    await navigation.getByRole("link", { name: "Earnings", exact: true }).click();
    await expect(page).toHaveURL(/\/owner\/earnings$/);
    await expect(
      page.getByRole("cell", { name: /Status Eligible Available to claim/ }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: /Switch persona\. Current persona:/ }).click();
    await page.getByRole("menuitemradio", { name: "Partner view" }).click();
    await expect(page.getByRole("heading", { name: "Partner workboard · Jamie" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    for (const link of await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link")
      .all()) {
      expect(await link.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    await expectVisibleTargetsAtLeast(page.getByRole("button"));
    await navigation.getByRole("link", { name: "Claims", exact: true }).click();
    await expect(page).toHaveURL(/\/partner\/claims$/);
    await expect(page.getByRole("button", { name: "Verify claim" })).toBeVisible();
    await expectLabeledInputTargetsAtLeast(page.getByRole("radio"));
    await expectLabeledInputTargetsAtLeast(page.getByRole("checkbox"));
  });
});

test.describe("deterministic portfolio captures", () => {
  test("captures the mobile partner claim at 390 by 844", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await resetSandbox(page);
    await page.getByRole("button", { name: "Open programs", exact: true }).click();
    await expect(page).toHaveURL(/\/owner\/programs$/);
    await page.getByRole("button", { name: "Mark program reviewed" }).click();
    await page.getByRole("button", { name: "Switch to partner" }).click();
    await expect(page).toHaveURL(/\/partner\/workboard$/);
    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page).toHaveURL(/\/partner\/referrals$/);
    await page.getByRole("button", { name: "Create referral" }).click();
    await page.getByRole("button", { name: "Open owner programs" }).click();
    await expect(page).toHaveURL(/\/owner\/programs$/);
    await page.getByRole("button", { name: "Complete fictional service" }).click();
    await expect(page.getByRole("heading", { name: "Claim the eligible earning" })).toBeVisible();
    await page.getByRole("button", { name: "Open partner claims" }).click();
    await expect(page).toHaveURL(/\/partner\/claims$/);

    const earning = page.getByRole("checkbox", {
      name: /Select plumbing referral GUIDE-REFERRAL-/,
    });
    await earning.check();
    const effectiveCheckboxTarget = await earning.evaluate((node) => {
      const box = node.closest("label")?.getBoundingClientRect();
      return box ? { width: box.width, height: box.height } : null;
    });
    expect(effectiveCheckboxTarget?.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);

    const verify = page.getByRole("button", { name: "Verify claim" });
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    const [verifyBox, navigationBox] = await Promise.all([
      verify.boundingBox(),
      navigation.boundingBox(),
    ]);
    expect(verifyBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    expect((verifyBox?.y ?? 0) + (verifyBox?.height ?? 0)).toBeLessThanOrEqual(
      navigationBox?.y ?? 0,
    );

    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        node.textContent =
          node.textContent?.replace(/GUIDE-REFERRAL-\d+/g, "GUIDE-REFERRAL-DEMO") ?? null;
      }
    });
    await waitForFonts(page);
    await page.screenshot({
      path: "docs/screenshots/mobile-partner-claim.png",
      animations: "disabled",
      style: "time { visibility: hidden !important; }",
    });

    await verify.click();
    const preview = page.getByRole("dialog", { name: "SMS preview" });
    await expect
      .poll(async () => {
        const box = await preview.boundingBox();
        return box ? box.x + box.width : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(390);
    const previewBox = await preview.boundingBox();
    expect(previewBox).not.toBeNull();
    expect(previewBox?.x).toBeGreaterThanOrEqual(0);
    expect((previewBox?.x ?? 0) + (previewBox?.width ?? 0)).toBeLessThanOrEqual(390);
    await preview.getByRole("button", { name: "Copy code" }).click();
    const otp = page.getByRole("textbox", { name: "Verification code" });
    await expect(otp).toBeFocused();
    await expect
      .poll(() =>
        otp.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const topmost = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return topmost === node || node.contains(topmost);
        }),
      )
      .toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test("captures the desktop owner dashboard at 1280 by 800", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await resetSandbox(page);
    await expect(page).toHaveURL(/\/owner\/workboard$/);
    await waitForFonts(page);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: "docs/screenshots/desktop-owner-dashboard.png",
      animations: "disabled",
      style: "time { visibility: hidden !important; }",
    });
  });
});
