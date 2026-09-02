import { expect, test } from "@playwright/test";

test("analytics exposes metric provenance and never substitutes fixtures", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "经营数据分析" })).toBeVisible();
  const unavailable = page.getByText("经营数据暂时不可用");
  if (await unavailable.count()) await expect(page.getByText(/没有使用演示数据替代/)).toBeVisible();
  else { await expect(page.getByTestId("analytics-as-of")).toBeVisible(); await expect(page.getByText(/^口径 /).first()).toBeVisible(); }
  await expect(page.getByText("固定洞察", { exact: true })).toHaveCount(0);
});
