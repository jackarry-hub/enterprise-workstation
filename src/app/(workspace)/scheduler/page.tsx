import type { Metadata } from "next";

import { DecisionWorkspace } from "@/features/decisions/decision-workspace";

export const metadata: Metadata = { title: "决策执行中枢 | 企业工作站" };

export default function SchedulerPage() { return <DecisionWorkspace />; }
