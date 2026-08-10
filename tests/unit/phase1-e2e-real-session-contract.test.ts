import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function e2e(name: string) {
  return readFileSync(resolve("tests/e2e", name), "utf8");
}

describe("Phase 1 real-session E2E contract", () => {
  it.each([
    ["approvals.spec.ts", "当前账号没有可显示的真实审批数据。"],
    ["payroll.spec.ts", "当前账号没有可显示的真实薪资数据。"],
    ["people.spec.ts", "当前账号没有可显示的真实员工数据。"],
    ["interaction-audit.spec.ts", "当前账号没有可显示的真实活动数据。"],
  ])("expects a truthful fail-closed state in %s", (file, message) => {
    expect(e2e(file)).toContain(message);
  });

  it("does not restore local fixture workflows in the project closure suite", () => {
    const source = e2e("projects-closure.spec.ts");

    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("setInputFiles");
    expect(source).not.toContain("创建项目");
    expect(source).toContain("未找到项目");
  });

  it("covers the intentionally denied knowledge route with visible guidance", () => {
    const source = e2e("v09-page-completion.spec.ts");

    expect(source).toContain("/dashboard\\?notice=no_access");
    expect(source).toContain("你没有权限查看刚才的页面，已返回可访问的工作台。");
    expect(source).not.toContain('route: "/knowledge"');
  });

  it("checks the no-access notice only after the forbidden-route redirect", () => {
    const source = e2e("phase1-auth-rbac.spec.ts");
    const landingNavigation = source.indexOf("await page.goto(landingPath)");
    const forbiddenNavigation = source.indexOf("await page.goto(forbiddenPath)");
    const noticeAssertion = source.indexOf(
      'await expect(page.getByRole("status")).toHaveText',
    );

    expect(landingNavigation).toBeGreaterThan(-1);
    expect(forbiddenNavigation).toBeGreaterThan(landingNavigation);
    expect(noticeAssertion).toBeGreaterThan(forbiddenNavigation);
  });
});
