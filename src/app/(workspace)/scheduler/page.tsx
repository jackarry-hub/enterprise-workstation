import type { Metadata } from "next";

import { SchedulerWorkspace } from "@/features/ai-scheduler/scheduler-workspace";

export const metadata: Metadata = { title: "智能排期 | 企业工作站" };

export default function SchedulerPage() { return <SchedulerWorkspace />; }
