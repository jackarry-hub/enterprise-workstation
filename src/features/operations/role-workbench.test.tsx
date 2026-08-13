import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { addOperationFile, resetOperationsState, saveOperationsState, updateOperationTask } from "@/features/operations/operations-data";
import { RoleWorkbench } from "@/features/operations/role-workbench";

describe("RoleWorkbench customer demo", () => {
  beforeEach(() => window.localStorage.clear());

  const sessionFor = (personId: string) => customerDemoSessions.find(
    ({ identity }) => identity.providerSubject === `customer-demo:${personId}`,
  )!;

  function submitEmployeeTask() {
    const executiveSession = sessionFor("demo-executive");
    const employeeSession = sessionFor("demo-engineer");
    const employeeContext = createOperationFixtureContext(employeeSession);
    const task = resetOperationsState(createOperationFixtureContext(executiveSession)).tasks.find(({ id }) => id === "flow-task-02")!;
    updateOperationTask(employeeContext, task.id, { status: "in_progress" }, "actor-employee", employeeSession.actor);
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
    await user.click(screen.getByRole("button", { name: "开始执行：实现目标拆解与责任映射" }));
    expect(screen.getByText("演示快捷操作：自动添加一份可验收的示例成果，也可以使用左侧真实上传入口。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "使用演示成果" }));

    expect(await screen.findByText("星云智造-AI工作站试点验收记录.txt")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "提交验收" }));
    expect(await screen.findByText("待验收")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("成果已提交给负责人验收");
    const submittedTask = screen.getByRole("heading", { name: "实现目标拆解与责任映射" }).closest("article")!;
    expect(within(submittedTask).getByText("任务闭环进度")).toBeVisible();
    expect(within(submittedTask).getByText("你已完成个人提交，当前由张伟验收；通过后进度会自动到 100%。")).toBeVisible();
  });

  it("guides the manager to enter a sample comment and links the inbox directly to the review task", async () => {
    const user = userEvent.setup();
    submitEmployeeTask();
    const managerSession = sessionFor("demo-product-head");
    render(
      <WorkspaceSessionProvider session={managerSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="department_head" />
      </WorkspaceSessionProvider>,
    );

    const reviewAction = screen.getByRole("heading", { name: "验收：实现目标拆解与责任映射" }).closest("article")!;
    const reviewLink = within(reviewAction).getByRole("link", { name: "处理：验收：实现目标拆解与责任映射" });
    expect(reviewLink).toHaveAttribute("href", "/department#task-flow-task-02");
    const actionList = screen.getByRole("list", { name: "岗位行动列表" });
    expect(within(actionList).getAllByTestId("operation-action-item").length).toBeLessThanOrEqual(4);
    expect(within(actionList).getByRole("link", { name: "处理：验收：实现目标拆解与责任映射" })).toBeVisible();
    expect(reviewLink).toContainElement(within(reviewAction).getByRole("heading", { name: "验收：实现目标拆解与责任映射" }));
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
    expect(screen.getByRole("link", { name: "处理：返工：实现目标拆解与责任映射" })).toHaveAttribute("href", "/execution#task-flow-task-02");
    const taskArticle = screen.getByRole("heading", { name: "实现目标拆解与责任映射" }).closest("article");
    expect(taskArticle).toHaveAttribute("id", "task-flow-task-02");
    expect(screen.getByText("补充说明后重新提交，完成后将再次通知张伟验收。")).toBeVisible();
  });

  it("lets finance start and submit its own task without waiting for another person", () => {
    const financeSession = sessionFor("demo-finance");
    const financeContext = createOperationFixtureContext(financeSession);
    const state = resetOperationsState(financeContext);
    saveOperationsState(financeContext, {
      ...state,
      tasks: state.tasks.map((task) => {
        if (task.id === "flow-task-01") return { ...task, status: "in_progress" as const, progress: 90 };
        if (task.id === "flow-task-06") return { ...task, status: "todo" as const, progress: 0 };
        return task;
      }),
    });

    render(
      <WorkspaceSessionProvider session={financeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="finance" />
      </WorkspaceSessionProvider>,
    );

    const financeTask = screen.getByRole("heading", { name: "完成试点预算审核与付款" }).closest("article")!;
    expect(within(financeTask).getByRole("button", { name: "开始执行：完成试点预算审核与付款" })).toBeEnabled();
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
    saveOperationsState(managerContext, {
      ...state,
      tasks: state.tasks.map((task) => task.id === "flow-task-10"
        ? { ...task, assigneeId: "actor-manager", status: "todo" as const, progress: 0 }
        : { ...task, status: "done" as const, progress: 100 }),
    });

    render(
      <WorkspaceSessionProvider session={managerSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="department_head" />
      </WorkspaceSessionProvider>,
    );

    const nextHeading = screen.getByRole("heading", { name: "完成关键流程回归测试" });
    const completedHeading = screen.getByRole("heading", { name: "确认试点范围与成功标准" });
    expect(nextHeading.compareDocumentPosition(completedHeading) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    const nextTask = nextHeading.closest("article")!;
    await user.click(within(nextTask).getByRole("button", { name: "开始执行：完成关键流程回归测试" }));
    expect(await within(nextTask).findByText("进行中")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("任务已开始执行");
  });

  it("keeps a department head's own execution tasks separate from employee review work", () => {
    const managerSession = sessionFor("demo-product-head");
    const managerContext = createOperationFixtureContext(managerSession);
    const state = resetOperationsState(managerContext);
    saveOperationsState(managerContext, {
      ...state,
      tasks: state.tasks.map((task) => task.id === "flow-task-02"
        ? { ...task, status: "review" as const, progress: 90 }
        : task),
      files: [{
        id: "employee-review-proof",
        commandId: state.command.id,
        entityType: "task",
        entityId: "flow-task-02",
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
    expect(within(execution).getByRole("heading", { name: "确认试点范围与成功标准" })).toBeVisible();
    expect(within(execution).queryByRole("heading", { name: "实现目标拆解与责任映射" })).not.toBeInTheDocument();

    const reviews = screen.getByRole("region", { name: "我负责验收" });
    expect(within(reviews).getByRole("heading", { name: "实现目标拆解与责任映射" })).toBeVisible();
  });
});
