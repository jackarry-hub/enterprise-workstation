import {
  defaultCustomerCommandDependencies,
  handleCustomerCreateCommand,
} from "@/features/customers/customer-command-handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await handleCustomerCreateCommand(request, await defaultCustomerCommandDependencies());
  } catch {
    return Response.json({ error: "customer_command_unavailable" }, { status: 503 });
  }
}
