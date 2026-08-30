import { handleSchedulingGoals } from "@/features/ai-scheduler/scheduling-handler";

export async function POST(request: Request) { return handleSchedulingGoals(request); }
