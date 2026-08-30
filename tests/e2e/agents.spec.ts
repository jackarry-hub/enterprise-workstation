import { expect, test } from "@playwright/test";

test("manager creates, publishes, runs and reloads a real Agent", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now(); const code = `e2e_agent_${suffix}`; const name = `E2E Agent ${suffix}`;
  await page.goto("/agents", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建 Agent" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建 Agent" });
  await dialog.getByLabel("唯一编码").fill(code);
  await dialog.getByLabel("名称").fill(name);
  await dialog.getByLabel("用途说明").fill("验证版本、真实模型调用和不可变运行记录");
  await dialog.getByLabel("系统提示词").fill("你是验收 Agent。仅返回简短、可验证的工作结果，不执行未授权操作。");
  await dialog.getByRole("button", { name: "保存并发布" }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByLabel("Agent 运行输入").fill("回复：Agent 真实运行已通过");
  await page.getByRole("button", { name: "运行 Agent" }).click();
  await expect(page.getByText(/运行 [0-9a-f]{8} 已完成/)).toBeVisible({ timeout: 90_000 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText("已完成").first()).toBeVisible();
});

test("Agent Center mobile detail is app-like and has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents", { waitUntil: "networkidle" });
  const firstAgent = page.locator("button").filter({ has: page.locator("svg") }).filter({ hasText: /已发布 v/ }).first();
  if (await firstAgent.count()) {
    await firstAgent.click();
    await expect(page.getByRole("button", { name: "返回 Agent 列表" })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
