import { screen } from "@testing-library/react";
import { renderWithSpecificWorkspaceSession, renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { SettingsPage } from "@/features/settings/settings-page";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";

describe("SettingsPage", () => {
  beforeEach(() => window.localStorage.clear());

  it("supports the approved V0.9 settings navigation", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "系统设置" })).toBeVisible();
    expect(screen.getByDisplayValue("量子星河科技有限公司")).toBeVisible();
    expect(screen.getByRole("img", { name: "量子星河企业 Logo" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "个人设置" }));
    expect(screen.getByRole("heading", { name: "个人设置" })).toBeVisible();
    expect(screen.getByLabelText("新密码")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "通知设置" }));
    const mailToggle = screen.getByRole("button", { name: "邮件通知" });
    expect(mailToggle).toHaveAttribute("data-state", "on");
    await user.click(mailToggle);
    expect(mailToggle).toHaveAttribute("data-state", "off");
    await user.click(screen.getByRole("tab", { name: "权限矩阵" }));
    expect(screen.getByRole("heading", { name: "角色权限矩阵" })).toBeVisible();
  });

  it("saves edits and cancel restores the entry snapshot", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const companyName = screen.getByLabelText("企业名称");

    await user.clear(companyName);
    await user.type(companyName, "量子星河集团");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(companyName).toHaveValue("量子星河科技有限公司");

    await user.clear(companyName);
    await user.type(companyName, "量子星河集团");
    await user.click(screen.getByRole("button", { name: "保存设置" }));
    expect(screen.getByText("设置已保存")).toBeVisible();
    expect(window.localStorage.getItem("enterprise-workspace.settings.v1")).toContain("量子星河集团");
  });

  it("rejects a non-image logo file", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<SettingsPage />);

    await user.upload(screen.getByLabelText("选择企业 Logo"), new File(["not-image"], "logo.txt", { type: "text/plain" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请选择图片文件");
  });

  it("shows employees only personal and notification settings", () => {
    const employee = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-engineer")!;
    renderWithSpecificWorkspaceSession(<SettingsPage />, employee);

    expect(screen.getByRole("tab", { name: "个人设置" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "通知设置" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "企业信息" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "权限矩阵" })).not.toBeInTheDocument();
    expect(screen.queryByText("企业时区")).not.toBeInTheDocument();
  });

  it("keeps enterprise and permission controls for executives", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("tab", { name: "企业信息" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "权限矩阵" })).toBeVisible();
  });
});
