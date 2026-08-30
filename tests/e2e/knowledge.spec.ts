import { expect, test } from "@playwright/test";

import { authStatePath } from "./auth-state";

const title = `E2E 知识验收 ${Date.now()}`;

test("verified file to draft, publication, search and source survives refresh", async ({ browser }) => {
  test.setTimeout(120_000);
  const managerContext = await browser.newContext({ storageState: authStatePath("executive") });
  const page = await managerContext.newPage();
  await page.goto("/knowledge", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "从已核验文件新建知识" }).click();
  const dialog = page.getByRole("dialog", { name: "新建知识草稿" });
  const fileSelect = dialog.getByLabel("已核验文件");
  const options = await fileSelect.locator("option").count();
  if (options < 2) throw new Error("E2E 知识库需要至少一个当前账号可见的已核验文件");
  await fileSelect.selectOption({ index: 1 });
  await dialog.getByLabel("标题").fill(title);
  await dialog.getByLabel("摘要").fill("真实知识发布与引用链路验收");
  await dialog.getByLabel("分类").fill("E2E 验收");
  await dialog.getByLabel("标签").fill("E2E,验收");
  await dialog.getByRole("button", { name: "保存草稿" }).click();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: `预览文档：${title}` }).first().click();
  await page.getByRole("button", { name: "发布此版本" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("searchbox", { name: "搜索知识库" }).fill(title);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText(/权限范围内找到 1 篇相关文档/)).toBeVisible();
  await page.getByRole("button", { name: `预览文档：${title}` }).first().click();
  const source = page.getByRole("link", { name: /查看来源/ });
  await expect(source).toHaveAttribute("data-version-id", /^[0-9a-f-]{36}$/);
  await managerContext.close();
});

test("knowledge mobile layout has app-like full-height create surface and no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/knowledge", { waitUntil: "networkidle" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.getByRole("button", { name: "从已核验文件新建知识" }).click();
  await expect(page.getByRole("dialog", { name: "新建知识草稿" })).toHaveClass(/h-\[100dvh\]/);
});
