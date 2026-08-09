import type { Metadata } from "next";

import { AnalyticsPage } from "@/features/analytics/analytics-page";

export const metadata: Metadata = {
  title: "数据分析 | 企业工作站",
};

export default function AnalyticsRoute() {
  return <AnalyticsPage />;
}
