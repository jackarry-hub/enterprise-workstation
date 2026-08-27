import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OrganizationDialogs,
  organizationCommandErrorMessage,
} from "@/features/organization/organization-dialogs";
import { renderWithWorkspaceSession } from "@/test/workspace-session-test-utils";

const roleTargets = [{
  employeeId: "71000000-0000-4000-8000-000000000001",
  displayName: "陈工",
  employeeNo: "QXY-2101",
  jobTitle: "后端工程师",
  memberId: 31,
  roleVersion: 4,
}];

const managerTargets = {
  status: "ready" as const,
  targets: [{
    employeeId: "72000000-0000-4000-8000-000000000001",
    displayLabel: "陈工 · QXY-2101 · 后端工程师",
    departmentPublicId: "73000000-0000-4000-8000-000000000001",
    departmentName: "工程部",
    currentManagerEmployeeId: "72000000-0000-4000-8000-000000000004",
    managerVersion: 4,
    managerSource: "manual" as const,
  }, {
    employeeId: "72000000-0000-4000-8000-000000000002",
    displayLabel: "李工 · QXY-2002 · 前端工程师",
    departmentPublicId: "73000000-0000-4000-8000-000000000001",
    departmentName: "工程部",
    currentManagerEmployeeId: null,
    managerVersion: 1,
    managerSource: "unassigned" as const,
  }, {
    employeeId: "72000000-0000-4000-8000-000000000004",
    displayLabel: "王主管 · QXY-2001 · 研发主管",
    departmentPublicId: "73000000-0000-4000-8000-000000000001",
    departmentName: "工程部",
    currentManagerEmployeeId: null,
    managerVersion: 2,
    managerSource: "unassigned" as const,
  }, {
    employeeId: "72000000-0000-4000-8000-000000000003",
    displayLabel: "赵经理 · QXY-3001 · 销售经理",
    departmentPublicId: "73000000-0000-4000-8000-000000000002",
    departmentName: "销售部",
    currentManagerEmployeeId: null,
    managerVersion: 1,
    managerSource: "unassigned" as const,
  }],
};

function renderDialogs(onAuthoritativeRefresh = vi.fn()) {
  renderWithWorkspaceSession(
    <OrganizationDialogs
      canManageOrganization
      canManageRoles
      roleTargets={roleTargets}
      managerTargets={managerTargets}
      onAuthoritativeRefresh={onAuthoritativeRefresh}
    />,
  );
  return onAuthoritativeRefresh;
}

async function openDepartment(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "新建部门" }));
  await user.type(screen.getByRole("textbox", { name: "部门名称" }), "研发中心");
  await user.type(screen.getByRole("textbox", { name: "部门编码" }), "RND");
  await user.type(screen.getByRole("textbox", { name: "业务理由" }), "组织调整");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("organization dialogs", () => {
  it("resets the captured form and refreshes only after a successful authoritative command", async () => {
    const user = userEvent.setup();
    const refresh = renderDialogs();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 201 })));

    await openDepartment(user);
    expect(screen.getByRole("textbox", { name: "部门名称" })).toHaveClass("h-11");
    expect(screen.getByRole("textbox", { name: "业务理由" })).toHaveClass("min-h-11");
    await user.click(screen.getByRole("button", { name: "提交部门" }));

    expect(await screen.findByText("部门变更已提交，刷新目录以查看最新结果。")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "部门名称" })).toHaveValue("");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("recovers from a transport rejection and reuses the idempotency key for the unchanged retry", async () => {
    const user = userEvent.setup();
    renderDialogs();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetch);

    await openDepartment(user);
    await user.click(screen.getByRole("button", { name: "提交部门" }));
    expect(await screen.findByText("网络连接未完成，请检查连接后重试。")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "提交部门" }));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": expect.any(String),
    });
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": fetch.mock.calls[0]?.[1]?.headers["Idempotency-Key"],
    });
  });

  it("synchronously blocks a rapid duplicate submit while the request is in flight", async () => {
    const user = userEvent.setup();
    renderDialogs();
    let resolveResponse: (response: Response) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal("fetch", fetch);

    await openDepartment(user);
    const submit = screen.getByRole("button", { name: "提交部门" });
    await user.click(submit);
    await user.click(submit);

    expect(fetch).toHaveBeenCalledOnce();
    resolveResponse!(new Response(null, { status: 201 }));
  });

  it.each([
    ["unauthorized", "登录状态已失效，请重新登录后再试。"],
    ["forbidden", "当前账号没有执行此操作的权限。"],
    ["invalid_request", "提交内容不符合要求，请检查后重试。"],
    ["not_found", "目标员工或组织记录不存在，无法继续操作。"],
    ["stale_version", "目录已更新，请刷新后重试。"],
    ["conflict", "目录已更新，请刷新后重试。"],
    ["scope_conflict", "目录已更新，请刷新后重试。"],
    ["duplicate_request", "该变更正在处理中，请勿重复提交。"],
    ["directory_role_owned", "该角色由目录同步管理，不能在此处修改。"],
    ["directory_manager_owned", "该汇报关系由通讯录同步管理，不能手动覆盖。"],
    ["manager_cycle", "该设置会形成循环汇报关系，请调整主管。"],
    ["command_failed", "未能提交变更，请稍后重试。"],
    ["transport_failure", "网络连接未完成，请检查连接后重试。"],
  ])("maps %s to an actionable stable message", (code, message) => {
    expect(organizationCommandErrorMessage(code)).toBe(message);
  });

  it("offers the distinct supervisor role in the server-loaded role assignment flow", async () => {
    const user = userEvent.setup();
    renderDialogs();

    await user.click(screen.getByRole("button", { name: "分配系统角色" }));

    expect(screen.getByRole("option", { name: "主管" })).toHaveValue("supervisor");
  });

  it("assigns a manager with public targets and the hidden authoritative version", async () => {
    const user = userEvent.setup();
    const refresh = renderDialogs();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      outcome: "success",
      id: managerTargets.targets[0].employeeId,
      version: 5,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    await user.click(screen.getByRole("button", { name: "分配直属主管" }));
    expect(screen.getByRole("combobox", { name: "选择员工" })).toHaveTextContent("陈工");
    expect(screen.getByRole("combobox", { name: "选择主管" })).toHaveTextContent("王主管");
    expect(screen.getByRole("combobox", { name: "选择主管" })).toHaveValue(
      managerTargets.targets[0].currentManagerEmployeeId,
    );
    expect(screen.getByRole("combobox", { name: "选择主管" })).not.toHaveTextContent("赵经理");
    expect(screen.queryByRole("textbox", { name: "员工编号" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "主管版本" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "主管调整理由" }), "明确研发汇报关系");
    await user.click(screen.getByRole("button", { name: "提交主管变更" }));

    expect(fetch).toHaveBeenCalledWith(
      `/api/workstation/organization/members/${managerTargets.targets[0].employeeId}/manager`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
        body: JSON.stringify({
          managerEmployeeId: managerTargets.targets[2].employeeId,
          expectedVersion: 4,
          reason: "明确研发汇报关系",
        }),
      }),
    );
    expect(await screen.findByText("直属主管已更新，正在刷新服务器数据。")).toBeVisible();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("shows a retryable unavailable state when manager targets could not be loaded", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    renderWithWorkspaceSession(
      <OrganizationDialogs
        canManageOrganization
        canManageRoles={false}
        roleTargets={[]}
        managerTargets={{ status: "unavailable" }}
        onAuthoritativeRefresh={refresh}
      />,
    );

    expect(screen.getByText("主管数据暂不可用，请刷新页面后重试。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "分配直属主管" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试加载主管数据" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
