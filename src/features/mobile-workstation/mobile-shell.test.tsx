import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileAppFrame } from "@/features/mobile-workstation/components/mobile-app-frame";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

describe("MobileAppFrame", () => {
  it("renders the five destination mobile navigation", () => {
    render(<MobileAppFrame><p>页面内容</p></MobileAppFrame>);
    expect(screen.getByRole("region", { name: "移动工作区" })).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: "移动端主导航" });
    expect(navigation).toBeVisible();
    const links = screen.getAllByRole("link").filter((link) => navigation.contains(link));
    expect(links.map((link) => link.textContent)).toEqual(["首页", "项目", "任务", "团队", "我的"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/dashboard", "/projects", "/tasks", "/people", "/me"]);
    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("aria-current", "page");
  });
});
