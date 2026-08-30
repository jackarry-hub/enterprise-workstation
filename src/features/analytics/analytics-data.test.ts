import { describe, expect, it } from "vitest";
import { formatMetricValue, parseCommercialAnalytics } from "@/features/analytics/analytics-data";

const payload = { fromDate: "2026-08-01", toDate: "2026-08-30", asOf: "2026-08-30T10:00:00Z", metrics: [{ definitionCode: "task_completion_rate", label: "任务完成率", value: 0.8, numerator: 8, denominator: 10, unit: "ratio", definition: "完成数 / 总数" }], projectHealth: [], taskFlow: [], customerPipeline: [], approvalCycle: [], expense: [], aiUsage: [], trend: [{ date: "2026-08-30", tasksCreated: 2, tasksCompleted: 1, aiInvocations: 3 }] };

describe("commercial analytics projection", () => {
  it("keeps metric definition and numerator/denominator traceability", () => { const result = parseCommercialAnalytics(payload); expect(result?.metrics[0]).toMatchObject({ definitionCode: "task_completion_rate", numerator: 8, denominator: 10, value: 0.8 }); expect(formatMetricValue(result!.metrics[0])).toBe("80.0%"); });
  it("keeps unavailable metrics null instead of inventing a value", () => { const result = parseCommercialAnalytics({ ...payload, metrics: [{ ...payload.metrics[0], value: null, numerator: 0, denominator: 0 }] }); expect(result?.metrics[0].value).toBeNull(); expect(formatMetricValue(result!.metrics[0])).toBe("不可用"); });
  it("rejects malformed or synthetic-looking projections", () => { expect(parseCommercialAnalytics({ ...payload, asOf: "not-a-date" })).toBeNull(); expect(parseCommercialAnalytics({ ...payload, metrics: [{ ...payload.metrics[0], numerator: "unknown" }] })).toBeNull(); });
});
