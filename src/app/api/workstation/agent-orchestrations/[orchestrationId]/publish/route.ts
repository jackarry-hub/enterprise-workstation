import{handleOrchestrationPublish}from"@/features/agents/orchestration-handler";
export async function POST(request:Request,context:{params:Promise<{orchestrationId:string}>}){const{orchestrationId}=await context.params;return handleOrchestrationPublish(request,orchestrationId);}
