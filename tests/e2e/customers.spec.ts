import { expect, test } from "@playwright/test";

import { authStatePath } from "./auth-state";

const suffix = Date.now();
const customerName = `E2E 商用客户 ${suffix}`;
const opportunityName = `E2E 数字化商机 ${suffix}`;

test("customer to delivery workflow persists for another authorized browser", async ({ browser, page }) => {
  await page.goto("/customers", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "客户管理", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "新建客户" }).click();

  const createDialog = page.getByRole("dialog", { name: "新建客户" });
  await createDialog.getByLabel("客户名称").fill(customerName);
  await createDialog.getByLabel("统一登记号").fill(`E2E-${suffix}`);
  await createDialog.getByLabel("所属行业").fill("企业数字化服务");
  await createDialog.getByLabel("客户地区").fill("上海");
  await createDialog.getByLabel("联系人").fill("E2E 联系人");
  await createDialog.getByLabel("联系人职务").fill("信息化负责人");
  await createDialog.getByLabel("联系电话").fill("13800000000");
  await createDialog.getByRole("button", { name: "保存客户" }).click();

  await expect(page.getByText(customerName).first()).toBeVisible();
  await page.getByRole("button", { name: `查看客户详情：${customerName}` }).last().click();
  let detail = page.getByRole("dialog", { name: `客户详情：${customerName}` });
  await expect(detail.getByText("E2E 联系人")).toBeVisible();

  await detail.getByRole("button", { name: "新建商机" }).click();
  await detail.getByLabel("商机名称").fill(opportunityName);
  await detail.getByLabel("商机金额").fill("120000.00");
  await detail.getByLabel("预计成交日期").fill("2026-10-31");
  await detail.getByRole("button", { name: "保存商机" }).click();
  await expect(detail.getByText(opportunityName)).toBeVisible();

  await detail.getByRole("button", { name: "推进至已确认" }).click();
  await expect(detail.getByRole("button", { name: "推进至方案中" })).toBeVisible();
  await detail.getByRole("button", { name: "推进至方案中" }).click();
  await expect(detail.getByRole("button", { name: "推进至已赢单" })).toBeVisible();

  await detail.getByLabel("新增客户跟进记录").fill("已确认交付范围与项目计划");
  await detail.getByLabel("下次跟进时间").fill("2026-09-01T10:00");
  await detail.getByRole("button", { name: "保存跟进" }).click();
  await expect(detail.getByText("已确认交付范围与项目计划")).toBeVisible();

  await detail.getByRole("button", { name: "推进至已赢单" }).click();
  await expect(detail.getByRole("button", { name: "转交付项目" })).toBeVisible();
  await detail.getByRole("button", { name: "转交付项目" }).click();
  await detail.getByLabel("交付项目说明").fill("E2E 客户商机转交付事务验证");
  await detail.getByLabel("项目开始日期").fill("2026-09-01");
  await detail.getByLabel("项目计划完成日期").fill("2026-10-31");
  await detail.getByRole("button", { name: "确认创建项目" }).click();
  await expect(detail.getByRole("link", { name: /E2E 商用客户/ })).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByLabel("搜索客户").fill(customerName);
  await expect(page.getByText(customerName).first()).toBeVisible();

  const secondContext = await browser.newContext({ storageState: authStatePath("executive") });
  const secondPage = await secondContext.newPage();
  await secondPage.goto("/customers", { waitUntil: "networkidle" });
  await secondPage.getByLabel("搜索客户").fill(customerName);
  await secondPage.getByRole("button", { name: `查看客户详情：${customerName}` }).last().click();
  detail = secondPage.getByRole("dialog", { name: `客户详情：${customerName}` });
  await expect(detail.getByText(opportunityName)).toBeVisible();
  await expect(detail.getByRole("link", { name: /E2E 商用客户/ })).toBeVisible();
  await secondContext.close();
});

test("customer mobile flow uses cards and a full-height action surface without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/customers", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "客户管理", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  const firstCustomer = page.getByRole("button", { name: /查看客户详情：/ }).last();
  if (await firstCustomer.count()) {
    await firstCustomer.click();
    await expect(page.getByRole("dialog", { name: /客户详情：/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "记录本次跟进" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }
});
