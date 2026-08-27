import {
  defaultCustomerCommandDependencies,
  handleCustomerUpdateCommand,
} from "@/features/customers/customer-command-handler";
import { loadCustomerDetailData } from "@/features/customers/customer-data";
import { getWorkspaceSession } from "@/features/auth/workspace-session";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ customerId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await getWorkspaceSession();
    if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
    const result = await loadCustomerDetailData((await context.params).customerId);
    if (result.loadError) return Response.json({ error: "customer_read_unavailable" }, { status: 503 });
    if (!result.customer) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ outcome: "success", resource: "customer_detail", customer: result.customer }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "customer_read_unavailable" }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    return await handleCustomerUpdateCommand(request, context, await defaultCustomerCommandDependencies());
  } catch {
    return Response.json({ error: "customer_command_unavailable" }, { status: 503 });
  }
}
