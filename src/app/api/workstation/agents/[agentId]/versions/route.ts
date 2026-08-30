import { handleAgentVersions } from "@/features/agents/agent-command-handler";
export async function POST(request:Request,context:{params:Promise<{agentId:string}>}){const {agentId}=await context.params;return handleAgentVersions(request,agentId);}
