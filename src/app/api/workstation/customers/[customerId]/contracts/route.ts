import {
  defaultCustomerCommandDependencies,
  handleCustomerContractCreateCommand,
} from "@/features/customers/customer-command-handler";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ customerId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    return await handleCustomerContractCreateCommand(request, context, await defaultCustomerCommandDependencies());
  } catch {
    return Response.json({ error: "customer_command_unavailable" }, { status: 503 });
  }
}
