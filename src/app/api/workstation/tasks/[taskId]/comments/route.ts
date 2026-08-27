import { handleDefaultProjectExecutionCommand } from "@/features/projects/execution-command-handler";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return handleDefaultProjectExecutionCommand("comment", request, context);
}
