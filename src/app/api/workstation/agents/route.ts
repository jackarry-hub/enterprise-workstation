import { handleAgentCollection } from "@/features/agents/agent-command-handler";
export async function GET(request: Request){return handleAgentCollection(request);}
export async function POST(request: Request){return handleAgentCollection(request);}
