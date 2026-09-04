import { handleDecisionConfirm } from "@/features/decisions/decision-handler";

export async function POST(request: Request, { params }: { params: Promise<{ commandId: string }> }) { return handleDecisionConfirm(request, (await params).commandId); }
