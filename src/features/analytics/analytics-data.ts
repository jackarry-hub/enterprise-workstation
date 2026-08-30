export type CommercialMetric = {
  definitionCode: string;
  label: string;
  value: number | null;
  numerator: number;
  denominator: number | null;
  unit: "count" | "ratio" | "CNY" | "hours" | "tokens" | "configured_currency";
  definition: string;
};

export type AnalyticsBreakdown = {
  key: string;
  count: number;
  amount?: number;
  currency?: string;
  averageHours?: number | null;
  tokens?: number;
  cost?: number;
};

export type AnalyticsTrend = {
  date: string;
  tasksCreated: number;
  tasksCompleted: number;
  aiInvocations: number;
};

export type CommercialAnalytics = {
  fromDate: string;
  toDate: string;
  asOf: string;
  metrics: CommercialMetric[];
  projectHealth: AnalyticsBreakdown[];
  taskFlow: AnalyticsBreakdown[];
  customerPipeline: AnalyticsBreakdown[];
  approvalCycle: AnalyticsBreakdown[];
  expense: AnalyticsBreakdown[];
  aiUsage: AnalyticsBreakdown[];
  trend: AnalyticsTrend[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS = new Set<CommercialMetric["unit"]>(["count", "ratio", "CNY", "hours", "tokens", "configured_currency"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBreakdown(value: unknown): AnalyticsBreakdown[] | null {
  if (!Array.isArray(value)) return null;
  const items: AnalyticsBreakdown[] = [];
  for (const entry of value) {
    const item = record(entry);
    const count = finite(item?.count);
    if (!item || typeof item.key !== "string" || count === null || count < 0) return null;
    const parsed: AnalyticsBreakdown = { key: item.key, count };
    for (const key of ["amount", "averageHours", "tokens", "cost"] as const) {
      if (item[key] === null && key === "averageHours") parsed[key] = null;
      else if (item[key] !== undefined) {
        const number = finite(item[key]);
        if (number === null) return null;
        parsed[key] = number;
      }
    }
    if (item.currency !== undefined) {
      if (typeof item.currency !== "string") return null;
      parsed.currency = item.currency;
    }
    items.push(parsed);
  }
  return items;
}

export function parseCommercialAnalytics(value: unknown): CommercialAnalytics | null {
  const root = record(value);
  if (!root || typeof root.fromDate !== "string" || typeof root.toDate !== "string" || !DATE.test(root.fromDate) || !DATE.test(root.toDate) || typeof root.asOf !== "string" || !Number.isFinite(Date.parse(root.asOf)) || !Array.isArray(root.metrics) || !Array.isArray(root.trend)) return null;
  const metrics: CommercialMetric[] = [];
  for (const entry of root.metrics) {
    const metric = record(entry); const valueNumber = finite(metric?.value); const numerator = finite(metric?.numerator); const denominator = finite(metric?.denominator);
    if (!metric || typeof metric.definitionCode !== "string" || typeof metric.label !== "string" || typeof metric.definition !== "string" || typeof metric.unit !== "string" || !UNITS.has(metric.unit as CommercialMetric["unit"]) || numerator === null || (metric.value !== null && valueNumber === null) || (metric.denominator !== null && denominator === null)) return null;
    metrics.push({ definitionCode: metric.definitionCode, label: metric.label, definition: metric.definition, unit: metric.unit as CommercialMetric["unit"], value: metric.value === null ? null : valueNumber, numerator, denominator: metric.denominator === null ? null : denominator });
  }
  const trend: AnalyticsTrend[] = [];
  for (const entry of root.trend) {
    const point = record(entry); const created = finite(point?.tasksCreated); const completed = finite(point?.tasksCompleted); const ai = finite(point?.aiInvocations);
    if (!point || typeof point.date !== "string" || !DATE.test(point.date) || created === null || completed === null || ai === null) return null;
    trend.push({ date: point.date, tasksCreated: created, tasksCompleted: completed, aiInvocations: ai });
  }
  const projectHealth = parseBreakdown(root.projectHealth); const taskFlow = parseBreakdown(root.taskFlow); const customerPipeline = parseBreakdown(root.customerPipeline); const approvalCycle = parseBreakdown(root.approvalCycle); const expense = parseBreakdown(root.expense); const aiUsage = parseBreakdown(root.aiUsage);
  if (!projectHealth || !taskFlow || !customerPipeline || !approvalCycle || !expense || !aiUsage) return null;
  return { fromDate: root.fromDate, toDate: root.toDate, asOf: root.asOf, metrics, projectHealth, taskFlow, customerPipeline, approvalCycle, expense, aiUsage, trend };
}

export function formatMetricValue(metric: CommercialMetric) {
  if (metric.value === null) return "不可用";
  if (metric.unit === "ratio") return `${(metric.value * 100).toFixed(1)}%`;
  if (metric.unit === "CNY" || metric.unit === "configured_currency") return new Intl.NumberFormat("zh-CN", { style: metric.unit === "CNY" ? "currency" : "decimal", currency: "CNY", maximumFractionDigits: 2 }).format(metric.value);
  if (metric.unit === "hours") return `${metric.value.toLocaleString("zh-CN")} 小时`;
  return metric.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
