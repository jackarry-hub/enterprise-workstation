import { act, screen, waitFor, within } from "@testing-library/react";
import { executiveWorkspaceSession, renderWithSpecificWorkspaceSession, renderWithWorkspaceSession as render, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsPage } from "@/features/projects/projects-page";
import { getProjectListMock, mockMembers, mockProjectMilestoneReminders, mockProjectPortfolioStats, mockProjects } from "@/features/projects/mock-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { getProjectsStorageKey } from "@/features/projects/data/mock-project-repository";

const context = createOperationFixtureContext(executiveWorkspaceSession);

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}));

describe("ProjectsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    navigation.push.mockReset();
    navigation.refresh.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders and creates Supabase projects for a real identity without fixture binding", async () => {
    const user = userEvent.setup();
    const owner = { ...mockMembers[0], employeePublicId: "a2000000-0000-4000-8000-000000000001", commandId: "m10" };
    const project = { ...getProjectListMock()[0], owner, members: [owner] };
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "project_command_unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ project: { id: "a2000000-0000-4000-8000-000000000002", version: 1 } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    renderWithSpecificWorkspaceSession(<ProjectsPage result={{
      projects: [project],
      stats: mockProjectPortfolioStats,
      reminders: mockProjectMilestoneReminders,
      availableMembers: [owner],
      source: "supabase",
    }} />, unboundExecutiveWorkspaceSession);

    expect(screen.getAllByText(project.name).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    await user.type(within(dialog).getByLabelText("项目名称"), "真实客户项目");
    await user.type(within(dialog).getByLabelText("项目描述"), "通过服务端事务创建");
    await user.type(within(dialog).getByLabelText("开始日期"), "2026-08-27");
    await user.type(within(dialog).getByLabelText("截止日期"), "2026-09-30");
    await user.click(within(dialog).getByRole("button", { name: "创建项目" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("服务暂时不可用");
    await user.click(within(dialog).getByRole("button", { name: "创建项目" }));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.headers["Idempotency-Key"]).toBe(fetch.mock.calls[1]?.[1]?.headers["Idempotency-Key"]);
    expect(navigation.push).toHaveBeenCalledWith("/projects/a2000000-0000-4000-8000-000000000002");
  });

  it("renders the approved project management center surface", () => {
    render(<ProjectsPage />);

    expect(screen.getByRole("heading", { name: "项目管理中心" })).toBeVisible();
    expect(screen.getByRole("button", { name: "新建项目" })).toBeVisible();
    expect(screen.getAllByText("全部项目").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("进行中").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("已完成").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("延期风险")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "搜索项目" })).toBeVisible();
    expect(screen.getAllByText("企业官网升级项目").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: "里程碑提醒" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "项目日历" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "看板" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下一页" })).not.toBeInTheDocument();
    expect(screen.getByText("当前显示 4 个项目")).toBeVisible();
  });

  it("keeps the formal project dialog locked while the create command is pending", async () => {
    const user = userEvent.setup();
    const owner = { ...mockMembers[0], employeePublicId: "a2000000-0000-4000-8000-000000000011", commandId: "m10" };
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    renderWithSpecificWorkspaceSession(<ProjectsPage result={{
      projects: [],
      stats: mockProjectPortfolioStats,
      reminders: [],
      availableMembers: [owner],
      source: "supabase",
    }} />, unboundExecutiveWorkspaceSession);

    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    await user.type(within(dialog).getByLabelText("项目名称"), "提交锁定项目");
    await user.type(within(dialog).getByLabelText("项目描述"), "验证提交期间禁止关闭");
    await user.type(within(dialog).getByLabelText("开始日期"), "2026-08-27");
    await user.type(within(dialog).getByLabelText("截止日期"), "2026-09-30");
    await user.click(within(dialog).getByRole("button", { name: "创建项目" }));
    expect(within(dialog).getByRole("button", { name: "正在创建…" })).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "新建项目" })).toBeVisible();

    await act(async () => {
      resolveFetch(Response.json({ project: { id: "a2000000-0000-4000-8000-000000000012", version: 1 } }, { status: 201 }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument());
  });

  it("filters projects by keyword and restores the list", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    const search = screen.getByRole("searchbox", { name: "搜索项目" });
    await user.type(search, "官网");
    const projectList = screen.getByRole("region", { name: "项目组合列表" });

    expect(within(projectList).getAllByText("企业官网升级项目").length).toBeGreaterThanOrEqual(1);
    expect(within(projectList).queryByText("新产品发布活动")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重置筛选" }));

    expect(within(projectList).getAllByText("新产品发布活动").length).toBeGreaterThanOrEqual(1);
  });

  it("switches to projects the current member is responsible for", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.click(screen.getByRole("tab", { name: "我负责的" }));

    const projectList = screen.getByRole("region", { name: "项目组合列表" });
    expect(within(projectList).getAllByText("企业官网升级项目").length).toBeGreaterThanOrEqual(1);
    expect(within(projectList).getAllByText("新产品发布活动").length).toBeGreaterThanOrEqual(1);
    expect(within(projectList).queryByText("年度市场推广计划")).not.toBeInTheDocument();
    expect(within(projectList).queryByText("客户成功知识库建设")).not.toBeInTheDocument();
  });

  it("links project rows and cards to the matching detail route", () => {
    render(<ProjectsPage />);

    const detailLinks = screen.getAllByRole("link", {
      name: "查看企业官网升级项目详情",
    });

    expect(detailLinks.length).toBeGreaterThanOrEqual(2);
    expect(detailLinks[0]).toHaveAttribute("href", `/projects/${mockProjects[0].id}`);
  });

  it("creates a refresh-safe mock project from the header action", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    await user.type(within(dialog).getByLabelText("项目名称"), "客户门户二期");
    await user.type(within(dialog).getByLabelText("项目描述"), "完善客户自助服务能力");
    await user.type(within(dialog).getByLabelText("开始日期"), "2026-08-10");
    await user.type(within(dialog).getByLabelText("截止日期"), "2026-10-30");
    await user.click(within(dialog).getByRole("button", { name: "创建项目" }));

    expect((await screen.findAllByText("客户门户二期")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();
    expect(navigation.push).toHaveBeenCalledWith(expect.stringMatching(/^\/projects\//));
    expect(window.localStorage.getItem(getProjectsStorageKey(context)!)).toContain("客户门户二期");
  });

  it("keeps the dialog open when the project date range is invalid", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    await user.click(screen.getByRole("button", { name: "新建项目" }));
    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    await user.type(within(dialog).getByLabelText("项目名称"), "日期校验项目");
    await user.type(within(dialog).getByLabelText("项目描述"), "验证项目周期边界");
    await user.type(within(dialog).getByLabelText("开始日期"), "2026-10-30");
    await user.type(within(dialog).getByLabelText("截止日期"), "2026-08-10");
    await user.click(within(dialog).getByRole("button", { name: "创建项目" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("截止日期不能早于开始日期");
    expect(screen.getByRole("dialog", { name: "新建项目" })).toBeVisible();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("restores focus to the new project action after keyboard dismissal", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);
    const trigger = screen.getByRole("button", { name: "新建项目" });

    await user.click(trigger);
    expect(screen.getByLabelText("项目名称")).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
