import { screen } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ActivitiesPage } from "@/features/activities/activities-page";

describe("ActivitiesPage", () => {
  it("renders the activity list and selected project detail", () => {
    render(<ActivitiesPage />);

    expect(screen.getByRole("heading", { name: "活动推进中心" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "活动列表" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "新产品发布活动", level: 2 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "阶段推进" })).toBeVisible();
    expect(screen.getByText("确认发布会主题与主叙事")).toBeVisible();
    expect(screen.getAllByText("策划").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("执行").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("推广").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("复盘").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("进行中").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("待开始").length).toBeGreaterThanOrEqual(1);
  });

  it("switches the detail context without leaving the page", async () => {
    const user = userEvent.setup();
    render(<ActivitiesPage />);

    await user.click(screen.getByRole("button", { name: "查看年度市场推广计划" }));

    expect(screen.getByRole("heading", { name: "年度市场推广计划", level: 2 })).toBeVisible();
    expect(screen.getByText("盘点下半年重点传播节点")).toBeVisible();
  });

  it("opens the calendar and creates an activity in the existing project model", async () => {
    const user = userEvent.setup();
    render(<ActivitiesPage />);

    await user.click(screen.getByRole("button", { name: "活动日历" }));
    expect(screen.getByRole("dialog", { name: "活动日历" })).toBeVisible();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "创建活动" }));
    await user.type(screen.getByLabelText("活动名称"), "客户开放日");
    await user.type(screen.getByLabelText("开始日期"), "2026-09-01");
    await user.type(screen.getByLabelText("截止日期"), "2026-09-30");
    await user.type(screen.getByLabelText("活动目标"), "完成客户邀约与现场执行");
    await user.click(screen.getByRole("button", { name: "创建活动" }));

    expect(screen.getByRole("heading", { name: "客户开放日", level: 2 })).toBeVisible();
    expect(screen.getByRole("button", { name: "查看客户开放日" })).toBeVisible();
  });
});
