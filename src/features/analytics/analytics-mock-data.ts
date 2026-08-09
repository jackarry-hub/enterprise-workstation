import type { AnalyticsRange } from "@/features/analytics/analytics-types";

export const analyticsTrendLabels: Record<AnalyticsRange, readonly string[]> = {
  month: ["08-01", "08-05", "08-10", "08-15", "08-20", "08-25", "08-31"],
  quarter: ["06月", "06月末", "07月", "07月末", "08月", "08月末"],
  half_year: ["03月", "04月", "05月", "06月", "07月", "08月"],
};

export const analyticsTrendOffsets: Record<AnalyticsRange, readonly number[]> = {
  month: [-18, -12, -8, -3, 2, 7, 12],
  quarter: [-24, -17, -10, -4, 3, 10],
  half_year: [-30, -23, -16, -9, -2, 7],
};
