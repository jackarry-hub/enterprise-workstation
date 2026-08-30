import { handleHumanConfirmation } from "@/features/ai-runtime/human-confirmation";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  return handleHumanConfirmation(request, runId);
}
