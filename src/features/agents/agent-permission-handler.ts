import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type RpcError={code?:string}|null; type RpcResult={data:unknown;error:RpcError};
export type AgentPermissionDependencies={loadSession:()=>Promise<WorkspaceSession|null>;rpc:(name:string,args:Record<string,unknown>)=>Promise<RpcResult>;createRequestId?:()=>string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value:unknown):Record<string,unknown>|null{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;}
function json(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});}
function statusFor(error:RpcError){return error?.code==="42501"?403:error?.code==="P0002"?404:["23505","55000"].includes(error?.code??"")?409:error?.code==="22023"?422:503;}
async function defaults():Promise<AgentPermissionDependencies>{const client=await getSupabaseServerClient();return{loadSession:getWorkspaceSession,rpc:async(name,args)=>await client.rpc(name,args) as RpcResult};}

export async function handleAgentPermissionRequests(request:Request,agentId:string,provided?:AgentPermissionDependencies){
  if(!UUID.test(agentId))return json({error:"not_found"},404);const deps=provided??await defaults();const session=await deps.loadSession();if(!session)return json({error:"unauthenticated"},401);
  if(request.method==="GET"){const result=await deps.rpc("list_current_agent_permission_requests",{p_limit:100});if(result.error){const status=statusFor(result.error);return json({error:status===403?"forbidden":"agent_permission_unavailable"},status);}return json(record(result.data)??{items:[]});}
  if(request.method!=="POST")return json({error:"method_not_allowed"},405);if(!session.permissionCodes.includes("approval.submit"))return json({error:"forbidden"},403);
  const raw=await request.text();if(Buffer.byteLength(raw,"utf8")>16_384)return json({error:"invalid_request"},400);let value:Record<string,unknown>|null=null;try{value=record(JSON.parse(raw));}catch{/* invalid */}
  const reason=typeof value?.reason==="string"?value.reason.trim():"";const expiresAt=typeof value?.expiresAt==="string"?value.expiresAt:"";const expiry=Date.parse(expiresAt);const now=Date.now();const idempotency=request.headers.get("idempotency-key")?.toLowerCase()??randomUUID();const requestId=deps.createRequestId?.()??randomUUID();
  if(reason.length<5||reason.length>500||!Number.isFinite(expiry)||expiry<=now+3_600_000||expiry>now+90*86_400_000||!UUID.test(idempotency)||!UUID.test(requestId)||idempotency===requestId)return json({error:"invalid_request"},400);
  const result=await deps.rpc("request_current_agent_permission",{p_agent_public_id:agentId,p_reason:reason,p_expires_at:new Date(expiry).toISOString(),p_idempotency_key:idempotency,p_request_id:requestId});const status=result.error?statusFor(result.error):201;return json(result.error?{error:status===403?"forbidden":status===404?"not_found":status===409?"conflict":status===422?"invalid_request":"agent_permission_unavailable"}:{...record(result.data),requestId},status);
}
