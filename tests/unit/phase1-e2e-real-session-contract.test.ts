import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function e2e(name: string) {
  return readFileSync(resolve("tests/e2e", name), "utf8");
}

describe("Phase 1 real-session E2E contract", () => {
  it.each([
    ["payroll.spec.ts", "当前账号没有可显示的真实薪资数据。"],
    ["interaction-audit.spec.ts", "当前账号没有可显示的真实活动数据。"],
  ])("expects a truthful fail-closed state in %s", (file, message) => {
    expect(e2e(file)).toContain(message);
  });

  it("keeps approval E2E on real data while excluding bundled fixture records", () => {
    const source = e2e("approvals.spec.ts");

    expect(source).toContain("真实审批模式");
    expect(source).toContain("EXP-20260804-002");
    expect(source).toContain("toHaveCount(0)");
    expect(source).not.toContain("page.route(");
  });

  it("expects people.spec.ts to exercise the real safe directory without fixture or PII fallbacks", () => {
    const source = e2e("people.spec.ts");

    expect(source).toContain("ordinary employee reads the server directory");
    expect(source).toContain("ordinary employee sees only a safe peer detail on mobile");
    expect(source).toContain("getByText(executive.email)).toHaveCount(0)");
    expect(source).not.toContain("当前账号没有可显示的真实员工数据。");
    expect(source).not.toContain("page.route(");
  });

  it("keeps the project closure suite on real commands without browser fixtures", () => {
    const source = e2e("projects-closure.spec.ts");

    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("setInputFiles");
    expect(source).toContain("authorized user creates a real project that survives refresh");
    expect(source).toContain("创建项目");
    expect(source).toContain("page.reload");
    expect(source).toContain("未找到项目");
  });

  it("requires the task and report chain to survive refresh on desktop and mobile", () => {
    const source = e2e("task-workflow.spec.ts");

    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("page.route(");
    expect(source).toContain("刷新后项目详情和任务中心均可查询");
    expect(source).toContain("日报已提交并写入项目动态");
    expect(source).toContain("width: 390");
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
