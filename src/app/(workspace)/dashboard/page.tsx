import type { Metadata } from "next";

import { AnalyticsPage } from "@/features/analytics/analytics-page";

export const metadata: Metadata = {
  title: "经营驾驶舱 | 企业工作站",
};

export default function DashboardRoute() {
  return <AnalyticsPage />;
}
