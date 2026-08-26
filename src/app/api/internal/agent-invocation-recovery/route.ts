import {
  createAgentInvocationRecoveryHandler,
  defaultAgentInvocationRecoveryDependencies,
} from "@/app/api/internal/agent-invocation-recovery/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createAgentInvocationRecoveryHandler(defaultAgentInvocationRecoveryDependencies);
