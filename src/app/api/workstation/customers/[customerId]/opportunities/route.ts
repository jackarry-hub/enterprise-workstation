import {
  defaultOpportunityCommandDependencies,
  handleOpportunityCreateCommand,
} from "@/features/customers/opportunity-command-handler";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ customerId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    return await handleOpportunityCreateCommand(
      request, context, await defaultOpportunityCommandDependencies(),
    );
  } catch {
    return Response.json({ error: "opportunity_command_unavailable" }, { status: 503 });
  }
}
