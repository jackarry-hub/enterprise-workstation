import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileAppFrame } from "@/features/mobile-workstation/components/mobile-app-frame";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

describe("MobileAppFrame", () => {
  it("renders the five destination mobile navigation", () => {
    render(<MobileAppFrame><p>页面内容</p></MobileAppFrame>);
    expect(screen.getByRole("region", { name: "移动工作区" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "移动端主导航" })).toBeVisible();
    for (const [name, href] of [["首页", "/dashboard"], ["任务", "/tasks"], ["项目", "/projects"], ["审批", "/approvals"], ["我的", "/me"]]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });
});

