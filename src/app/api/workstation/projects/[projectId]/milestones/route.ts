import { handleDefaultProjectExecutionCommand } from "@/features/projects/execution-command-handler";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  return handleDefaultProjectExecutionCommand("milestone", request, context);
}
