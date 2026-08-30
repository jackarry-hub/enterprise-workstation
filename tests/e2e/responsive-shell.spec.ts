import { expect, test } from "@playwright/test";

test("workspace shell fits the active viewport and exposes app navigation", async ({ page }, testInfo) => {
  await page.goto("/agents", { waitUntil: "networkidle" });
  const width = page.viewportSize()?.width ?? 1280;
  if (width < 768) await expect(page.getByTestId("mobile-primary-nav")).toBeVisible();
  else await expect(page.getByTestId("mobile-primary-nav")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("agent-shell.png"), fullPage: true });
});

for (const width of [360, 375, 390, 430, 768, 1024, 1366, 1440, 1920]) {
  test(`shell has no critical horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto("/assistant", { waitUntil: "networkidle" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
