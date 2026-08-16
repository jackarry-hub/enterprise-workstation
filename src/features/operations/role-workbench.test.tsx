import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { addOperationFile, resetOperationsState, saveOperationsState, updateOperationTask } from "@/features/operations/operations-data";
import { RoleWorkbench } from "@/features/operations/role-workbench";
import { dispatchAiPlanToOperations } from "@/features/ai-dispatch/dispatch-to-operations";
import { validDispatchPlan } from "@/test/ai-dispatch-test-utils";

describe("RoleWorkbench customer demo", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  const sessionFor = (personId: string) => customerDemoSessions.find(
    ({ identity }) => identity.providerSubject === `customer-demo:${personId}`,
  )!;

  function submitEmployeeTask() {
    const employeeSession = sessionFor("demo-engineer");
    const employeeContext = createOperationFixtureContext(employeeSession);
    const state = resetOperationsState(employeeContext);
    const task = state.tasks.find(({ id }) => id === "dept-task-engineer")!;
    saveOperationsState(employeeContext, {
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id
        ? { ...candidate, status: "in_progress" as const, progress: 50 }
        : candidate),
    });
    addOperationFile(employeeContext, {
      id: "role-workbench-review-file",
      commandId: task.commandId,
      entityType: "task",
      entityId: task.id,
      name: "验收记录.txt",
      mimeType: "text/plain",
      sizeBytes: 512,
      version: 1,
      uploadedById: "actor-employee",
      provider: "indexeddb",
      objectPath: "role-workbench-review-file",
      createdAt: "2026-08-12T09:00:00.000Z",
    });
    updateOperationTask(employeeContext, task.id, { status: "review" }, "actor-employee", employeeSession.actor);
    return task;
  }

  it("renders the same repository-backed action for department and AI tasks", async () => {
    const managerSession = sessionFor("demo-product-head");
    resetOperationsState(createOperationFixtureContext(managerSession));
    await dispatchAiPlanToOperations(
      createOperationFixtureContext(managerSession),
      validDispatchPlan,
      managerSession,
      { createId: () => "unified-action-task" },
    );
    const employeeSession = sessionFor("demo-engineer");

    render(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    expect(screen.getAllByRole("button", { name: /^领取任务：/ })).toHaveLength(2);
  });

  it("shows a recovery action when a deep-linked task is unavailable", async () => {
    window.history.replaceState(null, "", "/execution#task-not-available");
    const employeeSession = sessionFor("demo-engineer");

    render(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    expect(await screen.findByText("未找到指定任务")).toBeVisible();
    expect(screen.getByRole("link", { name: "返回任务列表" })).toHaveAttribute("href", "/tasks");
  });

  it("does not jump back to the first anchored task while working on a later task", async () => {
    const user = userEvent.setup();
    const employeeSession = sessionFor("demo-engineer");
    const employeeContext = createOperationFixtureContext(employeeSession);
    const state = resetOperationsState(employeeContext);
    const sourceTask = state.tasks.find(({ id }) => id === "dept-task-engineer")!;
    const firstTask = { ...sourceTask, id: "multi-task-first", code: "MULTI-01", title: "第一项执行任务", status: "accepted" as const, progress: 0 };
    const secondTask = { ...sourceTask, id: "multi-task-second", code: "MULTI-02", title: "第二项执行任务", status: "accepted" as const, progress: 0 };

    saveOperationsState(employeeContext, {
      ...state,
      tasks: state.tasks.flatMap((task) => task.id === sourceTask.id ? [firstTask, secondTask] : [task]),
    });
    window.history.replaceState(null, "", "/execution#task-multi-task-first");

    render(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    const firstTaskCard = screen.getByRole("heading", { name: "第一项执行任务" }).closest("article")!;
    const firstTaskScroll = vi.fn();
    Object.defineProperty(firstTaskCard, "scrollIntoView", { configurable: true, value: firstTaskScroll });
    const secondTaskCard = screen.getByRole("heading", { name: "第二项执行任务" }).closest("article")!;

    await user.click(within(secondTaskCard).getByRole("button", { name: "开始执行：第二项执行任务" }));

    expect(await within(secondTaskCard).findByText("进行中")).toBeVisible();
    expect(firstTaskScroll).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#task-multi-task-first");
  });

  it("moves to the exact task when the hash changes between two execution cards", async () => {
    const employeeSession = sessionFor("demo-engineer");
    const employeeContext = createOperationFixtureContext(employeeSession);
    const state = resetOperationsState(employeeContext);
    const sourceTask = state.tasks.find(({ id }) => id === "dept-task-engineer")!;
    const firstTask = { ...sourceTask, id: "hash-task-first", code: "HASH-01", title: "锚点任务一" };
    const secondTask = { ...sourceTask, id: "hash-task-second", code: "HASH-02", title: "锚点任务二" };

    saveOperationsState(employeeContext, {
      ...state,
      tasks: state.tasks.flatMap((task) => task.id === sourceTask.id ? [firstTask, secondTask] : [task]),
    });
    window.history.replaceState(null, "", "/execution#task-hash-task-first");

    render(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    const firstTaskCard = screen.getByRole("heading", { name: "锚点任务一" }).closest("article")!;
    const secondTaskCard = screen.getByRole("heading", { name: "锚点任务二" }).closest("article")!;
    const firstTaskScroll = vi.fn();
    const secondTaskScroll = vi.fn();
    Object.defineProperty(firstTaskCard, "scrollIntoView", { configurable: true, value: firstTaskScroll });
    Object.defineProperty(secondTaskCard, "scrollIntoView", { configurable: true, value: secondTaskScroll });

    window.history.replaceState(null, "", "/execution#task-hash-task-second");
    window.dispatchEvent(new Event("hashchange"));

    await waitFor(() => expect(secondTaskScroll).toHaveBeenCalledWith({ block: "center" }));
    expect(firstTaskScroll).not.toHaveBeenCalled();
    expect(secondTaskCard).toHaveFocus();
  });

  it("shows the executive assignee and makes the final submission step explicit", async () => {
    const user = userEvent.setup();
    const executiveSession = sessionFor("demo-executive");
    const executiveContext = createOperationFixtureContext(executiveSession);
    const state = resetOperationsState(executiveContext);
    saveOperationsState(executiveContext, {
      ...state,
      tasks: state.tasks.map((task) => task.id === "dept-task-executive"
        ? { ...task, status: "in_progress" as const, progress: 80 }
        : task),
    });

    render(
      <WorkspaceSessionProvider session={executiveSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    const task = screen.getByRole("heading", { name: "确认官网升级经营目标" }).closest("article")!;
    expect(within(task).queryByRole("combobox", { name: "确认官网升级经营目标执行人" })).not.toBeInTheDocument();
    expect(within(task).getByText("林远 · CEO")).toBeVisible();
    expect(within(task).getByText("当前部门暂无其他可选执行人")).toBeVisible();

    await user.click(within(task).getByRole("tab", { name: "任务说明" }));
    expect(within(task).getByText("下一步：提交成果并申请验收")).toBeVisible();
    await user.click(within(task).getByRole("button", { name: "提交成果并申请验收" }));

    expect(within(task).getByRole("tab", { name: "成果提交" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(within(task).getByRole("region", { name: "成果提交区" })).toHaveFocus());
    expect(within(task).getByText("最后一步")).toBeVisible();
    expect(within(task).getByRole("button", { name: "提交验收" })).toBeDisabled();

    await user.type(within(task).getByRole("textbox", { name: "成果说明" }), "经营目标和最终验收口径已确认。");
    expect(within(task).getByRole("button", { name: "提交验收" })).toBeEnabled();
  });

  it("attaches the built-in deliverable and submits the employee task for review", async () => {
    const user = userEvent.setup();
    const employeeSession = customerDemoSessions.find(
      ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
    )!;
    render(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    expect(screen.queryByRole("button", { name: "重置本地试用数据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "最近流转" })).not.toBeInTheDocument();
    const mobileTask = screen.getByRole("heading", { name: "实现官网核心页面" }).closest("article")!;
    for (const tab of ["任务说明", "成果提交", "沟通验收"]) {
      expect(within(mobileTask).getByRole("tab", { name: tab })).toBeVisible();
    }
    await user.click(screen.getByRole("button", { name: "领取任务：实现官网核心页面" }));
    await user.click(screen.getByRole("button", { name: "开始执行：实现官网核心页面" }));
    expect(screen.getByText("演示快捷操作：自动添加一份可验收的示例成果，也可以使用左侧真实上传入口。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "使用演示成果" }));

    expect(await screen.findByText("星云智造-量子智枢试点验收记录.txt")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "成果说明" }), "官网核心页面已经实现并完成自测。");
    await user.click(screen.getByRole("button", { name: "提交验收" }));
    expect(await screen.findByText("待验收")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("成果已提交给张伟验收");
    const submittedTask = screen.getByRole("heading", { name: "实现官网核心页面" }).closest("article")!;
    expect(within(submittedTask).getByText("任务闭环进度")).toBeVisible();
    expect(within(submittedTask).getByText("你已完成个人提交，当前由张伟验收；通过后进度会自动到 100%。")).toBeVisible();
  });

  it("guides the manager to enter a sample comment and links the inbox directly to the review task", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/department");
    submitEmployeeTask();
    const managerSession = sessionFor("demo-product-head");
    render(
      <WorkspaceSessionProvider session={managerSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="department_head" />
      </WorkspaceSessionProvider>,
    );

    const reviewAction = screen.getByRole("heading", { name: "验收：实现官网核心页面" }).closest("article")!;
    const reviewLink = within(reviewAction).getByRole("link", { name: "处理：验收：实现官网核心页面" });
    expect(reviewLink).toHaveAttribute("href", "/department#review-dept-task-engineer");
    const actionList = screen.getByRole("list", { name: "岗位行动列表" });
    expect(within(actionList).getAllByTestId("operation-action-item").length).toBeLessThanOrEqual(4);
    expect(within(actionList).getByRole("link", { name: "处理：验收：实现官网核心页面" })).toBeVisible();
    expect(reviewLink).toContainElement(within(reviewAction).getByRole("heading", { name: "验收：实现官网核心页面" }));
    const reviewTask = screen.getByRole("heading", { name: "实现官网核心页面" }).closest("article");
    expect(reviewTask).toHaveAttribute("id", "task-dept-task-engineer");
    expect(within(reviewTask!).getByRole("button", { name: "通过验收" })).toBeVisible();
    const reviewStep = document.getElementById("review-dept-task-engineer");
    expect(reviewStep).toContainElement(within(reviewTask!).getByRole("button", { name: "通过验收" }));
    const scrollIntoView = vi.fn();
    Object.defineProperty(reviewStep!, "scrollIntoView", { value: scrollIntoView });
    await user.click(reviewLink);
    expect(window.location.hash).toBe("#review-dept-task-engineer");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(screen.getByRole("textbox", { name: "进度、阻塞或验收意见" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "通过验收" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "退回修改" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "填入退回示例" }));
    expect(screen.getByRole("textbox", { name: "进度、阻塞或验收意见" })).toHaveValue("请补充角色切换说明和验收步骤截图后重新提交。");
    expect(screen.getByRole("button", { name: "退回修改" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "退回修改" }));
    expect(await screen.findByText("成果已退回陈晨修改，返工事项已同步到他的执行台")).toBeVisible();
  });

  it("shows a returned task as employee attention and keeps the direct task anchor", async () => {
    const task = submitEmployeeTask();
    const managerSession = sessionFor("demo-product-head");
    updateOperationTask(
      createOperationFixtureContext(managerSession),
      task.id,
      { status: "in_progress", reviewNote: "请补充流程截图", progress: 70 },
      "actor-manager",
      managerSession.actor,
    );
    const employeeSession = sessionFor("demo-engineer");
    render(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    expect(screen.getByText("需要关注").parentElement).toHaveTextContent("1 项");
    expect(screen.getByRole("link", { name: "处理：返工：实现官网核心页面" })).toHaveAttribute("href", "/execution#task-dept-task-engineer");
    const taskArticle = screen.getByRole("heading", { name: "实现官网核心页面" }).closest("article");
    expect(taskArticle).toHaveAttribute("id", "task-dept-task-engineer");
    expect(screen.getByText("补充说明后重新提交，完成后将再次通知张伟验收。")).toBeVisible();
  });

  it("lets finance start and submit its own task without waiting for another person", () => {
    const financeSession = sessionFor("demo-finance");
    const financeContext = createOperationFixtureContext(financeSession);
    const state = resetOperationsState(financeContext);
    saveOperationsState(financeContext, {
      ...state,
      tasks: state.tasks.map((task) => {
        if (task.id === "dept-task-finance") return { ...task, status: "accepted" as const, progress: 0 };
        return task;
      }),
    });

    render(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="finance" />
      </WorkspaceSessionProvider>,
    );

    const financeTask = screen.getByRole("heading", { name: "完成月度薪资核算" }).closest("article")!;
    expect(within(financeTask).getByRole("button", { name: "开始执行：完成月度薪资核算" })).toBeEnabled();
    expect(within(financeTask).queryByText(/等待前置任务|前置任务/)).not.toBeInTheDocument();
  });

  it("keeps role workbenches focused by hiding the generic recent activity feed", () => {
    const financeSession = sessionFor("demo-finance");
    render(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="finance" />
      </WorkspaceSessionProvider>,
    );

    const shortcuts = screen.getByRole("heading", { name: "常用入口" }).closest("div[data-slot='glass-card']") as HTMLElement;
    const taskRegion = screen.getByRole("region", { name: "我的执行任务" });
    expect(shortcuts.compareDocumentPosition(taskRegion) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(within(shortcuts).getByRole("link", { name: "薪资核算与发放" })).toHaveAttribute("href", "/payroll#payroll-control");
    expect(screen.queryByRole("heading", { name: "最近流转" })).not.toBeInTheDocument();
  });

  it("puts the next unfinished task first and exposes its start action in the card header", async () => {
    const user = userEvent.setup();
    const managerSession = sessionFor("demo-product-head");
    const managerContext = createOperationFixtureContext(managerSession);
    const state = resetOperationsState(managerContext);
    const activeTask = state.tasks.find(({ id }) => id === "dept-task-product-head")!;
    const completedTask = {
      ...activeTask,
      id: "dept-task-product-head-completed",
      code: "DEPT-DONE",
      title: "已完成的交付复盘",
      status: "done" as const,
      progress: 100,
    };
    saveOperationsState(managerContext, {
      ...state,
      tasks: [
        ...state.tasks.map((task) => task.id === activeTask.id
          ? { ...task, status: "accepted" as const, progress: 10 }
          : task),
        completedTask,
      ],
    });

    render(
      <WorkspaceSessionProvider session={managerSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="department_head" />
      </WorkspaceSessionProvider>,
    );

    const nextHeading = screen.getByRole("heading", { name: "制定官网升级交付方案" });
    const completedHeading = screen.getByRole("heading", { name: "已完成的交付复盘" });
    expect(nextHeading.compareDocumentPosition(completedHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    const nextTask = nextHeading.closest("article")!;
    await user.click(within(nextTask).getByRole("button", { name: "开始执行：制定官网升级交付方案" }));
    expect(await within(nextTask).findByText("进行中")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("任务已开始执行");
  });

  it("keeps a department head's own execution tasks separate from employee review work", () => {
    const managerSession = sessionFor("demo-product-head");
    const managerContext = createOperationFixtureContext(managerSession);
    const state = resetOperationsState(managerContext);
    saveOperationsState(managerContext, {
      ...state,
      tasks: state.tasks.map((task) => task.id === "dept-task-engineer"
        ? { ...task, status: "review" as const, progress: 90 }
        : task),
      files: [{
        id: "employee-review-proof",
        commandId: state.command.id,
        entityType: "task",
        entityId: "dept-task-engineer",
        name: "员工成果.txt",
        mimeType: "text/plain",
        sizeBytes: 256,
        version: 1,
        uploadedById: "actor-employee",
        provider: "indexeddb",
        objectPath: "employee-review-proof",
        createdAt: "2026-08-12T09:00:00.000Z",
      }],
    });

    render(
      <WorkspaceSessionProvider session={managerSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="department_head" />
      </WorkspaceSessionProvider>,
    );

    const execution = screen.getByRole("region", { name: "我的执行任务" });
    expect(within(execution).getByRole("heading", { name: "制定官网升级交付方案" })).toBeVisible();
    expect(within(execution).queryByRole("heading", { name: "实现官网核心页面" })).not.toBeInTheDocument();

    const reviews = screen.getByRole("region", { name: "我负责验收" });
    expect(within(reviews).getByRole("heading", { name: "实现官网核心页面" })).toBeVisible();
  });

  it("lets an employee accept a runtime AI task, update progress, and submit structured results", async () => {
    const user = userEvent.setup();
    const managerSession = sessionFor("demo-product-head");
    await dispatchAiPlanToOperations(
      createOperationFixtureContext(managerSession),
      validDispatchPlan,
      managerSession,
      { createId: () => "role-runtime-task" },
    );
    const employeeSession = sessionFor("demo-engineer");
    render(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    const card = screen.getByRole("heading", { name: "完成移动端开发" }).closest("article")!;
    await user.click(within(card).getByRole("button", { name: "领取任务：完成移动端开发" }));
    expect(await within(card).findByText("已接受")).toBeVisible();
    await user.click(within(card).getByRole("button", { name: "开始执行：完成移动端开发" }));
    expect(await within(card).findByText("进行中")).toBeVisible();

    await user.click(within(card).getByRole("button", { name: "更新进度 50%" }));
    expect(await within(card).findByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    await user.type(within(card).getByRole("textbox", { name: "成果说明" }), "移动端核心页面和身份切换已经完成。");
    await user.type(within(card).getByRole("textbox", { name: "成果链接" }), "https://demo.example.test/mobile");
    await user.type(within(card).getByRole("textbox", { name: "模拟附件名" }), "mobile-checklist.pdf");
    await user.type(within(card).getByRole("textbox", { name: "成果备注" }), "请检查390px宽度。\n");
    await user.click(within(card).getByRole("button", { name: "提交验收" }));

    expect(await within(card).findByText("待验收")).toBeVisible();
    expect(within(card).getByText("移动端核心页面和身份切换已经完成。")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("成果已提交给张伟验收");
  });
});
