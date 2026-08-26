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

function renderDialogs(onAuthoritativeRefresh = vi.fn()) {
  renderWithWorkspaceSession(
    <OrganizationDialogs
      canManageOrganization
      canManageRoles
      roleTargets={roleTargets}
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
    ["command_failed", "未能提交变更，请稍后重试。"],
    ["transport_failure", "网络连接未完成，请检查连接后重试。"],
  ])("maps %s to an actionable stable message", (code, message) => {
    expect(organizationCommandErrorMessage(code)).toBe(message);
  });
});
