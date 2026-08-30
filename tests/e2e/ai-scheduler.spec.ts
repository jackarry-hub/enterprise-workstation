import { expect, test } from "@playwright/test";

test("scheduler persists a versioned plan, audited override and atomic dispatch", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/scheduler", { waitUntil: "networkidle" });
  const project = page.getByLabel("项目");
  if (await project.locator("option").count() < 2) throw new Error("E2E 智能排期需要至少一个当前账号可管理且已有成员的项目");
  await project.selectOption({ index: 1 });
  await page.getByLabel("目标").fill(`E2E 排期 ${Date.now()}`);
  await page.getByLabel("工作项（每行一项）").fill("联调验收\n上线检查");
  await page.getByRole("button", { name: "生成并保存方案" }).click();
  await expect(page.getByText(/模型方案|规则方案/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("未配置")).toBeVisible();

  const assignment = page.getByLabel("改派任务");
  const member = page.getByLabel("替换成员");
  if (await assignment.locator("option").count() > 1 && await member.locator("option").count() > 1) {
    await assignment.selectOption({ index: 1 }); await member.selectOption({ index: 1 });
    await page.getByLabel("改派原因").fill("E2E 资源冲突改派验证");
    await page.getByRole("button", { name: "保存改派" }).click();
    await expect(page.getByText(/人工改派：E2E 资源冲突改派验证/)).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(/人工改派：E2E 资源冲突改派验证/)).toBeVisible();
  }
  await page.getByRole("button", { name: "确认并派发任务" }).click();
  await page.getByRole("button", { name: "确认派发", exact: true }).click();
  await expect(page.getByText(/已原子派发 \d+ 项任务/)).toBeVisible({ timeout: 60_000 });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText(/已派发 \d+ 项真实任务/)).toBeVisible();
});

test("scheduler mobile keeps the primary action above app navigation without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/scheduler", { waitUntil: "networkidle" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const action = page.getByRole("button", { name: "确认并派发任务" });
  if (await action.count()) await expect(action.locator("xpath=..")).toHaveClass(/bottom-20/);
});
