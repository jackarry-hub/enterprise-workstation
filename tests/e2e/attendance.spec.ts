import { expect, test } from "@playwright/test";

test("legacy attendance bookmarks redirect to task delivery on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/attendance", { waitUntil: "networkidle" });

  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "任务管理", level: 1 })).toBeVisible();
});

test("legacy attendance bookmarks redirect to task delivery on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/attendance", { waitUntil: "networkidle" });

  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "任务管理", level: 1 })).toBeVisible();
});
