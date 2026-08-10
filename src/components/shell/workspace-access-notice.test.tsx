import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceAccessNotice } from "@/components/shell/workspace-access-notice";

const navigation = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.searchParams,
}));

describe("WorkspaceAccessNotice", () => {
  it("explains a safe no-access redirect in plain language", () => {
    navigation.searchParams = new URLSearchParams("notice=no_access");

    render(<WorkspaceAccessNotice />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "你没有权限查看刚才的页面，已返回可访问的工作台。",
    );
  });

  it("stays hidden during normal navigation", () => {
    navigation.searchParams = new URLSearchParams();

    render(<WorkspaceAccessNotice />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
