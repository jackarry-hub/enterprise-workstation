import {
  defaultOpportunityCommandDependencies,
  handleOpportunityTransitionCommand,
} from "@/features/customers/opportunity-command-handler";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ opportunityId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    return await handleOpportunityTransitionCommand(
      request, context, await defaultOpportunityCommandDependencies(),
    );
  } catch {
    return Response.json({ error: "opportunity_command_unavailable" }, { status: 503 });
  }
}
