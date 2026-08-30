import {handleAgentPermissionRequests} from "@/features/agents/agent-permission-handler";
export async function GET(request:Request,context:{params:Promise<{agentId:string}>}){const{agentId}=await context.params;return handleAgentPermissionRequests(request,agentId);}
export async function POST(request:Request,context:{params:Promise<{agentId:string}>}){const{agentId}=await context.params;return handleAgentPermissionRequests(request,agentId);}
