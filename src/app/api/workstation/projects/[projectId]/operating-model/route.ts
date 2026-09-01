import { handleDefaultOperatingModelCommand } from "@/features/projects/operating-model-command-handler";

export const runtime = "nodejs";

export function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  return handleDefaultOperatingModelCommand(request, context);
}
