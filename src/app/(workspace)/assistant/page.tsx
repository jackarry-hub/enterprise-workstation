import type { Metadata } from "next";

import { AssistantWorkspace } from "@/features/ai-assistant/assistant-workspace";

export const metadata: Metadata = { title: "AI 助手 | 企业工作站" };

export default function AssistantPage() { return <AssistantWorkspace />; }
