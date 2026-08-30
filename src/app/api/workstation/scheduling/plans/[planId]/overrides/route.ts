import { handleSchedulingOverride } from "@/features/ai-scheduler/scheduling-handler";

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  return handleSchedulingOverride(request, (await params).planId);
}
