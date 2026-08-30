import { handleOrchestrationRuns } from "@/features/agents/orchestration-runtime-handler";

export async function GET(request: Request, context: { params: Promise<{ orchestrationId: string }> }) { const { orchestrationId } = await context.params; return handleOrchestrationRuns(request, orchestrationId); }
export async function POST(request: Request, context: { params: Promise<{ orchestrationId: string }> }) { const { orchestrationId } = await context.params; return handleOrchestrationRuns(request, orchestrationId); }
