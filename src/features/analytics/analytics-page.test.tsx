import { screen } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AnalyticsPage } from "@/features/analytics/analytics-page";

describe("AnalyticsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the approved analytics regions", () => {
    render(<AnalyticsPage />);

    expect(screen.getByRole("heading", { name: "数据分析" })).toBeVisible();
    expect(screen.getByText("员工执行情况")).toBeVisible();
    expect(screen.getByText("项目推进趋势")).toBeVisible();
    expect(screen.getByText("项目风险提醒")).toBeVisible();
    expect(screen.getByText("项目交付日历")).toBeVisible();
    expect(screen.getByText("项目健康度分布")).toBeVisible();
  });

  it("updates analytics content when range and department change", async () => {
    const user = userEvent.setup();
    render(<AnalyticsPage />);

    await user.click(screen.getByRole("combobox", { name: "时间范围" }));
    await user.click(screen.getByRole("option", { name: "本季度" }));
    await user.click(screen.getByRole("combobox", { name: "部门" }));
    await user.click(screen.getByRole("option", { name: "产品研发中心" }));

    expect(screen.getByTestId("analytics-filter-summary")).toHaveTextContent("本季度");
    expect(screen.getByTestId("analytics-filter-summary")).toHaveTextContent("产品研发中心");
  });
});
