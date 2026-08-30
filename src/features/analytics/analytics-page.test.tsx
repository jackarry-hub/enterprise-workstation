import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsPage } from "@/features/analytics/analytics-page";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";

const projection = { fromDate: "2026-08-01", toDate: "2026-08-30", asOf: "2026-08-30T10:00:00Z", metrics: [{ definitionCode: "task_completion_rate", label: "任务完成率", value: 0.8, numerator: 8, denominator: 10, unit: "ratio", definition: "完成任务数 / 总任务数" }], projectHealth: [{ key: "on_track", count: 2 }], taskFlow: [{ key: "done", count: 8 }], customerPipeline: [], approvalCycle: [], expense: [], aiUsage: [], trend: [{ date: "2026-08-30", tasksCreated: 10, tasksCompleted: 8, aiInvocations: 2 }] };

describe("AnalyticsPage", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("renders traceable real-data regions", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(projection), { status: 200 }))); render(<AnalyticsPage />); expect(await screen.findByRole("heading", { name: "经营数据分析" })).toBeVisible(); expect(await screen.findByTestId("metric-task_completion_rate")).toHaveTextContent("80.0%"); expect(screen.getByText("分子 8 / 分母 10")).toBeVisible(); expect(screen.getByText("客户管道")).toBeVisible(); expect(screen.getByText("AI 运行状态")).toBeVisible(); });
  it("reloads the server projection when range changes", async () => { const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(projection), { status: 200 })); vi.stubGlobal("fetch", fetcher); const user = userEvent.setup(); render(<AnalyticsPage />); await screen.findByTestId("metric-task_completion_rate"); await user.click(screen.getByRole("combobox", { name: "时间范围" })); await user.click(screen.getByRole("option", { name: "近 90 天" })); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); });
  it("shows an honest unavailable state instead of fixtures", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 }))); render(<AnalyticsPage />); expect(await screen.findByText("经营数据暂时不可用")).toBeVisible(); expect(screen.getByText(/没有使用演示数据替代/)).toBeVisible(); });
});
