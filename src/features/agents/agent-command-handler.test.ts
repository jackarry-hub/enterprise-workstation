import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { handleAgentCollection, handleAgentPublish, handleAgentVersions } from "@/features/agents/agent-command-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const agentId="11111111-1111-4111-8111-111111111111";
const versionId="22222222-2222-4222-8222-222222222222";
const requestId="33333333-3333-4333-8333-333333333333";
const manager={...executiveWorkspaceSession,permissionCodes:[...executiveWorkspaceSession.permissionCodes,"agent.manage" as const]};
const deps=(rpc=vi.fn().mockResolvedValue({data:{agentId,status:"disabled"},error:null}))=>({loadSession:async()=>manager,rpc,createRequestId:()=>requestId});

describe("versioned Agent commands",()=>{
  it("keeps published versions and their tool rows immutable and browser-unreadable",()=>{
    const sql=fs.readFileSync(path.join(process.cwd(),"supabase/migrations/202608300011_agent_versions.sql"),"utf8").toLowerCase();
    expect(sql).toContain("reject_published_agent_version_mutation");
    expect(sql).toContain("agent_versions_immutable");
    expect(sql).toContain("agent_version_tools_immutable");
    expect(sql).not.toContain("grant select on public.agent_versions");
  });

  it("rejects Agent creation without agent.manage before database access",async()=>{
    const rpc=vi.fn();
    const response=await handleAgentCollection(new Request("https://q.test/api/workstation/agents",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:"legal_review",name:"法务审核"})}),{loadSession:async()=>executiveWorkspaceSession,rpc});
    expect(response.status).toBe(403);expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a disabled server-owned definition with an idempotency key",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{agentId,status:"disabled",alreadyExists:false},error:null});
    const response=await handleAgentCollection(new Request("https://q.test/api/workstation/agents",{method:"POST",headers:{"content-type":"application/json","idempotency-key":requestId},body:JSON.stringify({code:"legal_review",name:"法务审核",description:"审查合同风险",icon:"shield",minJobLevel:3})}),deps(rpc));
    expect(response.status).toBe(201);expect(rpc).toHaveBeenCalledWith("create_current_agent",expect.objectContaining({p_code:"legal_review",p_request_id:requestId}));
  });

  it("persists a version with model, prompt, contracts, limits and catalog tools",async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{versionId,revision:1,lifecycle:"draft"},error:null});
    const response=await handleAgentVersions(new Request("https://q.test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({modelCode:"deepseek-chat",promptVersion:"legal-v1",systemPrompt:"仅根据授权合同给出风险建议。",inputSchema:{type:"object"},outputSchema:{type:"object"},dataScopes:["contracts.read"],secretRefs:["DEEPSEEK_API_KEY"],limits:{maxSteps:8,maxDepth:2,timeoutSeconds:120},tools:[{code:"knowledge.search",config:{collection:"legal"}}]})}),agentId,deps(rpc));
    expect(response.status).toBe(201);expect(rpc).toHaveBeenCalledWith("create_current_agent_version",expect.objectContaining({p_agent_public_id:agentId,p_secret_refs:["DEEPSEEK_API_KEY"]}));
  });

  it("rejects secret values and cannot publish a version rejected by the database",async()=>{
    const invalid=await handleAgentVersions(new Request("https://q.test",{method:"POST",body:JSON.stringify({modelCode:"deepseek-chat",promptVersion:"v1",systemPrompt:"prompt",inputSchema:{},outputSchema:{},dataScopes:[],secretRefs:["sk-secret"],limits:{},tools:[]})}),agentId,deps());
    expect(invalid.status).toBe(400);
    const rpc=vi.fn().mockResolvedValue({data:null,error:{code:"22023"}});
    const response=await handleAgentPublish(new Request("https://q.test",{method:"POST",body:JSON.stringify({versionId})}),agentId,deps(rpc));
    expect(response.status).toBe(422);
  });
});
