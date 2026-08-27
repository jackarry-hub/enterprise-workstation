import {
  defaultOpportunityCommandDependencies,
  handleOpportunityConvertCommand,
} from "@/features/customers/opportunity-command-handler";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ opportunityId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    return await handleOpportunityConvertCommand(
      request, context, await defaultOpportunityCommandDependencies(),
    );
  } catch {
    return Response.json({ error: "opportunity_command_unavailable" }, { status: 503 });
  }
}
