import { screen } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspacePage } from "@/features/tasks/workspace-page";
import { workspaceMockResult } from "@/features/tasks/workspace-mock-data";

describe("WorkspacePage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the daily overview and all requested work sections", () => {
    render(<WorkspacePage result={workspaceMockResult} />);

    expect(screen.getByRole("heading", { name: "工作中心" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日工作概览" })).toBeVisible();
    expect(screen.getByText("今日任务")).toBeVisible();
    expect(screen.getByText("待审批")).toBeVisible();
    expect(screen.getByText("截止提醒")).toBeVisible();
    expect(screen.getByText("本周任务完成率")).toBeVisible();
    expect(screen.getByRole("heading", { name: "我的任务" })).toBeVisible();
    expect(screen.getByText("完善用户增长分析报告")).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日待办" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "工作日报" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "最近动态" })).toBeVisible();
  });

  it("filters tasks without leaving the workspace", async () => {
    const user = userEvent.setup();
    render(<WorkspacePage result={workspaceMockResult} />);

    await user.click(screen.getByRole("button", { name: "待完成" }));

    expect(screen.getByText("产品需求评审会")).toBeVisible();
    expect(screen.queryByText("修复数据看板展示问题")).not.toBeInTheDocument();
  });

  it("saves a report locally in demo mode and shows clear feedback", async () => {
    const user = userEvent.setup();
    render(<WorkspacePage result={workspaceMockResult} />);

    const completed = screen.getByLabelText("今日完成");
    await user.clear(completed);
    await user.type(completed, "完成工作中心页面框架");
    await user.click(screen.getByRole("button", { name: "保存日报" }));

    expect(await screen.findByRole("status")).toHaveTextContent("日报已保存");
  });

  it("opens a project task and updates a todo state", async () => {
    const user = userEvent.setup();
    render(<WorkspacePage result={workspaceMockResult} />);
    const task = workspaceMockResult.data.tasks[0];
    expect(screen.getByRole("link", { name: task.title })).toHaveAttribute("href", `/projects/${task.projectId}?tab=tasks&task=${task.id}`);
    const todo = workspaceMockResult.data.todos[0];
    const toggle = screen.getByRole("button", { name: `完成待办：${todo.title}` });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("submits a formal workspace report through the project report API", async () => {
    const user = userEvent.setup();
    const projectId = "a5000000-0000-4000-8000-000000000001";
    const fetch = vi.fn().mockResolvedValue(Response.json({ resource: "report", entity: {
      id: "a5000000-0000-4000-8000-000000000002", projectId,
      authorPublicId: "a5000000-0000-4000-8000-000000000003", reportDate: "2026-08-27",
      status: "submitted", summary: "完成真实联调", nextPlan: "执行验收", blockers: "",
      supportNeeded: "", version: 1, updatedAt: "2026-08-27T10:00:00.000Z",
    } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspacePage result={{
      source: "supabase",
      data: {
        viewerName: "周岚",
        overview: { todayTaskCount: 0, pendingApprovalCount: 0, deadlineReminderCount: 0, weeklyCompletionRate: 0 },
        tasks: [], todos: [], activities: [], projects: [{ id: projectId, name: "真实项目" }],
        dailyReport: { projectId, todayCompleted: "", blockers: "", tomorrowPlan: "" },
      },
    }} />);

    await user.type(screen.getByLabelText("今日完成"), "完成真实联调");
    await user.type(screen.getByLabelText("明日计划"), "执行验收");
    await user.click(screen.getByRole("button", { name: "提交日报" }));

    expect(await screen.findByRole("status")).toHaveTextContent("已提交并写入项目记录");
    expect(fetch).toHaveBeenCalledWith(`/api/workstation/projects/${projectId}/reports`, expect.objectContaining({ method: "POST" }));
  });

  it("restores today's submitted report and marks edits as pending", async () => {
    const user = userEvent.setup();
    const projectId = "a5000000-0000-4000-8000-000000000011";
    render(<WorkspacePage result={{
      source: "supabase",
      data: {
        viewerName: "周岚",
        overview: { todayTaskCount: 0, pendingApprovalCount: 0, deadlineReminderCount: 0, weeklyCompletionRate: 0 },
        tasks: [], todos: [], activities: [], projects: [{ id: projectId, name: "真实项目" }],
        dailyReport: { projectId, todayCompleted: "已完成联调", blockers: "", tomorrowPlan: "开始验收", submitted: true },
      },
    }} />);

    expect(screen.getByText("已提交")).toBeVisible();
    expect(screen.getByLabelText("今日完成")).toHaveValue("已完成联调");
    await user.type(screen.getByLabelText("遇到问题"), "等待确认");
    expect(screen.getByText("待提交")).toBeVisible();
  });

  it("announces formal report failures as errors rather than success", async () => {
    const user = userEvent.setup();
    const projectId = "a5000000-0000-4000-8000-000000000021";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 })));
    render(<WorkspacePage result={{
      source: "supabase",
      data: {
        viewerName: "周岚",
        overview: { todayTaskCount: 0, pendingApprovalCount: 0, deadlineReminderCount: 0, weeklyCompletionRate: 0 },
        tasks: [], todos: [], activities: [], projects: [{ id: projectId, name: "真实项目" }],
        dailyReport: { projectId, todayCompleted: "", blockers: "", tomorrowPlan: "" },
      },
    }} />);

    await user.type(screen.getByLabelText("今日完成"), "完成联调");
    await user.type(screen.getByLabelText("明日计划"), "继续验收");
    await user.click(screen.getByRole("button", { name: "提交日报" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("没有执行该操作的权限");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows unknown module state and blocks duplicate reports when optional reads fail", () => {
    const projectId = "a5000000-0000-4000-8000-000000000031";
    render(<WorkspacePage result={{
      source: "supabase",
      data: {
        viewerName: "周岚",
        overview: { todayTaskCount: 2, pendingApprovalCount: 0, deadlineReminderCount: 1, weeklyCompletionRate: 50 },
        tasks: [], todos: [], activities: [], projects: [{ id: projectId, name: "真实项目" }],
        dailyReport: { projectId, todayCompleted: "", blockers: "", tomorrowPlan: "", submitted: false },
        approvalLoadError: "待审批数据暂时不可用，请稍后刷新。",
        dailyReportLoadError: "今日日报状态暂时无法确认，请勿重复提交，稍后刷新核对。",
      },
    }} />);

    expect(screen.getByText("数据暂不可用")).toBeVisible();
    expect(screen.getByText("状态未知")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("请勿重复提交");
    expect(screen.getByRole("button", { name: "提交日报" })).toBeDisabled();
    expect(screen.getByLabelText("今日完成")).toBeDisabled();
  });

  it("renders every metric and report state as unknown when the core workspace load fails", () => {
    render(<WorkspacePage result={{
      source: "supabase",
      data: {
        viewerName: "当前用户",
        overview: { todayTaskCount: 0, pendingApprovalCount: 0, deadlineReminderCount: 0, weeklyCompletionRate: 0 },
        tasks: [], todos: [], activities: [], projects: [],
        dailyReport: { projectId: "", todayCompleted: "", blockers: "", tomorrowPlan: "", submitted: false },
        loadError: "工作数据加载失败，请稍后重试。",
        approvalLoadError: "工作数据加载失败，请稍后重试。",
        dailyReportLoadError: "今日日报状态暂时无法确认，请勿重复提交，稍后刷新核对。",
      },
    }} />);

    expect(screen.getAllByText("数据暂不可用")).toHaveLength(4);
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByText("状态未知")).toBeVisible();
    expect(screen.getByRole("button", { name: "提交日报" })).toBeDisabled();
  });
});
