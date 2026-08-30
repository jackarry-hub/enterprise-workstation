import type { Metadata } from "next";

import { AgentCenterWorkspace } from "@/features/agents/agent-center-workspace";

export const metadata: Metadata = { title: "Agent 中心 | 企业工作站" };

export default function AgentsPage() { return <AgentCenterWorkspace />; }
