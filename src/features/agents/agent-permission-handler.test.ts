import fs from "node:fs";
import path from "node:path";
import {describe,expect,it,vi} from "vitest";

import {handleAgentPermissionRequests} from "@/features/agents/agent-permission-handler";
import {executiveWorkspaceSession} from "@/test/workspace-session-test-utils";

const agentId="11111111-1111-4111-8111-111111111111";const idempotency="22222222-2222-4222-8222-222222222222";const requestId="33333333-3333-4333-8333-333333333333";
const requester={...executiveWorkspaceSession,permissionCodes:[...executiveWorkspaceSession.permissionCodes,"approval.submit" as const]};
const dependencies=(rpc=vi.fn().mockResolvedValue({data:{requestId:"44444444-4444-4444-8444-444444444444",approvalId:"55555555-5555-4555-8555-555555555555",status:"pending"},error:null}))=>({loadSession:async()=>requester,rpc,createRequestId:()=>requestId});

describe("Agent permission approval",()=>{
  it("links requests to native approval and grants only from the approval status trigger",()=>{
    const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/202608300012_agent_permission_requests.sql"),"utf8").toLowerCase();
    expect(sql).toContain("public.submit_current_approval");
    expect(sql).toContain("create trigger approvals_apply_agent_permission after update of status");
    expect(sql).toContain("if new.status='rejected'");
    expect(sql).toContain("requested_expires_at");
  });

  it("rejects requesters without approval submission permission",async()=>{
    const rpc=vi.fn();const response=await handleAgentPermissionRequests(new Request("https://q.test",{method:"POST",body:"{}"}),agentId,{loadSession:async()=>executiveWorkspaceSession,rpc});expect(response.status).toBe(403);expect(rpc).not.toHaveBeenCalled();
  });

  it("submits an expiring idempotent permission request",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{requestId:"44444444-4444-4444-8444-444444444444",status:"pending"},error:null});const expiresAt=new Date(Date.now()+7*86_400_000).toISOString();
    const response=await handleAgentPermissionRequests(new Request("https://q.test",{method:"POST",headers:{"content-type":"application/json","idempotency-key":idempotency},body:JSON.stringify({reason:"需要在项目复盘中调用该 Agent",expiresAt})}),agentId,dependencies(rpc));
    expect(response.status).toBe(201);expect(rpc).toHaveBeenCalledWith("request_current_agent_permission",expect.objectContaining({p_agent_public_id:agentId,p_idempotency_key:idempotency,p_request_id:requestId}));
  });

  it("maps a duplicate pending request to a conflict",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:null,error:{code:"55000"}});const expiresAt=new Date(Date.now()+7*86_400_000).toISOString();
    const response=await handleAgentPermissionRequests(new Request("https://q.test",{method:"POST",body:JSON.stringify({reason:"需要临时调用完成项目复盘",expiresAt})}),agentId,dependencies(rpc));expect(response.status).toBe(409);
  });
});
