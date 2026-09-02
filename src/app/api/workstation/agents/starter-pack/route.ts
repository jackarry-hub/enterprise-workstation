import { handleAgentStarterPack } from "@/features/agents/agent-starter-pack-handler";

export async function POST(request: Request) {
  return handleAgentStarterPack(request);
}
