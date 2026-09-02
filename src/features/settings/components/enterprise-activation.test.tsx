import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EnterpriseActivation } from "@/features/settings/components/enterprise-activation";

describe("enterprise activation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the authoritative ready state and next real-operation links", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      status: "ready",
      canInitialize: true,
      departmentCount: 5,
      positionCount: 12,
      skillCount: 20,
    })));

    render(<EnterpriseActivation />);

    expect(await screen.findByText("企业基础模板已启用")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "去同步飞书员工" })).toHaveAttribute("href", "/people");
    expect(screen.getByRole("link", { name: "配置 Agent 工作流" })).toHaveAttribute("href", "/agents");
  });

  it("lets the owner initialize a fresh company and then exposes employee import", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        status: "not_started",
        canInitialize: true,
        companyName: "新公司",
        shortName: "新公司",
        industry: "",
        description: "",
        timezone: "Asia/Shanghai",
      }))
      .mockResolvedValueOnce(Response.json({ status: "ready", canInitialize: true, departmentCount: 5, positionCount: 12, skillCount: 20 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<EnterpriseActivation />);

    await user.type(await screen.findByLabelText("所属行业"), "人工智能");
    await user.click(screen.getByRole("button", { name: "启用企业基础模板" }));

    expect(await screen.findByText("企业基础模板已启用")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workstation/enterprise-initialization", expect.objectContaining({ method: "POST" }));
  });
});
