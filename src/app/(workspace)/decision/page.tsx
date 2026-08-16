import type { Metadata } from "next";

import { DecisionWorkbench } from "@/features/decision-workbench/decision-workbench";

export const metadata: Metadata = { title: "AI 决策调度台 | 量子智枢" };

export default function DecisionRoute() {
  return <DecisionWorkbench />;
}
