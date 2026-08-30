import { handleSchedulingDispatch } from "@/features/ai-scheduler/scheduling-handler";

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  return handleSchedulingDispatch(request, (await params).planId);
}
