import{handleAgentRuns}from"@/features/agents/agent-runtime-handler";
export async function GET(request:Request,context:{params:Promise<{agentId:string}>}){const{agentId}=await context.params;return handleAgentRuns(request,agentId);}export async function POST(request:Request,context:{params:Promise<{agentId:string}>}){const{agentId}=await context.params;return handleAgentRuns(request,agentId);}
