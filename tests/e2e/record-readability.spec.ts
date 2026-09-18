import { expect, test } from "@playwright/test";

function luminance(color: string): number {
  const channels = color
    .match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/)
    ?.slice(1)
    .map(Number);
  if (!channels || channels.some((channel) => channel > 255)) {
    throw new Error(
      `Unsupported color: ${color}; expected opaque integer rgb channels from 0 to 255`,
    );
  }
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

test("contrast helper accepts opaque computed RGB and rejects unsupported color formats", async ({
  page,
}) => {
  await page.setContent('<p style="color: rgb(0, 0, 0); background: rgb(255, 255, 255)">Label</p>');
  const colors = await page.locator("p").evaluate((node) => ({
    foreground: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
  }));
  expect(luminance(colors.foreground)).toBe(0);
  expect(luminance(colors.background)).toBe(1);
  for (const color of [
    "rgba(219, 231, 228, 0.2)",
    "rgb(96.5, 112, 121)",
    "rgb(256, 112, 121)",
    "color(srgb 0.5 0.5 0.5)",
  ]) {
    expect.soft(() => luminance(color), color).toThrow(/Unsupported color/);
  }
});

test("workboard eyebrow labels meet AA contrast at phone and desktop sizes", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    for (const role of ["owner", "partner"]) {
      await page.goto(`/${role}/workboard`);
      const eyebrow = page.locator(`.${role}-hero .eyebrow`);
      await expect(eyebrow).toBeVisible();
      const contrast = await eyebrow.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          size: style.fontSize,
          foreground: style.color,
          background: getComputedStyle(node.closest("header")!).backgroundColor,
        };
      });
      const foreground = luminance(contrast.foreground);
      const background = luminance(contrast.background);
      const ratio =
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      expect
        .soft(ratio, `${role} at ${viewport.width}px: ${JSON.stringify(contrast)}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("desktop earning cells separate references and status explanations", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/owner/earnings");
  const rows = page.getByRole("table", { name: "Earnings work queue" }).locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  const separations = await rows.evaluateAll((records) =>
    records.flatMap((record) =>
      [...record.querySelectorAll('td[data-label="Work item"], td[data-label="Status"]')].flatMap(
        (cell) =>
          [...cell.children].slice(1).map((child) => {
            const before = child.previousElementSibling!.getBoundingClientRect();
            const after = child.getBoundingClientRect();
            return {
              text: child.textContent,
              gap: Math.max(after.top - before.bottom, after.left - before.right),
            };
          }),
      ),
    ),
  );
  expect(separations.length).toBeGreaterThan(0);
  for (const separation of separations) {
    expect.soft(separation.gap, `Separation before ${separation.text}`).toBeGreaterThanOrEqual(4);
  }
});
