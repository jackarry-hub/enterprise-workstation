import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskCenterPage } from "@/features/tasks/task-center-page";

describe("TaskCenterPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the approved task center structure", () => {
    render(<TaskCenterPage />);

    expect(screen.getByRole("heading", { name: "任务管理" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "搜索任务或项目" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日待办" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "我的任务" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "快捷筛选" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "团队协作" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "日程安排" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "最近动态" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /全部任务/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /待开始/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /进行中/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /已完成/ })).toBeVisible();
  });

  it("filters tasks and resets an empty result", async () => {
    const user = userEvent.setup();
    render(<TaskCenterPage />);

    const search = screen.getByRole("searchbox", { name: "搜索任务或项目" });
    await user.type(search, "不存在的任务");

    expect(screen.getByText("没有找到匹配的任务")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.queryByText("没有找到匹配的任务")).not.toBeInTheDocument();
  });

  it("opens task detail and routes status work to the authorized workspace", async () => {
    const user = userEvent.setup();
    render(<TaskCenterPage />);

    await user.click(screen.getAllByRole("button", { name: /查看任务详情/ })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("负责人")).toBeVisible();
    expect(within(dialog).getByText("所属项目")).toBeVisible();

    expect(within(dialog).queryByRole("button", { name: "标记为已完成" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "返回领导调度台" })).toHaveAttribute("href", "/dashboard");
    expect(window.localStorage.getItem("enterprise-workspace.projects.v1")).toBeNull();
  });
});
