import { expect, test } from "@playwright/test";

test("project overview navigation remains usable with an empty real-session portfolio", async ({ page }) => {
  await page.goto("/projects", { waitUntil: "networkidle" });

  const overviewLink = page.getByRole("link", { name: "项目总览" });
  await overviewLink.click();

  await expect(page).toHaveURL(/\/projects\?view=overview#project-overview$/);
  await expect(overviewLink).toHaveAttribute("aria-current", "location");
  await expect(page.getByText("没有匹配的项目")).toBeVisible();
});

test("shell search works while fixture dashboard actions stay unavailable", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "全局搜索" }).click();
  await page.getByLabel("输入全局搜索关键词").fill("经营驾驶舱");
  await expect(page.getByRole("link", { name: /经营驾驶舱/ })).toHaveAttribute("href", "/dashboard");
  await expect(page.getByRole("button", { name: /完成待办|恢复待办/ })).toHaveCount(0);
});

test("activity center shows an explicit disabled empty state", async ({ page }) => {
  await page.goto("/activities", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "活动推进中心" })).toBeVisible();
  await expect(page.getByText("当前账号没有可显示的真实活动数据。" )).toBeVisible();
  await expect(page.getByRole("button", { name: "活动日历" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "创建活动" })).toBeDisabled();
});
