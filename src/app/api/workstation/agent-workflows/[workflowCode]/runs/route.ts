import { handleExternalWorkflowRuns } from "@/features/agents/external-workflow-handler";

export async function GET(request: Request, context: { params: Promise<{ workflowCode: string }> }) {
  const { workflowCode } = await context.params; return handleExternalWorkflowRuns(request, workflowCode);
}
export async function POST(request: Request, context: { params: Promise<{ workflowCode: string }> }) {
  const { workflowCode } = await context.params; return handleExternalWorkflowRuns(request, workflowCode);
}
