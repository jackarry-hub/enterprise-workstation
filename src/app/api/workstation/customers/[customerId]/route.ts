import {
  defaultCustomerCommandDependencies,
  handleCustomerUpdateCommand,
} from "@/features/customers/customer-command-handler";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ customerId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    return await handleCustomerUpdateCommand(request, context, await defaultCustomerCommandDependencies());
  } catch {
    return Response.json({ error: "customer_command_unavailable" }, { status: 503 });
  }
}
