import { handleDecisionComplete } from "@/features/decisions/decision-handler";

export async function POST(request: Request, { params }: { params: Promise<{ commandId: string }> }) { return handleDecisionComplete(request, (await params).commandId); }
