import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { createInitialOperationsState, readOperationsState, saveOperationsState } from "@/features/operations/operations-data";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";
import { validDispatchPlan } from "@/test/ai-dispatch-test-utils";
import { validExecutionSummary } from "@/features/ai-dispatch/summary-contract.test";
import { dispatchAiPlanToOperations } from "@/features/ai-dispatch/dispatch-to-operations";

const executive = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-executive",
)!;
const departmentHead = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
)!;
const employee = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
)!;

describe("DashboardPage", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("resets only the active AI dispatch and keeps department progress", async () => {
    const user = userEvent.setup();
    const context = createOperationFixtureContext(departmentHead);
    const initial = createInitialOperationsState(context);
    const departmentTask = initial.tasks.find(({ runtimeSource }) => runtimeSource === "department_mock")!;
    saveOperationsState(context, {
      ...initial,
      tasks: initial.tasks.map((task) => task.id === departmentTask.id
        ? { ...task, progress: 50 }
        : task),
    });
    await dispatchAiPlanToOperations(context, validDispatchPlan, departmentHead, {
      createId: () => "dashboard-reset",
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);
    await user.click(screen.getByRole("button", { name: "重置本次 AI 调度" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("部门任务与部门进度会保留"));
    expect(await screen.findByText("本次 AI 调度已重置，部门任务进度已保留")).toBeVisible();
    const after = readOperationsState(context);
    expect(after.tasks.find(({ id }) => id === departmentTask.id)?.progress).toBe(50);
    expect(after.tasks.some(({ runtimeSource }) => runtimeSource === "ai_dispatch")).toBe(false);
    expect(after.activeAiWorkstreamId).toBeUndefined();
  });

  it("shows 100% runtime progress, saves the real AI summary, and archives it", async () => {
    const user = userEvent.setup();
    const context = createOperationFixtureContext(departmentHead);
    const initial = createInitialOperationsState(context);
    const workstreamId = "ai-workstream-ui-summary";
    const projectId = "ai-project-ui-summary";
    const baseTask = initial.tasks.find(({ assigneeId }) => assigneeId === context.actor!.id)!;
    saveOperationsState(context, {
      ...initial,
      activeAiWorkstreamId: workstreamId,
      workstreams: [...initial.workstreams, {
        id: workstreamId,
        source: "ai_dispatch",
        title: "完成移动端 V1",
        ownerId: context.actor!.id,
        projectId,
        status: "completed",
        createdAt: "2026-08-14T09:00:00.000Z",
        updatedAt: "2026-08-14T10:00:00.000Z",
      }],
      command: {
        ...initial.command,
        id: "ai-command-ui-summary",
        ownerId: context.actor!.id,
        title: "完成移动端 V1",
        status: "accepted",
        projectId,
      },
      tasks: [...initial.tasks, {
        ...baseTask,
        id: "ai-task-ui-summary",
        commandId: "ai-command-ui-summary",
        workstreamId,
        projectId,
        status: "done" as const,
        progress: 100,
        runtimeSource: "ai_dispatch" as const,
        submission: { description: "移动端成果已提交", submittedAt: "2026-08-14T10:00:00.000Z" },
        reviewComment: "验收通过",
        rejectionCount: 1,
      }],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      summary: validExecutionSummary,
      model: "deepseek-v4-flash",
      repaired: false,
      mode: "demo",
    }), { status: 200, headers: { "content-type": "application/json" } })));

    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);
    expect(screen.getByText("当前调度进度")).toBeVisible();
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "生成 AI 执行总结" }));
    expect(await screen.findByText(validExecutionSummary.completion)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "归档本次调度" }));

    expect(await screen.findByText("本次 AI 调度已归档")).toBeVisible();
    expect(readOperationsState(context).dispatchHistory).toHaveLength(1);
  });

  it("filters current dispatch tasks by interactive progress stage", async () => {
    const user = userEvent.setup();
    const context = createOperationFixtureContext(departmentHead);
    const initial = createInitialOperationsState(context);
    const statuses = ["assigned", "in_progress", "review", "done"] as const;
    const workstreamId = "ai-workstream-progress-filter";
    const projectId = "ai-project-progress-filter";
    saveOperationsState(context, {
      ...initial,
      activeAiWorkstreamId: workstreamId,
      workstreams: [...initial.workstreams, {
        id: workstreamId,
        source: "ai_dispatch",
        title: "完成移动端七页升级",
        ownerId: context.actor!.id,
        projectId,
        status: "active",
        createdAt: "2026-08-14T09:00:00.000Z",
        updatedAt: "2026-08-14T09:00:00.000Z",
      }],
      command: {
        ...initial.command,
        id: "ai-command-progress-filter",
        ownerId: context.actor!.id,
        title: "完成移动端七页升级",
        status: "executing",
        projectId,
      },
      tasks: [...initial.tasks, ...statuses.map((status, index) => ({
        ...initial.tasks[index],
        id: `progress-filter-${status}`,
        title: ["梳理移动范围", "开发移动首页", "验收任务详情", "完成移动导航"][index],
        commandId: "ai-command-progress-filter",
        workstreamId,
        projectId,
        runtimeSource: "ai_dispatch" as const,
        status,
        progress: [0, 50, 90, 100][index],
      }))],
    });

    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);

    expect(screen.getByRole("button", { name: "未开始 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "已开始 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "待验收 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "已完成 1" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "去验收：验收任务详情" })).toHaveAttribute(
      "href",
      "/department#review-progress-filter-review",
    );
    expect(screen.getByText("所有子任务通过验收后，生成执行总结并完成归档；该待办会自动关闭。")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "已开始 1" }));
    const detail = screen.getByRole("region", { name: "调度任务明细" });
    expect(within(detail).getByText("开发移动首页")).toBeVisible();
    expect(within(detail).getByText("50%")).toBeVisible();
    expect(within(detail).queryByText("梳理移动范围")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已开始 1" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "已开始 1" }));
    expect(screen.queryByRole("region", { name: "调度任务明细" })).not.toBeInTheDocument();
  });

  it("renders one role-aware workbench without traditional attendance content", () => {
    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);

    expect(screen.getByRole("heading", { name: "量子智枢 · 我的工作台" })).toBeVisible();
    expect(screen.getByText("张伟")).toBeVisible();
    expect(screen.getByText("产品技术总监 · 产品研发中心")).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日待办" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "AI决策调度台" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看全部任务" })).toHaveAttribute("href", "/tasks");
    expect(screen.queryByText(/打卡|迟到|早退|考勤统计/)).not.toBeInTheDocument();
  });

  it("hides the AI decision console from employees and keeps their dashboard personal", () => {
    renderWithSpecificWorkspaceSession(<DashboardPage />, employee);

    expect(screen.queryByRole("heading", { name: "AI决策调度台" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("告诉AI企业大脑，你今天想推进什么……")).not.toBeInTheDocument();
    const myTasks = screen.getByRole("heading", { name: "我的任务" }).closest("section")!;
    expect(within(myTasks).getByText("实现官网核心页面")).toBeVisible();
    expect(within(myTasks).getByRole("link", { name: /实现官网核心页面/ })).toHaveAttribute(
      "href",
      "/execution#task-dept-task-engineer",
    );
    expect(within(myTasks).queryByText("确认试点范围与成功标准")).not.toBeInTheDocument();
    expect(within(myTasks).queryByText("完成关键流程回归测试")).not.toBeInTheDocument();
  });

  it("dispatches a confirmed DeepSeek plan to each assignee workbench", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      plan: validDispatchPlan,
      model: "deepseek-v4-flash",
      repaired: false,
      mode: "demo",
    }), { status: 200, headers: { "content-type": "application/json" } })));
    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);

    const input = screen.getByPlaceholderText("告诉AI企业大脑，你今天想推进什么……");
    await user.type(input, "3天内完成AI企业大脑移动端V1。");
    await user.click(screen.getByRole("button", { name: "AI分析并生成调度方案" }));

    const dialog = await screen.findByRole("dialog", undefined, { timeout: 2_500 });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("heading", { name: "AI调度方案" })).toBeVisible();
    expect(within(dialog).getByText(validDispatchPlan.goal)).toBeVisible();
    expect(within(dialog).getByText("3天", { exact: true })).toBeVisible();
    expect(within(dialog).getByText("3人", { exact: true })).toBeVisible();
    expect(within(dialog).getByText("3项", { exact: true })).toBeVisible();
    expect(within(dialog).getByText("中", { exact: true })).toBeVisible();
    expect(within(dialog).getByText("完成移动端开发")).toBeVisible();
    expect(within(dialog).getByText("陈晨 · 前端工程师")).toBeVisible();
    expect(within(dialog).getByText("具备前端开发与系统联调能力。")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "确认并下发" }));
    expect(await screen.findByText("已下发 3 项任务至 3 人")).toBeVisible();
    expect(screen.getByText("DEMO MODE")).toBeVisible();
    const myTasks = screen.getByRole("heading", { name: "我的任务" }).closest("section")!;
    expect(within(myTasks).getByText("确认移动端范围")).toBeVisible();
    expect(within(myTasks).getAllByText(/新任务/).length).toBeGreaterThanOrEqual(2);

    const state = readOperationsState(createOperationFixtureContext(departmentHead));
    expect(state.command).toMatchObject({
      title: validDispatchPlan.goal,
      ownerId: "actor-manager",
      status: "executing",
    });
    const aiTasks = state.tasks.filter(({ workstreamId }) => workstreamId === state.activeAiWorkstreamId);
    expect(state.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock")).toHaveLength(10);
    expect(aiTasks).toHaveLength(3);
    expect(aiTasks.map(({ assigneeId }) => assigneeId)).toEqual([
      "actor-manager",
      "actor-employee",
      "actor-qa",
    ]);
    expect(aiTasks.every(({ status, progress }) => status === "assigned" && progress === 0)).toBe(true);
  });

  it("generates the GitHub Pages dispatch plan entirely in the browser", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubEnv("NEXT_PUBLIC_STATIC_AI_DEMO", "true");
    vi.stubGlobal("fetch", fetchMock);
    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);

    expect(screen.getByText("本地演示 AI")).toBeVisible();
    await user.type(screen.getByPlaceholderText("告诉AI企业大脑，你今天想推进什么……"), "一周内完成官网升级");
    await user.click(screen.getByRole("button", { name: "AI分析并生成调度方案" }));

    const dialog = await screen.findByRole("dialog", undefined, { timeout: 2_500 });
    expect(within(dialog).getByText(/浏览器内置演示规则/)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows all analysis stages while DeepSeek is working without claiming completion", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);

    await user.type(screen.getByPlaceholderText("告诉AI企业大脑，你今天想推进什么……"), "安排团队完成本周客户交付");
    await user.click(screen.getByRole("button", { name: "AI分析并生成调度方案" }));

    for (const stage of ["正在理解目标", "正在分析团队能力", "正在拆解任务", "正在评估工作负荷", "正在生成调度方案"]) {
      expect(screen.getByText(stage)).toBeVisible();
    }
    expect(screen.getByText("以上步骤表示DeepSeek正在处理的分析范围，不代表已提前完成。" )).toBeVisible();

    resolveFetch(new Response(JSON.stringify({ plan: validDispatchPlan, model: "deepseek-v4-flash", repaired: false, mode: "demo" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    expect(await screen.findByRole("heading", { name: "AI调度方案" })).toBeVisible();
  });

  it("keeps four demo prompts and provides a retryable friendly error", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "ai_unavailable", message: "AI调度服务暂时不可用，请稍后重试。" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ plan: validDispatchPlan, model: "deepseek-v4-flash", repaired: false, mode: "demo" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithSpecificWorkspaceSession(<DashboardPage />, departmentHead);

    for (const prompt of ["3天内完成移动端V1", "为客户官网升级项目制定一周执行计划", "安排团队完成本周客户交付", "分析当前团队任务并重新分配优先级"]) {
      expect(screen.getByRole("button", { name: prompt })).toBeVisible();
    }
    await user.click(screen.getByRole("button", { name: "3天内完成移动端V1" }));
    await user.click(screen.getByRole("button", { name: "AI分析并生成调度方案" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI调度服务暂时不可用，请稍后重试。");

    await user.click(screen.getByRole("button", { name: "重新生成" }));
    expect(await screen.findByRole("heading", { name: "AI调度方案" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a real profile avatar first and an AI demo portrait as fallback", () => {
    const { unmount } = renderWithSpecificWorkspaceSession(<DashboardPage />, executive);
    expect(screen.getByTestId("dashboard-identity-avatar")).toHaveAttribute("data-avatar-source", "mock");
    expect(screen.getByRole("img", { name: "林远的AI演示头像" })).toHaveStyle({
      backgroundImage: expect.stringMatching(/demo-avatar-sprite-v1/),
    });
    unmount();

    renderWithSpecificWorkspaceSession(
      <DashboardPage />,
      { ...executive, profile: { ...executive.profile, avatarUrl: "https://cdn.example.test/real-avatar.png" } },
    );
    expect(screen.getByTestId("dashboard-identity-avatar")).toHaveAttribute("data-avatar-source", "real");
    expect(screen.getByRole("img", { name: "林远的头像" })).toHaveAttribute(
      "src",
      "https://cdn.example.test/real-avatar.png",
    );
  });
});
