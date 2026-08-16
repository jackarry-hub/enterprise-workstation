import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { ProjectsPage } from "@/features/projects/projects-page";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const departmentHead = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-product-head")!;
const executive = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-executive")!;

describe("ProjectsPage", () => {
  it("includes department workstreams as project cards", () => {
    renderWithSpecificWorkspaceSession(<ProjectsPage />, executive);

    expect(screen.getByText("客户官网升级交付")).toBeVisible();
    expect(screen.getByText("月度经营与薪资结算")).toBeVisible();
    expect(screen.getByText("客户成功知识库建设")).toBeVisible();
  });

  it("shows only projects related to the signed-in person", () => {
    renderWithSpecificWorkspaceSession(<ProjectsPage />, departmentHead);
    expect(screen.getByRole("heading", { name: "项目" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-project-card").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("年度市场推广计划")).not.toBeInTheDocument();
  });

  it("opens and applies the compact project search", async () => {
    const user = userEvent.setup();
    renderWithSpecificWorkspaceSession(<ProjectsPage />, departmentHead);
    await user.click(screen.getByRole("button", { name: "搜索项目" }));
    await user.type(screen.getByRole("textbox", { name: "项目关键词" }), "官网");
    expect(screen.getByText("企业官网升级项目")).toBeVisible();
    expect(screen.queryByText("新产品发布活动")).not.toBeInTheDocument();
  });

  it("links every visible project card directly to its detail", () => {
    renderWithSpecificWorkspaceSession(<ProjectsPage />, departmentHead);
    for (const card of screen.getAllByTestId("mobile-project-card")) {
      expect(card.getAttribute("href")).toMatch(/^\/projects\//);
    }
  });
});
