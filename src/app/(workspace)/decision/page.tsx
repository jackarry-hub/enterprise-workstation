import type { Metadata } from "next";

import { DecisionWorkbench } from "@/features/decision-workbench/decision-workbench";

export const metadata: Metadata = { title: "AI 决策调度台 | 企业工作站" };

export default function DecisionRoute() {
  return <DecisionWorkbench />;
}
