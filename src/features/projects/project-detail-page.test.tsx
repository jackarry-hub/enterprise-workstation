import { act, screen, waitFor, within } from "@testing-library/react";
import { executiveWorkspaceSession, renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getProjectsStorageKey, saveLocalProject } from "@/features/projects/data/mock-project-repository";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { getProjectDetailMock, mockProjects } from "@/features/projects/mock-data";
import { ProjectDetailPage } from "@/features/projects/project-detail-page";

const detail = getProjectDetailMock(mockProjects[0].id);
const context = createOperationFixtureContext(executiveWorkspaceSession);

if (!detail) {
  throw new Error("Expected the primary project detail fixture.");
}

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("creates a Supabase task through the real command and never writes local project state", async () => {
    const user = userEvent.setup();
    const realDetail = {
      ...detail,
      members: detail.members.map((membership, index) => ({
        ...membership,
        member: { ...membership.member, commandId: `m${index + 10}` },
      })),
    };
    const createdTaskId = "a4000000-0000-4000-8000-000000000001";
    const fetch = vi.fn().mockResolvedValue(Response.json({ task: { id: createdTaskId, p: detail.project.id }, notification: { status: "queued" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail: realDetail, source: "supabase", access: { canManage: true, viewerMemberId: realDetail.owner.id } }} />);

    await user.click(screen.getByRole("button", { name: "添加任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建任务" });
    await user.type(within(dialog).getByLabelText("任务名称"), "真实接口联调");
    await user.type(within(dialog).getByLabelText("任务描述"), "验证服务端持久化");
    await user.type(within(dialog).getByLabelText("验收标准"), "刷新后任务仍存在");
    await user.click(within(dialog).getByRole("button", { name: "创建任务" }));

    expect(fetch).toHaveBeenCalledWith("/api/workstation/tasks", expect.objectContaining({ method: "POST" }));
    expect(window.localStorage.getItem(getProjectsStorageKey(context)!)).toBeNull();
    expect(screen.queryByRole("dialog", { name: "新建任务" })).not.toBeInTheDocument();
  });

  it("keeps the formal task dialog locked while the create command is pending", async () => {
    const user = userEvent.setup();
    const realDetail = {
      ...detail,
      members: detail.members.map((membership, index) => ({
        ...membership,
        member: { ...membership.member, commandId: `m${index + 10}` },
      })),
    };
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail: realDetail, source: "supabase", access: { canManage: true, viewerMemberId: realDetail.owner.id } }} />);

    await user.click(screen.getByRole("button", { name: "添加任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建任务" });
    await user.type(within(dialog).getByLabelText("任务名称"), "锁定提交状态");
    await user.type(within(dialog).getByLabelText("验收标准"), "刷新后可查询");
    await user.click(within(dialog).getByRole("button", { name: "创建任务" }));
    expect(within(dialog).getByRole("button", { name: "正在创建…" })).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "新建任务" })).toBeVisible();

    await act(async () => {
      resolveFetch(Response.json({ task: { id: "a4000000-0000-4000-8000-000000000008", p: detail.project.id } }, { status: 201 }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建任务" })).not.toBeInTheDocument());
  });

  it("keeps formal retrospective and risk controls read-only until durable commands exist", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "supabase", access: { canManage: true, viewerMemberId: detail.owner.id } }} />);

    await user.click(screen.getByRole("tab", { name: "复盘" }));

    expect(screen.getByText("正式项目复盘与风险维护接口尚未接入，当前仅展示已存数据。")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存复盘" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "标记缓解" })).not.toBeInTheDocument();
  });

  it("maps returned comment authors and refreshes after a confirmed report", async () => {
    const user = userEvent.setup();
    const employeePublicId = "a4000000-0000-4000-8000-000000000010";
    const realDetail = {
      ...detail,
      owner: { ...detail.owner, employeePublicId },
      members: detail.members.map((membership, index) => ({
        ...membership,
        member: {
          ...membership.member,
          employeePublicId: index === 0 ? employeePublicId : `a4000000-0000-4000-8000-${String(index + 11).padStart(12, "0")}`,
          commandId: `m${index + 10}`,
        },
      })),
    };
    const task = realDetail.tasks[0];
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ resource: "comment", entity: {
        id: "a4000000-0000-4000-8000-000000000020",
        taskId: task.id,
        projectId: realDetail.project.id,
        authorPublicId: employeePublicId,
        body: "正式评论已保存",
        version: 1,
        createdAt: "2026-08-27T10:01:00.000Z",
        updatedAt: "2026-08-27T10:01:00.000Z",
      } }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ resource: "report", entity: {
        id: "a4000000-0000-4000-8000-000000000021",
        projectId: realDetail.project.id,
        authorPublicId: employeePublicId,
        reportDate: "2026-08-27",
        status: "submitted",
        summary: "完成真实接口联调",
        nextPlan: "执行客户验收",
        blockers: "",
        supportNeeded: "",
        version: 1,
        updatedAt: "2026-08-27T10:02:00.000Z",
      } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<ProjectDetailPage projectId={realDetail.project.id} initialResult={{ detail: realDetail, source: "supabase", access: { canManage: true, viewerMemberId: realDetail.owner.id } }} />);

    await user.click(screen.getByRole("tab", { name: "任务" }));
    await user.click(screen.getByRole("button", { name: new RegExp(`查看任务详情：${task.title}`) }));
    const taskDialog = screen.getByRole("dialog");
    await user.type(within(taskDialog).getByLabelText("任务评论内容"), "正式评论已保存");
    await user.click(within(taskDialog).getByRole("button", { name: "添加评论" }));
    expect(await within(taskDialog).findByText("正式评论已保存")).toBeVisible();
    expect(within(taskDialog).getAllByText(realDetail.owner.displayName).length).toBeGreaterThan(0);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: "日报" }));
    await user.type(screen.getByLabelText("今日完成"), "完成真实接口联调");
    await user.type(screen.getByLabelText("下一步计划"), "执行客户验收");
    await user.click(screen.getByRole("button", { name: "提交日报" }));
    expect(await screen.findByRole("status")).toHaveTextContent("日报已提交并写入项目动态");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("announces formal comment and report failures with error semantics", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 })));
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "supabase", access: { canManage: true, viewerMemberId: detail.owner.id } }} />);

    await user.click(screen.getByRole("tab", { name: "任务" }));
    await user.click(screen.getByRole("button", { name: /查看任务详情：搭建官网前端工程/ }));
    const taskDialog = screen.getByRole("dialog");
    await user.type(within(taskDialog).getByLabelText("任务评论内容"), "需要正式保存");
    await user.click(within(taskDialog).getByRole("button", { name: "添加评论" }));
    expect(await within(taskDialog).findByRole("alert")).toHaveTextContent("没有执行该操作的权限");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: "日报" }));
    await user.type(screen.getByLabelText("今日完成"), "完成联调");
    await user.type(screen.getByLabelText("下一步计划"), "继续验收");
    await user.click(screen.getByRole("button", { name: "提交日报" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("没有执行该操作的权限");
  });

  it("renders the project command header and overview information", () => {
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);

    expect(screen.getByRole("heading", { name: "企业官网升级项目" })).toBeVisible();
    expect(screen.getAllByText("张伟").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2026/07/01 - 2026/09/30")).toBeVisible();
    expect(screen.getByRole("button", { name: "编辑项目" })).toBeVisible();
    expect(screen.getByRole("button", { name: "添加任务" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "项目目标" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "项目健康状态" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "项目成员" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "项目动态" })).toBeVisible();
  });

  it("switches between milestones and the project task list", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);

    await user.click(screen.getByRole("tab", { name: "里程碑" }));

    expect(screen.getByRole("heading", { name: "里程碑计划" })).toBeVisible();
    expect(screen.getByText("体验设计定稿")).toBeVisible();
    expect(screen.queryByText("搭建官网前端工程与组件基线")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "任务" }));
    expect(screen.getByRole("heading", { name: "项目任务" })).toBeVisible();
    expect(screen.getByText("搭建官网前端工程与组件基线")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "任务模块将在后续阶段开放" })).not.toBeInTheDocument();
  });

  it("adds a milestone from the milestone form and updates the current view", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);

    await user.click(screen.getByRole("tab", { name: "里程碑" }));
    await user.click(screen.getByRole("button", { name: "新增里程碑" }));

    const dialog = screen.getByRole("dialog", { name: "新增里程碑" });
    await user.type(within(dialog).getByLabelText("阶段名称"), "测试上线");
    await user.type(within(dialog).getByLabelText("开始时间"), "2026-09-01");
    await user.type(within(dialog).getByLabelText("截止时间"), "2026-09-20");
    await user.click(within(dialog).getByRole("button", { name: "创建里程碑" }));

    expect(await screen.findByText("测试上线")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "新增里程碑" })).not.toBeInTheDocument();
  });

  it("keeps a Supabase-backed milestone form open when persistence is unavailable", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "supabase" }} />);

    await user.click(screen.getByRole("tab", { name: "里程碑" }));
    await user.click(screen.getByRole("button", { name: "新增里程碑" }));

    const dialog = screen.getByRole("dialog", { name: "新增里程碑" });
    await user.type(within(dialog).getByLabelText("阶段名称"), "权限边界测试");
    await user.type(within(dialog).getByLabelText("截止时间"), "2026-09-20");
    await user.click(within(dialog).getByRole("button", { name: "创建里程碑" }));

    expect(await within(dialog).findByRole("alert")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "新增里程碑" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "权限边界测试" })).not.toBeInTheDocument();
  });

  it("supports keyboard dismissal and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);

    await user.click(screen.getByRole("tab", { name: "里程碑" }));
    const trigger = screen.getByRole("button", { name: "新增里程碑" });
    await user.click(trigger);

    expect(screen.getByLabelText("阶段名称")).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "新增里程碑" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders a browser-created project when the server has no matching result", async () => {
    const localDetail = {
      ...detail,
      project: {
        ...detail.project,
        id: "project-local-1",
        code: "PRJ-2026-025",
        name: "客户门户二期",
      },
      members: detail.members.map((membership) => ({
        ...membership,
        projectId: "project-local-1",
      })),
      milestones: [],
      tasks: [],
      comments: [],
      files: [],
      dailyReports: [],
      activities: [],
      risks: [],
      fileRelations: [],
    };
    saveLocalProject(context, localDetail);

    render(<ProjectDetailPage projectId="project-local-1" />);

    expect(await screen.findByRole("heading", { name: "客户门户二期" })).toBeVisible();
  });

  it("shows a friendly missing state for an unknown project id", async () => {
    render(<ProjectDetailPage projectId="missing-project" />);

    expect(await screen.findByRole("heading", { name: "未找到项目" })).toBeVisible();
    expect(screen.getByRole("link", { name: "返回项目中心" })).toHaveAttribute("href", "/projects");
  });

  it("creates a task from the project header and persists it", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);

    await user.click(screen.getByRole("button", { name: "添加任务" }));
    const dialog = screen.getByRole("dialog", { name: "新建任务" });
    await user.type(within(dialog).getByLabelText("任务名称"), "完成客户门户原型");
    await user.type(within(dialog).getByLabelText("任务描述"), "覆盖登录后首页与项目进度页");
    await user.click(within(dialog).getByRole("button", { name: "创建任务" }));

    expect(await screen.findByText("完成客户门户原型")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "新建任务" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "任务" })).toHaveAttribute("data-state", "active");
    expect(window.localStorage.getItem(getProjectsStorageKey(context)!)).toContain("完成客户门户原型");
  });

  it("marks a task complete and recalculates the visible project progress", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);

    await user.click(screen.getByRole("tab", { name: "任务" }));
    await user.click(screen.getByRole("combobox", { name: "搭建官网前端工程与组件基线状态" }));
    await user.click(screen.getByRole("option", { name: "已完成" }));

    expect(screen.getByRole("progressbar", { name: "项目当前进度" })).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByRole("combobox", { name: "搭建官网前端工程与组件基线状态" })).toHaveTextContent("已完成");
    expect(window.localStorage.getItem(getProjectsStorageKey(context)!)).toContain('"progress":33');
  });

  it("edits project information, adds task feedback, and uploads a project file", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);

    await user.click(screen.getByRole("button", { name: "编辑项目" }));
    const editDialog = screen.getByRole("dialog", { name: "编辑项目" });
    const projectName = within(editDialog).getByLabelText("项目名称");
    await user.clear(projectName);
    await user.type(projectName, "企业官网升级二期");
    await user.click(within(editDialog).getByRole("button", { name: "保存项目" }));
    expect(screen.getByRole("heading", { name: "企业官网升级二期" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "任务" }));
    await user.click(screen.getByRole("button", { name: /查看任务详情：搭建官网前端工程/ }));
    await user.type(screen.getByLabelText("任务评论内容"), "已完成联调，请确认。");
    await user.click(screen.getByRole("button", { name: "添加评论" }));
    expect(screen.getByText("已完成联调，请确认。")).toBeVisible();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: "文件" }));
    await user.upload(screen.getByLabelText("选择项目文件"), new File(["demo"], "交付清单.txt", { type: "text/plain" }));
    expect(screen.getByText("交付清单.txt")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("已添加文件");
    expect(window.localStorage.getItem(getProjectsStorageKey(context)!)).toContain("交付清单.txt");
  });

  it("restores locally persisted project files after the detail page remounts", async () => {
    const user = userEvent.setup();
    saveLocalProject(context, {
      ...detail,
      files: [
        {
          id: "persisted-file",
          organizationId: detail.project.organizationId,
          projectId: detail.project.id,
          bucket: "mock-project-files",
          objectPath: `${detail.project.id}/验收清单.txt`,
          originalName: "验收清单.txt",
          mimeType: "text/plain",
          sizeBytes: 4,
          accessScope: "restricted",
          uploadedById: detail.owner.id,
          createdAt: "2026-08-05T08:00:00.000Z",
        },
        ...detail.files,
      ],
    });

    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);
    await user.click(screen.getByRole("tab", { name: "文件" }));

    expect(await screen.findByText("验收清单.txt")).toBeVisible();
  });

  it("provides working gantt, daily report, and retrospective tabs", async () => {
    const user = userEvent.setup();
    render(<ProjectDetailPage projectId={detail.project.id} initialResult={{ detail, source: "mock" }} />);

    await user.click(screen.getByRole("tab", { name: "甘特图" }));
    expect(screen.getByRole("heading", { name: "项目甘特图" })).toBeVisible();
    expect(screen.getByText("搭建官网前端工程与组件基线")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "日报" }));
    await user.type(screen.getByLabelText("今日完成"), "完成最终版模块联调");
    await user.type(screen.getByLabelText("下一步计划"), "进行全角色验收");
    await user.click(screen.getByRole("button", { name: "提交日报" }));
    expect(screen.getByText("完成最终版模块联调")).toBeVisible();
    expect(window.localStorage.getItem(getProjectsStorageKey(context)!)).toContain("完成最终版模块联调");

    await user.click(screen.getByRole("tab", { name: "复盘" }));
    await user.type(screen.getByLabelText("结果总结"), "主要闭环已完成");
    await user.type(screen.getByLabelText("经验教训"), "依赖和验收必须提前定义");
    await user.click(screen.getByRole("button", { name: "保存复盘" }));
    expect(screen.getByRole("status")).toHaveTextContent("复盘已保存");
    expect(window.localStorage.getItem(getProjectsStorageKey(context)!)).toContain("依赖和验收必须提前定义");
  });
});
