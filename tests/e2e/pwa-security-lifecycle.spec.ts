import { expect, test } from "@playwright/test";

test("offline state pauses tagged writes and worker excludes business responses", async ({ page, context }) => {
  await page.goto("/assistant", { waitUntil: "networkidle" }); await context.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText("当前离线")).toBeVisible(); await expect(page.getByText(/业务写入已暂停/)).toBeVisible();
  const create = page.getByRole("button", { name: "新会话" }); await expect(create).toHaveAttribute("data-network-write", "true");
  await context.setOffline(false);
});
