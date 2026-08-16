import { describe, expect, it } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { buildDashboardViewModel } from "@/features/dashboard/dashboard-view-model";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { createInitialOperationsState } from "@/features/operations/operations-data";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";

const engineerSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
)!;
const managerSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
)!;
const executiveSession = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-executive",
)!;

function engineerFixture() {
  const context = createOperationFixtureContext(engineerSession);
  const actor = context.actor!;
  const initial = createInitialOperationsState(context);
  return { context, actor, initial };
}

describe("buildDashboardViewModel", () => {
  it("shows the dispatch owner a management item without mixing in assignee tasks", () => {
    const context = createOperationFixtureContext(executiveSession);
    const actor = context.actor!;
    const initial = createInitialOperationsState(context);
    const runtime = {
      ...initial,
      command: {
        ...initial.command,
        id: "ai-command-owner-overview",
        ownerId: actor.id,
        title: "一个月内完成玄学网并上线",
        status: "executing" as const,
      },
      tasks: initial.tasks.slice(0, 2).map((task, index) => ({
        ...task,
        id: `runtime-assignee-${index}`,
        commandId: "ai-command-owner-overview",
        assigneeId: index === 0 ? "actor-manager" : "actor-employee",
        runtimeSource: "ai_dispatch" as const,
        status: index === 0 ? "done" as const : "in_progress" as const,
        progress: index === 0 ? 100 : 50,
      })),
    };

    const view = buildDashboardViewModel({
      session: executiveSession,
      actor,
      state: runtime,
      projects: [],
      now: new Date("2026-08-14T09:00:00+08:00"),
      source: "mock",
    });

    expect(view.today.items).toEqual([
      expect.objectContaining({
        title: "跟进调度进度：一个月内完成玄学网并上线",
        progress: 50,
        href: "/dashboard#ai-dispatch-progress",
      }),
    ]);
    expect(view.tasks).toMatchObject({ total: 1, inProgress: 1, review: 0 });
    expect(view.tasks.items).toEqual([
      expect.objectContaining({
        title: "统筹与复盘：一个月内完成玄学网并上线",
        progress: 50,
        href: "/dashboard#ai-dispatch-progress",
      }),
    ]);
    expect(view.projects.items).toEqual([
      expect.objectContaining({
        name: "一个月内完成玄学网并上线",
        role: "发起人 · 总负责人",
        progress: 50,
        href: "/dashboard#ai-dispatch-progress",
      }),
    ]);
    expect(view.tasks.items.map(({ sourceId }) => sourceId)).not.toContain("runtime-assignee-1");
  });

  it("turns an owner's dispatch reminder into a direct review action when review work is available", () => {
    const context = createOperationFixtureContext(managerSession);
    const actor = context.actor!;
    const initial = createInitialOperationsState(context);
    const reviewSource = initial.tasks.find(({ id }) => id === "dept-task-engineer")!;
    const reviewTask = {
      ...reviewSource,
      id: "runtime-owner-review",
      title: "验收客户交付成果",
      commandId: "ai-command-owner-review",
      runtimeSource: "ai_dispatch" as const,
      status: "review" as const,
      progress: 90,
    };
    const state = {
      ...initial,
      command: {
        ...initial.command,
        id: "ai-command-owner-review",
        ownerId: actor.id,
        title: "安排团队完成本周客户交付",
        status: "executing" as const,
      },
      tasks: [reviewTask],
    };

    const view = buildDashboardViewModel({
      session: managerSession,
      actor,
      state,
      projects: [],
      now: new Date("2026-08-14T09:00:00+08:00"),
      source: "mock",
    });

    expect(view.today.items[0]).toEqual(expect.objectContaining({
      title: "验收：验收客户交付成果",
      category: "acceptance",
      actionLabel: "去验收",
      href: "/department#review-runtime-owner-review",
    }));
  });

  it("limits AI dispatch to responsible roles and calculates runtime progress from tasks", () => {
    const managerContext = createOperationFixtureContext(managerSession);
    const managerActor = managerContext.actor!;
    const initial = createInitialOperationsState(managerContext);
    const runtime = {
      ...initial,
      command: {
        ...initial.command,
        id: "ai-command-progress",
        ownerId: managerActor.id,
        status: "executing" as const,
      },
      tasks: initial.tasks.slice(0, 2).map((task, index) => ({
        ...task,
        commandId: "ai-command-progress",
        runtimeSource: "ai_dispatch" as const,
        status: index === 0 ? "done" as const : "in_progress" as const,
        progress: index === 0 ? 100 : 50,
        rejectionCount: index,
      })),
    };
    const managerView = buildDashboardViewModel({
      session: managerSession,
      actor: managerActor,
      state: runtime,
      projects: [],
      now: new Date("2026-08-14T09:00:00+08:00"),
      source: "mock",
    });
    const employeeContext = createOperationFixtureContext(engineerSession);
    const employeeView = buildDashboardViewModel({
      session: engineerSession,
      actor: employeeContext.actor!,
      state: runtime,
      projects: [],
      now: new Date("2026-08-14T09:00:00+08:00"),
      source: "mock",
    });

    expect(managerView.dispatch.canUse).toBe(true);
    expect(managerView.dispatch.current).toMatchObject({
      commandId: "ai-command-progress",
      total: 2,
      completed: 1,
      progress: 50,
      rejectionCount: 1,
      isOwner: true,
    });
    expect(employeeView.dispatch.canUse).toBe(false);
  });

  it("groups runtime tasks into four interactive progress stages", () => {
    const context = createOperationFixtureContext(managerSession);
    const actor = context.actor!;
    const initial = createInitialOperationsState(context);
    const statuses = ["assigned", "accepted", "todo", "in_progress", "blocked", "review", "done"] as const;
    const runtime = {
      ...initial,
      command: {
        ...initial.command,
        id: "ai-command-stage-breakdown",
        ownerId: actor.id,
        title: "完成移动工作台升级",
        status: "executing" as const,
      },
      tasks: statuses.map((status, index) => ({
        ...initial.tasks[index],
        id: `runtime-stage-${status}`,
        commandId: "ai-command-stage-breakdown",
        runtimeSource: "ai_dispatch" as const,
        status,
        progress: status === "done" ? 100 : status === "review" ? 90 : index * 10,
        blocker: status === "blocked" ? "等待测试环境" : undefined,
      })),
    };

    const view = buildDashboardViewModel({
      session: managerSession,
      actor,
      state: runtime,
      projects: [],
      now: new Date("2026-08-14T09:00:00+08:00"),
      source: "mock",
    });

    expect(view.dispatch.current?.stageCounts).toEqual({
      not_started: 3,
      started: 2,
      review: 1,
      done: 1,
    });
    expect(view.dispatch.current?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "runtime-stage-blocked",
        stage: "started",
        statusLabel: "已阻塞",
        blocked: true,
        progress: 40,
      }),
      expect.objectContaining({
        id: "runtime-stage-done",
        stage: "done",
        statusLabel: "已完成",
        progress: 100,
      }),
    ]));
    expect(view.dispatch.current?.tasks.every(({ assignee, dueDate }) => Boolean(assignee && dueDate))).toBe(true);
  });

  it("keeps tasks and projects scoped to the current person", () => {
    const { actor, initial } = engineerFixture();
    const view = buildDashboardViewModel({
      session: engineerSession,
      actor,
      state: initial,
      projects: getEffectiveProjectDetails(),
      now: new Date("2026-08-13T09:00:00+08:00"),
      source: "mock",
    });

    expect(view.tasks.total).toBe(1);
    expect(view.tasks.items.map(({ title }) => title)).toEqual(["实现官网核心页面"]);
    expect(view.tasks.items.map(({ title }) => title)).not.toContain("完成试点预算审核与付款");
    expect(view.projects.items.map(({ name }) => name)).toContain("企业官网升级项目");
    expect(view.projects.items.map(({ name }) => name)).not.toContain("新产品发布活动");
  });

  it("limits today's list to five and orders it by priority before deadline", () => {
    const { actor, initial } = engineerFixture();
    const ownTasks = initial.tasks.filter(({ assigneeId }) => assigneeId === actor.id);
    const urgentTask = {
      ...ownTasks[0],
      id: "urgent-personal-task",
      code: "URGENT-01",
      title: "紧急个人任务",
      priority: "urgent" as const,
      status: "todo" as const,
      dueDate: "2026-08-14",
    };
    const state = {
      ...initial,
      tasks: [
        ...initial.tasks.filter(({ assigneeId }) => assigneeId !== actor.id),
        { ...ownTasks[0], priority: "high" as const, status: "in_progress" as const, dueDate: "2026-08-13" },
        urgentTask,
        ...Array.from({ length: 5 }, (_, index) => ({
          ...ownTasks[0],
          id: `extra-${index}`,
          code: `EX${index}`,
          title: `额外任务 ${index}`,
          priority: "medium" as const,
          status: "todo" as const,
          dueDate: `2026-08-${15 + index}`,
        })),
      ],
    };
    const view = buildDashboardViewModel({
      session: engineerSession,
      actor,
      state,
      projects: [],
      now: new Date("2026-08-13T09:00:00+08:00"),
      source: "mock",
    });

    expect(view.today.items).toHaveLength(5);
    expect(view.today.items[0]).toEqual(expect.objectContaining({
      sourceId: urgentTask.id,
      priority: "urgent",
    }));
    expect(view.today.items[1]).toEqual(expect.objectContaining({
      sourceId: ownTasks[0].id,
      priority: "high",
    }));
  });

  it("moves a submitted task out of the assignee's today list and into the reviewer's list", () => {
    const { actor, initial } = engineerFixture();
    const ownTasks = initial.tasks.filter(({ assigneeId }) => assigneeId === actor.id);
    const submittedTask = ownTasks[0];
    const remainingTask = {
      ...submittedTask,
      id: "remaining-personal-task",
      code: "REMAINING-01",
      title: "继续处理个人任务",
      status: "todo" as const,
      progress: 0,
    };
    const state = {
      ...initial,
      tasks: [
        ...initial.tasks.filter(({ assigneeId }) => assigneeId !== actor.id),
        { ...submittedTask, status: "review" as const, progress: 90 },
        remainingTask,
      ],
    };

    const employeeView = buildDashboardViewModel({
      session: engineerSession,
      actor,
      state,
      projects: [],
      now: new Date("2026-08-14T09:00:00+08:00"),
      source: "mock",
    });
    const managerContext = createOperationFixtureContext(managerSession);
    const managerView = buildDashboardViewModel({
      session: managerSession,
      actor: managerContext.actor!,
      state,
      projects: [],
      now: new Date("2026-08-14T09:00:00+08:00"),
      source: "mock",
    });

    expect(employeeView.today.items.map(({ sourceId }) => sourceId)).toEqual([remainingTask.id]);
    expect(managerView.today.items.map(({ sourceId }) => sourceId)).toContain(submittedTask.id);
  });

  it("keeps today empty after all of the current person's tasks are completed", () => {
    const { actor, initial } = engineerFixture();
    const state = {
      ...initial,
      tasks: initial.tasks.map((task) => task.assigneeId === actor.id
        ? { ...task, status: "done" as const, progress: 100 }
        : task),
    };
    const view = buildDashboardViewModel({
      session: engineerSession,
      actor,
      state,
      projects: [],
      now: new Date("2026-08-14T09:00:00+08:00"),
      source: "mock",
    });

    expect(view.today.items).toEqual([]);
  });

  it("keeps empty demo and real states honest instead of inventing tasks", () => {
    for (const session of customerDemoSessions) {
      const context = createOperationFixtureContext(session);
      const actor = context.actor!;
      const initial = createInitialOperationsState(context);
      const emptyState = { ...initial, tasks: [] };
      const demoView = buildDashboardViewModel({
        session,
        actor,
        state: emptyState,
        projects: [],
        now: new Date("2026-08-14T09:00:00+08:00"),
        source: "mock",
      });

      expect(demoView.today.items, session.profile.displayName).toHaveLength(0);

      const realView = buildDashboardViewModel({
        session,
        actor,
        state: emptyState,
        projects: [],
        now: new Date("2026-08-14T09:00:00+08:00"),
        source: "real",
      });
      expect(realView.today.items, `${session.profile.displayName} real`).toHaveLength(0);
    }
  });

  it("uses an honest placeholder when personal value settlement data is unavailable", () => {
    const { actor, initial } = engineerFixture();
    const view = buildDashboardViewModel({
      session: engineerSession,
      actor,
      state: initial,
      projects: [],
      now: new Date("2026-08-13T09:00:00+08:00"),
      source: "mock",
    });

    expect(view.value.source).toBe("placeholder");
    expect(view.value.message).toBe("价值体系待启用");
    expect(view.value.pendingAmount).toBeNull();
    expect(view.value.settledAmount).toBeNull();
  });
});
