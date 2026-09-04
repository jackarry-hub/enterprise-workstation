import { handleDecisionCollection } from "@/features/decisions/decision-handler";

export async function GET(request: Request) { return handleDecisionCollection(request); }
export async function POST(request: Request) { return handleDecisionCollection(request); }
