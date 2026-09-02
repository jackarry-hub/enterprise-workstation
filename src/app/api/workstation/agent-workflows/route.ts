import { handleExternalWorkflowCollection } from "@/features/agents/external-workflow-handler";

export async function GET(request: Request) { return handleExternalWorkflowCollection(request); }
