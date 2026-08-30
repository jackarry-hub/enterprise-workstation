import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcError = { code?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
export type AgentCommandDependencies = { loadSession: () => Promise<WorkspaceSession | null>; rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>; createRequestId?: () => string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,79}$/;
const MODELS = new Set(["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"]);

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function statusFor(error: RpcError) { return error?.code === "42501" ? 403 : error?.code === "P0002" ? 404 : ["23505","55000"].includes(error?.code ?? "") ? 409 : error?.code === "22023" ? 422 : 503; }
function errorFor(status: number) { return status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 ? "conflict" : status === 422 ? "invalid_request" : "agent_service_unavailable"; }
async function body(request: Request) { const raw=await request.text(); if(Buffer.byteLength(raw,"utf8")>65_536)return null; try{return record(JSON.parse(raw));}catch{return null;} }
async function defaults(): Promise<AgentCommandDependencies> { const client=await getSupabaseServerClient(); return { loadSession:getWorkspaceSession,rpc:async(name,args)=>await client.rpc(name,args) as RpcResult }; }
function manager(session: WorkspaceSession) { return session.permissionCodes.includes("agent.manage"); }
function validLimits(value: Record<string, unknown>) {
  const expected = ["maxConcurrent", "maxDepth", "maxSteps", "maxTokens", "timeoutSeconds"];
  if (Object.keys(value).sort().join(",") !== expected.join(",")) return false;
  const limits = { maxSteps: [1, 100], maxDepth: [1, 8], timeoutSeconds: [10, 1800], maxTokens: [1, 4000], maxConcurrent: [1, 50] } as const;
  return Object.entries(limits).every(([key, [minimum, maximum]]) => Number.isSafeInteger(value[key]) && Number(value[key]) >= minimum && Number(value[key]) <= maximum);
}

export async function handleAgentCollection(request: Request, provided?: AgentCommandDependencies) {
  const deps=provided??await defaults(); const session=await deps.loadSession(); if(!session)return json({error:"unauthenticated"},401);
  if(request.method==="GET"){const result=await deps.rpc("list_current_agents",{p_limit:100}); if(result.error){const status=statusFor(result.error);return json({error:errorFor(status)},status);} return json(record(result.data)??{items:[],canManage:false});}
  if(request.method!=="POST")return json({error:"method_not_allowed"},405); if(!manager(session))return json({error:"forbidden"},403);
  const value=await body(request); const code=typeof value?.code==="string"?value.code.trim():""; const name=typeof value?.name==="string"?value.name.trim():""; const description=typeof value?.description==="string"?value.description.trim():""; const icon=typeof value?.icon==="string"?value.icon.trim():"bot"; const departmentId=value?.departmentId===null||value?.departmentId===undefined?null:String(value.departmentId); const minJobLevel=Number(value?.minJobLevel??1); const key=request.headers.get("idempotency-key")?.toLowerCase()??deps.createRequestId?.()??randomUUID();
  if(!CODE_PATTERN.test(code)||name.length<2||name.length>120||description.length>2000||!icon||icon.length>40||(departmentId!==null&&!UUID_PATTERN.test(departmentId))||!Number.isSafeInteger(minJobLevel)||minJobLevel<1||minJobLevel>20||!UUID_PATTERN.test(key))return json({error:"invalid_request"},400);
  const result=await deps.rpc("create_current_agent",{p_code:code,p_name:name,p_description:description,p_icon:icon,p_department_public_id:departmentId,p_min_job_level:minJobLevel,p_request_id:key}); const status=result.error?statusFor(result.error):201; return json(result.error?{error:errorFor(status)}:{...record(result.data),requestId:key},status);
}

export async function handleAgentVersions(request: Request, agentId: string, provided?: AgentCommandDependencies) {
  if(!UUID_PATTERN.test(agentId))return json({error:"not_found"},404); const deps=provided??await defaults(); const session=await deps.loadSession(); if(!session)return json({error:"unauthenticated"},401); if(request.method!=="POST")return json({error:"method_not_allowed"},405); if(!manager(session))return json({error:"forbidden"},403);
  const value=await body(request); const modelCode=String(value?.modelCode??""); const promptVersion=typeof value?.promptVersion==="string"?value.promptVersion.trim():""; const systemPrompt=typeof value?.systemPrompt==="string"?value.systemPrompt:""; const inputSchema=record(value?.inputSchema); const outputSchema=record(value?.outputSchema); const limits=record(value?.limits); const dataScopes=Array.isArray(value?.dataScopes)&&value.dataScopes.every(item=>typeof item==="string")?value.dataScopes as string[]:null; const secretRefs=Array.isArray(value?.secretRefs)&&value.secretRefs.every(item=>typeof item==="string"&&SECRET_REF_PATTERN.test(item))?value.secretRefs as string[]:null; const tools=Array.isArray(value?.tools)&&value.tools.every(item=>{const row=record(item);return row&&typeof row.code==="string"&&record(row.config??{})!==null;})?value.tools:null; const key=request.headers.get("idempotency-key")?.toLowerCase()??deps.createRequestId?.()??randomUUID();
  if(!MODELS.has(modelCode)||!promptVersion||promptVersion.length>40||!systemPrompt||Buffer.byteLength(systemPrompt,"utf8")>12_000||!inputSchema||!outputSchema||!limits||!validLimits(limits)||!dataScopes||!secretRefs||!tools||dataScopes.length>30||secretRefs.length>20||tools.length>30||!UUID_PATTERN.test(key))return json({error:"invalid_request"},400);
  const result=await deps.rpc("create_current_agent_version",{p_agent_public_id:agentId,p_model_code:modelCode,p_prompt_version:promptVersion,p_system_prompt:systemPrompt,p_input_schema:inputSchema,p_output_schema:outputSchema,p_data_scopes:dataScopes,p_secret_refs:secretRefs,p_limits:limits,p_tools:tools,p_request_id:key}); const status=result.error?statusFor(result.error):201; return json(result.error?{error:errorFor(status)}:{...record(result.data),requestId:key},status);
}

export async function handleAgentPublish(request: Request, agentId: string, provided?: AgentCommandDependencies) {
  if(!UUID_PATTERN.test(agentId))return json({error:"not_found"},404); const deps=provided??await defaults(); const session=await deps.loadSession(); if(!session)return json({error:"unauthenticated"},401); if(request.method!=="POST")return json({error:"method_not_allowed"},405); if(!manager(session))return json({error:"forbidden"},403);
  const value=await body(request); const versionId=String(value?.versionId??""); const key=request.headers.get("idempotency-key")?.toLowerCase()??deps.createRequestId?.()??randomUUID(); if(!UUID_PATTERN.test(versionId)||!UUID_PATTERN.test(key))return json({error:"invalid_request"},400);
  const result=await deps.rpc("publish_current_agent_version",{p_agent_public_id:agentId,p_version_public_id:versionId,p_request_id:key}); const status=result.error?statusFor(result.error):200; return json(result.error?{error:errorFor(status)}:{...record(result.data),requestId:key},status);
}
